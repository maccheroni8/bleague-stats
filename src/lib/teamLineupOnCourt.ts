// チーム詳細「よく使われるラインナップ」のオンザコート（OC）。5人組ごとの人数と、シーズン単位のオンザコート別の合計（試合詳細の「オンザコート別の合計」のシーズン版）。
// 元データはラインナップのファイル（data/{season}/lineups/{teamId}.json。レギュラーシーズン＋ポストシーズン）と、シーズンの選手一覧の登録区分。
// 人数の数え方・集計外の扱いは試合詳細と同じ（shared/foreignOnCourt.ts の foreignCountInLineup、src/lib/gameLineups.ts の summarizeByForeignCount）。
// 画面だけの部品（集計のコードからは読まれない。保存キーの対象外）。
import { foreignCountInLineup, type ClassificationLookup } from "../../shared/foreignOnCourt";
import type { LineupAggregate, TeamGameLog } from "../../shared/types";
import { foreignCountBucket, summarizeByForeignCount, type GameLineupRow, type OnCourtSummaryRow, type RangeTotals } from "./gameLineups";
import { per100 } from "./lineupRatings";
import type { ForeignDetailSum } from "./teamForeignCourt";

/** 5人のうち外国籍・帰化・アジアの選手の人数（区分の分からない選手がいれば null） */
export function lineupForeignCount(lineup: Pick<LineupAggregate, "playerIds">, classify: ClassificationLookup): number | null {
  return foreignCountInLineup(lineup.playerIds, classify);
}

/** オンザコート別の合計の行の、絞り込みに使う人数（集計外は null） */
export function lineupBucket(lineup: Pick<LineupAggregate, "playerIds">, classify: ClassificationLookup, maxOnCourt: number): number | null {
  return foreignCountBucket(lineupForeignCount(lineup, classify), maxOnCourt);
}

/**
 * ラインナップを集計した試合の、試合時間とチームの得点・失点（集計外の行を出すのに使う）。
 * ラインナップのファイルと同じく、レギュラーシーズンとポストシーズンの試合（出場時間のある試合）。試合時間はチームの出場時間（5人分）÷5
 */
export function lineupSeasonTotals(gameLogs: readonly TeamGameLog[]): RangeTotals {
  let seconds = 0;
  let ownPoints = 0;
  let oppPoints = 0;
  for (const g of gameLogs) {
    if (g.min <= 0 || (g.gameType !== "regular" && g.gameType !== "playoff")) continue;
    seconds += Math.round((g.min * 60) / 5);
    ownPoints += g.teamScore;
    oppPoints += g.opponentScore;
  }
  return { seconds, ownPoints, oppPoints };
}

export interface SeasonOnCourtRow extends OnCourtSummaryRow {
  /** 人数を数えられた時間（集計外を除く）に占める割合（%）。集計外の行は null */
  pct: number | null;
  ortg: number | null;
  drtg: number | null;
  netRtg: number | null;
}

/** チームのシーズンのペース（推定のポゼッションに使う）。scripts/aggregate.ts の estimatedPoss と同じ: チームのポゼッション×5×出場分÷チームの出場分 */
export interface EstimatedPace {
  teamPoss: number;
  teamMin: number;
}

/**
 * シーズン単位のオンザコート別の合計。行は人数（上限から0）と、必要なら集計外。ORtg・DRtg・NetRtg は、実際のポゼッションがあるシーズン（2020-21以降）は
 * 5人組の攻撃回数の合計から、無いシーズンは今のラインナップの表と同じ推定（チームのシーズン平均のペースで時間から按分）で出す。集計外の行は出さない（null）
 */
export function seasonOnCourtSummary(
  lineups: readonly LineupAggregate[],
  classify: ClassificationLookup,
  maxOnCourt: number,
  totals: RangeTotals,
  pace: EstimatedPace | null,
): { rows: SeasonOnCourtRow[]; real: boolean } {
  const asRow = (l: LineupAggregate): GameLineupRow => ({
    teamId: "",
    lineupKey: l.lineupKey,
    playerIds: l.playerIds,
    seconds: l.secondsPlayed,
    ownPoints: l.ownPoints,
    oppPoints: l.oppPoints,
    netPoints: l.netPoints,
  });
  const summary = summarizeByForeignCount(lineups.map(asRow), (r) => foreignCountInLineup(r.playerIds, classify), maxOnCourt, totals);
  const real = lineups.length > 0 && lineups.every((l) => l.ownPoss !== undefined && l.oppPoss !== undefined);
  const poss = new Map<number, { own: number; opp: number }>();
  if (real) {
    for (const l of lineups) {
      const c = foreignCountBucket(foreignCountInLineup(l.playerIds, classify), maxOnCourt);
      if (c === null) continue;
      const p = poss.get(c) ?? { own: 0, opp: 0 };
      p.own += l.ownPoss!;
      p.opp += l.oppPoss!;
      poss.set(c, p);
    }
  }
  const countedSeconds = summary.reduce((a, s) => a + (s.count === null ? 0 : s.seconds), 0);
  const rows = summary.map((s): SeasonOnCourtRow => {
    if (s.count === null) return { ...s, pct: null, ortg: null, drtg: null, netRtg: null };
    const pct = countedSeconds > 0 ? (100 * s.seconds) / countedSeconds : null;
    let ownPoss: number;
    let oppPoss: number;
    if (real) {
      ownPoss = poss.get(s.count)?.own ?? 0;
      oppPoss = poss.get(s.count)?.opp ?? 0;
    } else {
      const est = pace && pace.teamMin > 0 ? (pace.teamPoss * 5 * (s.seconds / 60)) / pace.teamMin : 0;
      ownPoss = est;
      oppPoss = est;
    }
    const ortg = per100(s.ownPoints, ownPoss);
    const drtg = per100(s.oppPoints, oppPoss);
    return { ...s, pct, ortg, drtg, netRtg: ortg !== null && drtg !== null ? ortg - drtg : null };
  });
  return { rows, real };
}

/**
 * 試合区分・区間を選べるオンザコート別の合計（DESIGN.md 256章の段階3）。材料はチームのピリオド別の索引（src/lib/teamForeignCourt.ts の sumForeignDetail）。
 * 人数を数えた時間・得点・失点は、よく使われるラインナップと同じ数え方（試合区分が合算・区間が試合全体なら、ラインナップのファイルからの値と同じ）。
 * ORtg・DRtg・NetRtg は、人数ごとの攻撃回数がある（2020-21以降）ときはその値、無いときは推定（その条件のチームの攻撃回数を、時間の割合で人数ごとに分ける。256-7章の決定4）。
 * 規定の上限を超える人数の時間は集計外に入る（今までと同じ）
 */
export function seasonOnCourtSummaryFromDetail(
  detail: ForeignDetailSum,
  maxOnCourt: number,
): { rows: SeasonOnCourtRow[]; real: boolean; totals: RangeTotals; games: number } {
  const totals: RangeTotals = { seconds: detail.seconds, ownPoints: detail.ownPoints, oppPoints: detail.oppPoints };
  const asRows: GameLineupRow[] = detail.byCount.map((b, n) => ({
    teamId: "",
    lineupKey: String(n),
    playerIds: [],
    seconds: b.seconds,
    ownPoints: b.ownPoints,
    oppPoints: b.oppPoints,
    netPoints: b.ownPoints - b.oppPoints,
  }));
  const summary = summarizeByForeignCount(asRows, (r) => Number(r.lineupKey), maxOnCourt, totals);
  const real = detail.realPoss;
  const countedSeconds = summary.reduce((a, s) => a + (s.count === null ? 0 : s.seconds), 0);
  const rows = summary.map((s): SeasonOnCourtRow => {
    if (s.count === null) return { ...s, pct: null, ortg: null, drtg: null, netRtg: null };
    const pct = countedSeconds > 0 ? (100 * s.seconds) / countedSeconds : null;
    const b = detail.byCount[s.count]!;
    const est = detail.seconds > 0 ? (detail.teamPoss * s.seconds) / detail.seconds : 0;
    const ortg = per100(s.ownPoints, real ? b.ownPoss : est);
    const drtg = per100(s.oppPoints, real ? b.oppPoss : est);
    return { ...s, pct, ortg, drtg, netRtg: ortg !== null && drtg !== null ? ortg - drtg : null };
  });
  return { rows, real, totals, games: detail.games };
}
