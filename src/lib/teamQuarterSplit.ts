// チーム詳細の「Q別」タブ（1Q〜4Q・前半・後半・延長の行別の表）。
// 値はチームスタッツタブでQ別・前後半を選んだときと同じ集計（teamSeasonPeriod.ts の buildSeasonPeriodRow ＝ sumTeamPeriodTotals）を使い、新しく数えない。
// 上の表（得点・失点・得失点・ORtg・DRtg・NetRtg）は、その合計（得点・失点・攻撃回数）から出す。レーティングは足してから割る（試合ごとの率の平均ではない）。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { offensiveRating } from "../../shared/formulas";
import type { TeamGameLog } from "../../shared/types";
import { formatDecimal, formatSigned } from "./format";
import type { SeasonDisplayMode } from "./playerSeasonBoxscore";
import { buildSeasonPeriodRow, type SeasonPeriodRow } from "./teamSeasonPeriod";
import { countPeriodResults, type TeamPeriodSource, type TeamPeriodValue } from "./teamPeriodTotals";
import { EMPTY_TOTALS } from "./teamStatsColumns";

/** 行の並びと名前 */
export const QUARTER_ROWS: readonly { value: TeamPeriodValue; label: string }[] = [
  { value: "q1", label: "1Q" },
  { value: "q2", label: "2Q" },
  { value: "q3", label: "3Q" },
  { value: "q4", label: "4Q" },
  { value: "h1", label: "前半" },
  { value: "h2", label: "後半" },
  { value: "ot", label: "延長" },
  { value: "clutch", label: "クラッチ" },
];

/** その区間の勝ち越し・負け越し・同点の数（試合の勝敗は SeasonPeriodRow の wins・losses）。合計は games.length と一致する */
export interface QuarterResults {
  periodWins: number;
  periodLosses: number;
  periodTies: number;
}

export type QuarterRow = SeasonPeriodRow & QuarterResults & { value: TeamPeriodValue; label: string };

/** 区間の勝率。同点は0.5勝として数える（勝ち越し＋同点×0.5）÷ 試合数。試合が無ければ null */
export function periodWinPct(r: QuarterResults): number | null {
  const n = r.periodWins + r.periodLosses + r.periodTies;
  return n === 0 ? null : (r.periodWins + r.periodTies / 2) / n;
}

/** 区間の勝敗の表記。「7勝5敗1分」（同点が無いときは「7勝5敗」） */
export function formatPeriodRecord(r: QuarterResults): string {
  return `${r.periodWins}勝${r.periodLosses}敗${r.periodTies > 0 ? `${r.periodTies}分` : ""}`;
}

/** 絞り込んだ試合ログ（試合種別）から、7つの区間の行を作る。source が無い（読み込み中・読めない）ときは status で表す */
export function buildQuarterRows(
  season: string,
  source: TeamPeriodSource | null,
  loading: boolean,
  logs: readonly TeamGameLog[],
): QuarterRow[] {
  const state = loading ? ({ status: "loading" } as const) : source ? ({ status: "ready", source } as const) : ({ status: "unreadable" } as const);
  return QUARTER_ROWS.map((q) => {
    const base = buildSeasonPeriodRow(season, state, logs, q.value, EMPTY_TOTALS);
    const res = base.status === "ready" && source ? countPeriodResults(source, logs, q.value) : { wins: 0, losses: 0, ties: 0 };
    return { ...base, ...q, periodWins: res.wins, periodLosses: res.losses, periodTies: res.ties };
  });
}

export interface QuarterScoreCells {
  pts: string;
  oppPts: string;
  diff: string;
  ortg: string;
  drtg: string;
  netRtg: string;
}

const DASH: QuarterScoreCells = { pts: "-", oppPts: "-", diff: "-", ortg: "-", drtg: "-", netRtg: "-" };

/**
 * 上の表の1行。平均は数えた試合数（延長は延長のあった試合の数）で割る。
 * ORtg＝100×得点÷攻撃回数、DRtg＝100×失点÷攻撃回数（合計どうしを割る）、NetRtg＝丸める前の ORtg−DRtg
 */
export function quarterScoreCells(row: QuarterRow, mode: SeasonDisplayMode): QuarterScoreCells {
  if (row.status !== "ready") return DASH;
  const g = row.games.length;
  const { pts, oppPts, poss } = row.totals;
  const scale = (v: number) => (mode === "total" ? v : v / g);
  const digits = mode === "total" ? 0 : 2;
  const ratings = poss > 0;
  const ortg = offensiveRating(pts, poss);
  const drtg = offensiveRating(oppPts, poss);
  return {
    pts: formatDecimal(scale(pts), digits),
    oppPts: formatDecimal(scale(oppPts), digits),
    // 全チームスタッツの +/- の視点と同じく、平均にしてから引く（丸めの端数まで一致させる）
    diff: formatSigned(scale(pts) - scale(oppPts), digits),
    ortg: ratings ? formatDecimal(ortg) : "-",
    drtg: ratings ? formatDecimal(drtg) : "-",
    netRtg: ratings ? formatSigned(ortg - drtg) : "-",
  };
}
