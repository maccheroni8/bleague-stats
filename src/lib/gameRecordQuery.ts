// ランキングの1試合記録の「条件を付けたとき」の集計（DESIGN.md 220章）。1試合行の索引（219章。gameIndex.ts）を読み、試合の条件・登録区分・ポジション・
// ルーキー・スタッツの条件で絞り、項目の値で並べて上位（同じ値はすべて）を返す。通信・画面の部品を含まない純粋な部分（検証スクリプトからも使う）。
// 集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。
//
// 行を全件オブジェクトにはしない（全シーズンで選手13万行）。試合ごとの条件は「試合×ホーム/アウェイ」の事実の表（GameSideFacts。約1万2千件）で先に判定し、
// 通った行だけを playerGameAt・teamGameAt でオブジェクトにする。
import { FIRST_LEAGUE_SEASON } from "../../shared/rookieEligibility";
import { GAME_FLAG_PLAYOFF, GAME_FLAG_SHORT, ROW_FLAG_HOME, type IndexGames, type IndexTeam } from "../../shared/gameIndex";
import { PLAYER_GAME_RECORD_STATS, type PlayerGameRecordDef, type PlayerRecordGame } from "../../shared/playerGameRecords";
import { periodRecordKindDef, periodScore, type PeriodKey, type PeriodRecordKind } from "../../shared/teamPeriodRecords";
import { TEAM_RECORD_STATS, teamRecordDetail, type TeamRecordValueDef } from "../../shared/teamRecords";
import type { PlayerGameRecordEntry, RookieEligibilityFile, TeamGameLog } from "../../shared/types";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { formatMinutesFromSeconds } from "./boxscoreAggregate";
import { classKeyOfFilter, positionFilterValue, type PlayerGroupFilter } from "./classificationFilter";
import { formatPct, formatSigned } from "./format";
import {
  playerGameAt,
  rookieOfIndex,
  teamGameAt,
  type IndexedPlayerGame,
  type IndexedTeamGame,
  type PlayerGameIndexView,
  type TeamGameIndexView,
} from "./gameIndex";
import type { GameRecordConditions } from "./gameRecordConditions";
import { matchesMargin } from "./situational";
import { statConditionMatcher, type StatConditionItem, type StatConditionsState } from "./statConditions";
import {
  formatTeamRecordValue,
  parsePeriodItemKey,
  teamRecordDefs,
  teamRecordItems,
  teamRecordLowerFirst,
  type TeamGameRecordRow,
  type TeamRecordMode,
} from "./teamGameRecords";

/** 上位何位まで返すか（同じ順位は続けて入れる）。一覧の表示も同じ件数で切る */
export const GAME_RECORD_TOP_N = 20;
/** 同じ順位の行を広げて出すときの、表示する行数の上限（全体で。DESIGN.md 220章） */
export const GAME_RECORD_TIE_EXPAND_MAX = 100;

// ---- 試合ごとの事実の表 ----

export interface GameSideFacts {
  playoff: boolean;
  short: boolean;
  win: boolean;
  isHome: boolean;
  oppId: string;
  ownDivision: string;
  oppDivision: string;
  /** 最終点差の大きさ */
  absMargin: number;
  overtimes: number;
  maxLead?: number;
  maxDeficit?: number;
}

const factsCache = new WeakMap<object, GameSideFacts[]>();

/** 試合の番号×2＋(ホーム 0／アウェイ 1) の位置に、その側から見た事実を並べる */
export function gameFacts(file: { games: IndexGames; teams: IndexTeam[] }): GameSideFacts[] {
  const cached = factsCache.get(file);
  if (cached) return cached;
  const { games, teams } = file;
  const out: GameSideFacts[] = [];
  for (let g = 0; g < games.key.length; g++) {
    for (const side of [0, 1] as const) {
      const isHome = side === 0;
      const own = teams[isHome ? games.home[g]! : games.away[g]!]!;
      const opp = teams[isHome ? games.away[g]! : games.home[g]!]!;
      const teamScore = isHome ? games.homeScore[g]! : games.awayScore[g]!;
      const oppScore = isHome ? games.awayScore[g]! : games.homeScore[g]!;
      const lead = isHome ? games.homeMaxLead[g]! : games.awayMaxLead[g]!;
      const deficit = isHome ? games.awayMaxLead[g]! : games.homeMaxLead[g]!;
      out.push({
        playoff: (games.flags[g]! & GAME_FLAG_PLAYOFF) !== 0,
        short: (games.flags[g]! & GAME_FLAG_SHORT) !== 0,
        win: teamScore > oppScore,
        isHome,
        oppId: opp[0],
        ownDivision: own[2],
        oppDivision: opp[2],
        absMargin: Math.abs(teamScore - oppScore),
        overtimes: games.overtimes[g]!,
        ...(lead >= 0 && deficit >= 0 ? { maxLead: lead, maxDeficit: deficit } : {}),
      });
    }
  }
  factsCache.set(file, out);
  return out;
}

/** 試合区分と試合の条件（前後半5分の特別な試合の扱いを除く）に当てはまるか */
export function matchesGame(f: GameSideFacts, gameType: SeasonGameTypeFilter, c: GameRecordConditions): boolean {
  if (gameType === "regular" ? f.playoff : gameType === "playoff" ? !f.playoff : false) return false;
  if (c.result === "win" && !f.win) return false;
  if (c.result === "loss" && f.win) return false;
  if (c.homeAway === "home" && !f.isHome) return false;
  if (c.homeAway === "away" && f.isHome) return false;
  if (c.opponents.length > 0 && !c.opponents.includes(f.oppId)) return false;
  if (c.overtime) {
    const ot = f.overtimes;
    if (c.overtime === "none" ? ot !== 0 : c.overtime === "any" ? ot < 1 : c.overtime === "1" ? ot !== 1 : c.overtime === "2" ? ot !== 2 : ot < 3) return false;
  }
  if (c.marginMin !== undefined && f.absMargin < c.marginMin) return false;
  if (c.marginMax !== undefined && f.absMargin > c.marginMax) return false;
  if (c.margin && !matchesMargin(f, c.margin)) return false;
  if (c.ownDivision && f.ownDivision !== c.ownDivision) return false;
  if (c.oppDivision && f.oppDivision !== c.oppDivision) return false;
  return true;
}

export interface GameRecordQueryResult<R> {
  /** 上位（同じ順位の行はすべて。順位つき）。並びは、値→（成功率は試投数の多い順）→新しい試合 */
  rows: R[];
  /** 前後半5分の特別な試合のうち、ほかの条件に当てはまるが除いた行の数 */
  excludedSpecial: number;
}

interface Candidate {
  vi: number;
  i: number;
  v: number;
  attempts: number;
  date: string;
  id: string;
  key: string;
}

function compareCandidates(lowerFirst: boolean, dateOldFirst: boolean) {
  return (a: Candidate, b: Candidate): number =>
    (lowerFirst ? a.v - b.v : b.v - a.v) ||
    b.attempts - a.attempts ||
    (dateOldFirst ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)) ||
    a.id.localeCompare(b.id) ||
    a.key.localeCompare(b.key);
}

/** 並べた候補に順位をつけ、topN位までを返す（同じ値は同じ順位。N位と同じ値はすべて含む） */
function rankTop(sorted: Candidate[], topN: number): { cand: Candidate; rank: number }[] {
  const out: { cand: Candidate; rank: number }[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i]!.v !== sorted[i - 1]!.v) rank = i + 1;
    if (rank > topN) break;
    out.push({ cand: sorted[i]!, rank });
  }
  return out;
}

// ---- 個人 ----

export type PlayerRecordMode = "record" | "worst";
export const PLAYER_RECORD_MODE_LABELS: Record<PlayerRecordMode, string> = { record: "記録", worst: "ワースト" };

export interface PlayerQueryStat {
  key: string;
  label: string;
  def: PlayerGameRecordDef;
  /** 値の小さい方が上位か（ワーストの成功率・EFF・+/- ） */
  lowerFirst: boolean;
  /** 上位20位のファイルに無く、索引でしか出せないか */
  indexOnly: boolean;
}

/** 少ない方から並べてよい項目。成功率（既存の最低試投数を満たす試合だけ）・EFF・+/- 。個数は0の同率が数万件になるので出さない */
const WORST_ASCENDING_KEYS = ["fgPct", "2pPct", "tpPct", "ftPct", "efgPct", "tsPct", "eff", "plusMinus"];

const TOV_DEF: PlayerGameRecordDef = { key: "tov", label: "TOV", value: (g) => g.tov };

/**
 * 種類ごとの項目。記録＝今の36項目（多い順）。ワースト＝成功率6つ・EFF・+/-（少ない順）と、TOV（多い順）。
 * PF・UFOUL・TF は多い順でも同率が多い（PFの5は3,102試合）ので出さない
 */
export function playerQueryStats(mode: PlayerRecordMode): PlayerQueryStat[] {
  if (mode === "record") {
    return PLAYER_GAME_RECORD_STATS.map((def) => ({ key: def.key, label: def.label, def, lowerFirst: false, indexOnly: false }));
  }
  const worst = PLAYER_GAME_RECORD_STATS.filter((d) => WORST_ASCENDING_KEYS.includes(d.key)).map<PlayerQueryStat>((def) => ({
    key: def.key,
    label: def.label,
    def,
    lowerFirst: true,
    indexOnly: true,
  }));
  return [...worst, { key: TOV_DEF.key, label: TOV_DEF.label, def: TOV_DEF, lowerFirst: false, indexOnly: true }];
}

export interface PlayerRecordRow extends PlayerGameRecordEntry {
  position?: string;
  /** 当時の値でなく補った値か（"near" 近いシーズンの値／"current" 現在の値） */
  positionFallback?: "near" | "current";
}

export interface PlayerQuery {
  views: readonly PlayerGameIndexView[];
  gameType: SeasonGameTypeFilter;
  conditions: GameRecordConditions;
  group: PlayerGroupFilter;
  positions: readonly string[];
  statConditions: StatConditionsState;
  rookies: RookieEligibilityFile | null;
  /** 指定時、この選手IDの記録だけ（現役の絞り込み。今季の名簿の選手。DESIGN.md 222章） */
  activeIds?: ReadonlySet<string> | null;
  /** 指定時、選手名を今の登録名にする（歴代など、複数のシーズンをまたぐ表。選手ID → 名前。DESIGN.md 222-5）。無い選手は、その試合のシーズンの名前 */
  currentNames?: ReadonlyMap<string, string> | null;
  stat: PlayerQueryStat;
  includeSpecial: boolean;
  topN?: number;
}

/** 選手の索引の行を絞る条件（試合の条件・現役・登録区分〈ルーキーを含む〉・ポジション）。1試合記録・達成記録（thresholdQuery.ts）で共通 */
export interface PlayerRowFilterInput {
  gameType: SeasonGameTypeFilter;
  conditions: GameRecordConditions;
  group: PlayerGroupFilter;
  positions: readonly string[];
  rookies: RookieEligibilityFile | null;
  /** 指定時、この選手IDの記録だけ（現役の絞り込み。今季の名簿の選手。DESIGN.md 222章） */
  activeIds?: ReadonlySet<string> | null;
}

/** i行目の、その側から見た試合の事実（gameFacts の表から引く） */
export function rowSideFacts(view: PlayerGameIndexView, facts: GameSideFacts[], i: number): GameSideFacts {
  const { rows } = view.file;
  return facts[rows.game[i]! * 2 + ((rows.flags[i]! & ROW_FLAG_HOME) !== 0 ? 0 : 1)]!;
}

/**
 * 選手の索引の行が、試合の条件・現役・登録区分（ルーキーを含む）・ポジションに当てはまるかを返す関数を作る。
 * 前後半5分の特別な試合の扱い・スタッツの条件は含めない（呼び出し側で決める）。行をオブジェクトにせず、列の値だけで判定する
 */
export function playerRowFilter(q: PlayerRowFilterInput): (view: PlayerGameIndexView, facts: GameSideFacts[], i: number) => boolean {
  const positionSet = q.positions.length > 0 ? new Set(q.positions) : null;
  const classKey = q.group === "rookie" ? undefined : classKeyOfFilter(q.group);
  return (view, facts, i) => {
    const f = rowSideFacts(view, facts, i);
    if (!matchesGame(f, q.gameType, q.conditions)) return false;
    const p = view.file.players[view.file.rows.player[i]!]!;
    if (q.activeIds && !q.activeIds.has(p[0])) return false;
    if (q.group === "rookie") {
      // 2016-17は、それ以前の経歴が無くルーキーを判定できない（rookieFilter.ts の rookieSupportedSeason と同じ）
      if (view.season <= FIRST_LEAGUE_SEASON || !rookieOfIndex(q.rookies, view.season, p[0])) return false;
    } else if (classKey && p[5] !== classKey) return false;
    if (positionSet && !(p[2] && positionSet.has(positionFilterValue(p[2])))) return false;
    return true;
  };
}

export function queryPlayerGameRecords(q: PlayerQuery): GameRecordQueryResult<PlayerRecordRow> {
  const { stat } = q;
  const def = stat.def;
  const matcher = statConditionMatcher(q.statConditions, PLAYER_STAT_CONDITION_ITEMS);
  const rowFilter = playerRowFilter(q);
  const candidates: Candidate[] = [];
  let excludedSpecial = 0;

  q.views.forEach((view, vi) => {
    const facts = gameFacts(view.file);
    const { rows, players, games } = view.file;
    for (let i = 0; i < view.size; i++) {
      if (!rowFilter(view, facts, i)) continue;
      const g = rows.game[i]!;
      const f = rowSideFacts(view, facts, i);
      const p = players[rows.player[i]!]!;
      const row = playerGameAt(view, i);
      const game = row as unknown as PlayerRecordGame;
      if (def.filter && !def.filter(game)) continue;
      if (matcher && !matcher(row)) continue;
      if (f.short && !q.includeSpecial) {
        excludedSpecial += 1;
        continue;
      }
      candidates.push({
        vi,
        i,
        v: def.value(game),
        attempts: def.fraction ? def.fraction(game)[1] : 0,
        date: games.date[g]!,
        id: p[0],
        key: games.key[g]!,
      });
    }
  });

  candidates.sort(compareCandidates(stat.lowerFirst, false));
  const rows = rankTop(candidates, q.topN ?? GAME_RECORD_TOP_N).map(({ cand, rank }): PlayerRecordRow => {
    const row = playerGameAt(q.views[cand.vi]!, cand.i);
    const frac = def.fraction?.(row as unknown as PlayerRecordGame);
    return {
      rank,
      value: cand.v,
      playerId: row.playerId,
      playerName: q.currentNames?.get(row.playerId) ?? row.playerName,
      teamId: row.teamId,
      teamName: row.teamName,
      opponentTeamId: row.opponentTeamId,
      opponentTeamName: row.opponentTeamName,
      isHome: row.isHome,
      date: row.date,
      scheduleKey: row.scheduleKey,
      season: row.season,
      ...(frac ? { made: frac[0], attempted: frac[1] } : {}),
      ...(row.position ? { position: row.position } : {}),
      ...(row.positionFallback ? { positionFallback: row.positionFallback } : {}),
    };
  });
  return { rows, excludedSpecial };
}

// ---- チーム ----

export interface TeamQueryStat {
  key: string;
  label: string;
  lowerFirst: boolean;
  /** 値（クォーター別・前後半別で区間の値が無い試合は null で対象外） */
  value: (g: IndexedTeamGame) => number | null;
  filter?: (g: IndexedTeamGame) => boolean;
  fraction?: (g: IndexedTeamGame) => readonly [number, number];
  /** 区間の値（クォーター別・前後半別） */
  period?: { period: PeriodKey; kind: PeriodRecordKind };
  indexOnly: false;
}

/** 種類・項目から、条件付きの集計に使う定義を作る。項目が無ければ null */
export function teamQueryStat(mode: TeamRecordMode, key: string): TeamQueryStat | null {
  const period = parsePeriodItemKey(key);
  const label = teamRecordItems(mode).find((i) => i.key === key)?.label;
  if (label === undefined) return null;
  if (period) {
    const kind = periodRecordKindDef(period.kind);
    return {
      key,
      label,
      lowerFirst: kind.lowerFirst,
      value: (g) => {
        const s = periodScore(g as unknown as TeamGameLog, period.period);
        return s ? kind.value(s) : null;
      },
      period,
      indexOnly: false,
    };
  }
  const def: TeamRecordValueDef | undefined = teamRecordDefs(mode).find((d) => d.key === key);
  if (!def) return null;
  return {
    key,
    label,
    lowerFirst: teamRecordLowerFirst(mode, key),
    value: (g) => def.value(g as unknown as TeamGameLog),
    filter: def.filter ? (g) => def.filter!(g as unknown as TeamGameLog) : undefined,
    fraction: def.fraction ? (g) => def.fraction!(g as unknown as TeamGameLog) : undefined,
    indexOnly: false,
  };
}

export interface TeamQuery {
  views: readonly TeamGameIndexView[];
  gameType: SeasonGameTypeFilter;
  conditions: GameRecordConditions;
  statConditions: StatConditionsState;
  stat: TeamQueryStat;
  includeSpecial: boolean;
  topN?: number;
}

export function queryTeamGameRecords(q: TeamQuery): GameRecordQueryResult<TeamGameRecordRow> {
  const { stat, conditions: c } = q;
  const matcher = statConditionMatcher(q.statConditions, TEAM_STAT_CONDITION_ITEMS);
  const candidates: Candidate[] = [];
  let excludedSpecial = 0;

  q.views.forEach((view, vi) => {
    const facts = gameFacts(view.file);
    const { games, teams } = view.file;
    for (let i = 0; i < view.size; i++) {
      const f = facts[i]!;
      if (!matchesGame(f, q.gameType, c)) continue;
      const row = teamGameAt(view, i);
      if (stat.filter && !stat.filter(row)) continue;
      if (matcher && !matcher(row)) continue;
      const v = stat.value(row);
      if (v === null) continue;
      if (f.short && !q.includeSpecial) {
        excludedSpecial += 1;
        continue;
      }
      const g = i >> 1;
      candidates.push({
        vi,
        i,
        v,
        attempts: stat.fraction ? stat.fraction(row)[1] : 0,
        date: games.date[g]!,
        id: teams[(i & 1) === 0 ? games.home[g]! : games.away[g]!]![0],
        key: games.key[g]!,
      });
    }
  });

  // 同じ値の中は、新しい試合から（シーズンの表と同じ。クォーター別・前後半別だけ古い試合から。DESIGN.md 143章・220章）
  candidates.sort(compareCandidates(stat.lowerFirst, !!stat.period));
  const rows = rankTop(candidates, q.topN ?? GAME_RECORD_TOP_N).map(({ cand, rank }): TeamGameRecordRow => {
    const row = teamGameAt(q.views[cand.vi]!, cand.i);
    const frac = stat.fraction?.(row);
    const score = stat.period ? periodScore(row as unknown as TeamGameLog, stat.period.period) : null;
    const detail = stat.period ? undefined : teamRecordDetail(stat.key, row);
    return {
      ...(detail ? { detail } : {}),
      rank,
      value: cand.v,
      teamId: row.teamId,
      teamName: row.teamName,
      season: row.season,
      scheduleKey: row.scheduleKey,
      date: row.date,
      opponentTeamId: row.opponentTeamId,
      opponentTeamName: row.opponentTeamName,
      isHome: row.isHome,
      ...(frac ? { made: frac[0], attempted: frac[1] } : {}),
      ...(score ? { ownPoints: score.pts, oppPoints: score.oppPts, ...(score.fromPbp ? { fromPbp: true } : {}) } : {}),
    };
  });
  return { rows, excludedSpecial };
}

// ---- スタッツの条件の項目（その試合の値で判定する） ----

const CONDITION_GROUP = "1試合の値";

function playerConditionItem(def: PlayerGameRecordDef): StatConditionItem<IndexedPlayerGame> {
  const kind = def.kind === "pct" ? "pct" : def.kind === "minutes" ? "minutes" : def.kind === "ratio" || def.kind === "signed" ? "rate" : "count";
  return {
    key: def.key,
    label: def.label,
    group: CONDITION_GROUP,
    kind,
    unit: kind === "pct" ? "%" : kind === "minutes" ? "分" : "",
    suffix: kind === "pct" ? "%" : kind === "minutes" ? "分" : "",
    display: (row) => {
      const game = row as unknown as PlayerRecordGame;
      // 成功率は試投が無い試合を「-」にする（最低試投数は、条件ではなく、記録の一覧の対象を決めるものなので、ここでは掛けない）
      if (def.fraction && def.fraction(game)[1] === 0) return "-";
      const v = def.value(game);
      switch (def.kind) {
        case "minutes":
          return formatMinutesFromSeconds(Math.round(v * 60));
        case "pct":
          return formatPct(v);
        case "ratio":
          return v.toFixed(1);
        case "signed":
          return formatSigned(v, 0);
        default:
          return String(v);
      }
    },
  };
}

const PLAYER_CONDITION_DEFS: PlayerGameRecordDef[] = [
  ...PLAYER_GAME_RECORD_STATS,
  TOV_DEF,
  { key: "pf", label: "PF", value: (g) => g.pf },
];

/** 個人の1試合記録のスタッツの条件に選べる項目（記録の項目＋TOV・PF） */
export const PLAYER_STAT_CONDITION_ITEMS: StatConditionItem<IndexedPlayerGame>[] = PLAYER_CONDITION_DEFS.map(playerConditionItem);

/**
 * 2桁（10以上）になった部門の数（PTS・TR・AST・STL・BLK）。ダブルダブルは2以上、トリプルダブルは3以上
 * （集計の doubleDoubles・tripleDoubles、scripts/aggregate.ts と同じ定義）。達成記録（thresholdQuery.ts）のしきい値に使う。
 * 1試合記録のスタッツの条件の項目には入れない
 */
export const DOUBLE_DIGIT_CATEGORIES = ["pts", "reb", "ast", "stl", "blk"] as const;
export const DOUBLE_DIGIT_DEF: PlayerGameRecordDef = {
  key: "ddCats",
  label: "2桁の部門数（PTS・TR・AST・STL・BLK）",
  value: (g) => DOUBLE_DIGIT_CATEGORIES.filter((c) => g[c] >= 10).length,
};
export const DOUBLE_DIGIT_ITEM: StatConditionItem<IndexedPlayerGame> = playerConditionItem(DOUBLE_DIGIT_DEF);

function teamConditionItem(def: TeamRecordValueDef): StatConditionItem<IndexedTeamGame> {
  const pct = !!def.fraction;
  return {
    key: def.key,
    label: def.label,
    group: CONDITION_GROUP,
    kind: pct ? "pct" : "count",
    unit: pct ? "%" : "",
    suffix: pct ? "%" : "",
    display: (row) => {
      const game = row as unknown as TeamGameLog;
      if (def.fraction) {
        if (def.fraction(game)[1] === 0) return "-";
      } else if (def.filter && !def.filter(game)) {
        return "-";
      }
      return formatTeamRecordValue(def.key, def.value(game));
    },
  };
}

/** チームの1試合記録のスタッツの条件に選べる項目（記録したチーム自身のその試合の値） */
export const TEAM_STAT_CONDITION_ITEMS: StatConditionItem<IndexedTeamGame>[] = TEAM_RECORD_STATS.map(teamConditionItem);
