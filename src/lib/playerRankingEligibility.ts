// ランキングページ選手版の掲載基準（DESIGN.md参照、2026-09）。
//
// 基本ルール: 所属チーム試合数の85%以上に出場した選手のみを対象とする
// （statDefs.tsのfilterPlayersByGamesPlayedRatio・MIN_GAMES_PLAYED_RATIO_FOR_RANKINGをそのまま
// 再利用）。3P%・FT%・FG%・2P%はこれに加えて「1試合あたりの試投/成功数」の最低ラインを
// 併用する（極端に試投数が少ない選手が異常値で上位に出るのを防ぐ）。eFG%・TS%はこの追加基準を
// 設けず、85%出場のみで足りるとした（PTS/FGA/FTAという総合的な母数のため、他の個別シュート
// 系%より小サンプルの影響を受けにくいと判断）。EFF・Usage%・FTR・PER・PPS・PPPのような
// レーティング系スタッツも85%出場ルールのみに統合し、旧来のminMinutesForRanking
// （PERのみ設定されていた絶対分数の足切り）は廃止した。
//
// 追加基準のデフォルト値は、2025-26シーズンの85%出場ルール適用後の母集団（191名）における
// 試投/成功数の分布を確認した上で決定した（tpPct: 1試合平均3P成功1.5本以上→対象49名、
// fgPct: 1試合平均FGA3.0本以上→対象160名、twoPct: 1試合平均2PA2.0本以上→対象122名、
// ftPct: 1試合平均FT成功1.0本以上→対象89名。掲載基準を厳しくしすぎず、極端な小サンプルだけを
// 除く水準を狙った）

import type { PlayerSummary, TeamSummary } from "../../shared/types";
import { MIN_GAMES_PLAYED_RATIO_FOR_RANKING, filterPlayersByGamesPlayedRatio } from "./statDefs";
import { safeDiv } from "../../shared/formulas";

export { MIN_GAMES_PLAYED_RATIO_FOR_RANKING };

export interface ExtraEligibilityRule {
  /** スライダーのラベル（例: "3P成功数"） */
  label: string;
  /** スライダー値の単位表記（例: "本/試合"） */
  unit: string;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  /** シーズン合計値から1試合あたりの値を求める（85%出場ルールと同じくシーズン全体の値を
   * 基準にする。シチュエーション別フィルタで絞り込んだ試合数には依存しない） */
  perGameValue: (p: PlayerSummary) => number;
}

export const EXTRA_ELIGIBILITY_RULES: Partial<Record<string, ExtraEligibilityRule>> = {
  tpPct: {
    label: "3P成功数",
    unit: "本/試合",
    defaultValue: 1.5,
    min: 0,
    max: 4,
    step: 0.1,
    perGameValue: (p) => safeDiv(p.totals.tpm, p.gamesPlayed),
  },
  ftPct: {
    label: "FT成功数",
    unit: "本/試合",
    defaultValue: 1.0,
    min: 0,
    max: 4,
    step: 0.1,
    perGameValue: (p) => safeDiv(p.totals.ftm, p.gamesPlayed),
  },
  fgPct: {
    label: "FGA",
    unit: "本/試合",
    defaultValue: 3.0,
    min: 0,
    max: 10,
    step: 0.5,
    perGameValue: (p) => safeDiv(p.totals.fga, p.gamesPlayed),
  },
  twoPct: {
    label: "2PA",
    unit: "本/試合",
    defaultValue: 2.0,
    min: 0,
    max: 8,
    step: 0.5,
    perGameValue: (p) => safeDiv(p.totals.fga - p.totals.tpa, p.gamesPlayed),
  },
};

/**
 * 出場率（gamesRatio）とスタッツ固有の追加基準（statKeyに応じてEXTRA_ELIGIBILITY_RULESから
 * 引く。extraThresholdはスライダーで動かした現在値）を両方満たす選手だけを残す
 */
export function filterEligiblePlayers(
  players: PlayerSummary[],
  teams: Pick<TeamSummary, "teamId" | "gamesPlayed">[],
  gamesRatio: number,
  statKey: string,
  extraThreshold: number,
): PlayerSummary[] {
  const base = filterPlayersByGamesPlayedRatio(players, teams, gamesRatio);
  const rule = EXTRA_ELIGIBILITY_RULES[statKey];
  if (!rule) return base;
  return base.filter((p) => rule.perGameValue(p) >= extraThreshold);
}
