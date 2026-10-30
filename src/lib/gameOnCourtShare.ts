// 試合詳細のボックススコアの、選手の出場中の割合（%PTS〜%FTA）と AST%（在コート基準の再集計。DESIGN.md 303章）。**画面だけの計算**。
// 分母は在コートの復元の5人組の区間（本人がいた区間の自チームの数。shared/playerOnCourt.ts）。チームごとに、区間の時間が試合を覆い、
// 区間の得点・FGM・FGA・3PM・3PA・FTM・FTA の合計が公式と合うときだけ出す（集計の試合ログと同じ判定 teamOnCourtQuality）。
import { fgAssistsByPlayer, onCourtKeyIndex, playerOnCourtByPeriod, sumOverPeriods, teamOnCourtQuality, ON_COURT_QUALITY_SHARES } from "../../shared/playerOnCourt";
import type { LineupStint, OnCourtReconstruction } from "../../shared/onCourt";
import type { BoxscoreRow, PlayByPlayEvent } from "../../shared/types";
import { safeDiv } from "../../shared/formulas";
import type { PeriodOnCourtShare } from "./playerSeasonBoxscore";

/** 出せない理由 */
export type OnCourtShareUnavailableReason =
  /** 2016-17〜2019-20 の試合（出場中の数え上げが無い） */
  | "legacy"
  /** プレーバイプレーが無い試合 */
  | "noPbp"
  /** 出場選手の復元の合計が公式の記録と合わない */
  | "mismatch";

export type TeamOnCourtShare =
  | { available: true; byPlayer: Map<string, PeriodOnCourtShare> }
  | { available: false; reason: OnCourtShareUnavailableReason };

export interface TeamOnCourtShareInput {
  lineupStints: LineupStint[];
  playByPlays: readonly PlayByPlayEvent[];
  teamId: string;
  opponentTeamId: string;
  ownRows: readonly BoxscoreRow[];
  opponentRows: readonly BoxscoreRow[];
  /** 試合全体の得点（区間の得点の合計と比べる） */
  ownScore: number;
  opponentScore: number;
  totalPeriods: number;
  /** 選んだ期間のピリオド番号。null は試合全体 */
  periods: readonly number[] | null;
}

export function computeTeamOnCourtShare(input: TeamOnCourtShareInput): TeamOnCourtShare {
  const { lineupStints, teamId, totalPeriods, periods } = input;
  if (lineupStints.length === 0) return { available: false, reason: "noPbp" };
  const own = lineupStints.filter((s) => s.teamId === teamId);
  if (own.length > 0 && own.every((s) => s.countsByPeriod === undefined)) return { available: false, reason: "legacy" };
  const rec = { lineupStints } as unknown as OnCourtReconstruction;
  const quality = teamOnCourtQuality(rec, teamId, input.opponentTeamId, input.ownRows, input.opponentRows, input.ownScore, input.opponentScore, totalPeriods);
  if ((quality & ON_COURT_QUALITY_SHARES) === 0) return { available: false, reason: "mismatch" };
  const inRange = (p: number) => periods === null || periods.includes(p);
  const fg = fgAssistsByPlayer(input.playByPlays);
  const byPlayer = new Map<string, PeriodOnCourtShare>();
  for (const [pid, bp] of playerOnCourtByPeriod(lineupStints, teamId, totalPeriods)) {
    const v = sumOverPeriods(bp, inRange);
    const o = (k: Parameters<typeof onCourtKeyIndex>[0]) => v[onCourtKeyIndex(k, "own")]!;
    let fgAssists = 0;
    for (const [p, n] of fg.get(pid) ?? []) if (inRange(p)) fgAssists += n;
    byPlayer.set(pid, { pts: o("pts"), fgm: o("fgm"), fga: o("fga"), tpm: o("tpm"), tpa: o("tpa"), ftm: o("ftm"), fta: o("fta"), fgAssists });
  }
  return { available: true, byPlayer };
}

/** 選手の AST%（100 × FGにつながったアシスト ÷（出場中の自チーム FGM − 本人の FGM））。分母0は null */
export function gamePlayerAstPct(share: PeriodOnCourtShare | null | undefined, playerFgm: number): number | null {
  if (!share) return null;
  const d = share.fgm - playerFgm;
  return d > 0 ? safeDiv(100 * share.fgAssists, d) : null;
}

export const ON_COURT_SHARE_UNAVAILABLE_NOTE: Record<OnCourtShareUnavailableReason, string> = {
  legacy: "2016-17〜2019-20の試合は、選手の%PTS〜%FTA・AST%を出していません（出場中の記録の数え上げが無いため）",
  noPbp: "この試合はプレーバイプレーの記録が無いため、選手の%PTS〜%FTA・AST%を出していません",
  mismatch: "この試合は、出場選手の復元が公式の記録と合わないため、選手の%PTS〜%FTA・AST%を出していません",
};
