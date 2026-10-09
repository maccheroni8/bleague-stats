// ランキング > 個人 > 達成記録（DESIGN.md 223章）の集計。「項目がしきい値以上（以下）の試合」を共通の条件にして、
// 達成試合数・連続記録・達成時の年齢の3つを、1試合行の索引（219章。gameIndex.ts）から作る。通信・画面の部品を含まない純粋な部分（検証スクリプトからも使う）。
// 集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。
//
// 共通の条件: 試合の条件・現役・登録区分（ルーキーを含む）・ポジションは 1試合記録と同じ playerRowFilter（gameRecordQuery.ts）、
// しきい値は 1試合記録の「スタッツの条件」（statConditions.ts。以上・以下、すべて／どれか）に「2桁の部門数」を足したもの。
// 前後半5分の特別な試合は、既定で数えない（連続を途切れさせず、「以下」の条件を自動的に満たしてしまうのを避ける）。
//
// 連続記録は「条件に当てはまる試合だけを順に見て、途切れずに続いた試合数」。出場した試合だけで数える（欠場では途切れない）。
// シーズンまたぎ・移籍は継続する。レギュラーシーズンとポストシーズンは別の並び。ただし、B.PREMIERの名簿に載っていないシーズンをはさむと途切れる
// （B2など別のリーグにいた期間は、欠場ではない）。
import { GAME_FLAG_PLAYOFF, GAME_FLAG_SHORT, ROW_FLAG_HOME } from "../../shared/gameIndex";
import { ageOnDate, compareAge, type AgeOnDate } from "../../shared/gameAge";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import {
  DOUBLE_DIGIT_CATEGORIES,
  DOUBLE_DIGIT_ITEM,
  PLAYER_STAT_CONDITION_ITEMS,
  gameFacts,
  playerRowFilter,
  rowSideFacts,
  type PlayerRowFilterInput,
} from "./gameRecordQuery";
import { playerGameAt, type IndexedPlayerGame, type PlayerGameIndexView } from "./gameIndex";
import { MIN_GAMES_PLAYED_RATIO_FOR_RANKING } from "./playerRankingEligibility";
import { activeStatConditions, statConditionMatcher, type StatConditionItem, type StatConditionsState } from "./statConditions";

export const THRESHOLD_TOP_N = 20;

/** しきい値に選べる項目（1試合記録のスタッツの条件の項目＋2桁の部門数） */
export const THRESHOLD_ITEMS: StatConditionItem<IndexedPlayerGame>[] = [...PLAYER_STAT_CONDITION_ITEMS, DOUBLE_DIGIT_ITEM];

/** しきい値の初期値（PTS 20 以上）。URLには、これと違うときだけ載せる */
export const DEFAULT_THRESHOLD: StatConditionsState = { match: "all", conditions: [{ id: 1, key: "pts", op: "gte", value: "20" }] };

export interface QuickValue {
  value: number;
  label?: string;
}
/** 「すぐ選べる」値（項目ごと） */
export const THRESHOLD_QUICK_VALUES: Record<string, QuickValue[]> = {
  pts: [{ value: 10 }, { value: 20 }, { value: 30 }, { value: 40 }],
  reb: [{ value: 10 }, { value: 15 }, { value: 20 }],
  oreb: [{ value: 5 }, { value: 8 }],
  ast: [{ value: 5 }, { value: 10 }, { value: 15 }],
  stl: [{ value: 3 }, { value: 5 }],
  blk: [{ value: 3 }, { value: 5 }],
  fgm: [{ value: 10 }, { value: 15 }],
  tpm: [{ value: 3 }, { value: 5 }, { value: 7 }],
  ftm: [{ value: 10 }, { value: 15 }],
  eff: [{ value: 20 }, { value: 30 }],
  ddCats: [
    { value: 2, label: "ダブルダブル" },
    { value: 3, label: "トリプルダブル" },
  ],
};

export function thresholdActive(state: StatConditionsState): boolean {
  return statConditionMatcher(state, THRESHOLD_ITEMS) !== null;
}

const CATEGORY_LABELS: Record<(typeof DOUBLE_DIGIT_CATEGORIES)[number], string> = { pts: "PTS", reb: "TR", ast: "AST", stl: "STL", blk: "BLK" };

/** その試合の値の説明（「PTS 21」。2桁の部門数は、2桁になった部門「PTS 21・TR 11」）。しきい値の項目ごと、「・」でつなぐ */
export function thresholdDetail(row: IndexedPlayerGame, state: StatConditionsState): string {
  const parts: string[] = [];
  for (const { item } of activeStatConditions(state, THRESHOLD_ITEMS)) {
    if (item.key === DOUBLE_DIGIT_ITEM.key) {
      for (const c of DOUBLE_DIGIT_CATEGORIES) if (row[c] >= 10) parts.push(`${CATEGORY_LABELS[c]} ${row[c]}`);
    } else {
      const text = `${item.label} ${item.display(row)}${item.suffix}`;
      if (!parts.includes(text)) parts.push(text);
    }
  }
  return parts.join("・");
}

export interface ThresholdInput extends PlayerRowFilterInput {
  /** シーズンの昇順に並べた索引（達成試合数のシーズンは1つ、それ以外は全シーズン） */
  views: readonly PlayerGameIndexView[];
  /** しきい値（使える条件が1つも無いときは null を返す） */
  threshold: StatConditionsState;
  /** 前後半5分の特別な試合を含めるか（既定は含めない） */
  includeSpecial: boolean;
  /** 指定時、選手名を今の登録名にする（複数のシーズンをまたぐ表。DESIGN.md 222-5） */
  currentNames?: ReadonlyMap<string, string> | null;
  topN?: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 並べた行に順位をつけ（同じ値は同じ順位、次はその分飛ばす）、topN位までを返す（N位と同じ値はすべて含む） */
function rankSorted<T>(sorted: T[], same: (a: T, b: T) => boolean, topN: number): (T & { rank: number })[] {
  const out: (T & { rank: number })[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || !same(sorted[i]!, sorted[i - 1]!)) rank = i + 1;
    if (rank > topN) break;
    out.push({ ...sorted[i]!, rank });
  }
  return out;
}

/** 試合の条件・登録区分などに当てはまる行を順に見て、しきい値を満たすかを渡す。使えるしきい値が無ければ null */
function scanRows(q: ThresholdInput, visit: (vi: number, i: number, hit: boolean) => void): { excludedSpecial: number } | null {
  const matcher = statConditionMatcher(q.threshold, THRESHOLD_ITEMS);
  if (!matcher) return null;
  const rowFilter = playerRowFilter(q);
  let excludedSpecial = 0;
  q.views.forEach((view, vi) => {
    const facts = gameFacts(view.file);
    for (let i = 0; i < view.size; i++) {
      if (!rowFilter(view, facts, i)) continue;
      if (!q.includeSpecial && rowSideFacts(view, facts, i).short) {
        excludedSpecial += 1;
        continue;
      }
      visit(vi, i, matcher(playerGameAt(view, i)));
    }
  });
  return { excludedSpecial };
}

// ---- 達成試合数 ----

export type ThresholdCountSort = "count" | "rate";

export interface ThresholdCountQuery extends ThresholdInput {
  /** count＝達成試合数、rate＝達成率（掲載基準を満たす選手だけ） */
  sort: ThresholdCountSort;
  /** 通算（全シーズン）か。達成率の掲載基準が、通算は出場100試合以上、シーズンはランキングの掲載基準（所属チームの試合数の85%以上）になる */
  career: boolean;
}

export interface ThresholdCountRow {
  rank: number;
  /** 並びの値（達成試合数、または達成率〈0〜1〉） */
  value: number;
  count: number;
  /** 出場試合数（試合の条件などに当てはまる試合の数） */
  games: number;
  rate: number;
  playerId: string;
  playerName: string;
  /** 最後に達成した試合のチーム */
  teamId: string;
  teamName: string;
  firstSeason: string;
  lastSeason: string;
}

/** 試合区分・前後半5分の特別な試合の扱いに当てはまる試合か（試合の表の旗で判定） */
function gameCounts(flags: number, gameType: SeasonGameTypeFilter, includeSpecial: boolean): boolean {
  const po = (flags & GAME_FLAG_PLAYOFF) !== 0;
  if (gameType === "regular" ? po : gameType === "playoff" ? !po : false) return false;
  return includeSpecial || (flags & GAME_FLAG_SHORT) === 0;
}

/**
 * ランキングの掲載基準（所属チームの試合数の85%以上に出場。statDefs.ts の MIN_GAMES_PLAYED_RATIO_FOR_RANKING）を満たす選手。
 * シーズンごとに「その選手の最後の試合のチーム」の試合数を分母にし（シーズン成績の掲載基準と同じ）、複数のシーズンは出場試合数と分母をそれぞれ合計して比べる。
 * 試合の条件・しきい値には依存しない（試合区分と、前後半5分の特別な試合の扱いだけ）
 */
export function ratioEligiblePlayers(
  views: readonly PlayerGameIndexView[],
  gameType: SeasonGameTypeFilter,
  includeSpecial: boolean,
  minRatio: number = MIN_GAMES_PLAYED_RATIO_FOR_RANKING,
): Set<string> {
  const { played, teamGames } = playedAndTeamGames(views, gameType, includeSpecial);
  const out = new Set<string>();
  for (const [id, gp] of played) {
    const denom = teamGames.get(id) ?? 0;
    if (denom > 0 && gp / denom >= minRatio) out.add(id);
  }
  return out;
}

/** 通算の達成率の掲載基準: 出場試合数の下限（ユーザー決定。DESIGN.md 223-3章） */
export const THRESHOLD_CAREER_MIN_GAMES = 100;

/**
 * 通算の達成率の掲載基準を満たす選手: 全シーズンの出場試合数（試合区分と前後半5分の特別な試合の扱いには従い、試合の条件・しきい値には依存しない）が
 * THRESHOLD_CAREER_MIN_GAMES 以上
 */
export function careerEligiblePlayers(
  views: readonly PlayerGameIndexView[],
  gameType: SeasonGameTypeFilter,
  includeSpecial: boolean,
  minGames: number = THRESHOLD_CAREER_MIN_GAMES,
): Set<string> {
  const { played } = playedAndTeamGames(views, gameType, includeSpecial);
  const out = new Set<string>();
  for (const [id, gp] of played) if (gp >= minGames) out.add(id);
  return out;
}

/** 選手ごとの出場試合数と、出場した各シーズンの「最後の試合のチーム」の試合数の合計 */
function playedAndTeamGames(
  views: readonly PlayerGameIndexView[],
  gameType: SeasonGameTypeFilter,
  includeSpecial: boolean,
): { played: Map<string, number>; teamGames: Map<string, number> } {
  const played = new Map<string, number>();
  const teamGames = new Map<string, number>();
  for (const view of views) {
    const { games, teams, rows, players } = view.file;
    const ok = games.flags.map((f) => gameCounts(f, gameType, includeSpecial));
    const perTeam = new Map<string, number>();
    for (let g = 0; g < ok.length; g++) {
      if (!ok[g]) continue;
      for (const t of [games.home[g]!, games.away[g]!]) {
        const id = teams[t]![0];
        perTeam.set(id, (perTeam.get(id) ?? 0) + 1);
      }
    }
    const perPlayer = new Map<string, { gp: number; team: string }>();
    for (let i = 0; i < view.size; i++) {
      const g = rows.game[i]!;
      if (!ok[g]) continue;
      const id = players[rows.player[i]!]![0];
      const home = (rows.flags[i]! & ROW_FLAG_HOME) !== 0;
      const team = teams[home ? games.home[g]! : games.away[g]!]![0];
      const e = perPlayer.get(id);
      if (e) {
        e.gp += 1;
        e.team = team;
      } else perPlayer.set(id, { gp: 1, team });
    }
    for (const [id, e] of perPlayer) {
      played.set(id, (played.get(id) ?? 0) + e.gp);
      teamGames.set(id, (teamGames.get(id) ?? 0) + (perTeam.get(e.team) ?? 0));
    }
  }
  return { played, teamGames };
}

interface CountAcc {
  count: number;
  games: number;
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  lastDate: string;
  lastKey: string;
  firstSeason: string;
  lastSeason: string;
}

/** 選手ごとに、しきい値を満たした試合の数と出場試合数を数える。views が1シーズンなら「シーズン」、全シーズンなら「通算」 */
export function queryThresholdCount(q: ThresholdCountQuery): { rows: ThresholdCountRow[]; players: number; excludedSpecial: number } | null {
  const acc = new Map<string, CountAcc>();
  const scan = scanRows(q, (vi, i, hit) => {
    const view = q.views[vi]!;
    const { rows, players, games, teams } = view.file;
    const p = players[rows.player[i]!]!;
    let a = acc.get(p[0]);
    if (!a) acc.set(p[0], (a = { count: 0, games: 0, playerId: p[0], playerName: p[1], teamId: "", teamName: "", lastDate: "", lastKey: "", firstSeason: "", lastSeason: "" }));
    a.games += 1;
    if (!hit) return;
    a.count += 1;
    const g = rows.game[i]!;
    const date = games.date[g]!;
    const key = games.key[g]!;
    if (!a.firstSeason || view.season < a.firstSeason) a.firstSeason = view.season;
    if (date > a.lastDate || (date === a.lastDate && key > a.lastKey)) {
      const team = teams[(rows.flags[i]! & ROW_FLAG_HOME) !== 0 ? games.home[g]! : games.away[g]!]!;
      a.lastDate = date;
      a.lastKey = key;
      a.lastSeason = view.season;
      a.playerName = p[1];
      a.teamId = team[0];
      a.teamName = team[1];
    }
  });
  if (!scan) return null;
  const eligible = q.sort !== "rate" ? null : q.career ? careerEligiblePlayers(q.views, q.gameType, q.includeSpecial) : ratioEligiblePlayers(q.views, q.gameType, q.includeSpecial);
  const list = [...acc.values()]
    .filter((a) => a.count > 0 && (!eligible || eligible.has(a.playerId)))
    .map<Omit<ThresholdCountRow, "rank">>((a) => ({
      value: q.sort === "rate" ? a.count / a.games : a.count,
      count: a.count,
      games: a.games,
      rate: a.count / a.games,
      playerId: a.playerId,
      playerName: q.currentNames?.get(a.playerId) ?? a.playerName,
      teamId: a.teamId,
      teamName: a.teamName,
      firstSeason: a.firstSeason,
      lastSeason: a.lastSeason,
    }));
  // 達成試合数: 多い順→達成率の高い順→選手ID。達成率: 高い順→達成試合数の多い順→選手ID
  list.sort((a, b) =>
    q.sort === "rate"
      ? b.rate - a.rate || b.count - a.count || compareText(a.playerId, b.playerId)
      : b.count - a.count || b.rate - a.rate || compareText(a.playerId, b.playerId),
  );
  return { rows: rankSorted(list, (a, b) => a.value === b.value, q.topN ?? THRESHOLD_TOP_N), players: list.length, excludedSpecial: scan.excludedSpecial };
}

// ---- 連続記録 ----

/** 連続の開始・終了の試合 */
export interface StreakGame {
  date: string;
  season: string;
  scheduleKey: string;
  teamId: string;
  teamName: string;
  opponentTeamId: string;
  opponentTeamName: string;
  isHome: boolean;
  /** その試合のしきい値の項目の値（「PTS 21」） */
  detail: string;
}

export interface ThresholdStreakQuery extends ThresholdInput {
  /** 連続は、レギュラーシーズンとポストシーズンを別の並びで数える（合算は無い） */
  gameType: "regular" | "playoff";
  /**
   * シーズン → そのシーズンにB.PREMIERの名簿にいた選手（選手IDがキー）。名簿外のシーズンをはさむ連続を途切れさせるのに使う。
   * player-careers.json の seasons（そのシーズンに登録していた選手。出場0試合も含む。DESIGN.md 175章）をそのまま渡せる
   */
  rosters: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  /** 今季の名簿の選手ID（継続中の判定。現役の絞り込み〈activeIds〉とは別）。null なら継続中は無い */
  currentIds: ReadonlySet<string> | null;
  /** true: 今も続いている連続だけを、その長さで並べる。false: 選手ごとの最長（同じ長さなら新しい方） */
  ongoingOnly: boolean;
}

export interface ThresholdStreakRow {
  rank: number;
  value: number;
  playerId: string;
  playerName: string;
  /** 連続の最後の試合のチーム */
  teamId: string;
  teamName: string;
  start: StreakGame;
  end: StreakGame;
  /** 今も続いている連続か（今季の名簿の選手で、最後の出場まで続いている） */
  ongoing: boolean;
}

interface Ref {
  vi: number;
  i: number;
}

interface Run {
  len: number;
  start: Ref;
  end: Ref;
}

interface PlayerStreak {
  playerId: string;
  /** 今続いている（最後に見た試合までつながっている）連続 */
  run: Run | null;
  best: Run | null;
  /** 最後に見た試合の索引の番号 */
  lastVi: number;
  lastRef: Ref;
}

export function queryThresholdStreaks(q: ThresholdStreakQuery): { rows: ThresholdStreakRow[]; players: number; excludedSpecial: number } | null {
  const states = new Map<string, PlayerStreak>();
  const presentCache: (Set<string> | undefined)[] = [];
  /** views[vi] のシーズンにB.PREMIERの名簿にいるか */
  const present = (vi: number, id: string): boolean => {
    let s = presentCache[vi];
    if (!s) {
      const view = q.views[vi]!;
      s = new Set<string>(view.file.players.map((p) => p[0]));
      for (const r of Object.keys(q.rosters[view.season] ?? {})) s.add(r);
      presentCache[vi] = s;
    }
    return s.has(id);
  };
  /** (from, to) のシーズンのどれかで名簿にいなければ true */
  const absentBetween = (from: number, to: number, id: string): boolean => {
    for (let k = from + 1; k < to; k++) if (!present(k, id)) return true;
    return false;
  };

  const scan = scanRows(q, (vi, i, hit) => {
    const { rows, players } = q.views[vi]!.file;
    const id = players[rows.player[i]!]![0];
    let st = states.get(id);
    if (!st) states.set(id, (st = { playerId: id, run: null, best: null, lastVi: -1, lastRef: { vi, i } }));
    if (st.run && vi - st.lastVi > 1 && absentBetween(st.lastVi, vi, id)) st.run = null;
    const ref = { vi, i };
    if (hit) {
      if (!st.run) st.run = { len: 0, start: ref, end: ref };
      st.run.len += 1;
      st.run.end = ref;
      if (!st.best || st.run.len >= st.best.len) st.best = st.run;
    } else st.run = null;
    st.lastVi = vi;
    st.lastRef = ref;
  });
  if (!scan) return null;

  const lastView = q.views.length - 1;
  const isOngoing = (st: PlayerStreak, run: Run | null): boolean =>
    !!run && st.run === run && !!q.currentIds?.has(st.playerId) && !absentBetween(st.lastVi, lastView + 1, st.playerId);

  const game = (ref: Ref): StreakGame => {
    const row = playerGameAt(q.views[ref.vi]!, ref.i);
    return {
      date: row.date,
      season: row.season,
      scheduleKey: row.scheduleKey,
      teamId: row.teamId,
      teamName: row.teamName,
      opponentTeamId: row.opponentTeamId,
      opponentTeamName: row.opponentTeamName,
      isHome: row.isHome,
      detail: thresholdDetail(row, q.threshold),
    };
  };

  interface Candidate {
    st: PlayerStreak;
    run: Run;
    ongoing: boolean;
  }
  const candidates: Candidate[] = [];
  for (const st of states.values()) {
    const run = q.ongoingOnly ? st.run : st.best;
    if (!run) continue;
    const ongoing = isOngoing(st, run);
    if (q.ongoingOnly && !ongoing) continue;
    candidates.push({ st, run, ongoing });
  }
  candidates.sort((a, b) => b.run.len - a.run.len || compareText(a.st.playerId, b.st.playerId));
  const top = rankSorted(candidates, (a, b) => a.run.len === b.run.len, q.topN ?? THRESHOLD_TOP_N);
  const rows = top.map<ThresholdStreakRow>(({ st, run, ongoing, rank }) => {
    const end = game(run.end);
    return {
      rank,
      value: run.len,
      playerId: st.playerId,
      playerName: q.currentNames?.get(st.playerId) ?? playerGameAt(q.views[run.end.vi]!, run.end.i).playerName,
      teamId: end.teamId,
      teamName: end.teamName,
      start: game(run.start),
      end,
      ongoing,
    };
  });
  return { rows, players: candidates.length, excludedSpecial: scan.excludedSpecial };
}

// ---- 達成時の年齢 ----

export type ThresholdAgeWhich = "young" | "old";

export interface ThresholdAgeQuery extends ThresholdInput {
  /** young＝最年少（初めて達成した試合）、old＝最年長（最後に達成した試合） */
  which: ThresholdAgeWhich;
}

export interface ThresholdAgeRow {
  rank: number;
  /** 並びの値（年×1000＋日。若い方が小さい） */
  value: number;
  age: AgeOnDate;
  playerId: string;
  playerName: string;
  teamId: string;
  teamName: string;
  date: string;
  season: string;
  scheduleKey: string;
  opponentTeamId: string;
  opponentTeamName: string;
  isHome: boolean;
  /** その試合のしきい値の項目の値（「PTS 21」） */
  detail: string;
}

/** 年齢の並べ替え・同順位の判定に使う数（年×1000＋日。日数は最大365） */
export function ageValue(age: AgeOnDate): number {
  return age.years * 1000 + age.days;
}

/**
 * 選手ごとに、しきい値を満たした試合のうち、最初（最年少）または最後（最年長）の試合の年齢を出して並べる（1選手1行）。
 * 生年月日の無い選手は含めない（unknownBirth に人数）
 */
export function queryThresholdAge(q: ThresholdAgeQuery): { rows: ThresholdAgeRow[]; players: number; unknownBirth: number; excludedSpecial: number } | null {
  const birth = new Map<string, string>();
  for (const view of q.views) for (const p of view.file.players) if (p[4] && !birth.has(p[0])) birth.set(p[0], p[4]);

  interface Pick {
    ref: Ref;
    date: string;
    key: string;
  }
  const picks = new Map<string, Pick>();
  const scan = scanRows(q, (vi, i, hit) => {
    if (!hit) return;
    const { rows, players, games } = q.views[vi]!.file;
    const id = players[rows.player[i]!]![0];
    const g = rows.game[i]!;
    const date = games.date[g]!;
    const key = games.key[g]!;
    const cur = picks.get(id);
    const later = !cur || date > cur.date || (date === cur.date && key > cur.key);
    if (!cur || (q.which === "old" ? later : !later)) picks.set(id, { ref: { vi, i }, date, key });
  });
  if (!scan) return null;

  let unknownBirth = 0;
  const list: Omit<ThresholdAgeRow, "rank">[] = [];
  for (const [id, pick] of picks) {
    const age = ageOnDate(birth.get(id), pick.date);
    if (!age) {
      unknownBirth += 1;
      continue;
    }
    const row = playerGameAt(q.views[pick.ref.vi]!, pick.ref.i);
    list.push({
      value: ageValue(age),
      age,
      playerId: id,
      playerName: q.currentNames?.get(id) ?? row.playerName,
      teamId: row.teamId,
      teamName: row.teamName,
      date: row.date,
      season: row.season,
      scheduleKey: row.scheduleKey,
      opponentTeamId: row.opponentTeamId,
      opponentTeamName: row.opponentTeamName,
      isHome: row.isHome,
      detail: thresholdDetail(row, q.threshold),
    });
  }
  // 同じ年齢（〇歳〇日まで同じ）は同じ順位。並びは、試合日の早い順→選手ID
  const sign = q.which === "young" ? 1 : -1;
  list.sort((a, b) => sign * compareAge(a.age, b.age) || compareText(a.date, b.date) || compareText(a.playerId, b.playerId));
  return { rows: rankSorted(list, (a, b) => compareAge(a.age, b.age) === 0, q.topN ?? THRESHOLD_TOP_N), players: list.length, unknownBirth, excludedSpecial: scan.excludedSpecial };
}
