// ラインナップ検索（チーム詳細）の計算。チームの出場区間ごとの数え上げ（data/{season}/team-stints/{teamId}.json。DESIGN.md 204章）から、
// 選んだ選手が全員コートにいた時間帯（Players On）と、全員ベンチにいた時間帯（Players Off）の成績を求める。DESIGN.md 207章
//
// - Players On: 選んだ選手が全員コートにいる区間
// - Players Off: 選んだ選手が全員コートにいない区間。どちらか一部だけがコートにいる区間は、On にも Off にも入れない
//   Off は、選んだ選手のうち誰かが出場した試合だけが対象（出場しなかった試合の「ベンチ」は意味が無いため。個人詳細のオンコート/オフコートと同じ）
// - 試合数は、その状態が実際に起きた試合の数（時間があった、または得点・攻撃の記録があった試合）。平均はその試合数で割る

import type { TeamStintsFile } from "../../shared/types";
import { ratingsFromPossessions } from "./lineupRatings";

export type LineupSearchMode = "on" | "off";

export interface LineupSearchOptions {
  /** 対象にする試合（ScheduleKey）か。試合区分・ホーム/アウェイの絞り込みはここで渡す */
  includeGame: (scheduleKey: string) => boolean;
  /** 対象にするピリオド。null は全ピリオド */
  periods: number[] | null;
}

export interface LineupSearchResult {
  games: number;
  seconds: number;
  ownPoints: number;
  oppPoints: number;
  ownPoss: number;
  oppPoss: number;
}

const FIXED_COLUMNS = 9; // 試合番号・ピリオド・開始秒・終了秒・選手×5

/** 数え上げの列の位置（countKeys に無ければ -1） */
function countIndex(file: TeamStintsFile, key: string): number {
  return file.countKeys.indexOf(key);
}

/** 選んだ選手のうち、そのチームのファイルに居る選手の番号 */
function selectedNumbers(file: TeamStintsFile, selectedPlayerIds: readonly string[]): number[] {
  const numbers: number[] = [];
  for (const id of selectedPlayerIds) {
    const n = file.players.indexOf(id);
    if (n >= 0) numbers.push(n);
  }
  return numbers;
}

export function searchLineup(
  file: TeamStintsFile,
  selectedPlayerIds: readonly string[],
  mode: LineupSearchMode,
  options: LineupSearchOptions,
): LineupSearchResult {
  const result: LineupSearchResult = { games: 0, seconds: 0, ownPoints: 0, oppPoints: 0, ownPoss: 0, oppPoss: 0 };
  // 選んだ選手がこのチームのファイルに居ない（このシーズンに出場していない）ときは、On は成り立たず、Off は対象の試合が無い
  const selected = selectedNumbers(file, selectedPlayerIds);
  if (selectedPlayerIds.length === 0 || selected.length !== selectedPlayerIds.length) return result;
  const selectedSet = new Set(selected);
  const nKeys = file.countKeys.length;
  const ptsIdx = countIndex(file, "pts");
  const possIdx = countIndex(file, "poss");
  if (ptsIdx < 0 || possIdx < 0) return result;

  // 試合ごとに、選んだ選手のうち誰かが出場したか（ピリオドの絞り込みに関係なく、試合全体で見る）
  const appeared = new Set<number>();
  if (mode === "off") {
    for (const row of file.rows) {
      const game = row[0]!;
      if (appeared.has(game) || row[3]! <= row[2]!) continue;
      for (let i = 4; i < FIXED_COLUMNS; i += 1) {
        if (selectedSet.has(row[i]!)) {
          appeared.add(game);
          break;
        }
      }
    }
  }

  const gameIncluded = new Map<number, boolean>();
  const active = new Set<number>();
  for (const row of file.rows) {
    const game = row[0]!;
    let ok = gameIncluded.get(game);
    if (ok === undefined) {
      ok = options.includeGame(file.games[game]!);
      gameIncluded.set(game, ok);
    }
    if (!ok) continue;
    if (options.periods !== null && !options.periods.includes(row[1]!)) continue;

    let onCourt = 0;
    for (let i = 4; i < FIXED_COLUMNS; i += 1) if (selectedSet.has(row[i]!)) onCourt += 1;
    if (mode === "on" ? onCourt !== selected.length : onCourt !== 0 || !appeared.has(game)) continue;

    const seconds = row[3]! - row[2]!;
    const ownPts = row[FIXED_COLUMNS + ptsIdx]!;
    const oppPts = row[FIXED_COLUMNS + nKeys + ptsIdx]!;
    const ownPoss = row[FIXED_COLUMNS + possIdx]!;
    const oppPoss = row[FIXED_COLUMNS + nKeys + possIdx]!;
    result.seconds += seconds;
    result.ownPoints += ownPts;
    result.oppPoints += oppPts;
    result.ownPoss += ownPoss;
    result.oppPoss += oppPoss;
    if (seconds > 0 || ownPts !== 0 || oppPts !== 0 || ownPoss !== 0 || oppPoss !== 0) active.add(game);
  }
  result.games = active.size;
  return result;
}

export interface LineupSearchRow {
  games: number;
  totalMinutes: number;
  ownPoints: number;
  oppPoints: number;
  netPoints: number;
  avgMinutes: number | null;
  avgOwnPoints: number | null;
  avgOppPoints: number | null;
  avgNetPoints: number | null;
  off: number | null;
  def: number | null;
  net: number | null;
}

/** 画面に出す12項目。平均は、その状態が実際に起きた試合の数で割る */
export function lineupSearchRow(r: LineupSearchResult): LineupSearchRow {
  const avg = (v: number) => (r.games > 0 ? v / r.games : null);
  const ratings = ratingsFromPossessions(r.ownPoints, r.oppPoints, r.ownPoss, r.oppPoss);
  return {
    games: r.games,
    totalMinutes: r.seconds / 60,
    ownPoints: r.ownPoints,
    oppPoints: r.oppPoints,
    netPoints: r.ownPoints - r.oppPoints,
    avgMinutes: avg(r.seconds / 60),
    avgOwnPoints: avg(r.ownPoints),
    avgOppPoints: avg(r.oppPoints),
    avgNetPoints: avg(r.ownPoints - r.oppPoints),
    off: ratings.off,
    def: ratings.def,
    net: ratings.net,
  };
}

/** ファイルに出てくるピリオドの最大（延長を含む試合のピリオド数。4未満にはしない） */
export function maxPeriodOf(file: TeamStintsFile): number {
  let max = 4;
  for (const row of file.rows) if (row[1]! > max) max = row[1]!;
  return max;
}

/** 選手ごとの出場時間（秒、全試合）。選択肢を出場時間の多い順に並べるのに使う */
export function playerSecondsOf(file: TeamStintsFile): Map<string, number> {
  const seconds = new Map<string, number>();
  for (const row of file.rows) {
    const d = row[3]! - row[2]!;
    if (d <= 0) continue;
    for (let i = 4; i < FIXED_COLUMNS; i += 1) {
      const id = file.players[row[i]!]!;
      seconds.set(id, (seconds.get(id) ?? 0) + d);
    }
  }
  return seconds;
}
