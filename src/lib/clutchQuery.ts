// ランキング > 個人 > 「勝負所」（勝ち越し弾・同点弾・決勝弾）と「アシストペア」の集計（DESIGN.md 221章）。1試合行の索引（219章）と、アシストペアの試合ごとの行
// （assist-pairs.json.gz）を読み、試合の条件で絞って、選手ごと（勝負所）・ペアごと（アシストペア）に足し上げて並べる。通信・画面の部品を含まない純粋な部分（検証スクリプトからも使う）。
// 集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。
//
// 勝負所: 第4Qと各延長の残り5分・2分・1分以内の得点（shared/gameFlow.ts）。窓ごと・種類ごとに FG と FT を分けた列が索引にある。
// 同じ値の中の並びは、選手ID（ペアは アシストした選手ID → 得点した選手ID）→ 日付（1試合）の順で固定する（Mapの挿入順に依存しない）。
import { PLAYER_INDEX_CLUTCH_COLUMNS, ROW_FLAG_HOME, type PlayerGameIndexFile } from "../../shared/gameIndex";
import { assistPairPoints, ASSIST_PAIRS_VERSION, type AssistPairsFile } from "../../shared/assistPairs";
import type { RookieEligibilityFile } from "../../shared/types";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { FIRST_LEAGUE_SEASON } from "../../shared/rookieEligibility";
import { classKeyOfFilter, type PlayerGroupFilter } from "./classificationFilter";
import type { PlayerGameIndexView } from "./gameIndex";
import { rookieOfIndex } from "./gameIndex";
import type { GameRecordConditions } from "./gameRecordConditions";
import { gameFacts, matchesGame } from "./gameRecordQuery";

export const CLUTCH_TOP_N = 20;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 並べた行に順位をつけ（同じ値は同じ順位、次はその分飛ばす）、topN位までを返す（N位と同じ値はすべて含む） */
function rankRows<T extends { value: number }>(sorted: T[], topN: number): (T & { rank: number })[] {
  const out: (T & { rank: number })[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i]!.value !== sorted[i - 1]!.value) rank = i + 1;
    if (rank > topN) break;
    out.push({ ...sorted[i]!, rank });
  }
  return out;
}

// ---- 勝負所 ----

export type ClutchMeasure = "goAhead" | "tie" | "winner";
export const CLUTCH_MEASURES: ClutchMeasure[] = ["goAhead", "tie", "winner"];
export const CLUTCH_MEASURE_LABELS: Record<ClutchMeasure, string> = { goAhead: "勝ち越し弾", tie: "同点弾", winner: "決勝弾" };
/** 窓: 第4Q・各延長の残り時間（分）。初期値は2分 */
export type ClutchWindowKey = "5" | "2" | "1";
export const CLUTCH_WINDOWS: ClutchWindowKey[] = ["5", "2", "1"];
export const CLUTCH_WINDOW_LABELS: Record<ClutchWindowKey, string> = { "5": "残り5分", "2": "残り2分", "1": "残り1分" };
export const DEFAULT_CLUTCH_WINDOW: ClutchWindowKey = "2";

/** 窓・種類の（FG, FT）の列の名前（shared/gameIndex.ts の PLAYER_INDEX_CLUTCH_COLUMNS の並び: 窓×種類×{FG,FT}） */
export function clutchColumns(window: ClutchWindowKey, measure: ClutchMeasure): [fg: string, ft: string] {
  const w = CLUTCH_WINDOWS.indexOf(window);
  const k = CLUTCH_MEASURES.indexOf(measure);
  return [PLAYER_INDEX_CLUTCH_COLUMNS[w * 6 + k * 2]!, PLAYER_INDEX_CLUTCH_COLUMNS[w * 6 + k * 2 + 1]!];
}

export interface ClutchRow {
  rank: number;
  /** FG と FT の合計 */
  value: number;
  fg: number;
  ft: number;
  playerId: string;
  playerName: string;
  /** 最後に出場した試合のチーム */
  teamId: string;
  teamName: string;
  firstSeason: string;
  lastSeason: string;
}

export interface ClutchQuery {
  views: readonly PlayerGameIndexView[];
  gameType: SeasonGameTypeFilter;
  conditions: GameRecordConditions;
  group: PlayerGroupFilter;
  rookies: RookieEligibilityFile | null;
  /** 指定時、この選手IDの記録だけ（現役の絞り込み。DESIGN.md 222章） */
  activeIds?: ReadonlySet<string> | null;
  measure: ClutchMeasure;
  window: ClutchWindowKey;
  topN?: number;
}

interface ClutchAcc {
  fg: number;
  ft: number;
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  lastDate: string;
  lastKey: string;
  firstSeason: string;
  lastSeason: string;
}

/** 選手ごとに足し上げる。views が1シーズンなら「シーズン」、全シーズンなら「通算」。値が0の選手は含めない */
export function queryClutch(q: ClutchQuery): { rows: ClutchRow[]; players: number } {
  const [fgCol, ftCol] = clutchColumns(q.window, q.measure);
  const classKey = q.group === "rookie" ? undefined : classKeyOfFilter(q.group);
  const acc = new Map<string, ClutchAcc>();
  for (const view of q.views) {
    const file = view.file;
    const facts = gameFacts(file);
    const fgValues = file.rows.stats[fgCol as keyof typeof file.rows.stats];
    const ftValues = file.rows.stats[ftCol as keyof typeof file.rows.stats];
    if (!fgValues || !ftValues) continue; // この列が無い古い索引
    const { rows, players, games, teams } = file;
    for (let i = 0; i < view.size; i++) {
      const fg = fgValues[i]!;
      const ft = ftValues[i]!;
      if (fg === 0 && ft === 0) continue;
      const g = rows.game[i]!;
      const home = (rows.flags[i]! & ROW_FLAG_HOME) !== 0;
      if (!matchesGame(facts[g * 2 + (home ? 0 : 1)]!, q.gameType, q.conditions)) continue;
      const p = players[rows.player[i]!]!;
      if (q.activeIds && !q.activeIds.has(p[0])) continue;
      if (q.group === "rookie") {
        if (view.season <= FIRST_LEAGUE_SEASON || !rookieOfIndex(q.rookies, view.season, p[0])) continue;
      } else if (classKey && p[5] !== classKey) continue;
      const team = teams[home ? games.home[g]! : games.away[g]!]!;
      const date = games.date[g]!;
      const key = games.key[g]!;
      let a = acc.get(p[0]);
      if (!a) {
        a = { fg: 0, ft: 0, playerId: p[0], playerName: p[1], teamId: team[0], teamName: team[1], lastDate: date, lastKey: key, firstSeason: view.season, lastSeason: view.season };
        acc.set(p[0], a);
      }
      a.fg += fg;
      a.ft += ft;
      if (view.season < a.firstSeason) a.firstSeason = view.season;
      if (date > a.lastDate || (date === a.lastDate && key > a.lastKey)) {
        a.lastDate = date;
        a.lastKey = key;
        a.lastSeason = view.season;
        a.playerName = p[1];
        a.teamId = team[0];
        a.teamName = team[1];
      }
    }
  }
  const sorted = [...acc.values()]
    .map<Omit<ClutchRow, "rank">>((a) => ({
      value: a.fg + a.ft,
      fg: a.fg,
      ft: a.ft,
      playerId: a.playerId,
      playerName: a.playerName,
      teamId: a.teamId,
      teamName: a.teamName,
      firstSeason: a.firstSeason,
      lastSeason: a.lastSeason,
    }))
    .sort((a, b) => b.value - a.value || compareText(a.playerId, b.playerId));
  return { rows: rankRows(sorted, q.topN ?? CLUTCH_TOP_N), players: sorted.length };
}

// ---- アシストペア ----

/** 1試合／シーズン（選んだシーズンの合計）／通算（全シーズンの合計） */
export type PairUnit = "game" | "season" | "career";
export const PAIR_UNITS: PairUnit[] = ["game", "season", "career"];
export const PAIR_UNIT_LABELS: Record<PairUnit, string> = { game: "1試合", season: "シーズン", career: "通算" };

export function isSupportedAssistPairs(file: { version?: unknown; rows?: unknown } | null | undefined): file is AssistPairsFile {
  return !!file && file.version === ASSIST_PAIRS_VERSION && !!file.rows;
}

/** 1シーズン分のアシストペアの行と、同じシーズンの選手の索引 */
export interface PairSeasonData {
  pairs: AssistPairsFile;
  index: PlayerGameIndexView;
}

export interface PairRow {
  rank: number;
  /** アシストを受けて得た得点（2P×2＋3P×3＋FT） */
  value: number;
  /** 2P・3P・FT の成功数 */
  n2: number;
  n3: number;
  nf: number;
  assisterId: string;
  assisterName: string;
  scorerId: string;
  scorerName: string;
  /** 得点した選手のチーム（1試合はその試合、ほかは最後の試合） */
  teamId: string;
  teamName: string;
  /** 1試合のみ */
  scheduleKey?: string;
  date?: string;
  season?: string;
  opponentTeamId?: string;
  opponentTeamName?: string;
  isHome?: boolean;
  /** シーズン・通算のみ: 2人でアシスト付きの得点があった試合の数と、最初・最後のシーズン */
  games?: number;
  firstSeason?: string;
  lastSeason?: string;
}

export interface PairQuery {
  data: readonly PairSeasonData[];
  gameType: SeasonGameTypeFilter;
  conditions: GameRecordConditions;
  unit: PairUnit;
  /** 指定時、アシストした選手・得点した選手の両方がこの選手IDにいる組だけ（現役の絞り込み。DESIGN.md 222章） */
  activeIds?: ReadonlySet<string> | null;
  topN?: number;
}

const rowLookupCache = new WeakMap<PlayerGameIndexFile, Map<number, number>>();

/** (試合の番号, 選手辞書の番号) → 選手の行の番号 */
function rowLookup(file: PlayerGameIndexFile): Map<number, number> {
  let m = rowLookupCache.get(file);
  if (m) return m;
  m = new Map();
  const width = file.players.length;
  for (let i = 0; i < file.rows.player.length; i++) m.set(file.rows.game[i]! * width + file.rows.player[i]!, i);
  rowLookupCache.set(file, m);
  return m;
}

interface PairAcc {
  n2: number;
  n3: number;
  nf: number;
  games: number;
  assisterId: string;
  assisterName: string;
  scorerId: string;
  scorerName: string;
  teamId: string;
  teamName: string;
  lastDate: string;
  lastKey: string;
  firstSeason: string;
  lastSeason: string;
}

export function queryAssistPairs(q: PairQuery): { rows: PairRow[]; pairs: number } {
  const singles: Omit<PairRow, "rank">[] = [];
  const acc = new Map<string, PairAcc>();
  for (const { pairs, index } of q.data) {
    const file = index.file;
    const facts = gameFacts(file);
    const lookup = rowLookup(file);
    const width = file.players.length;
    const dictIndex = new Map(file.players.map((p, i) => [p[0], i]));
    const gameIndexByKey = new Map(file.games.key.map((k, i) => [k, i]));
    const r = pairs.rows;
    for (let k = 0; k < r.game.length; k++) {
      const g = gameIndexByKey.get(pairs.keys[r.game[k]!]!);
      const scorerId = pairs.players[r.scorer[k]!]!;
      const assisterId = pairs.players[r.assister[k]!]!;
      if (q.activeIds && (!q.activeIds.has(scorerId) || !q.activeIds.has(assisterId))) continue;
      const si = dictIndex.get(scorerId);
      const ai = dictIndex.get(assisterId);
      if (g === undefined || si === undefined || ai === undefined) continue;
      const row = lookup.get(g * width + si);
      if (row === undefined) continue;
      const home = (file.rows.flags[row]! & ROW_FLAG_HOME) !== 0;
      if (!matchesGame(facts[g * 2 + (home ? 0 : 1)]!, q.gameType, q.conditions)) continue;
      const n2 = r.n2[k]!;
      const n3 = r.n3[k]!;
      const nf = r.nf[k]!;
      const team = file.teams[home ? file.games.home[g]! : file.games.away[g]!]!;
      const opp = file.teams[home ? file.games.away[g]! : file.games.home[g]!]!;
      const date = file.games.date[g]!;
      const key = file.games.key[g]!;
      const assisterName = file.players[ai]![1];
      const scorerName = file.players[si]![1];
      if (q.unit === "game") {
        singles.push({
          value: assistPairPoints({ n2, n3, nf }),
          n2,
          n3,
          nf,
          assisterId,
          assisterName,
          scorerId,
          scorerName,
          teamId: team[0],
          teamName: team[1],
          scheduleKey: key,
          date,
          season: file.season,
          opponentTeamId: opp[0],
          opponentTeamName: opp[1],
          isHome: home,
        });
        continue;
      }
      const id = `${assisterId}>${scorerId}`;
      let a = acc.get(id);
      if (!a) {
        a = { n2: 0, n3: 0, nf: 0, games: 0, assisterId, assisterName, scorerId, scorerName, teamId: team[0], teamName: team[1], lastDate: date, lastKey: key, firstSeason: file.season, lastSeason: file.season };
        acc.set(id, a);
      }
      a.n2 += n2;
      a.n3 += n3;
      a.nf += nf;
      a.games += 1;
      if (file.season < a.firstSeason) a.firstSeason = file.season;
      if (date > a.lastDate || (date === a.lastDate && key > a.lastKey)) {
        a.lastDate = date;
        a.lastKey = key;
        a.lastSeason = file.season;
        a.assisterName = assisterName;
        a.scorerName = scorerName;
        a.teamId = team[0];
        a.teamName = team[1];
      }
    }
  }
  if (q.unit === "game") {
    singles.sort(
      (a, b) =>
        b.value - a.value ||
        compareText(a.assisterId, b.assisterId) ||
        compareText(a.scorerId, b.scorerId) ||
        compareText(a.date!, b.date!) ||
        compareText(a.scheduleKey!, b.scheduleKey!),
    );
    return { rows: rankRows(singles, q.topN ?? CLUTCH_TOP_N), pairs: singles.length };
  }
  const sorted = [...acc.values()]
    .map<Omit<PairRow, "rank">>((a) => ({
      value: assistPairPoints(a),
      n2: a.n2,
      n3: a.n3,
      nf: a.nf,
      assisterId: a.assisterId,
      assisterName: a.assisterName,
      scorerId: a.scorerId,
      scorerName: a.scorerName,
      teamId: a.teamId,
      teamName: a.teamName,
      games: a.games,
      firstSeason: a.firstSeason,
      lastSeason: a.lastSeason,
    }))
    .sort((a, b) => b.value - a.value || compareText(a.assisterId, b.assisterId) || compareText(a.scorerId, b.scorerId));
  return { rows: rankRows(sorted, q.topN ?? CLUTCH_TOP_N), pairs: sorted.length };
}
