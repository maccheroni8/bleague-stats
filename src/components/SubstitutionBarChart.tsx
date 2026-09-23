import { useState, type ReactNode } from "react";
import { useMediaQuery } from "../lib/useMediaQuery";
import { createPortal } from "react-dom";
import { periodDurationSeconds, type PeriodBoundary, type TimeoutMark } from "../lib/leadTracker";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { formatSigned } from "../lib/format";
import type { CourtInterval } from "../../shared/foreignOnCourt";

export interface SubstitutionInterval {
  startSec: number;
  endSec: number;
  /** この区間中の自チーム/相手チームの得点（ツールチップの「10-8」形式表示用。shared/onCourt.ts参照） */
  ownPts: number;
  oppPts: number;
}

export interface SubstitutionRow {
  playerId: string;
  /** 表示名（名字のみ。lib/playerSurname.ts）。フルネームはfullNameでツールチップ（title）に出す */
  name: string;
  fullName?: string;
  /** ボックススコアの出場時間（"MM:SS"または"DNP"）。名前とバーの間の列に表示する */
  playTime?: string;
  intervals: SubstitutionInterval[];
}

interface TeamSubstitutionBlockProps {
  teamName: string;
  starters: SubstitutionRow[];
  bench: SubstitutionRow[];
  periodBoundaries: PeriodBoundary[];
  totalSeconds: number;
  color: string;
  timeouts: TimeoutMark[];
  homeColor?: string;
  awayColor?: string;
  foreignFourIntervals: CourtInterval[];
  onSegmentHover: (e: React.MouseEvent<HTMLElement>, lines: string[]) => void;
  onSegmentLeave: () => void;
}

interface SubstitutionBarChartProps {
  homeTeamName: string;
  awayTeamName: string;
  /** スマホ幅（560px以下）で下の注記「タイムアウト（◯◯色/…）」だけに使う略称（チーム見出しはフルの名前のまま） */
  homeShortName?: string;
  awayShortName?: string;
  homeStarters: SubstitutionRow[];
  homeBench: SubstitutionRow[];
  awayStarters: SubstitutionRow[];
  awayBench: SubstitutionRow[];
  periodBoundaries: PeriodBoundary[];
  totalSeconds: number;
  /** data/team-colors.json由来のチームカラー。未指定時は既存のvar(--accent)/var(--muted)にフォールバックする */
  homeColor?: string;
  awayColor?: string;
  /** Lead Trackerと同じタイムアウトマーク（buildTimeoutMarks()の結果をそのまま渡す） */
  timeouts?: TimeoutMark[];
  /**
   * オンザコート4（日本人以外の選手が4人同時に在コート）の時間帯。チームごとの選手行全体を
   * 枠で囲んで示す（shared/foreignOnCourt.ts）
   */
  homeForeignFourIntervals?: CourtInterval[];
  awayForeignFourIntervals?: CourtInterval[];
  /**
   * ホームとアウェイの選手行の間に、同じ時間軸で描く要素（LeadTrackerChartのembedded表示）。
   * 選手行と同じ横幅（min-width含む）のブロックに入れるため、横スクロール時も一緒に動く
   */
  leadTracker?: ReactNode;
}

interface TooltipState {
  x: number;
  y: number;
  lines: string[];
}

function pct(sec: number, totalSeconds: number): number {
  return (sec / totalSeconds) * 100;
}

/** そのピリオドの残り時間形式で表示する（Lead Trackerのツールチップと同じ書式） */
function formatElapsedTime(sec: number, periodBoundaries: PeriodBoundary[]): string {
  let current = periodBoundaries[0];
  for (const b of periodBoundaries) {
    if (b.startSec <= sec) current = b;
    else break;
  }
  if (!current) return "";
  const elapsedInPeriod = sec - current.startSec;
  const remaining = Math.max(0, periodDurationSeconds(current.period) - elapsedInPeriod);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${current.label} 残り${m}:${String(s).padStart(2, "0")}`;
}

/** 「自チーム得点-相手得点 (得失点差)」。差は自チーム基準で、上回れば+、下回れば-、同点は0 */
function formatPointsWithDiff(own: number, opp: number): string {
  return `${own}-${opp} (${formatSigned(own - opp, 0)})`;
}

/** 複数行（IN時刻・OUT時刻・出場時間・得失点）を行の配列で返す。呼び出し側が1行ずつ描画する */
function segmentTooltipLines(iv: SubstitutionInterval, periodBoundaries: PeriodBoundary[]): string[] {
  const inTime = formatElapsedTime(iv.startSec, periodBoundaries);
  const outTime = formatElapsedTime(iv.endSec, periodBoundaries);
  const duration = formatMinutesFromSeconds(iv.endSec - iv.startSec);
  return [`IN: ${inTime}`, `OUT: ${outTime}`, `出場時間: ${duration}`, `得失点: ${formatPointsWithDiff(iv.ownPts, iv.oppPts)}`];
}

/** オンザコート4の枠のツールチップ（選手の区間と同じ書式。得失点は区間中のチーム全体） */
function fourTooltipLines(iv: CourtInterval, periodBoundaries: PeriodBoundary[]): string[] {
  return [
    "オンザコート4",
    `IN: ${formatElapsedTime(iv.startSec, periodBoundaries)}`,
    `OUT: ${formatElapsedTime(iv.endSec, periodBoundaries)}`,
    `出場時間: ${formatMinutesFromSeconds(iv.endSec - iv.startSec)}`,
    `得失点: ${formatPointsWithDiff(iv.ownPoints, iv.oppPoints)}`,
  ];
}

/**
 * Lead Trackerと同じperiodBoundaries/totalSecondsを受け取り、選手ごとの在コート区間を
 * 横棒（ガントチャート的な）表示で描く。rechartsではなくCSS(flex + 絶対配置)で組んでいる
 * （選手1人が複数区間を持ちうるため、rechartsのBar系コンポーネントでは表現しづらい。DESIGN.md参照）。
 *
 * 選手名欄＋出場時間欄の固定幅ガター（150px）と、組み込むLead Trackerのembedded表示のY軸幅を
 * 同じにしているため、両者のプロット領域の左右端はピクセル単位で一致する。
 *
 * 区間セグメントのツールチップは、ネイティブのtitle属性ではなく自前描画（React state +
 * document.bodyへのportal）で実装している。ネイティブtitleはブラウザ側のツールチップ
 * 制御が「クリック等のユーザー操作の後、他の要素にカーソルを移しても再表示されなくなり
 * リロードでのみ復帰する」という既知の挙動を持つため（2026-08-18に不具合報告・調査済み）。
 * .substitution-chartはoverflow-x: autoで横スクロールする（＝overflow-yも仕様上自動的に
 * autoになる）ため、ツールチップをそのまま子要素として絶対配置すると上端付近の行で
 * クリップされる恐れがある。position: fixedかつdocument.bodyへのportalにすることで、
 * このスクロールコンテナの影響を受けずに常にカーソル上に表示できる
 */
export function SubstitutionBarChart({
  homeTeamName,
  awayTeamName,
  homeShortName,
  awayShortName,
  homeStarters,
  homeBench,
  awayStarters,
  awayBench,
  periodBoundaries,
  totalSeconds,
  homeColor,
  awayColor,
  timeouts = [],
  homeForeignFourIntervals = [],
  awayForeignFourIntervals = [],
  leadTracker,
}: SubstitutionBarChartProps) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const handleSegmentHover = (e: React.MouseEvent<HTMLElement>, lines: string[]) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ x: rect.left + rect.width / 2, y: rect.top, lines });
  };
  const handleSegmentLeave = () => setTooltip(null);

  return (
    <div className="substitution-chart">
      <TimeAxisHeader periodBoundaries={periodBoundaries} totalSeconds={totalSeconds} />
      <TeamSubstitutionBlock
        teamName={homeTeamName}
        starters={homeStarters}
        bench={homeBench}
        periodBoundaries={periodBoundaries}
        totalSeconds={totalSeconds}
        color={homeColor ?? "var(--accent)"}
        timeouts={timeouts}
        homeColor={homeColor}
        awayColor={awayColor}
        foreignFourIntervals={homeForeignFourIntervals}
        onSegmentHover={handleSegmentHover}
        onSegmentLeave={handleSegmentLeave}
      />
      {leadTracker && <div className="sub-bar-lead">{leadTracker}</div>}
      <TeamSubstitutionBlock
        teamName={awayTeamName}
        starters={awayStarters}
        bench={awayBench}
        periodBoundaries={periodBoundaries}
        totalSeconds={totalSeconds}
        color={awayColor ?? "var(--muted)"}
        timeouts={timeouts}
        homeColor={homeColor}
        awayColor={awayColor}
        foreignFourIntervals={awayForeignFourIntervals}
        onSegmentHover={handleSegmentHover}
        onSegmentLeave={handleSegmentLeave}
      />
      {timeouts.length > 0 && (
        <p className="sub-bar-note">
          点線: タイムアウト（{narrow && homeShortName ? homeShortName : homeTeamName}色/{narrow && awayShortName ? awayShortName : awayTeamName}色。オフィシャルタイムアウトは基準色）
        </p>
      )}
      {(homeForeignFourIntervals.length > 0 || awayForeignFourIntervals.length > 0) && (
        <p className="sub-bar-note">
          {homeForeignFourIntervals.length > 0 && (
            <span className="sub-bar-legend-four" style={{ borderColor: homeColor ?? "var(--accent)" }} />
          )}
          {awayForeignFourIntervals.length > 0 && (
            <span className="sub-bar-legend-four" style={{ borderColor: awayColor ?? "var(--muted)" }} />
          )}
          枠: オンザコート4（外国籍・帰化・アジア特別枠の選手が4人同時に出場している時間帯。枠線にカーソルを当てると詳細を表示）
        </p>
      )}
      {tooltip &&
        createPortal(
          <div className="sub-bar-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
            {tooltip.lines.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function TimeAxisHeader({
  periodBoundaries,
  totalSeconds,
}: {
  periodBoundaries: PeriodBoundary[];
  totalSeconds: number;
}) {
  return (
    <div className="sub-bar-row sub-bar-header">
      <div className="sub-bar-label" />
      <div className="sub-bar-min">出場</div>
      <div className="sub-bar-track">
        {periodBoundaries.map((b) => (
          <span key={b.period} className="sub-bar-axis-label" style={{ left: `${pct(b.startSec, totalSeconds)}%` }}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TeamSubstitutionBlock({
  teamName,
  starters,
  bench,
  periodBoundaries,
  totalSeconds,
  color,
  timeouts,
  homeColor,
  awayColor,
  foreignFourIntervals,
  onSegmentHover,
  onSegmentLeave,
}: TeamSubstitutionBlockProps) {
  // スタメン5人を上5段に固定し、ベンチは出場時間のある選手を先に詰めて表示、
  // DNP（出場0分）の選手を最後尾にまとめる（「スタメン」「ベンチ」ラベルは廃止し、
  // スタメンは名前の先頭に"*"を付けて区別する）
  const benchPlayed = bench.filter((r) => r.intervals.length > 0);
  const benchDnp = bench.filter((r) => r.intervals.length === 0);
  const rows: (SubstitutionRow & { isStarter: boolean })[] = [
    ...starters.map((r) => ({ ...r, isStarter: true })),
    ...benchPlayed.map((r) => ({ ...r, isStarter: false })),
    ...benchDnp.map((r) => ({ ...r, isStarter: false })),
  ];
  return (
    <div className="sub-bar-team">
      <h4 className="sub-bar-team-name">{teamName}</h4>
      <div className="sub-bar-rows">
        {rows.map((row) => (
          <div className="sub-bar-row" key={row.playerId}>
            <div className="sub-bar-label" title={row.fullName ?? row.name}>
              {row.isStarter ? `*${row.name}` : row.name}
            </div>
            {/* DNPは出場時間の列に表示する（バーの位置には出さない） */}
            <div className={row.intervals.length === 0 || row.playTime === "DNP" ? "sub-bar-min dnp" : "sub-bar-min"}>
              {row.intervals.length === 0 ? "DNP" : (row.playTime ?? "")}
            </div>
            <div className="sub-bar-track">
              {periodBoundaries
                .filter((b) => b.startSec > 0)
                .map((b) => (
                  <div key={b.period} className="sub-bar-gridline" style={{ left: `${pct(b.startSec, totalSeconds)}%` }} />
                ))}
              {timeouts.map((t, i) => (
                <div
                  key={`timeout-${i}`}
                  className="sub-bar-timeout-line"
                  style={{
                    left: `${pct(t.elapsedSec, totalSeconds)}%`,
                    borderColor: t.homeAway === 1 ? (homeColor ?? "var(--accent)") : t.homeAway === 2 ? (awayColor ?? "var(--muted)") : "var(--fg)",
                  }}
                />
              ))}
              {row.intervals.map((iv, i) => (
                  <div
                    key={i}
                    className="sub-bar-segment"
                    onMouseEnter={(e) => onSegmentHover(e, segmentTooltipLines(iv, periodBoundaries))}
                    onMouseLeave={onSegmentLeave}
                    style={{
                      left: `${pct(iv.startSec, totalSeconds)}%`,
                      width: `${pct(iv.endSec - iv.startSec, totalSeconds)}%`,
                      background: color,
                    }}
                  />
              ))}
            </div>
          </div>
        ))}
        {foreignFourIntervals.length > 0 && (
          <div className="sub-bar-four-layer">
            {foreignFourIntervals.map((iv, i) => (
              // 枠の内側は選手の区間のツールチップを優先し、枠線の上（上下左右の辺）でだけ枠のツールチップを出す
              <div
                key={i}
                className="sub-bar-four-box"
                style={{
                  left: `${pct(iv.startSec, totalSeconds)}%`,
                  width: `${pct(iv.endSec - iv.startSec, totalSeconds)}%`,
                  borderColor: color,
                }}
              >
                {(["top", "bottom", "left", "right"] as const).map((edge) => (
                  <div
                    key={edge}
                    className={`sub-bar-four-edge ${edge}`}
                    onMouseEnter={(e) => onSegmentHover(e, fourTooltipLines(iv, periodBoundaries))}
                    onMouseLeave={onSegmentLeave}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
