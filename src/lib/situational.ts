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
import type { Category, DivisionHistoryFile, GameSummary, PlayerGameLog, TeamGameLog } from "../../shared/types";
import { teamDivisionForSeason } from "../../scripts/lib/divisions";
import { isWeekdayGame } from "./japaneseHolidays";

/**
 * 「試合の範囲」を決める軸。互いに排他（同時に2つは選べない）。前半戦/後半戦は
 * dateRangeの特殊値（境界日と一致するstart/end）として表現する（SituationalFilterPickerの
 * active判定・describeSituationalFilter参照）
 */
export type SituationalRange =
  | { kind: "all" }
  | { kind: "recent"; n: number }
  | { kind: "dateRange"; start: string; end: string };

/**
 * 2026-08-29、SituationalFilterPickerの複数選択（AND条件）対応に伴い追加。rangeとは独立に
 * ON/OFFでき、選択した軸すべてがANDで絞り込まれる（ショットチャート専用フィルタ
 * ShotChartGameFiltersと全く同じ考え方・同じ判定ロジックを共有する。DESIGN.md参照）
 */
export interface SituationalAndFilters {
  result?: "win" | "loss";
  homeAway?: "home" | "away";
  /** 対戦相手の地区（scripts/lib/divisions.tsの東西マスタを使用。DESIGN.md参照） */
  division?: "east" | "west";
  /** 1〜12（開催月） */
  month?: number;
  /** 年明け（1月）を境にした前後半。B.LEAGUEのシーズンは10月開幕〜翌年5,6月終幕のため、
   * 7〜12月を「年明け前」、1〜6月を「年明け後」とする */
  newYear?: "before" | "after";
  /** 土日祝を除く曜日に開催された試合 */
  weekday?: boolean;
  /**
   * 対戦相手の「その試合時点までの」レギュラーシーズン勝率による絞り込み。3段階は独立した
   * 閾値ボタン（5割以上と6割以上は重複しうる）。相手の消化試合数がMIN_GAMES_FOR_OPPONENT_WIN_RATE
   * 未満の対戦はどの区分にも該当しない扱いにする（シーズン序盤の1〜数試合だけの勝率は
   * 0%/100%に振れやすく、対戦相手として意味のある強さの指標にならないため。DESIGN.md参照）
   */
  opponentWinRate?: "under50" | "atLeast50" | "atLeast60";
}

/**
 * range（直近N試合・期間指定等、互いに排他）と、それとは独立にAND合成できる
 * SituationalAndFilters（勝敗・会場・地区・月別・年明け前後・平日開催・対勝率別）を組み合わせた
 * シチュエーション別フィルタ。includePlayoffsはさらに独立した軸として、プレーオフを合算するかどうかを
 * 持つ。デフォルト（未指定/false）はレギュラーシーズンのみ。teams.json/players.jsonの season 集計と
 * 同じ既定に揃える（2026-08-16、選手個人スタッツが60試合超になる集計バグの修正で導入）
 */
export type SituationalFilter = SituationalAndFilters & {
  range: SituationalRange;
  includePlayoffs?: boolean;
};

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
  return (
    filter.range.kind === "all" &&
    !filter.includePlayoffs &&
    !filter.result &&
    !filter.homeAway &&
    !filter.division &&
    filter.month === undefined &&
    !filter.newYear &&
    !filter.weekday &&
    !filter.opponentWinRate
  );
}

export interface GameTeamInfo {
  teamId: string;
  teamName: string;
}

/**
 * PlayerGameLog/TeamGameLogには自チームのteamId/teamNameが無いため（scheduleKey・opponentTeamId・
 * isHomeのみ）、同じシーズンのgames-summary.json（homeTeamId/awayTeamId）とisHomeを突き合わせて
 * 動的に導出する。scheduleKeyをキーにhome/away両チーム情報を持ち、呼び出し側でisHomeに応じて
 * resolveOwnTeam()で選ぶ（シーズン内移籍で選手ごとに所属チームが変わりうる箇所で使う。DESIGN.md参照）
 */
export function buildGameTeamsByScheduleKey(
  games: GameSummary[],
): Map<string, { home: GameTeamInfo; away: GameTeamInfo }> {
  const map = new Map<string, { home: GameTeamInfo; away: GameTeamInfo }>();
  for (const g of games) {
    map.set(g.scheduleKey, {
      home: { teamId: g.homeTeamId, teamName: g.homeTeamName },
      away: { teamId: g.awayTeamId, teamName: g.awayTeamName },
    });
  }
  return map;
}

/** buildGameTeamsByScheduleKey()の結果とisHomeから、その1試合における自チームを解決する */
export function resolveOwnTeam(
  log: { scheduleKey: string; isHome: boolean },
  gameTeams: Map<string, { home: GameTeamInfo; away: GameTeamInfo }>,
): GameTeamInfo | null {
  const entry = gameTeams.get(log.scheduleKey);
  if (!entry) return null;
  return log.isHome ? entry.home : entry.away;
}

/** 対戦相手のその試合時点までの勝率で絞り込む際、これ未満の消化試合数は対象外にする（DESIGN.md参照） */
export const MIN_GAMES_FOR_OPPONENT_WIN_RATE = 5;

export interface RecordBeforeGame {
  wins: number;
  losses: number;
}

/**
 * シーズンの試合日程（games-summary.json、レギュラーシーズンのみ対象）から、各試合について
 * 「その試合が始まる時点（その試合自体は含まない）」での両チームの勝敗数を求める。
 * Map<scheduleKey, Map<teamId, RecordBeforeGame>>（1試合につき対戦した2チーム分のキーを持つ）。
 * 「対勝率別」フィルタ（opponentWinRate）で、対戦相手のscheduleKeyをキーに引く用途で使う
 */
export function buildRecordsBeforeGame(games: GameSummary[]): Map<string, Map<string, RecordBeforeGame>> {
  const sorted = games
    .filter((g) => g.gameType === "regular" && g.gameEndedFlg)
    .sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));

  const result = new Map<string, Map<string, RecordBeforeGame>>();
  const running = new Map<string, RecordBeforeGame>();
  const ensure = (teamId: string): RecordBeforeGame => {
    let r = running.get(teamId);
    if (!r) {
      r = { wins: 0, losses: 0 };
      running.set(teamId, r);
    }
    return r;
  };

  for (const g of sorted) {
    const perGame = new Map<string, RecordBeforeGame>();
    perGame.set(g.homeTeamId, { ...ensure(g.homeTeamId) });
    perGame.set(g.awayTeamId, { ...ensure(g.awayTeamId) });
    result.set(g.scheduleKey, perGame);

    if (g.homeScore > g.awayScore) {
      ensure(g.homeTeamId).wins += 1;
      ensure(g.awayTeamId).losses += 1;
    } else {
      ensure(g.awayTeamId).wins += 1;
      ensure(g.homeTeamId).losses += 1;
    }
  }
  return result;
}

export type BackToBackGame = "GAME1" | "GAME2";

function daysBetweenDates(d1: string, d2: string): number {
  return (new Date(d2).getTime() - new Date(d1).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * 連戦GAME1/GAME2判定。シーズンの試合日程（games-summary.json、`gameEndedFlg`の試合のみ対象。
 * レギュラー/プレーオフとも対象に含める。過密日程による疲労という観点のため、対戦相手が
 * 同じかどうかは問わない）から、チームごとに日付昇順で並べ、直前の自チームの試合との間隔が
 * 中1日以内（連日=1日差、または中1日空き=2日差）の試合を「連戦」とみなす。
 * Map<scheduleKey, Map<teamId, BackToBackGame>>（1試合につき対戦した2チーム分、それぞれ独立に
 * 判定した結果を持つ。片方のチームだけが連戦中というケースもありうる）。
 * 3試合以上が中1日以内で連続する場合（プレーオフのBest-of-3等）は、直前の自チームの試合が
 * 近接している試合をすべてGAME2（＝短い休養日数でプレーした試合）とし、GAME1はその連戦の
 * 最初の1試合のみとする（実データ確認済み。DESIGN.md参照）
 */
export function buildBackToBackStatus(games: GameSummary[]): Map<string, Map<string, BackToBackGame>> {
  const byTeam = new Map<string, GameSummary[]>();
  for (const g of games) {
    if (!g.gameEndedFlg) continue;
    for (const teamId of [g.homeTeamId, g.awayTeamId]) {
      let list = byTeam.get(teamId);
      if (!list) {
        list = [];
        byTeam.set(teamId, list);
      }
      list.push(g);
    }
  }

  const result = new Map<string, Map<string, BackToBackGame>>();
  const setStatus = (scheduleKey: string, teamId: string, status: BackToBackGame) => {
    let m = result.get(scheduleKey);
    if (!m) {
      m = new Map();
      result.set(scheduleKey, m);
    }
    m.set(teamId, status);
  };

  for (const [teamId, list] of byTeam) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 0; i < list.length; i++) {
      const game = list[i]!;
      const prev = list[i - 1];
      const next = list[i + 1];
      const closeToPrev = prev !== undefined && daysBetweenDates(prev.date, game.date) <= 2;
      const closeToNext = next !== undefined && daysBetweenDates(game.date, next.date) <= 2;
      if (closeToPrev) {
        setStatus(game.scheduleKey, teamId, "GAME2");
      } else if (closeToNext) {
        setStatus(game.scheduleKey, teamId, "GAME1");
      }
    }
  }
  return result;
}

/**
 * 対戦相手の地区が一致するか（data/division-history.json、シーズン対応版マスタを使用。
 * DESIGN.md参照。2026-08-29、2026-27シーズン基準の単一スナップショットだった旧実装から
 * シーズン対応版に置き換えた）。historyが未取得（undefined）の場合は判定不能として常にfalse
 */
export function matchesDivision<T extends { opponentTeamId: string }>(
  g: T,
  division: "east" | "west",
  history: DivisionHistoryFile | null | undefined,
  season: string,
  category: Category = "premier",
): boolean {
  return teamDivisionForSeason(history, g.opponentTeamId, season, category) === division;
}

/** 開催月（1〜12）が一致するか */
export function matchesMonth<T extends { date: string }>(g: T, month: number): boolean {
  return Number(g.date.slice(5, 7)) === month;
}

/** 年明け前（7〜12月）/年明け後（1〜6月）のどちらか */
export function matchesNewYearHalf<T extends { date: string }>(g: T, half: "before" | "after"): boolean {
  const month = Number(g.date.slice(5, 7));
  return half === "before" ? month >= 7 : month <= 6;
}

/**
 * 対戦相手のその試合時点までの勝率が指定の閾値区分に該当するか。opponentRecordsが未指定、
 * または相手の消化試合数がMIN_GAMES_FOR_OPPONENT_WIN_RATE未満の場合は常にfalse（DESIGN.md参照）
 */
export function matchesOpponentWinRateTier<T extends { scheduleKey: string; opponentTeamId: string }>(
  g: T,
  tier: "under50" | "atLeast50" | "atLeast60",
  opponentRecords: Map<string, Map<string, RecordBeforeGame>> | undefined,
): boolean {
  const rec = opponentRecords?.get(g.scheduleKey)?.get(g.opponentTeamId);
  if (!rec) return false;
  const gp = rec.wins + rec.losses;
  if (gp < MIN_GAMES_FOR_OPPONENT_WIN_RATE) return false;
  const winPct = rec.wins / gp;
  switch (tier) {
    case "under50":
      return winPct < 0.5;
    case "atLeast50":
      return winPct >= 0.5;
    case "atLeast60":
      return winPct >= 0.6;
  }
}

/**
 * SituationalAndFilters（勝敗・会場・地区・月別・年明け前後・平日開催・対勝率別）を全てAND合成で
 * 判定する共通マッチャー。SituationalFilterPicker（filterGameLogs経由）・ShotChartFilterPicker
 * （matchesShotChartGameFilters経由）の両方から呼ばれる、複数選択フィルタの唯一の判定ロジック
 * （2026-08-29、SituationalFilterPicker側もこの判定を共有する形に統合した。DESIGN.md参照）
 */
export function matchesSituationalAndFilters<
  T extends {
    date: string;
    win: boolean;
    isHome: boolean;
    opponentTeamId: string;
    scheduleKey: string;
  },
>(
  g: T,
  filters: SituationalAndFilters,
  opponentRecords?: Map<string, Map<string, RecordBeforeGame>>,
  divisionHistory?: DivisionHistoryFile | null,
  season?: string,
): boolean {
  if (filters.result === "win" && !g.win) return false;
  if (filters.result === "loss" && g.win) return false;
  if (filters.homeAway === "home" && !g.isHome) return false;
  if (filters.homeAway === "away" && g.isHome) return false;
  if (filters.division && (!season || !matchesDivision(g, filters.division, divisionHistory, season))) return false;
  if (filters.month !== undefined && !matchesMonth(g, filters.month)) return false;
  if (filters.newYear && !matchesNewYearHalf(g, filters.newYear)) return false;
  if (filters.weekday && !isWeekdayGame(g.date)) return false;
  if (filters.opponentWinRate && !matchesOpponentWinRateTier(g, filters.opponentWinRate, opponentRecords)) return false;
  return true;
}

/**
 * ショットチャート用の複数選択フィルタ（AND合成）。軸のON/OFF判定自体は
 * matchesSituationalAndFilters()にそのまま委譲し（SituationalFilterPickerと共通）、
 * ショットチャート固有の「シーズン内移籍時のチーム別絞り込み（ownTeamId）」だけをここで追加する
 */
export interface ShotChartGameFilters extends SituationalAndFilters {
  /** シーズン内移籍対応: 試合ログから動的に導出した所属チーム（resolveOwnTeam参照）で絞り込む。
   * 未選択（undefined）なら全チーム合算（従来通り） */
  ownTeamId?: string;
}

export function matchesShotChartGameFilters<
  T extends {
    date: string;
    win: boolean;
    isHome: boolean;
    opponentTeamId: string;
    scheduleKey: string;
  },
>(
  g: T,
  filters: ShotChartGameFilters,
  opponentRecords?: Map<string, Map<string, RecordBeforeGame>>,
  ownTeamByScheduleKey?: Map<string, GameTeamInfo>,
  divisionHistory?: DivisionHistoryFile | null,
  season?: string,
): boolean {
  if (!matchesSituationalAndFilters(g, filters, opponentRecords, divisionHistory, season)) return false;
  if (filters.ownTeamId && ownTeamByScheduleKey?.get(g.scheduleKey)?.teamId !== filters.ownTeamId) return false;
  return true;
}

/** filter.rangeによる「試合の範囲」の絞り込み（前半戦/後半戦を含む3種、互いに排他） */
function applySituationalRange<T extends { date: string }>(games: T[], range: SituationalRange): T[] {
  switch (range.kind) {
    case "all":
      return games;
    case "recent":
      return games.slice(Math.max(0, games.length - range.n));
    case "dateRange":
      return games.filter((g) => (!range.start || g.date >= range.start) && (!range.end || g.date <= range.end));
  }
}

/**
 * 試合ログ（日付昇順ソート済み前提）をフィルタ条件で絞り込む。
 * DNP（出場0分）の試合は「出場した試合」の集計対象から除く（players.json/teams.jsonの
 * season集計と同じ基準。含めるとcomputePlayerSituationalStats等のgamesPlayedが
 * 実際の出場試合数より多くカウントされてしまう）。
 * filter.rangeで「試合の範囲」を絞り込んだ後、matchesSituationalAndFilters()でAND条件の
 * 各軸（勝敗・会場・地区・月別・年明け前後・平日開催・対勝率別）を絞り込む
 * （2026-08-29、複数選択対応。DESIGN.md参照）。
 * opponentRecordsは「対勝率別」フィルタでのみ使う（buildRecordsBeforeGame()の結果。
 * 未指定の場合、この軸を選んでいても該当試合0件として扱う）。
 * divisionHistory・seasonは「地区」フィルタでのみ使う（data/division-history.json、
 * シーズン対応版マスタ。fetchDivisionHistory()の結果とその試合ログのシーズンを渡す。
 * seasonが未指定の場合、この軸を選んでいても該当試合0件として扱う）
 */
export function filterGameLogs<
  T extends {
    date: string;
    win: boolean;
    gameType: "regular" | "playoff";
    min: number;
    isHome: boolean;
    opponentTeamId: string;
    scheduleKey: string;
  },
>(
  logs: T[],
  filter: SituationalFilter,
  opponentRecords?: Map<string, Map<string, RecordBeforeGame>>,
  divisionHistory?: DivisionHistoryFile | null,
  season?: string,
): T[] {
  const played = logs.filter((g) => g.min > 0);
  const scoped = filter.includePlayoffs ? played : played.filter((g) => g.gameType === "regular");
  const ranged = applySituationalRange(scoped, filter.range);
  return ranged.filter((g) => matchesSituationalAndFilters(g, filter, opponentRecords, divisionHistory, season));
}

export interface TeamSituationalStats {
  gamesPlayed: number;
  perGame: {
    pts: number;
    oppPts: number;
    net: number;
    reb: number;
    oppReb: number;
    ast: number;
    oppAst: number;
    stl: number;
    oppStl: number;
    blk: number;
    oppBlk: number;
    tov: number;
    oppTov: number;
  };
  shooting: {
    fgPct: number;
    oppFgPct: number;
    tpPct: number;
    oppTpPct: number;
    ftPct: number;
    oppFtPct: number;
    efgPct: number;
    oppEfgPct: number;
    tsPct: number;
    oppTsPct: number;
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
      oppReb: acc.oppReb + g.opponentOreb + g.opponentDreb,
      oppAst: acc.oppAst + g.opponentAst,
      oppStl: acc.oppStl + g.opponentStl,
      oppBlk: acc.oppBlk + g.opponentBlk,
      oppTov: acc.oppTov + g.opponentTov,
      oppFgm: acc.oppFgm + g.opponentFgm,
      oppFga: acc.oppFga + g.opponentFga,
      oppTpm: acc.oppTpm + g.opponentTpm,
      oppTpa: acc.oppTpa + g.opponentTpa,
      oppFtm: acc.oppFtm + g.opponentFtm,
      oppFta: acc.oppFta + g.opponentFta,
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
      oppReb: 0,
      oppAst: 0,
      oppStl: 0,
      oppBlk: 0,
      oppTov: 0,
      oppFgm: 0,
      oppFga: 0,
      oppTpm: 0,
      oppTpa: 0,
      oppFtm: 0,
      oppFta: 0,
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
      oppReb: totals.oppReb / gp,
      ast: totals.ast / gp,
      oppAst: totals.oppAst / gp,
      stl: totals.stl / gp,
      oppStl: totals.oppStl / gp,
      blk: totals.blk / gp,
      oppBlk: totals.oppBlk / gp,
      tov: totals.tov / gp,
      oppTov: totals.oppTov / gp,
    },
    shooting: {
      fgPct: safeDiv(totals.fgm, totals.fga),
      oppFgPct: safeDiv(totals.oppFgm, totals.oppFga),
      tpPct: safeDiv(totals.tpm, totals.tpa),
      oppTpPct: safeDiv(totals.oppTpm, totals.oppTpa),
      ftPct: safeDiv(totals.ftm, totals.fta),
      oppFtPct: safeDiv(totals.oppFtm, totals.oppFta),
      efgPct: efgPct(totals.fgm, totals.tpm, totals.fga),
      oppEfgPct: efgPct(totals.oppFgm, totals.oppTpm, totals.oppFga),
      tsPct: tsPct(totals.teamScore, totals.fga, totals.fta),
      oppTsPct: tsPct(totals.opponentScore, totals.oppFga, totals.oppFta),
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
