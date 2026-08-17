import { periodDurationSeconds, type PeriodBoundary, type TimeoutMark } from "../lib/leadTracker";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";

export interface SubstitutionInterval {
  startSec: number;
  endSec: number;
  /** この区間中の自チーム/相手チームの得点（ツールチップの「10-8」形式表示用。shared/onCourt.ts参照） */
  ownPts: number;
  oppPts: number;
}

export interface SubstitutionRow {
  playerId: string;
  name: string;
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
}

interface SubstitutionBarChartProps {
  homeTeamName: string;
  awayTeamName: string;
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

function segmentTooltip(iv: SubstitutionInterval, periodBoundaries: PeriodBoundary[]): string {
  const inTime = formatElapsedTime(iv.startSec, periodBoundaries);
  const duration = formatMinutesFromSeconds(iv.endSec - iv.startSec);
  return `IN: ${inTime}\n出場時間: ${duration}\n得失点: ${iv.ownPts}-${iv.oppPts}`;
}

/**
 * Lead Trackerと同じperiodBoundaries/totalSecondsを受け取り、選手ごとの在コート区間を
 * 横棒（ガントチャート的な）表示で描く。rechartsではなくCSS(flex + 絶対配置)で組んでいる
 * （選手1人が複数区間を持ちうるため、rechartsのBar系コンポーネントでは表現しづらい。DESIGN.md参照）。
 *
 * Lead Trackerと完全にピクセル単位で揃っているわけではない（Lead Trackerのプロット領域は
 * rechartsのYAxis幅で決まり、こちらは選手名ラベル分の固定幅ガター(130px)を使うため左端の
 * 開始位置が微妙にズレる）が、時間軸のドメイン(0〜totalSeconds)と各Qの区切り線・ラベルは
 * 完全に同じものを使っているため、見比べれば十分に対応関係がわかる。
 */
export function SubstitutionBarChart({
  homeTeamName,
  awayTeamName,
  homeStarters,
  homeBench,
  awayStarters,
  awayBench,
  periodBoundaries,
  totalSeconds,
  homeColor,
  awayColor,
  timeouts = [],
}: SubstitutionBarChartProps) {
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
      />
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
      />
      {timeouts.length > 0 && (
        <p className="sub-bar-note">
          点線: タイムアウト（{homeTeamName}色/{awayTeamName}色。オフィシャルタイムアウトは基準色）
        </p>
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
      {rows.map((row) => (
        <div className="sub-bar-row" key={row.playerId}>
          <div className="sub-bar-label" title={row.name}>
            {row.isStarter ? `*${row.name}` : row.name}
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
            {row.intervals.length === 0 ? (
              <span className="sub-bar-dnp">DNP</span>
            ) : (
              row.intervals.map((iv, i) => (
                <div
                  key={i}
                  className="sub-bar-segment"
                  title={segmentTooltip(iv, periodBoundaries)}
                  style={{
                    left: `${pct(iv.startSec, totalSeconds)}%`,
                    width: `${pct(iv.endSec - iv.startSec, totalSeconds)}%`,
                    background: color,
                  }}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
