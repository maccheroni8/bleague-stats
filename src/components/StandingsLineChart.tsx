import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Customized, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { teamLogoUrl } from "../lib/data";
import { teamShortName } from "../../shared/teamNames";
import type { TeamColors } from "../../shared/types";
import { ConditionLine } from "./ConditionTitle";
import { StandingsTrendPlaybackLayer } from "./StandingsTrendPlaybackLayer";
import type { TrendPlayback } from "../lib/trendPlayback";

export interface ChartTeam {
  teamId: string;
  teamName: string;
}

interface StandingsLineChartProps {
  title: string;
  data: Record<string, number | string>[];
  teams: ChartTeam[];
  /** 順位グラフ用: 1位を上に、数値が大きいほど下に表示する */
  reversed?: boolean;
  height?: number;
  /** 指定時、折れ線の色にチームカラー（primary）を使う。未取得のチーム（過去在籍のみの
   * クラブ等、data/team-colors.jsonに無いチーム）は従来通りインデックス由来の虹色にフォールバックする */
  teamColors?: Record<string, TeamColors>;
  /** アニメーション再生中だけ渡す、再生の時計。渡されている間は、ラインとロゴを再生用の層
   * （StandingsTrendPlaybackLayer）が描く。data は再生中も全期間分のまま渡す（軸は動かさない）。設計書378章 */
  playback?: TrendPlayback;
  /** このグラフの最初の日付が、再生全体の何番目か（ワイルドカードのグラフは途中から始まる）。既定は0 */
  playbackOffset?: number;
  /** 再生中のタイトル直下の条件。再生全体でいま何番目の日付まで進んだかを受け取って返す */
  playingConditions?: (playbackIndex: number) => string[];
  /** trueなら値が欠けている区間（undefined）の前後を直線で結ぶ（従来の挙動）。falseにすると
   * 値が欠けている区間で線が途切れる（例: ワイルドカードグラフで、あるチームが地区3位以内に
   * 浮上している期間はプール対象外になり値を持たないため、その区間だけ線を途切れさせたい場合） */
  connectGaps?: boolean;
  /** 順位グラフ（reversed）のY軸domain上限を明示的に上書きする。未指定時はteams.length
   * （凡例に載るチーム数）を使うが、ワイルドカードグラフ（動的な出入り対応）のように
   * 「1日あたりの最大順位（プールの延べ人数、日によって変動しない固定値）」が
   * 「凡例に載る延べチーム数」（出入りにより1日あたりの人数より多くなりうる）と一致しない
   * 場合に、呼び出し側から正しい上限を渡すために使う */
  rankDomainMax?: number;
  /** タイトル直下に添える「選択中の条件」（シーズン・対象期間等。src/lib/conditionLabels.ts参照）。未指定なら出さない */
  conditions?: string[];
  /** 縦軸を固定の範囲・目盛り・書き方にする（勝率推移: .000〜1.000）。未指定なら従来どおり自動 */
  fixedYAxis?: FixedYAxis;
}

/** 縦軸を固定したいグラフ用の指定（設計書389章） */
export interface FixedYAxis {
  domain: [number, number];
  ticks: number[];
  /** 目盛り・ツールチップの値の書き方 */
  format: (value: number) => string;
  /** 目立ちすぎない基準線を引く値（例: 勝率の.500） */
  referenceLine?: number;
  width?: number;
}

/** チーム数に応じて均等に色相を割り振る簡易パレット。teamColorsに無いチーム用のフォールバック */
function fallbackColor(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(total, 1));
  return `hsl(${hue}, 65%, 55%)`;
}

const LOGO_SIZE = 40;

// 末端ロゴが同値で重なった際、順位が下のチームを少しずつ左へずらして視認できるようにする
// 1段あたりのオフセット量（px）。左方向を選んだ理由: 末端ロゴは常にグラフ右端（プロット領域の
// 右端）に描画されるため、右へずらすと右余白を超えてはみ出す恐れがある。上下方向も、順位グラフの
// 1位（プロット領域の最上端）付近では上余白を超える恐れがある。左方向ならプロット領域の内側に
// 十分な余白があり、どの位置でもはみ出しにくい
const TIE_OFFSET_STEP = 10;

export function StandingsLineChart({
  title,
  data,
  teams,
  reversed = false,
  height = 320,
  teamColors,
  playback,
  playbackOffset = 0,
  playingConditions,
  connectGaps = true,
  rankDomainMax,
  conditions,
  fixedYAxis,
}: StandingsLineChartProps) {
  const rankMax = Math.max(rankDomainMax ?? teams.length, 1);
  // アニメーション再生中はdataが徐々に伸びていくため、折れ線の末端（=最新地点）の位置は
  // dataの長さそのものではなく「そのチームの値が定義済みの最後のindex」から都度求める
  // （ワイルドカードグラフ等、チームによって値が欠ける日があるため）
  const lastValidIndexByTeam = useMemo(() => {
    const result = new Map<string, number>();
    for (const t of teams) {
      for (let i = data.length - 1; i >= 0; i--) {
        const v = data[i]![t.teamId];
        if (v !== undefined && v !== null && !Number.isNaN(v as number)) {
          result.set(t.teamId, i);
          break;
        }
      }
    }
    return result;
  }, [data, teams]);

  // 各チームの色を、teams配列の並び順（呼び出し側が渡す「現在の順位が良い順」）を単一の
  // 情報源として決める。下でLineのSVG描画順（＝重なりの手前/奥）をteams配列と逆順に
  // するため、色・Legendの表示順はこのMapを介して元の並び順のまま保つ
  const colorByTeamId = useMemo(() => {
    const m = new Map<string, string>();
    teams.forEach((t, i) => m.set(t.teamId, teamColors?.[t.teamId]?.primary ?? fallbackColor(i, teams.length)));
    return m;
  }, [teams, teamColors]);

  // 末端（＝lastValidIndexByTeamの位置）の日付・値がどちらも一致するチーム同士を「同着」として
  // グループ化し、グループ内での段階（0, 1, 2...）を割り当てる。teams配列を順にスキャンする
  // ため、各グループの0番目は必ず「現在の順位が最も良いチーム」になる。0番目はロゴ位置を
  // ずらさずそのまま描画し、1番目以降は段階に応じて少しずつ左へオフセットする（同値のロゴ同士が
  // 完全に重なって下のチームが一切見えなくなるのを防ぐ）
  const tieOffsetByTeam = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const t of teams) {
      const idx = lastValidIndexByTeam.get(t.teamId);
      if (idx === undefined) continue;
      const v = data[idx]![t.teamId];
      if (v === undefined || v === null || Number.isNaN(v as number)) continue;
      const key = `${idx}:${v}`;
      const list = groups.get(key);
      if (list) list.push(t.teamId);
      else groups.set(key, [t.teamId]);
    }
    const offsets = new Map<string, number>();
    for (const list of groups.values()) {
      list.forEach((teamId, i) => offsets.set(teamId, i));
    }
    return offsets;
  }, [teams, data, lastValidIndexByTeam]);

  const [failedLogos, setFailedLogos] = useState<Set<string>>(new Set());
  const markLogoFailed = (teamId: string) => {
    setFailedLogos((prev) => (prev.has(teamId) ? prev : new Set(prev).add(teamId)));
  };

  return (
    <div className="standings-chart">
      <h3>{title}</h3>
      {playback && playingConditions ? (
        <PlayingConditionLine playback={playback} conditionsAt={playingConditions} />
      ) : (
        conditions && <ConditionLine conditions={conditions} />
      )}
      <ResponsiveContainer width="100%" height={height}>
        {/* topマージンはロゴ半径（LOGO_SIZE/2）分以上確保する。順位グラフの1位は
            プロット領域の最上端ちょうどに位置するため、これが無いとロゴの上部がプロット領域の
            外（＝見切れる位置）にはみ出してしまう */}
        <LineChart data={data} margin={{ top: LOGO_SIZE / 2 + 8, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} minTickGap={24} />
          <YAxis
            reversed={reversed}
            allowDecimals={!reversed}
            // 順位グラフ（reversed）はrechartsの自動目盛り丸め（domain未指定時の[0, 'auto']）に
            // 任せると、実際のチーム数を超えた「きりのいい」上限（例: 13チームなのに16位まで）
            // まで軸が伸びてしまう。順位は1〜チーム数の範囲に収まることが自明なため、domainを
            // 明示的に指定して実データの範囲ちょうどに固定する
            domain={fixedYAxis ? fixedYAxis.domain : reversed ? [1, rankMax] : undefined}
            // domainを固定しても、目盛りの間隔自体はrechartsが自動生成するため（例: 1, 4, 7,
            // 10, 13のように間引かれる）、1位から最下位までの全順位を目盛りとして明示的に指定する
            ticks={fixedYAxis ? fixedYAxis.ticks : reversed ? Array.from({ length: rankMax }, (_, i) => i + 1) : undefined}
            tickFormatter={fixedYAxis ? (v: number) => fixedYAxis.format(v) : undefined}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={fixedYAxis?.width ?? 32}
          />
          {/* 基準線は折れ線より奥（先に描く）。グリッドより少し濃いだけの細い実線 */}
          {fixedYAxis?.referenceLine !== undefined && (
            <ReferenceLine y={fixedYAxis.referenceLine} stroke="var(--fg)" strokeOpacity={0.3} strokeWidth={1} />
          )}
          {/* 再生中は、まだ出ていない日の値が出ないようにツールチップを止める */}
          {!playback && (
            <Tooltip
              contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--fg)" }}
              labelStyle={{ color: "var(--fg)" }}
              formatter={fixedYAxis ? (v: unknown) => (typeof v === "number" ? fixedYAxis.format(v) : String(v)) : undefined}
            />
          )}
          {/* Legendはteams配列（現在の順位が良い順）そのままの表示順にするため、明示的な
              payloadを渡す（下のLine描画順とは独立させる） */}
          <Legend
            wrapperStyle={{ fontSize: 11 }}
            payload={teams.map((t) => ({
              value: teamShortName(t.teamId, t.teamName),
              type: "line" as const,
              color: colorByTeamId.get(t.teamId) ?? "var(--fg)",
            }))}
          />
          {/* 末端ロゴの重なり順（同値の場合に順位が上のチームを手前に表示する）を制御するため、
              teams配列を反転させてLineの描画順（＝SVG内の記述順＝重なりの手前/奥）を逆にする。
              teams配列は常に「現在の順位が良い順」で渡される前提のため、これにより順位が良い
              チームほど後から描画され、他のチームより手前（視覚的に上）に表示される */}
          {[...teams].reverse().map((t) => {
            const color = colorByTeamId.get(t.teamId) ?? "var(--fg)";
            const lastIndex = lastValidIndexByTeam.get(t.teamId);
            const tieOffset = tieOffsetByTeam.get(t.teamId) ?? 0;
            return (
              <Line
                key={t.teamId}
                type="monotone"
                dataKey={t.teamId}
                name={teamShortName(t.teamId, t.teamName)}
                stroke={color}
                dot={playback ? false : (props: any) => {
                  const { cx, cy, index } = props;
                  if (index !== lastIndex || cx === undefined || cy === undefined) {
                    return <circle key={`${t.teamId}-dot-${index}`} cx={cx} cy={cy} r={0} fill="none" />;
                  }
                  const dotX = cx - tieOffset * TIE_OFFSET_STEP;
                  if (failedLogos.has(t.teamId)) {
                    return (
                      <circle
                        key={`${t.teamId}-dot-${index}`}
                        cx={dotX}
                        cy={cy}
                        r={4}
                        fill={color}
                      />
                    );
                  }
                  return (
                    <image
                      key={`${t.teamId}-logo`}
                      href={teamLogoUrl(t.teamId)}
                      x={dotX - LOGO_SIZE / 2}
                      y={cy - LOGO_SIZE / 2}
                      width={LOGO_SIZE}
                      height={LOGO_SIZE}
                      onError={() => markLogoFailed(t.teamId)}
                    />
                  );
                }}
                // 再生中は再生用の層が描くので、こちらの線は見せない（位置の計算には使うので外さない）
                strokeOpacity={playback ? 0 : 1}
                activeDot={!playback}
                strokeWidth={2}
                connectNulls={connectGaps}
                isAnimationActive={false}
              />
            );
          })}
          {playback && (
            <Customized
              component={
                <StandingsTrendPlaybackLayer
                  playback={playback}
                  playbackOffset={playbackOffset}
                  teams={teams}
                  colorByTeamId={colorByTeamId}
                  connectGaps={connectGaps}
                  logoSize={LOGO_SIZE}
                  tieOffsetStep={TIE_OFFSET_STEP}
                  failedLogos={failedLogos}
                  onLogoError={markLogoFailed}
                />
              }
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** 再生中のタイトル直下の条件。日付が1日進んだときだけ、この1行だけを描き直す */
function PlayingConditionLine({
  playback,
  conditionsAt,
}: {
  playback: TrendPlayback;
  conditionsAt: (playbackIndex: number) => string[];
}) {
  const [index, setIndex] = useState(() => Math.floor(playback.getProgress()));
  useEffect(() => playback.subscribe((progress) => setIndex(Math.floor(progress))), [playback]);
  return <ConditionLine conditions={conditionsAt(index)} />;
}
