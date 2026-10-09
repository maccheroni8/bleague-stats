// ランキング > 個人 > On/Off・組み合わせ（DESIGN.md 224章）の集計。チームの出場区間（team-stints。204章）から、
// 選手のOn/Off（出場中と不在時のNetRtg・ORtg・DRtgとその差）と、同じチームの2人・3人が同時に出ていた時間のNetRtg・ORtg・DRtgを、行にする。
// 通信・画面の部品を含まない純粋な部分（検証スクリプトからも使う）。計算の核は shared/onCourtTotals.ts（チーム詳細のラインナップ検索と同じ数え方）。
// 集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。
//
// 条件: 試合の条件・試合区分は、1試合行の索引（219章）の「試合×ホーム/アウェイ」の事実の表（gameRecordQuery.ts の gameFacts・matchesGame）で
// チームごとに判定する。登録区分・ポジション・現役・ルーキーは索引の選手辞書で選手ごとに判定し、組み合わせは「組の全員が当てはまる」ものだけ。
// 1選手×1チームで1行（移籍した選手は、チームごとに別の行）。通算は、同じチームの行をシーズンをまたいで足す。
import { FIRST_LEAGUE_SEASON } from "../../shared/rookieEligibility";
import { substitutionModelForSeason } from "../../shared/onCourt";
import { onCourtByGroup, onOffByPlayer, teamTotals, type CompactStints, type OnCourtTotals } from "../../shared/onCourtTotals";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import type { RookieEligibilityFile } from "../../shared/types";
import { classKeyOfFilter, positionFilterValue, type PlayerGroupFilter } from "./classificationFilter";
import { rookieOfIndex, type PlayerGameIndexView } from "./gameIndex";
import type { GameRecordConditions } from "./gameRecordConditions";
import { gameFacts, matchesGame, type GameSideFacts } from "./gameRecordQuery";
import { ratingsFromPossessions } from "./lineupRatings";

// ---- 種類・指標 ----

/** On/Off（選手1人）・2人の組み合わせ・3人の組み合わせ */
export type LineupUnit = "onoff" | "duo" | "trio";
export const LINEUP_UNITS: LineupUnit[] = ["onoff", "duo", "trio"];
export const LINEUP_UNIT_LABELS: Record<LineupUnit, string> = { onoff: "On/Off", duo: "2人", trio: "3人" };

export type LineupMetric = "net" | "off" | "def";
export const LINEUP_METRICS: LineupMetric[] = ["net", "off", "def"];
export const LINEUP_METRIC_LABELS: Record<LineupMetric, string> = { net: "NetRtg", off: "ORtg", def: "DRtg" };

/** 範囲: シーズン（選んでいるシーズン）／通算（2020-21以降の合計） */
export type LineupRange = "season" | "career";

/** 実際のポゼッションを数えているシーズンか（2020-21以降。ラインナップ検索と同じ） */
export function lineupSeasonSupported(season: string): boolean {
  return substitutionModelForSeason(season) === "modern";
}

export const LINEUP_UNSUPPORTED_REASON =
  "2016-17〜2019-20は、旧形式のプレーバイプレーでコートにいる5人の復元の前提が違い、実際のポゼッションを数えていないため、On/Offと組み合わせのNetRtgを出せません（2020-21以降で使えます）。";

// ---- 最低の基準（ポゼッション数） ----

/** 下限の初期値（チームのポゼッション数に対する割合、%）。On/Off は On・Off それぞれ、組み合わせは組が同時に出ていた間 */
export const LINEUP_SHARE_DEFAULT: Record<LineupUnit, number> = { onoff: 15, duo: 5, trio: 5 };
export const LINEUP_SHARE_RANGE: Record<LineupUnit, { min: number; max: number }> = {
  onoff: { min: 5, max: 30 },
  duo: { min: 1, max: 15 },
  trio: { min: 1, max: 15 },
};
/** 割合によらない、ポゼッション数の絶対の下限（進行中のシーズンなど、チームのポゼッションが少ないときに、極端に少ない値が上位に出るのを防ぐ） */
export const LINEUP_MIN_POSSESSIONS = 100;
/**
 * 得点の差（自チームの得点−相手の得点）の、1ポゼッションあたりの標準偏差（2025-26のレギュラーシーズンの出場区間から求めた概算。区間の中のポゼッションは互いに独立と仮定）。
 * 100ポゼッションあたりの値の誤差（標準誤差）の目安に使う
 */
export const RATING_SIGMA_PER_POSSESSION = 1.82;

/** N ポゼッションのときの NetRtg（100ポゼッションあたり）の標準誤差の目安 */
export function netRatingError(possessions: number): number {
  return (100 * RATING_SIGMA_PER_POSSESSION) / Math.sqrt(possessions);
}

/** On/Off の差（On の NetRtg − Off の NetRtg）の標準誤差の目安 */
export function onOffDiffError(onPossessions: number, offPossessions: number): number {
  return 100 * RATING_SIGMA_PER_POSSESSION * Math.sqrt(1 / onPossessions + 1 / offPossessions);
}

/** チームのポゼッション数に対する割合から、その行に求める下限のポゼッション数（絶対の下限を下回らない） */
export function minPossessions(teamPossessions: number, sharePct: number): number {
  return Math.max(LINEUP_MIN_POSSESSIONS, (teamPossessions * sharePct) / 100);
}

// ---- 入力 ----

export interface LineupSeasonData {
  /** そのシーズンの選手の索引（試合の表・チーム辞書・選手辞書を使う） */
  view: PlayerGameIndexView;
  /** チームID → 出場区間 */
  stints: ReadonlyMap<string, CompactStints>;
}

/** 行を作る条件（下限は含まない。下限は applyLineupThreshold で、作った行にあとから当てはめる） */
export interface LineupBuildQuery {
  /** シーズンの昇順 */
  data: readonly LineupSeasonData[];
  unit: LineupUnit;
  gameType: SeasonGameTypeFilter;
  conditions: GameRecordConditions;
  group: PlayerGroupFilter;
  positions: readonly string[];
  rookies: RookieEligibilityFile | null;
  /** 指定時、この選手IDだけ（現役。今季の名簿の選手） */
  activeIds?: ReadonlySet<string> | null;
  /** 対象にするピリオド。null は試合全体 */
  periods: readonly number[] | null;
  /** 指定時、選手名を今の登録名にする（複数のシーズンをまたぐ表。222章） */
  currentNames?: ReadonlyMap<string, string> | null;
}

// ---- 出力 ----

/** 1つの状態（On または Off）の合計 */
export interface LineupSide {
  games: number;
  seconds: number;
  ownPoints: number;
  oppPoints: number;
  ownPoss: number;
  oppPoss: number;
}

export interface LineupPlayer {
  id: string;
  name: string;
  /** 最後に出たシーズン（個人ページ・ルーキー印の引き先） */
  season: string;
}

export interface LineupRow {
  /** チームID＋選手ID（組み合わせは小さい順）。一意 */
  key: string;
  teamId: string;
  /** 最後のシーズンのチーム名 */
  teamName: string;
  firstSeason: string;
  lastSeason: string;
  players: LineupPlayer[];
  on: LineupSide;
  /** On/Off のときだけ。選手が出場した試合の、コートにいなかった区間 */
  off: LineupSide | null;
  /** 行の下限の元にしたチームのポゼッション数（その選手・組が出場したシーズンの、条件に当てはまる試合の合計） */
  teamPoss: number;
}

export interface LineupResult {
  rows: LineupRow[];
  /** 下限を適用する前の行の数 */
  beforeThreshold: number;
}

export function emptySide(): LineupSide {
  return { games: 0, seconds: 0, ownPoints: 0, oppPoints: 0, ownPoss: 0, oppPoss: 0 };
}

const KEYS = ["pts", "poss"] as const;

function sideOf(t: OnCourtTotals): LineupSide {
  return { games: t.games, seconds: t.seconds, ownPoints: t.own[0]!, oppPoints: t.opp[0]!, ownPoss: t.own[1]!, oppPoss: t.opp[1]! };
}

function addSide(a: LineupSide, b: LineupSide): void {
  a.games += b.games;
  a.seconds += b.seconds;
  a.ownPoints += b.ownPoints;
  a.oppPoints += b.oppPoints;
  a.ownPoss += b.ownPoss;
  a.oppPoss += b.oppPoss;
}

/** 状態の ORtg・DRtg・NetRtg（ポゼッションが無ければ null） */
export function sideRatings(s: LineupSide): { off: number | null; def: number | null; net: number | null } {
  return ratingsFromPossessions(s.ownPoints, s.oppPoints, s.ownPoss, s.oppPoss);
}

/** 並べる値。On/Off は On−Off の差、組み合わせは On の値。出せなければ null */
export function lineupValue(row: LineupRow, unit: LineupUnit, metric: LineupMetric): number | null {
  const on = sideRatings(row.on)[metric];
  if (unit !== "onoff") return on;
  const off = row.off ? sideRatings(row.off)[metric] : null;
  return on !== null && off !== null ? on - off : null;
}

// ---- 索引から引く表 ----

interface SeasonContext {
  /** ScheduleKey → 索引の試合番号 */
  gameIndex: Map<string, number>;
  facts: GameSideFacts[];
  /** 選手ID → 索引の選手辞書の項目 */
  players: Map<string, readonly [string, string, string, string, string, string]>;
  /** 試合番号 → ホームのチームID */
  homeTeamId: string[];
  teamNames: Map<string, string>;
}

const contextCache = new WeakMap<object, SeasonContext>();

function seasonContext(view: PlayerGameIndexView): SeasonContext {
  const cached = contextCache.get(view.file);
  if (cached) return cached;
  const { games, teams, players } = view.file;
  const gameIndex = new Map<string, number>();
  const homeTeamId: string[] = [];
  for (let g = 0; g < games.key.length; g++) {
    gameIndex.set(games.key[g]!, g);
    homeTeamId.push(teams[games.home[g]!]![0]);
  }
  const ctx: SeasonContext = {
    gameIndex,
    facts: gameFacts(view.file),
    players: new Map(players.map((p) => [p[0], p] as const)),
    homeTeamId,
    teamNames: new Map(teams.map((t) => [t[0], t[1]] as const)),
  };
  contextCache.set(view.file, ctx);
  return ctx;
}

/** 選手が登録区分・ポジション・現役・ルーキーの条件に当てはまるか（gameRecordQuery.ts の playerRowFilter と同じ判定） */
function playerFilter(q: LineupBuildQuery, ctx: SeasonContext, season: string): (id: string) => boolean {
  const positionSet = q.positions.length > 0 ? new Set(q.positions) : null;
  const classKey = q.group === "rookie" ? undefined : classKeyOfFilter(q.group);
  return (id) => {
    const p = ctx.players.get(id);
    if (!p) return false;
    if (q.activeIds && !q.activeIds.has(id)) return false;
    if (q.group === "rookie") {
      if (season <= FIRST_LEAGUE_SEASON || !rookieOfIndex(q.rookies, season, id)) return false;
    } else if (classKey && p[5] !== classKey) return false;
    if (positionSet && !(p[2] && positionSet.has(positionFilterValue(p[2])))) return false;
    return true;
  };
}

interface Acc {
  row: LineupRow;
}

/** 行を作る（下限を適用する前）。出場区間を読み直す計算なので重い。下限だけを変えるときは、作った行に applyLineupThreshold を当てる */
export function buildLineupRows(q: LineupBuildQuery): LineupRow[] {
  const accs = new Map<string, Acc>();
  for (const { view, stints } of q.data) {
    const ctx = seasonContext(view);
    const season = view.season;
    const playerOk = playerFilter(q, ctx, season);
    for (const [teamId, c] of stints) {
      const options = {
        includeGame: (scheduleKey: string) => {
          const g = ctx.gameIndex.get(scheduleKey);
          if (g === undefined) return false;
          const f = ctx.facts[g * 2 + (ctx.homeTeamId[g] === teamId ? 0 : 1)]!;
          return !f.short && matchesGame(f, q.gameType, q.conditions);
        },
        periods: q.periods,
        keys: KEYS,
      };
      const teamPoss = teamTotals(c, options).own[1]!;
      const teamName = ctx.teamNames.get(teamId) ?? c.teamId;
      const nameOf = (id: string) => q.currentNames?.get(id) ?? ctx.players.get(id)![1];
      const put = (ids: string[], on: LineupSide, off: LineupSide | null) => {
        if (on.games === 0 && on.seconds === 0) return;
        const key = `${teamId}:${ids.join(",")}`;
        let acc = accs.get(key);
        if (!acc) {
          acc = {
            row: {
              key,
              teamId,
              teamName,
              firstSeason: season,
              lastSeason: season,
              players: ids.map((id) => ({ id, name: nameOf(id), season })),
              on: emptySide(),
              off: off ? emptySide() : null,
              teamPoss: 0,
            },
          };
          accs.set(key, acc);
        }
        const r = acc.row;
        r.teamName = teamName;
        r.lastSeason = season;
        r.players = ids.map((id) => ({ id, name: nameOf(id), season }));
        addSide(r.on, on);
        if (off && r.off) addSide(r.off, off);
        r.teamPoss += teamPoss;
      };
      if (q.unit === "onoff") {
        for (const [id, t] of onOffByPlayer(c, options)) {
          if (playerOk(id)) put([id], sideOf(t.on), sideOf(t.off));
        }
      } else {
        for (const g of onCourtByGroup(c, q.unit === "duo" ? 2 : 3, options)) {
          if (g.playerIds.every(playerOk)) put(g.playerIds, sideOf(g.on), null);
        }
      }
    }
  }

  return [...accs.values()].map((a) => a.row);
}

/**
 * 下限（チームのポゼッション数に対する割合。絶対の下限100）を満たす行だけを返す。並べ替えは呼び出し側（RankedList）。
 * On/Off は On・Off の両方が、組み合わせは同時に出ていた間が、下限を満たす
 */
export function applyLineupThreshold(rows: readonly LineupRow[], unit: LineupUnit, sharePct: number): LineupResult {
  const kept = rows.filter((r) => {
    const min = minPossessions(r.teamPoss, sharePct);
    if (r.on.ownPoss < min) return false;
    if (unit === "onoff" && (!r.off || r.off.ownPoss < min)) return false;
    return lineupValue(r, unit, "net") !== null;
  });
  return { rows: kept, beforeThreshold: rows.length };
}

export type LineupQuery = LineupBuildQuery & {
  /** 下限（チームのポゼッション数に対する割合、%） */
  sharePct: number;
};

export function queryLineupRanking(q: LineupQuery): LineupResult {
  return applyLineupThreshold(buildLineupRows(q), q.unit, q.sharePct);
}

/** 読み込んだ出場区間の中の最大のピリオド（延長を含む。4未満にはしない） */
export function maxPeriodOfStints(data: readonly LineupSeasonData[]): number {
  let max = 4;
  for (const { stints } of data) {
    for (const c of stints.values()) {
      for (let r = 0; r < c.rowCount; r++) {
        const p = c.data[r * c.stride + 1]!;
        if (p > max) max = p;
      }
    }
  }
  return max;
}
