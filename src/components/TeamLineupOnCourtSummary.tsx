import type { CSSProperties } from "react";
import { StatHeaderLabel } from "./StatHeaderLabel";
import { highlightStrength } from "./GameLineupTable";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { formatDecimal, formatSigned } from "../lib/format";
import { statDescription } from "../lib/statDescriptions";
import type { RangeTotals } from "../lib/gameLineups";
import type { SeasonOnCourtRow } from "../lib/teamLineupOnCourt";

/**
 * チーム詳細「よく使われるラインナップ」のオンザコート別の合計（試合詳細の「オンザコート別の合計」のシーズン版）。
 * 行は人数（上限から0）と集計外。行を押すと、下の5人組の一覧をその人数の組だけに絞る（もう一度押すと解除）。
 * perGame を渡すと、出場時間・得点・失点・得失点をその試合数で割った1試合平均で出す（割合・レーティングは変わらない）
 */
export function TeamLineupOnCourtSummary({
  rows,
  totals,
  real,
  color,
  selected,
  onSelect,
  perGame,
}: {
  rows: SeasonOnCourtRow[];
  totals: RangeTotals;
  /** ORtg・DRtg・NetRtg が実際のポゼッションで計算した値か（false は推定値） */
  real: boolean;
  color: string;
  selected: number | null | undefined;
  onSelect: (count: number | null) => void;
  /** 1試合平均で出すときの試合数（未指定・0以下は合計） */
  perGame?: number;
}) {
  const avg = perGame !== undefined && perGame > 0;
  const time = (sec: number) => formatMinutesFromSeconds(avg ? Math.round(sec / perGame!) : sec);
  const pts = (v: number) => (avg ? formatDecimal(v / perGame!) : String(v));
  const net = (v: number) => (avg ? formatSigned(v / perGame!, 1) : formatSigned(v, 0));
  const rtg = (label: "ORtg" | "DRtg" | "NetRtg") => ({
    label: real ? label : `${label}（推定）`,
    title: statDescription(real ? `オンザコート別の${label}` : `オンザコート別の${label}（推定）`, "team"),
  });
  const headers = [
    { label: "OC", title: statDescription("OC", "team") },
    { label: "出場時間", title: statDescription("オンザコート別の出場時間", "team") },
    { label: "得点", title: statDescription("得点", "team") },
    { label: "失点", title: statDescription("失点", "team") },
    { label: "得失点", title: statDescription("得失点", "team") },
    { label: "割合", title: statDescription("オンザコート別の割合", "team") },
    rtg("ORtg"),
    rtg("DRtg"),
    rtg("NetRtg"),
  ];
  return (
    <div className="game-oc-summary table-scroll">
      <table className="sortable-table game-oc-summary-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={h.label} className={i === 0 ? "align-left" : "align-right"} title={h.title}>
                <StatHeaderLabel label={h.label} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            // 時間も得点も無い人数の行は塗らない
            const strength = s.seconds > 0 || s.ownPoints > 0 || s.oppPoints > 0 ? highlightStrength(s.count, undefined) : undefined;
            const isSelected = selected === s.count;
            return (
              <tr
                key={s.count ?? "excluded"}
                className={["game-oc-row", strength ? "row-highlight" : "", strength === "half" ? "row-highlight-half" : "", isSelected ? "is-selected" : ""]
                  .filter(Boolean)
                  .join(" ")}
                style={strength ? ({ "--row-highlight-color": color } as CSSProperties) : undefined}
                onClick={() => onSelect(s.count)}
                tabIndex={0}
                aria-pressed={isSelected}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(s.count);
                  }
                }}
              >
                <td className="align-left" title={s.count === null ? statDescription("集計外", "team") : undefined}>
                  {s.count === null ? "集計外" : s.count}
                  {isSelected ? " ✓" : ""}
                </td>
                <td className="align-right">{time(s.seconds)}</td>
                <td className="align-right">{pts(s.ownPoints)}</td>
                <td className="align-right">{pts(s.oppPoints)}</td>
                <td className="align-right">{net(s.netPoints)}</td>
                <td className="align-right" title={s.count === null ? undefined : statDescription(`OC${s.count}%`, "team")}>
                  {s.pct === null ? "-" : `${formatDecimal(s.pct)}%`}
                </td>
                <td className="align-right">{s.ortg === null ? "-" : formatDecimal(s.ortg)}</td>
                <td className="align-right">{s.drtg === null ? "-" : formatDecimal(s.drtg)}</td>
                <td className="align-right">{s.netRtg === null ? "-" : formatSigned(s.netRtg)}</td>
              </tr>
            );
          })}
          <tr className="game-oc-total">
            <td className="align-left">合計</td>
            <td className="align-right">{time(totals.seconds)}</td>
            <td className="align-right">{pts(totals.ownPoints)}</td>
            <td className="align-right">{pts(totals.oppPoints)}</td>
            <td className="align-right">{net(totals.ownPoints - totals.oppPoints)}</td>
            <td className="align-right" />
            <td className="align-right" />
            <td className="align-right" />
            <td className="align-right" />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
