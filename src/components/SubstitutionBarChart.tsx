import type { PeriodBoundary } from "../lib/leadTracker";

export interface SubstitutionRow {
  playerId: string;
  name: string;
  intervals: { startSec: number; endSec: number }[];
}

interface TeamSubstitutionBlockProps {
  teamName: string;
  starters: SubstitutionRow[];
  bench: SubstitutionRow[];
  periodBoundaries: PeriodBoundary[];
  totalSeconds: number;
  color: string;
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
}

function pct(sec: number, totalSeconds: number): number {
  return (sec / totalSeconds) * 100;
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
      />
      <TeamSubstitutionBlock
        teamName={awayTeamName}
        starters={awayStarters}
        bench={awayBench}
        periodBoundaries={periodBoundaries}
        totalSeconds={totalSeconds}
        color={awayColor ?? "var(--muted)"}
      />
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

function TeamSubstitutionBlock({ teamName, starters, bench, periodBoundaries, totalSeconds, color }: TeamSubstitutionBlockProps) {
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
            {row.intervals.length === 0 ? (
              <span className="sub-bar-dnp">DNP</span>
            ) : (
              row.intervals.map((iv, i) => (
                <div
                  key={i}
                  className="sub-bar-segment"
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
