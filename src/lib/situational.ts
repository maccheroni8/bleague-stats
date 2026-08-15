// シチュエーション別スタッツ（直近N試合・勝敗別・期間指定）のフィルタとその場集計。
// team-games/{teamId}.json・player-games/{playerId}.jsonの試合ログをフロントエンドで
// 絞り込み、都度集計し直す（新しいバックエンド集計ファイルは作らない方針。DESIGN.md参照）。
//
// 集計の注意点（DESIGN.md 6章と同じ方針）:
// - PTS/REB/AST等の基本カウント統計は単純合算・平均
// - eFG%/TS%等の式ベースの指標は、絞り込んだ試合の基本カウントを合算してから式を適用する
//   （各試合の%をそのまま平均すると分母の違う試合が均等に扱われてしまい誤り）
// - POSS/ORtg/DRtg/Paceは、各試合ログに保存済みの公式POSS値をそのまま合算する
//   （比率項を含む式をシーズン合計値に再適用すると非線形性で誤差が出るため。POSS配線時と同じ方針）

import { efgPct, offensiveRating, pace, safeDiv, tsPct } from "../../shared/formulas";
import type { PlayerGameLog, TeamGameLog } from "../../shared/types";

export type SituationalFilterKind =
  | { kind: "all" }
  | { kind: "recent"; n: number }
  | { kind: "result"; win: boolean }
  | { kind: "dateRange"; start: string; end: string };

/**
 * kind（直近N試合・勝敗別・期間指定）とは独立した軸として、プレーオフを合算するかどうかを持つ。
 * デフォルト（未指定/false）はレギュラーシーズンのみ。teams.json/players.jsonの season 集計と
 * 同じ既定に揃える（2026-08-16、選手個人スタッツが60試合超になる集計バグの修正で導入）
 */
export type SituationalFilter = SituationalFilterKind & { includePlayoffs?: boolean };

export const RECENT_N_OPTIONS = [5, 10, 20] as const;

export function isDefaultFilter(filter: SituationalFilter): boolean {
  return filter.kind === "all" && !filter.includePlayoffs;
}

/**
 * 試合ログ（日付昇順ソート済み前提）をフィルタ条件で絞り込む。
 * DNP（出場0分）の試合は「出場した試合」の集計対象から除く（players.json/teams.jsonの
 * season集計と同じ基準。含めるとcomputePlayerSituationalStats等のgamesPlayedが
 * 実際の出場試合数より多くカウントされてしまう）
 */
export function filterGameLogs<T extends { date: string; win: boolean; gameType: "regular" | "playoff"; min: number }>(
  logs: T[],
  filter: SituationalFilter,
): T[] {
  const played = logs.filter((g) => g.min > 0);
  const scoped = filter.includePlayoffs ? played : played.filter((g) => g.gameType === "regular");
  switch (filter.kind) {
    case "all":
      return scoped;
    case "recent":
      return scoped.slice(Math.max(0, scoped.length - filter.n));
    case "result":
      return scoped.filter((g) => g.win === filter.win);
    case "dateRange":
      return scoped.filter(
        (g) => (!filter.start || g.date >= filter.start) && (!filter.end || g.date <= filter.end),
      );
  }
}

export interface TeamSituationalStats {
  gamesPlayed: number;
  perGame: {
    pts: number;
    oppPts: number;
    net: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    tov: number;
  };
  shooting: {
    fgPct: number;
    tpPct: number;
    ftPct: number;
    efgPct: number;
    tsPct: number;
  };
  advanced: {
    pace: number;
    offRtg: number;
    defRtg: number;
    netRtg: number;
  };
}

export function computeTeamSituationalStats(logs: TeamGameLog[]): TeamSituationalStats | null {
  if (logs.length === 0) return null;
  const gp = logs.length;

  const totals = logs.reduce(
    (acc, g) => ({
      teamScore: acc.teamScore + g.teamScore,
      opponentScore: acc.opponentScore + g.opponentScore,
      reb: acc.reb + g.reb,
      ast: acc.ast + g.ast,
      stl: acc.stl + g.stl,
      blk: acc.blk + g.blk,
      tov: acc.tov + g.tov,
      fgm: acc.fgm + g.fgm,
      fga: acc.fga + g.fga,
      tpm: acc.tpm + g.tpm,
      tpa: acc.tpa + g.tpa,
      ftm: acc.ftm + g.ftm,
      fta: acc.fta + g.fta,
      min: acc.min + g.min,
      poss: acc.poss + g.poss,
    }),
    {
      teamScore: 0,
      opponentScore: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 0,
      fgm: 0,
      fga: 0,
      tpm: 0,
      tpa: 0,
      ftm: 0,
      fta: 0,
      min: 0,
      poss: 0,
    },
  );

  const offRtg = offensiveRating(totals.teamScore, totals.poss);
  const defRtg = offensiveRating(totals.opponentScore, totals.poss);

  return {
    gamesPlayed: gp,
    perGame: {
      pts: totals.teamScore / gp,
      oppPts: totals.opponentScore / gp,
      net: (totals.teamScore - totals.opponentScore) / gp,
      reb: totals.reb / gp,
      ast: totals.ast / gp,
      stl: totals.stl / gp,
      blk: totals.blk / gp,
      tov: totals.tov / gp,
    },
    shooting: {
      fgPct: safeDiv(totals.fgm, totals.fga),
      tpPct: safeDiv(totals.tpm, totals.tpa),
      ftPct: safeDiv(totals.ftm, totals.fta),
      efgPct: efgPct(totals.fgm, totals.tpm, totals.fga),
      tsPct: tsPct(totals.teamScore, totals.fga, totals.fta),
    },
    advanced: {
      pace: pace(totals.poss, totals.min),
      offRtg,
      defRtg,
      netRtg: offRtg - defRtg,
    },
  };
}

export interface PlayerSituationalStats {
  gamesPlayed: number;
  perGame: {
    min: number;
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    tov: number;
    plusMinus: number;
  };
  shooting: {
    fgPct: number;
    tpPct: number;
    ftPct: number;
    efgPct: number;
    tsPct: number;
  };
}

export function computePlayerSituationalStats(logs: PlayerGameLog[]): PlayerSituationalStats | null {
  if (logs.length === 0) return null;
  const gp = logs.length;

  const totals = logs.reduce(
    (acc, g) => ({
      min: acc.min + g.min,
      pts: acc.pts + g.pts,
      reb: acc.reb + g.reb,
      ast: acc.ast + g.ast,
      stl: acc.stl + g.stl,
      blk: acc.blk + g.blk,
      tov: acc.tov + g.tov,
      fgm: acc.fgm + g.fgm,
      fga: acc.fga + g.fga,
      tpm: acc.tpm + g.tpm,
      tpa: acc.tpa + g.tpa,
      ftm: acc.ftm + g.ftm,
      fta: acc.fta + g.fta,
      plusMinus: acc.plusMinus + g.plusMinus,
    }),
    { min: 0, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, plusMinus: 0 },
  );

  return {
    gamesPlayed: gp,
    perGame: {
      min: totals.min / gp,
      pts: totals.pts / gp,
      reb: totals.reb / gp,
      ast: totals.ast / gp,
      stl: totals.stl / gp,
      blk: totals.blk / gp,
      tov: totals.tov / gp,
      plusMinus: totals.plusMinus / gp,
    },
    shooting: {
      fgPct: safeDiv(totals.fgm, totals.fga),
      tpPct: safeDiv(totals.tpm, totals.tpa),
      ftPct: safeDiv(totals.ftm, totals.fta),
      efgPct: efgPct(totals.fgm, totals.tpm, totals.fga),
      tsPct: tsPct(totals.pts, totals.fga, totals.fta),
    },
  };
}
