// 個人詳細の「Q別」タブ（1Q〜4Q・前半・後半・延長を行にした表）の行の作り方と、シーズン別成績の「勝敗」「勝率」の数え方。
// 値は、個人詳細のシチュエーション別成績・シーズン別成績でその区間を選んだときと同じ関数（buildTeamSplitRowsFromPeriodSource＝ピリオド別の索引の合算）を、
// 区間ごとに呼ぶだけで、新しく数えない。移籍した選手は、シーズン別成績と同じく「所属チームごとの行＋複数チームの合計行」を区間ごとに出す。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import type { PlayerGameLog, TeamGameLog } from "../../shared/types";
import { formatWinPct } from "./format";
import type { PeriodRangeValue } from "./periodRange";
import {
  filterByGameType,
  sumTeamTotalsForLogs,
  transferredCombinedTeam,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
  type TeamSplitRow,
} from "./playerSeasonBoxscore";
import { buildTeamSplitRowsFromPeriodSource, seasonPeriodTotalsOf, type SeasonPeriodSource } from "./seasonPeriod";
import type { GameTeamInfo } from "./situational";

/** Q別タブの行の並びと名前（チーム詳細のQ別タブと同じ） */
export const PLAYER_QUARTER_ROWS: readonly { value: PeriodRangeValue; label: string }[] = [
  { value: "q1", label: "1Q" },
  { value: "q2", label: "2Q" },
  { value: "q3", label: "3Q" },
  { value: "q4", label: "4Q" },
  { value: "h1", label: "前半" },
  { value: "h2", label: "後半" },
  { value: "ot", label: "延長" },
];

/** Q別タブで選べるカテゴリ（チーム詳細のQ別タブと同じ4つ） */
export const PLAYER_QUARTER_CATEGORY_KEYS = ["traditional", "advanced", "misc", "scoring"] as const;

export interface PlayerQuarterRow extends TeamSplitRow {
  periodValue: PeriodRangeValue;
  periodLabel: string;
  /** その区間の最初の行か（区間名を出す行） */
  firstOfPeriod: boolean;
}

/** 区間の値が1試合も無い区間（その条件では出場した試合が無い延長など） */
export interface PlayerQuarterEmptyPeriod {
  periodValue: PeriodRangeValue;
  periodLabel: string;
}

export interface PlayerQuarterInput {
  playerId: string;
  season: string;
  /** そのシーズンの試合ログ（試合種別で絞る前。出場しなかった試合を含む） */
  logs: PlayerGameLog[];
  gameType: SeasonGameTypeFilter;
  displayMode: SeasonDisplayMode;
  ownTeamByScheduleKey: Map<string, GameTeamInfo>;
  teamLogsByTeamId: Map<string, TeamGameLog[]>;
  source: SeasonPeriodSource;
}

/**
 * 7つの区間の行。区間ごとに、所属チームごとの行（1チームだけならその1行）と、移籍した選手の「複数チーム」の合計行が並ぶ。
 * 出場した試合が無いとき、rows は空。区間の値がある試合が無い区間は empty に入れる（表では「-」の行）
 */
export function buildPlayerQuarterRows(input: PlayerQuarterInput): { rows: PlayerQuarterRow[]; empty: PlayerQuarterEmptyPeriod[] } {
  const { playerId, season, logs, gameType, displayMode, ownTeamByScheduleKey, teamLogsByTeamId, source } = input;
  const seasonStartYear = Number(season.split("-")[0]);
  const played = filterByGameType(logs, gameType).filter((g) => g.min > 0);
  if (played.length === 0) return { rows: [], empty: [] };
  const scopedTeamLogs = new Map([...teamLogsByTeamId].map(([teamId, teamLogs]) => [teamId, filterByGameType(teamLogs, gameType)]));
  const combined = transferredCombinedTeam(logs, played, ownTeamByScheduleKey, scopedTeamLogs);
  const teamTotals = sumTeamTotalsForLogs(played, ownTeamByScheduleKey, teamLogsByTeamId);
  const rows: PlayerQuarterRow[] = [];
  const empty: PlayerQuarterEmptyPeriod[] = [];
  for (const q of PLAYER_QUARTER_ROWS) {
    const split = buildTeamSplitRowsFromPeriodSource(
      `${season}|${q.value}`,
      played,
      ownTeamByScheduleKey,
      teamTotals,
      displayMode,
      seasonStartYear,
      playerId,
      q.value,
      source,
      combined,
    );
    if (split.length === 0) empty.push({ periodValue: q.value, periodLabel: q.label });
    split.forEach((r, i) => rows.push({ ...r, periodValue: q.value, periodLabel: q.label, firstOfPeriod: i === 0 }));
  }
  return { rows, empty };
}

// --- 勝敗・勝率（シーズン別成績。本人が出場した試合のチームの勝敗） ---

export interface PlayerRecord {
  wins: number;
  losses: number;
}

/**
 * 本人が出場した試合（出場時間0の試合は数えない）のチームの勝敗。
 * 区間（Q別・前後半・延長）を選んでいるときは、G（その区間の値がある試合）と同じ試合だけを数える
 */
export function playerRecordOfLogs(
  logs: readonly PlayerGameLog[],
  playerId: string,
  period: PeriodRangeValue,
  source: SeasonPeriodSource | null | undefined,
): PlayerRecord {
  let wins = 0;
  let losses = 0;
  for (const g of logs) {
    if (g.min <= 0) continue;
    if (period !== "all" && (!source || seasonPeriodTotalsOf(source, playerId, g.scheduleKey, g.isHome, period) === null)) continue;
    if (g.win) wins += 1;
    else losses += 1;
  }
  return { wins, losses };
}

/** 「9勝4敗」 */
export function formatPlayerRecord(r: PlayerRecord): string {
  return `${r.wins}勝${r.losses}敗`;
}

/** 勝率（勝÷(勝＋敗)）。試合が無ければ null */
export function playerWinPct(r: PlayerRecord): number | null {
  const n = r.wins + r.losses;
  return n === 0 ? null : r.wins / n;
}

/** 「.692」。試合が無ければ「-」 */
export function formatPlayerWinPct(r: PlayerRecord): string {
  const v = playerWinPct(r);
  return v === null ? "-" : formatWinPct(v);
}
