// 試合詳細のボックススコア（アドバンスド）の個人 OR% と、内訳集計の %OR。**画面だけの計算（保存キーの対象のファイルからは読まない）**。
// 個人 OR% = 100 × 本人の OR ÷（本人が出場中の自チーム OR ＋ 出場中の相手 DR）。分母は、在コートの復元（lineupStints）の
// 区間ごとの数え上げ（新形式は countsByPeriod、旧形式 2016-17〜2019-20 は reboundsByPeriod の own.or・opp.dr。チームリバウンド込み）を、
// 本人が含まれる区間について足したもの。時間の比などの近似は使わない。その試合のデータから数え上げが公式のチーム合計と合うと判定できたチームだけ出す。
import { stintReboundsByPeriod, type LineupStint } from "../../shared/onCourt";
import { safeDiv } from "../../shared/formulas";

/** 個人 OR% を出せない理由 */
export type OrPctUnavailableReason =
  /** 区間にリバウンドの数え上げが無い（今は起きない。古い作りの読み込みへの備え） */
  | "legacy"
  /** プレーバイプレーが無い試合 */
  | "noPbp"
  /** 数え上げが公式のチーム合計と合わない、またはリバウンドの瞬間に5人でない区間がある */
  | "mismatch";

export interface PlayerOrDenominator {
  /** 本人が出場中の自チーム OR */
  ownOr: number;
  /** 本人が出場中の相手 DR */
  oppDr: number;
}

export type TeamOrPct =
  | { available: true; byPlayer: Map<string, PlayerOrDenominator> }
  | { available: false; reason: OrPctUnavailableReason };

export interface TeamOrPctInput {
  lineupStints: LineupStint[];
  teamId: string;
  opponentTeamId: string;
  /** ボックススコアのチーム合計（試合全体）。自チームの OR と相手の DR（チームリバウンド込み） */
  boxOr: number;
  boxOpponentDr: number;
  /** 選んだ期間のピリオド番号。null は試合全体 */
  periods: number[] | null;
}

function inPeriods(period: number, periods: number[] | null): boolean {
  return periods === null || periods.includes(period);
}

/**
 * 自チームの選手ごとの分母（出場中の自チーム OR・相手 DR）を、選んだ期間について出す。
 * 判定はチームごと（自チームの OR と、相手の DR が対象。両チームの区間を見る）:
 * ① 自チームの区間の own.or の合計＝ボックススコアの自チーム OR、自チームの区間の opp.dr の合計＝相手の DR（試合全体）
 * ② リバウンドを数えた区間（自チームの own.or・opp.dr、相手チームの own.dr）が5人の組み合わせであること
 * どれかが外れたら理由つきで出さない。
 */
export function computeTeamOrPct(input: TeamOrPctInput): TeamOrPct {
  const { lineupStints, teamId, opponentTeamId, boxOr, boxOpponentDr, periods } = input;
  if (lineupStints.length === 0) return { available: false, reason: "noPbp" };
  const reb = new Map(lineupStints.map((s) => [s, stintReboundsByPeriod(s)] as const));
  if ([...reb.values()].every((r) => r === null)) return { available: false, reason: "legacy" };
  const own = lineupStints.filter((s) => s.teamId === teamId);
  const opp = lineupStints.filter((s) => s.teamId === opponentTeamId);
  let ownOrTotal = 0;
  let oppDrTotal = 0;
  for (const s of own) {
    for (const pair of Object.values(reb.get(s) ?? {})) {
      ownOrTotal += pair.own.or;
      oppDrTotal += pair.opp.dr;
      if ((pair.own.or > 0 || pair.opp.dr > 0) && s.playerIds.length !== 5) return { available: false, reason: "mismatch" };
    }
  }
  for (const s of opp) {
    for (const pair of Object.values(reb.get(s) ?? {})) {
      if (pair.own.dr > 0 && s.playerIds.length !== 5) return { available: false, reason: "mismatch" };
    }
  }
  if (ownOrTotal !== boxOr || oppDrTotal !== boxOpponentDr) return { available: false, reason: "mismatch" };

  const byPlayer = new Map<string, PlayerOrDenominator>();
  for (const s of own) {
    let ownOr = 0;
    let oppDr = 0;
    for (const [period, pair] of Object.entries(reb.get(s) ?? {})) {
      if (!inPeriods(Number(period), periods)) continue;
      ownOr += pair.own.or;
      oppDr += pair.opp.dr;
    }
    if (ownOr === 0 && oppDr === 0) continue;
    for (const id of s.playerIds) {
      const cur = byPlayer.get(id) ?? { ownOr: 0, oppDr: 0 };
      cur.ownOr += ownOr;
      cur.oppDr += oppDr;
      byPlayer.set(id, cur);
    }
  }
  return { available: true, byPlayer };
}

/** 個人 OR%（0〜100）。分母が 0（選んだ期間に出場していない・出場中にリバウンドが無い）は null（画面では「-」） */
export function personalOrPct(playerOr: number, denominator: PlayerOrDenominator | undefined): number | null {
  if (!denominator) return null;
  const d = denominator.ownOr + denominator.oppDr;
  return d > 0 ? safeDiv(100 * playerOr, d) : null;
}

/** 内訳集計の %OR（0〜100）＝グループの OR ÷ チーム OR（チームに付いた OR も分母に含む）。チーム OR が 0 は null */
export function orShare(groupOr: number, teamOr: number): number | null {
  return teamOr > 0 ? safeDiv(100 * groupOr, teamOr) : null;
}

export const OR_PCT_UNAVAILABLE_NOTE: Record<OrPctUnavailableReason, string> = {
  legacy: "この試合は、出場中のリバウンドの記録が無いため、個人のOR%を出していません",
  noPbp: "この試合はプレーバイプレーの記録が無いため、個人のOR%を出していません",
  mismatch: "この試合は、リバウンドの記録が出場選手の復元と合わないため、個人のOR%を出していません",
};
