// 画面専用（図解の散布図・ベン図の「条件付きの勝率」。設計書389章）。
// 「その条件に当てはまる試合だけで数えた勝率」。条件の定義と判定は条件別順位表と同じ部品（conditionalCondition.ts の applyConditionalCondition）で、
// 結果だけの試合（不戦勝など）も条件別順位表と同じように数える。同じ条件なら条件別順位表と同じ勝敗・勝率になる（validate:figure-cond-winpct）。
import type { UrlCodec } from "./urlState";
import type { DivisionHistoryFile, GameSummary, TeamGameLog } from "../../shared/types";
import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";
import { filterByGameType, type SeasonGameTypeFilter } from "../../shared/gameType";
import { teamDivisionForSeason } from "../../scripts/lib/divisions";
import {
  applyConditionalCondition,
  buildConditionGroups,
  buildConditionIndex,
  conditionNumberKind,
  describeCondition,
  NUMBER_CONDITION_DEFAULTS,
  type ConditionalCondition,
  type ConditionGroup,
} from "./conditionalCondition";
import { divisionOrder } from "./divisionGroups";
import type { League } from "./league";
import { formatWinPct } from "./format";
import { buildOpponentSeasonWinRates, type OpponentSeasonRecord } from "./opponentSeasonWinRate";
import { withResultOnlyLogs, resultOnlySummaries } from "./resultOnlyGames";
import {
  applySituationalRange,
  buildBackToBackStatus,
  buildBiweekPeriods,
  buildRecordsBeforeGame,
  type BackToBackGame,
  type BiweekPeriod,
  type RecordBeforeGame,
  type SituationalRange,
} from "./situational";

/** 相手の勝率を数字で選ぶ条件のキー（条件別順位表の条件の一覧には無い。図解だけ） */
export const OPP_RATE_KEY = "oppRate";
export const OPP_RATE_GROUP = "対戦相手の強さ（最新勝率を数字で選ぶ）";

/** 条件付きの勝率の条件の選び方。key は条件別順位表の条件のキー（または OPP_RATE_KEY）。n は「●人」「●点」、oppMode・oppRate は相手の勝率の「●以上／●未満」 */
export interface CondSpec { key: string; n?: number; oppMode?: "ge" | "lt"; oppRate?: number }
/** 初期の条件＝勝率.600以上の相手 */
export const DEFAULT_COND: CondSpec = { key: OPP_RATE_KEY, oppMode: "ge", oppRate: 0.6 };

const rateNumber = (rate: number) => String(Number(rate.toFixed(4)));
/** URL の文字列にする（`home`・`foreign-ge~2`・`oppRate~ge~0.6`） */
export function condSpecToText(spec: CondSpec): string {
  if (spec.key === OPP_RATE_KEY) return `${OPP_RATE_KEY}~${spec.oppMode ?? "ge"}~${rateNumber(spec.oppRate ?? 0.6)}`;
  return spec.n === undefined ? spec.key : `${spec.key}~${spec.n}`;
}
export function parseCondSpec(text: string | null | undefined): CondSpec | null {
  if (!text) return null;
  const [key, a, b] = text.split("~");
  if (!key) return null;
  if (key === OPP_RATE_KEY) {
    const rate = Number(b);
    return { key, oppMode: a === "lt" ? "lt" : "ge", oppRate: b !== undefined && b !== "" && Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0.6 };
  }
  const n = Number(a);
  return a !== undefined && a !== "" && Number.isFinite(n) && n >= 0 ? { key, n: Math.floor(n) } : { key };
}
export const sameCond = (a: CondSpec, b: CondSpec) => condSpecToText(a) === condSpecToText(b);

/** 勝率の入力（.6・0.6・60 のどれも受け付ける）。読めなければ null */
export function parseRateInput(text: string): number | null {
  const t = text.trim().replace(/[%％]/g, "");
  if (t === "") return null;
  const v = Number(t);
  if (!Number.isFinite(v) || v < 0) return null;
  return v > 1 ? (v <= 100 ? v / 100 : null) : v;
}
/** 勝率の書き方（順位表と同じ .813。1.000 も） */
export const rateText = (rate: number) => formatWinPct(rate);
export const recordText = (wins: number, losses: number) => `${wins}勝${losses}敗`;

export interface CondEnvInput {
  season: string;
  league: League;
  /** 相手の最新の勝率の元（teams.json の wins/losses。結果だけの試合を含む）*/
  teams: readonly OpponentSeasonRecord[];
  /** チームごとの試合ログ（結果だけの試合を含まない。ここで足す） */
  logsByTeam: ReadonlyMap<string, TeamGameLog[]>;
  summaries: readonly GameSummary[];
  resultOnly: ResultOnlyGameEntry[] | undefined;
  divisionHistory: DivisionHistoryFile | null;
}
export interface CondEnv {
  season: string;
  league: League;
  /** チームごとの試合ログ（結果だけの試合を足し、日付・試合のキーの順に並べたもの） */
  logsByTeam: Map<string, TeamGameLog[]>;
  opponentRecords: Map<string, Map<string, RecordBeforeGame>>;
  backToBackStatus: Map<string, Map<string, BackToBackGame>>;
  biweekPeriods: BiweekPeriod[];
  divisionHistory: DivisionHistoryFile | null;
  opponentLatestWinRates: ReadonlyMap<string, number>;
  groups: ConditionGroup[];
  index: Map<string, { label: string; group: string; condition: ConditionalCondition }>;
}

/** 条件別順位表と同じ材料（結果だけの試合を足した試合ログ・試合の概要・相手の最新勝率・連戦・バイウィーク）を組み立てる */
export function buildCondEnv(input: CondEnvInput): CondEnv {
  const { season, league, divisionHistory } = input;
  const withResultOnly = withResultOnlyLogs(new Map(input.logsByTeam), input.resultOnly) ?? new Map<string, TeamGameLog[]>();
  const logsByTeam = new Map<string, TeamGameLog[]>();
  for (const [id, logs] of withResultOnly) logsByTeam.set(id, [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey)));
  const recorded = [...input.summaries];
  const summaries = [...recorded, ...resultOnlySummaries(input.resultOnly, recorded)];
  const backToBackStatus = buildBackToBackStatus(summaries);
  const regularScheduleKeys = new Set(summaries.filter((g) => g.gameType === "regular").map((g) => g.scheduleKey));
  const biweekPeriods = buildBiweekPeriods(summaries);
  const presentDivisions = divisionOrder(league).filter((d) => input.teams.some((t) => teamDivisionForSeason(divisionHistory, t.teamId, season, league) === d));
  const groups = buildConditionGroups({
    presentDivisions, backToBackStatus, regularScheduleKeys, biweekPeriods,
    numbers: { count: NUMBER_CONDITION_DEFAULTS.count, score: NUMBER_CONDITION_DEFAULTS.score },
  });
  return {
    season, league, logsByTeam, opponentRecords: buildRecordsBeforeGame(summaries), backToBackStatus, biweekPeriods, divisionHistory,
    opponentLatestWinRates: buildOpponentSeasonWinRates(input.teams), groups, index: buildConditionIndex(groups),
  };
}

/** 選べる条件（グループごと）。数字で相手の勝率を選ぶ条件を先頭に */
export function condOptionGroups(env: CondEnv): { label: string; options: { key: string; label: string }[] }[] {
  const out = [{ label: OPP_RATE_GROUP, options: [{ key: OPP_RATE_KEY, label: "対戦相手の勝率が●以上／●未満" }] }];
  for (const g of env.groups) if (g.options.length) out.push({ label: g.label, options: g.options.map((o) => ({ key: o.key, label: o.label })) });
  out.push({ label: "月別", options: Array.from({ length: 12 }, (_, i) => ({ key: `month-${i + 1}`, label: `${i + 1}月` })) });
  return out;
}
/** 「●人」「●点」の数を入れる条件か（'count'＝人、'score'＝点） */
export function condNumberKind(env: CondEnv, spec: CondSpec): "count" | "score" | null {
  const base = env.index.get(spec.key)?.condition;
  return base ? conditionNumberKind(base) : null;
}
/** 選んだ条件を条件別順位表の条件にする。選択肢に無いキーは null */
export function conditionOf(env: CondEnv, spec: CondSpec): ConditionalCondition | null {
  if (spec.key === OPP_RATE_KEY) return { kind: "opponentLatestRate", mode: spec.oppMode ?? "ge", rate: spec.oppRate ?? 0.6 };
  const base = env.index.get(spec.key)?.condition;
  if (!base) return null;
  const nk = conditionNumberKind(base);
  return nk ? ({ ...base, n: spec.n ?? NUMBER_CONDITION_DEFAULTS[nk] } as ConditionalCondition) : base;
}
/** 条件の名前（サブタイトル・円の名前・吹き出しに出す） */
export function condLabel(env: CondEnv, spec: CondSpec): string {
  const c = conditionOf(env, spec);
  return c ? describeCondition(c) : "条件なし";
}
/** 軸・円の名前（例: 勝率（対勝率.600以上の相手）） */
export const condWinLabel = (env: CondEnv, spec: CondSpec) => `勝率（${condLabel(env, spec)}）`;
/** 選んだ条件が使えるか（そのシーズンに無い条件のキーは使えない） */
export const condAvailable = (env: CondEnv, spec: CondSpec) => conditionOf(env, spec) !== null;

export interface CondRecord { games: number; wins: number; losses: number; rate: number | null }
export interface CondScope { range: SituationalRange; gameType: SeasonGameTypeFilter }

/** 1チームの、条件に当てはまる試合の勝敗。期間 → 試合区分 → 条件の順（条件別順位表は「レギュラーシーズン全体」に条件を適用するので、既定の期間・試合区分なら同じ）。spec が null なら条件なし */
export function condRecord(env: CondEnv, teamId: string, scope: CondScope, spec: CondSpec | null): CondRecord {
  const base = filterByGameType(applySituationalRange(env.logsByTeam.get(teamId) ?? [], scope.range), scope.gameType);
  const condition = spec ? conditionOf(env, spec) : ({ kind: "all" } as ConditionalCondition);
  const games = condition
    ? applyConditionalCondition(base, condition, {
        teamId, season: env.season, league: env.league, opponentRecords: env.opponentRecords, divisionHistory: env.divisionHistory,
        backToBackStatus: env.backToBackStatus, opponentLatestWinRates: env.opponentLatestWinRates,
      })
    : [];
  const wins = games.filter((g) => g.win).length;
  return { games: games.length, wins, losses: games.length - wins, rate: games.length > 0 ? wins / games.length : null };
}
/** 全チームぶん */
export function condRecords(env: CondEnv, teamIds: readonly string[], scope: CondScope, spec: CondSpec | null): Map<string, CondRecord> {
  return new Map(teamIds.map((id) => [id, condRecord(env, id, scope, spec)] as const));
}

// ---- URL（散布図。図の設定の保存はこの文字列をそのまま持つ） ----
/** 条件付きの勝率の条件（縦軸 fyc・横軸 fxc。初期の条件〔勝率.600以上の相手〕のときは書かない） */
export const condCodec = (key: string): UrlCodec<CondSpec> => ({
  keys: [key],
  read: p => parseCondSpec(p.get(key)) ?? undefined,
  write: (p, v) => { if (!sameCond(v, DEFAULT_COND)) p.set(key, condSpecToText(v)); },
});
/** その条件の試合数の下限（fmin） */
export const MIN_GAMES_MAX = 30;
export const minGamesCodec: UrlCodec<number> = {
  keys: ['fmin'],
  read: p => { const v = Number(p.get('fmin')); return p.has('fmin') && Number.isInteger(v) && v > 0 ? Math.min(v, 99) : undefined; },
  write: (p, v) => { if (v > 0) p.set('fmin', String(v)); },
};
