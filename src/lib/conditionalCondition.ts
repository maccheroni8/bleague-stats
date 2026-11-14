// 条件別順位表の「条件」の定義と、試合ログへの適用（設計書387章）。条件別順位表と図解の「条件付きの勝率」で同じ判定を使うため、画面の部品から切り出した。
import { DIVISION_LABELS } from "./divisionGroups";
import type { League } from "./league";
import { isWeekdayGame } from "./japaneseHolidays";
import {
  backToBackGameLabels,
  matchesBiweekPeriod,
  matchesDivision,
  matchesMonth,
  matchesNewYearHalf,
  matchesOpponentWinRateTier,
  MARGIN_CONDITION_LABELS,
  matchesMargin,
  type BackToBackGame,
  type BiweekPeriod,
  type MarginCondition,
  type RecordBeforeGame,
} from "./situational";
import type { Division, DivisionHistoryFile, TeamGameLog } from "../../shared/types";
import {
  hasOvertimeLog,
  isCenturyGame,
  LEAD_LABELS,
  leadStatusFromLog,
  marginAtLeast,
  matchesBothScores,
  matchesForeignCount,
  matchesTeamScore,
  type CountMode,
  type Lead,
} from "./situationalRecords";
import { matchesOpponentSeasonWinRate, type OpponentSeasonTier } from "./opponentSeasonWinRate";

/** 条件「クラッチタイムになった試合」の名前（設計書375章） */
export const CLUTCH_GAMES_LABEL = "クラッチタイムになった試合";

/**
 * 「条件別順位表」タブが扱う単一選択の条件。SituationalFilterPicker（AND合成の複数選択）とは
 * 異なり、こちらは「この条件だけで見た順位表」を1つずつ切り替えて見る用途のため、常に
 * どれか1つ（または条件なし="all"）だけがアクティブになる。既存のsituational.tsのマッチャー
 * （matchesDivision・matchesMonth・matchesNewYearHalf・matchesOpponentWinRateTier・
 * buildBackToBackStatus・buildBiweekPeriods/matchesBiweekPeriod）をそのまま再利用し、
 * このファイルでは「どの条件が選ばれているか」の型と、それをTeamGameLog[]へ適用する
 * ロジックだけを持つ。
 */
export type ConditionalCondition =
  | { kind: "all" }
  | { kind: "newYear"; half: "before" | "after" }
  | { kind: "homeAway"; value: "home" | "away" }
  /** 対戦相手の地区。same＝対同地区（自クラブと同じ地区）、other＝対他地区（自クラブと違う地区）。地区の構成はそのシーズンの決まりに従う */
  | { kind: "division"; value: Division | "same" | "other" }
  | { kind: "weekday"; value: boolean }
  | { kind: "month"; value: number }
  | { kind: "opponentWinRate"; tier: "under50" | "atLeast50" | "atLeast60" }
  | { kind: "backToBack"; value: BackToBackGame }
  // シーズンをバイウィーク（10日以上の試合空白期間）で区切った区間の1つ。区間自体は
  // シーズン・カテゴリごとに動的に検出されるため、区間の内容（ラベル・日付範囲）を
  // 条件の値として直接持たせる（buildBiweekPeriods参照）
  | { kind: "biweekPeriod"; index: number; period: BiweekPeriod }
  | { kind: "recent"; n: number }
  | { kind: "gamePhase"; value: "early" | "mid" | "late" }
  | { kind: "margin"; points: number }
  // 試合中の最大リード・最大ビハインド（延長戦を含む。DESIGN.md 150章）
  | { kind: "inGameMargin"; value: MarginCondition }
  // クラッチタイムになった試合（第4Q・延長の残り5:00以下で5点差以内の時間かプレーがあった試合。勝敗は試合の最終結果。判定できない試合は入らない。設計書375章）
  | { kind: "clutch" }
  // チーム詳細の「シチュエーション別勝敗」と同じ条件（設計書387章。判定は lib/situationalRecords.ts の共通の関数）
  /** 自チームの外国籍人数（試合ごとの同時出場人数）。eq＝ちょうど、le＝以下、ge＝以上 */
  | { kind: "foreign"; mode: CountMode; n: number }
  /** 得点（own）・失点（opp）が n 点以下／以上 */
  | { kind: "score"; side: "own" | "opp"; mode: "le" | "ge"; n: number }
  | { kind: "bothScore"; value: "ge" | "lt" }
  | { kind: "century" }
  | { kind: "marginAtLeast"; points: number }
  /** 第 q 終了時点（1・2〔前半終了〕・3）のリード状況 */
  | { kind: "checkpoint"; q: 1 | 2 | 3; status: Lead }
  | { kind: "overtime"; value: "ot" | "regulation" }
  /** 対戦相手の最新の勝率（概要の「対戦相手の強さ」と同じ。その時点までの勝率とは別） */
  | { kind: "opponentLatestWinRate"; tier: OpponentSeasonTier }
  /** 対戦相手の最新の勝率が rate 以上（ge）／未満（lt）。図解の「条件付きの勝率」で数字を選ぶための条件 */
  | { kind: "opponentLatestRate"; mode: "ge" | "lt"; rate: number };

/** 条件の「●人」「●点」の数を持つ条件か（持つ条件は数を入れる欄を出す） */
export function conditionNumberKind(c: ConditionalCondition): "count" | "score" | null {
  if (c.kind === "foreign" && c.mode !== "eq") return "count";
  if (c.kind === "score") return "score";
  return null;
}
export const NUMBER_CONDITION_DEFAULTS = { count: 2, score: 80 } as const;
const MODE_LABELS = { eq: "", le: "以下", ge: "以上" } as const;
export const CHECKPOINT_LABELS = { 1: "Q1終了時点", 2: "前半終了時点", 3: "3Q終了時点" } as const;

/** 「序盤戦/中盤戦/終盤戦20試合」の窓の大きさ（固定） */
const GAME_PHASE_WINDOW = 20;

/**
 * 現在選択中の条件を、表の上のタイトル（「{ラベル} 順位表」）用に1行で表す。各ボタンの
 * 表示文言（conditionGroupsのoption.label）と揃えている
 */
export function describeCondition(condition: ConditionalCondition): string {
  switch (condition.kind) {
    case "all":
      return "シーズン全体";
    case "newYear":
      return condition.half === "before" ? "年明け前" : "年明け後";
    case "homeAway":
      return condition.value === "home" ? "ホーム" : "アウェイ";
    case "division":
      return divisionConditionLabel(condition.value);
    case "weekday":
      return condition.value ? "平日開催" : "休日開催";
    case "month":
      return `${condition.value}月`;
    case "opponentWinRate":
      return condition.tier === "under50" ? "対5割未満" : condition.tier === "atLeast50" ? "対5割以上" : "対6割以上";
    case "backToBack":
      return `連戦時${condition.value}`;
    case "biweekPeriod":
      return condition.period.label;
    case "recent":
      return `直近${condition.n}試合`;
    case "gamePhase":
      return condition.value === "early"
        ? `序盤戦${GAME_PHASE_WINDOW}試合`
        : condition.value === "late"
          ? `終盤戦${GAME_PHASE_WINDOW}試合`
          : `中盤戦${GAME_PHASE_WINDOW}試合`;
    case "margin":
      return condition.points === 3 ? "3点差以内の試合" : "6点差以内の試合";
    case "inGameMargin":
      return MARGIN_CONDITION_LABELS[condition.value];
    case "clutch":
      return CLUTCH_GAMES_LABEL;
    case "foreign":
      return `自チーム外国籍${condition.n}人${MODE_LABELS[condition.mode]}`;
    case "score":
      return `${condition.side === "own" ? "得点" : "失点"}${condition.n}点${MODE_LABELS[condition.mode]}`;
    case "bothScore":
      return condition.value === "ge" ? "お互い80点以上" : "お互い80点未満";
    case "century":
      return "100点ゲーム";
    case "marginAtLeast":
      return `${condition.points}点差以上の試合`;
    case "checkpoint":
      return `${CHECKPOINT_LABELS[condition.q]}・${LEAD_LABELS[condition.status]}`;
    case "overtime":
      return condition.value === "ot" ? "OT試合" : "レギュレーション決着";
    case "opponentLatestRate":
      return `対勝率${formatRateText(condition.rate)}${condition.mode === "ge" ? "以上" : "未満"}の相手`;
    case "opponentLatestWinRate":
      return `対${condition.tier === "under50" ? "5割未満" : condition.tier === "atLeast50" ? "5割以上" : "6割以上"}（最新勝率）`;
  }
}

/** 「対東地区」「対同地区」「対他地区」 */
function divisionConditionLabel(value: Division | "same" | "other"): string {
  return value === "same" ? "対同地区" : value === "other" ? "対他地区" : `対${DIVISION_LABELS[value]}`;
}

export interface ConditionContext {
  teamId: string;
  season: string;
  league: League;
  opponentRecords?: Map<string, Map<string, RecordBeforeGame>>;
  divisionHistory?: DivisionHistoryFile | null;
  backToBackStatus?: Map<string, Map<string, BackToBackGame>>;
  /** 相手の最新のレギュラーシーズン勝率（概要の「対戦相手の強さ」と同じ） */
  opponentLatestWinRates?: ReadonlyMap<string, number>;
}

/** 日付昇順ソート済みのTeamGameLog[]に、選択中の条件を1つ適用する */
/** 勝率の書き方（.600）。サイトの順位表と同じ */
function formatRateText(rate: number): string {
  return rate >= 1 ? "1.000" : rate.toFixed(3).replace(/^0/, "");
}

export function applyConditionalCondition(
  logs: TeamGameLog[],
  condition: ConditionalCondition,
  ctx: ConditionContext,
): TeamGameLog[] {
  switch (condition.kind) {
    case "all":
      return logs;
    case "newYear":
      return logs.filter((g) => matchesNewYearHalf(g, condition.half));
    case "homeAway":
      return logs.filter((g) => (condition.value === "home" ? g.isHome : !g.isHome));
    case "division":
      return logs.filter((g) => matchesDivision(g, condition.value, ctx.divisionHistory, ctx.season, ctx.league, () => ctx.teamId));
    case "weekday":
      return logs.filter((g) => isWeekdayGame(g.date) === condition.value);
    case "month":
      return logs.filter((g) => matchesMonth(g, condition.value));
    case "opponentWinRate":
      return logs.filter((g) => matchesOpponentWinRateTier(g, condition.tier, ctx.opponentRecords));
    case "backToBack":
      return logs.filter((g) => ctx.backToBackStatus?.get(g.scheduleKey)?.get(ctx.teamId) === condition.value);
    case "biweekPeriod":
      return logs.filter((g) => matchesBiweekPeriod(g, condition.period));
    case "recent":
      return logs.slice(Math.max(0, logs.length - condition.n));
    case "gamePhase": {
      const n = GAME_PHASE_WINDOW;
      if (condition.value === "early") return logs.slice(0, n);
      if (condition.value === "late") return logs.slice(Math.max(0, logs.length - n));
      const start = Math.max(0, Math.floor((logs.length - n) / 2));
      return logs.slice(start, start + n);
    }
    case "margin":
      return logs.filter((g) => Math.abs(g.teamScore - g.opponentScore) <= condition.points);
    case "inGameMargin":
      return logs.filter((g) => matchesMargin(g, condition.value));
    case "clutch":
      // 結果だけの試合・プレーバイプレーの無い試合（1810）・前後半5分の特別な試合は clutchGame を持たないので入らない
      return logs.filter((g) => g.clutchGame === true);
    case "foreign":
      return logs.filter((g) => matchesForeignCount(g, condition.mode, condition.n));
    case "score":
      return logs.filter((g) => matchesTeamScore(g, condition.side, condition.mode, condition.n));
    case "bothScore":
      return logs.filter((g) => matchesBothScores(g, condition.value));
    case "century":
      return logs.filter((g) => isCenturyGame(g));
    case "marginAtLeast":
      return logs.filter((g) => marginAtLeast(g, condition.points));
    case "checkpoint":
      return logs.filter((g) => leadStatusFromLog(g, condition.q) === condition.status);
    case "overtime":
      return logs.filter((g) => hasOvertimeLog(g) === (condition.value === "ot"));
    case "opponentLatestRate": {
      const rates = ctx.opponentLatestWinRates ?? new Map<string, number>();
      return logs.filter((g) => {
        const r = rates.get(g.opponentTeamId);
        return r !== undefined && (condition.mode === "ge" ? r >= condition.rate - 1e-9 : r < condition.rate - 1e-9);
      });
    }
    case "opponentLatestWinRate":
      return logs.filter((g) => matchesOpponentSeasonWinRate(g.opponentTeamId, condition.tier, ctx.opponentLatestWinRates ?? new Map()));
  }
}


export interface ConditionOption {
  key: string;
  label: string;
  condition: ConditionalCondition;
}

export interface ConditionGroup {
  label: string;
  options: ConditionOption[];
}

export interface ConditionGroupInput {
  presentDivisions: Division[];
  backToBackStatus: Map<string, Map<string, BackToBackGame>> | undefined;
  regularScheduleKeys: Set<string>;
  biweekPeriods: BiweekPeriod[];
  /** 「●人」「●点」の数 */
  numbers: { count: number; score: number };
}

/** 条件別順位表で選べる条件の一覧（グループごと）。月別は buildConditionIndex が足す */
export function buildConditionGroups({ presentDivisions, backToBackStatus, regularScheduleKeys, biweekPeriods, numbers }: ConditionGroupInput): ConditionGroup[] {
  return [
    {
      label: "年明け前後",
      options: [
        { key: "newYear-before", label: "年明け前", condition: { kind: "newYear", half: "before" } },
        { key: "newYear-after", label: "年明け後", condition: { kind: "newYear", half: "after" } },
      ],
    },
    {
      label: "会場",
      options: [
        { key: "home", label: "ホーム", condition: { kind: "homeAway", value: "home" } },
        { key: "away", label: "アウェイ", condition: { kind: "homeAway", value: "away" } },
      ],
    },
    {
      label: "対戦相手の地区",
      options: [
        ...presentDivisions.map((d) => ({
          key: `div-${d}`,
          label: `対${DIVISION_LABELS[d]}`,
          condition: { kind: "division", value: d } as ConditionalCondition,
        })),
        // 対同地区・対他地区（自クラブから見た相手の地区。地区が2つ以上あるシーズンだけ）
        ...(presentDivisions.length >= 2
          ? [
              { key: "div-same", label: "対同地区", condition: { kind: "division", value: "same" } as ConditionalCondition },
              { key: "div-other", label: "対他地区", condition: { kind: "division", value: "other" } as ConditionalCondition },
            ]
          : []),
      ],
    },
    {
      label: "曜日",
      options: [
        { key: "weekday", label: "平日開催", condition: { kind: "weekday", value: true } },
        { key: "holiday", label: "休日開催", condition: { kind: "weekday", value: false } },
      ],
    },
    {
      label: "対戦相手の強さ（その時点までの勝率）",
      options: [
        { key: "oppwin-under50", label: "対5割未満", condition: { kind: "opponentWinRate", tier: "under50" } },
        { key: "oppwin-50", label: "対5割以上", condition: { kind: "opponentWinRate", tier: "atLeast50" } },
        { key: "oppwin-60", label: "対6割以上", condition: { kind: "opponentWinRate", tier: "atLeast60" } },
      ],
    },
    {
      label: "連戦（同じ相手と中1日以内の連戦）",
      // GAME3以降は、この表の対象（レギュラーシーズン）に当てはまる試合があるときだけ出す
      options: backToBackGameLabels(backToBackStatus, regularScheduleKeys).map((value) => ({
        key: `b2b-${value.slice(4)}`,
        label: `連戦時${value}`,
        condition: { kind: "backToBack", value } as ConditionalCondition,
      })),
    },
    {
      label: "バイウィーク（リーグ全体で10日以上試合が無い期間で区切った区間）",
      options: biweekPeriods.map((period, index) => ({
        key: `biweek-${index}`,
        label: period.label,
        condition: { kind: "biweekPeriod", index, period } as ConditionalCondition,
      })),
    },
    {
      label: "直近の試合数",
      options: [
        { key: "recent5", label: "直近5試合", condition: { kind: "recent", n: 5 } },
        { key: "recent10", label: "直近10試合", condition: { kind: "recent", n: 10 } },
      ],
    },
    {
      label: "シーズンの時期",
      options: [
        { key: "phase-early", label: "序盤戦20試合", condition: { kind: "gamePhase", value: "early" } },
        { key: "phase-mid", label: "中盤戦20試合", condition: { kind: "gamePhase", value: "mid" } },
        { key: "phase-late", label: "終盤戦20試合", condition: { kind: "gamePhase", value: "late" } },
      ],
    },
    {
      label: "点差決着",
      options: [
        { key: "margin-1pos", label: "3点差以内の試合", condition: { kind: "margin", points: 3 } },
        { key: "margin-2pos", label: "6点差以内の試合", condition: { kind: "margin", points: 6 } },
        { key: "margin-10plus", label: "10点差以上の試合", condition: { kind: "marginAtLeast", points: 10 } },
        { key: "margin-20plus", label: "20点差以上の試合", condition: { kind: "marginAtLeast", points: 20 } },
      ],
    },
    {
      label: "自チーム外国籍人数",
      options: [
        ...[0, 1, 2, 3].map((n) => ({ key: `foreign-eq-${n}`, label: `${n}人`, condition: { kind: "foreign", mode: "eq", n } as ConditionalCondition })),
        { key: "foreign-le", label: "●人以下", condition: { kind: "foreign", mode: "le", n: numbers.count } },
        { key: "foreign-ge", label: "●人以上", condition: { kind: "foreign", mode: "ge", n: numbers.count } },
      ],
    },
    {
      label: "得点・失点",
      options: [
        { key: "score-own-le", label: "得点●点以下", condition: { kind: "score", side: "own", mode: "le", n: numbers.score } },
        { key: "score-own-ge", label: "得点●点以上", condition: { kind: "score", side: "own", mode: "ge", n: numbers.score } },
        { key: "score-opp-le", label: "失点●点以下", condition: { kind: "score", side: "opp", mode: "le", n: numbers.score } },
        { key: "score-opp-ge", label: "失点●点以上", condition: { kind: "score", side: "opp", mode: "ge", n: numbers.score } },
        { key: "both80ge", label: "お互い80点以上", condition: { kind: "bothScore", value: "ge" } },
        { key: "both80lt", label: "お互い80点未満", condition: { kind: "bothScore", value: "lt" } },
        { key: "century", label: "100点ゲーム", condition: { kind: "century" } },
      ],
    },
    {
      label: "対戦相手の強さ（最新勝率）",
      options: (["under50", "atLeast50", "atLeast60"] as const).map((tier) => ({
        key: `oppLatest-${tier}`,
        label: `対${tier === "under50" ? "5割未満" : tier === "atLeast50" ? "5割以上" : "6割以上"}（最新勝率）`,
        condition: { kind: "opponentLatestWinRate", tier } as ConditionalCondition,
      })),
    },
    {
      label: "延長",
      options: [
        { key: "ot", label: "OT試合", condition: { kind: "overtime", value: "ot" } },
        { key: "regulation", label: "レギュレーション決着", condition: { kind: "overtime", value: "regulation" } },
      ],
    },
    ...([1, 2, 3] as const).map((q) => ({
      label: CHECKPOINT_LABELS[q],
      options: (["lead", "tie", "behind"] as const).map((status) => ({
        key: `cp${q}-${status}`,
        label: LEAD_LABELS[status],
        condition: { kind: "checkpoint", q, status } as ConditionalCondition,
      })),
    })),
    {
      label: "試合中の点差（延長戦を含む）",
      options: (Object.keys(MARGIN_CONDITION_LABELS) as MarginCondition[]).map((c) => ({
        key: `in-game-${c}`,
        label: MARGIN_CONDITION_LABELS[c],
        condition: { kind: "inGameMargin" as const, value: c },
      })),
    },
    {
      label: "クラッチ",
      options: [{ key: "clutch", label: CLUTCH_GAMES_LABEL, condition: { kind: "clutch" } }],
    },
  ];
}


/** 条件の選択肢（キー → 条件）。月別（month-1〜month-12）も含む */
export function buildConditionIndex(groups: readonly ConditionGroup[]): Map<string, { label: string; group: string; condition: ConditionalCondition }> {
  const out = new Map<string, { label: string; group: string; condition: ConditionalCondition }>();
  for (const g of groups) for (const o of g.options) out.set(o.key, { label: o.label, group: g.label, condition: o.condition });
  for (let m = 1; m <= 12; m++) out.set(`month-${m}`, { label: `${m}月`, group: "月別", condition: { kind: "month", value: m } });
  return out;
}
