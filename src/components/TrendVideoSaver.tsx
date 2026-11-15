import { useEffect, useRef, useState } from "react";
import { SaveModal, SaveModalPreview } from "./SaveModal";
import { baseDateFooterText } from "../lib/exportFormat";
import { exportHeadingLines } from "../lib/exportHeading";
import { resolveBaseDate } from "../lib/dataBaseDate";
import { buildExportFilename } from "../lib/conditionLabels";
import { EXPORT_ACCOUNT_NAME } from "../lib/exportImage";
import { LEAGUE_LABELS, leagueScopeLabel, useLeague } from "../lib/league";
import { loadLogoImages } from "../lib/logoDataUrl";
import { TREND_STEP_MS } from "../lib/trendPlayback";
import {
  pickVideoFormat,
  recordTrendVideo,
  VIDEO_HEIGHT,
  VIDEO_HOLD_END_MS,
  VIDEO_HOLD_START_MS,
  VIDEO_WIDTH,
  type TrendVideoAxis,
  type TrendVideoTeam,
} from "../lib/trendVideo";

/** 動画にできるグラフ1つ分（地区別・ワイルドカード・全体のどれか）。中身は画面のグラフと同じ値 */
export interface TrendVideoChart {
  key: string;
  /** 選ぶときの名前（「東地区」「ワイルドカード」「全体」） */
  label: string;
  /** 見出しの2行目（「東地区順位推移」） */
  title: string;
  rows: Record<string, number | string>[];
  teams: TrendVideoTeam[];
  axis: TrendVideoAxis;
  connectGaps: boolean;
  /** サブタイトル。index はそのグラフの最初の日が0。最後の形のときは undefined */
  subtitleAt: (index: number | undefined) => string;
}

type SpeedChoice = "standard" | "30" | "15";
const SPEED_LABELS: Record<SpeedChoice, string> = { standard: "標準（画面のアニメーションと同じ速さ）", "30": "30秒", "15": "15秒" };
const SPEED_ORDER: SpeedChoice[] = ["standard", "30", "15"];
/** Xの動画の上限（2分20秒）に収める。標準でもこれを超えないようにする */
const MAX_MOVING_MS = 120_000;

function movingMsOf(speed: SpeedChoice, days: number): number {
  if (speed === "30") return 30_000;
  if (speed === "15") return 15_000;
  return Math.min(Math.max(days - 1, 1) * TREND_STEP_MS, MAX_MOVING_MS);
}

/**
 * 推移グラフを動画（MP4）にして保存する（設計書395章）。パソコンの Chrome 向け。
 * 画面のアニメーションとは別の描画面に、同じ式で線とロゴを描いて録画する。グラフは1本ずつ（地区・ワイルドカード・全体から選ぶ）
 */
export function TrendVideoSaver({
  tabName,
  season,
  seasonLabel,
  charts,
  disabledReason,
}: {
  /** タブの名前（ファイル名に入れる「順位推移」など） */
  tabName: string;
  season: string;
  seasonLabel: string;
  charts: TrendVideoChart[];
  /** アニメーション再生中など、いまは作れない理由 */
  disabledReason?: string;
}) {
  const league = useLeague();
  const [chartKey, setChartKey] = useState(charts[0]?.key ?? "");
  const [speed, setSpeed] = useState<SpeedChoice>("standard");
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const format = pickVideoFormat();

  // 選んでいたグラフが無くなったとき（シーズン・リーグの切り替え）は先頭に戻す
  useEffect(() => {
    if (!charts.some((c) => c.key === chartKey)) setChartKey(charts[0]?.key ?? "");
  }, [charts, chartKey]);
  // ページを離れたら作成を中止する
  useEffect(() => () => abortRef.current?.abort(), []);

  const chart = charts.find((c) => c.key === chartKey) ?? charts[0];
  if (!chart) return null;

  const make = async () => {
    const ac = new AbortController();
    abortRef.current = ac;
    setMessage(null);
    setProgress(0);
    try {
      const [logos, baseDate] = await Promise.all([
        loadLogoImages(chart.teams.map((t) => t.teamId)),
        resolveBaseDate({ kind: "season", season, gameType: "regular" }, league),
      ]);
      const heading = exportHeadingLines(chart.title, LEAGUE_LABELS[league], seasonLabel, leagueScopeLabel(league, true));
      const movingMs = movingMsOf(speed, chart.rows.length);
      if (!format) throw new Error("no-recorder");
      const result = await recordTrendVideo(
        {
          scope: heading.scope,
          title: heading.name,
          subtitleAt: chart.subtitleAt,
          rows: chart.rows,
          teams: chart.teams,
          axis: chart.axis,
          connectGaps: chart.connectGaps,
          footerLeft: baseDateFooterText(baseDate) || undefined,
          footerRight: EXPORT_ACCOUNT_NAME,
          logos,
        },
        { durationMs: movingMs, format, onProgress: setProgress, signal: ac.signal },
      );
      const name = `${LEAGUE_LABELS[league]}_${buildExportFilename(
        [seasonLabel, ...(chart.key === "all" ? [] : [chart.label]), tabName, "動画"],
        result.format.ext,
      )}`;
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      const mb = (result.blob.size / 1024 / 1024).toFixed(1);
      setMessage(
        `${name} を保存しました（${Math.round(result.seconds)}秒・${mb}MB）` +
          (result.format.ext === "webm" ? "。このブラウザでは MP4 を作れなかったため WebM です（X に投稿するときは MP4 に変換が必要です）" : ""),
      );
    } catch (e) {
      setMessage(e instanceof DOMException && e.name === "AbortError" ? "動画の作成を中止しました" : "動画を作れませんでした。もう一度お試しください");
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const making = progress !== null;
  const movingMs = movingMsOf(speed, chart.rows.length);
  const totalSec = Math.round((VIDEO_HOLD_START_MS + movingMs + VIDEO_HOLD_END_MS) / 1000);
  const heading = exportHeadingLines(chart.title, LEAGUE_LABELS[league], seasonLabel, leagueScopeLabel(league, true));

  return (
    <>
      <button type="button" className="export-image-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {making ? `動画を作成中… ${Math.round((progress ?? 0) * 100)}%` : "動画"}
      </button>
      <SaveModal open={open} title="動画として保存" onClose={() => setOpen(false)}>
        <SaveModalPreview scope={heading.scope} name={heading.name} subtitle={chart.subtitleAt(undefined)} />
        <div className="save-modal-options">
          {charts.length > 1 && (
            <label className="save-modal-field">
              グラフ
              <select value={chart.key} disabled={making} onChange={(e) => setChartKey(e.target.value)} aria-label="動画にするグラフ">
                {charts.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="save-modal-field">
            速さ
            <select value={speed} disabled={making} onChange={(e) => setSpeed(e.target.value as SpeedChoice)} aria-label="動画の速さ">
              {SPEED_ORDER.map((k) => (
                <option key={k} value={k}>
                  {SPEED_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="save-modal-note">
          {VIDEO_WIDTH}×{VIDEO_HEIGHT}・{format ? (format.ext === "mp4" ? "MP4" : "WebM") : "—"}・約{totalSec}秒。作っている間は、このタブを表示したままにしてください。
        </p>
        {making && (
          <>
            <progress className="save-modal-progress" max={1} value={progress ?? 0} aria-label="動画の作成の進み具合" />
            <p className="save-modal-status" role="status">
              作成中… {Math.round((progress ?? 0) * 100)}%
            </p>
          </>
        )}
        {!format && <p className="save-modal-reason">この環境では動画を作れません（パソコンの Chrome で開いてください）</p>}
        {disabledReason && <p className="save-modal-reason">{disabledReason}</p>}
        {message && (
          <p className="save-modal-status" role="status">
            {message}
          </p>
        )}
        <div className="save-modal-actions">
          {making ? (
            <button type="button" className="save-modal-secondary" onClick={() => abortRef.current?.abort()}>
              中止
            </button>
          ) : (
            <button type="button" className="save-modal-primary" disabled={!format || !!disabledReason} onClick={() => void make()}>
              動画を作る
            </button>
          )}
        </div>
      </SaveModal>
    </>
  );
}
