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
import type { GameSummary, PlayerGameLog, TeamGameLog } from "../../shared/types";
import { teamDivision } from "../../scripts/lib/divisions";
import { isWeekdayGame } from "./japaneseHolidays";

export type SituationalFilterKind =
  | { kind: "all" }
  | { kind: "recent"; n: number }
  | { kind: "result"; win: boolean }
  | { kind: "dateRange"; start: string; end: string }
  | { kind: "homeAway"; home: boolean }
  /** 対戦相手の地区（scripts/lib/divisions.tsの東西マスタを使用。DESIGN.md参照） */
  | { kind: "division"; division: "east" | "west" }
  /** 1〜12（開催月） */
  | { kind: "month"; month: number }
  /** 年明け（1月）を境にした前後半。B.LEAGUEのシーズンは10月開幕〜翌年5,6月終幕のため、
   * 7〜12月を「年明け前」、1〜6月を「年明け後」とする */
  | { kind: "newYear"; half: "before" | "after" }
  /** 土日祝を除く曜日に開催された試合 */
  | { kind: "weekday" };

/**
 * kind（直近N試合・勝敗別・期間指定）とは独立した軸として、プレーオフを合算するかどうかを持つ。
 * デフォルト（未指定/false）はレギュラーシーズンのみ。teams.json/players.jsonの season 集計と
 * 同じ既定に揃える（2026-08-16、選手個人スタッツが60試合超になる集計バグの修正で導入）
 */
export type SituationalFilter = SituationalFilterKind & { includePlayoffs?: boolean };

export const RECENT_N_OPTIONS = [5, 10, 20] as const;

export interface SeasonHalfBoundary {
  firstHalfEnd: string;
  secondHalfStart: string;
}

/**
 * シーズンの試合日程（games-summary.json、レギュラーシーズンのみ対象）を日付昇順・試合数ベースで
 * ちょうど半分に分割し、既存の「期間指定」フィルタ（dateRange）にそのまま渡せる境界日
 * （前半戦の最終日・後半戦の初日）を返す。プレーオフはこの前半/後半とは独立した軸
 * （includePlayoffsトグル）のため中央値の算出対象から除く。
 * 1日に複数カードが組まれることがあるため、中央値そのものの日付ではなく、その日付が属する
 * 前後の「試合が行われた日」を境界にする（同じ日の試合が前半/後半に分かれてしまわないようにする）。
 */
export function computeSeasonHalfBoundary(games: GameSummary[]): SeasonHalfBoundary | null {
  const regularDates = games
    .filter((g) => g.gameType === "regular")
    .map((g) => g.date)
    .sort();
  if (regularDates.length === 0) return null;

  const splitDate = regularDates[Math.floor(regularDates.length / 2)]!;
  const uniqueDates = [...new Set(regularDates)].sort();
  const splitIdx = uniqueDates.indexOf(splitDate);
  const firstHalfEnd = splitIdx > 0 ? uniqueDates[splitIdx - 1]! : splitDate;

  return { firstHalfEnd, secondHalfStart: splitDate };
}

export function isDefaultFilter(filter: SituationalFilter): boolean {
  return filter.kind === "all" && !filter.includePlayoffs;
}

/**
 * 試合ログ（日付昇順ソート済み前提）をフィルタ条件で絞り込む。
 * DNP（出場0分）の試合は「出場した試合」の集計対象から除く（players.json/teams.jsonの
 * season集計と同じ基準。含めるとcomputePlayerSituationalStats等のgamesPlayedが
 * 実際の出場試合数より多くカウントされてしまう）
 */
export function filterGameLogs<
  T extends {
    date: string;
    win: boolean;
    gameType: "regular" | "playoff";
    min: number;
    isHome: boolean;
    opponentTeamId: string;
  },
>(logs: T[], filter: SituationalFilter): T[] {
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
    case "homeAway":
      return scoped.filter((g) => g.isHome === filter.home);
    case "division":
      return scoped.filter((g) => teamDivision(g.opponentTeamId) === filter.division);
    case "month":
      return scoped.filter((g) => Number(g.date.slice(5, 7)) === filter.month);
    case "newYear":
      return scoped.filter((g) => {
        const month = Number(g.date.slice(5, 7));
        return filter.half === "before" ? month >= 7 : month <= 6;
      });
    case "weekday":
      return scoped.filter((g) => isWeekdayGame(g.date));
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
