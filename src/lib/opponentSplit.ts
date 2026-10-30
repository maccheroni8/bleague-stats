// チーム詳細 > 対戦相手別（選んだシーズンの、対戦相手ごとの成績を1行ずつ）の行の作り方と列の定義。
// 値は全チームスタッツ・対戦成績タブと同じ列の式に、試合ログの合計（sumTeamGameLogs）を渡して出す。
// Shooting・Forced TOV だけはスポーツナビ（Yahoo）の記録を、試合ログの試合ごとに引いて足す。
// 試合の生データは読まない。結果だけの試合（不戦勝など）と中止の試合は試合ログに無いので、スタッツにも勝敗にも入らない。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import type { OpponentRowBase } from "../components/OpponentSplitTable";
import type { Column } from "../components/SortableTable";
import { classifyForcedTurnover } from "../../shared/forcedTurnover";
import type { ShotTypeBreakdown, TeamForcedTurnovers, TeamGameLog, YahooGamePbp } from "../../shared/types";
import { CATEGORY_LABELS } from "./categoryLabels";
import { formatDecimal } from "./format";
import { FORCED_TURNOVER_COLUMNS } from "./forcedTurnoverColumns";
import { foreignShareFromSeconds, type ForeignShare } from "./shareCharts";
import { buildShotTypeBreakdown, shotTypeEntityColumns, sortShotTypeKeys } from "./shotTypeBreakdown";
import type { SeasonDisplayMode } from "./playerSeasonBoxscore";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildPointsShareColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  sumTeamGameLogs,
  type AllTeamsRow,
  type TeamPerspective,
} from "./teamStatsColumns";
import { buildPeriodColumns } from "./teamPeriodColumns";
import { aggregatePeriodScoring, type PeriodScoringRow } from "./teamPeriodScoring";
import { FOREIGN_COUNTS, sumForeignCourt } from "./teamForeignCourt";

/** 対戦相手別のカテゴリ（チームスタッツのカテゴリタブのうち、相手ごとの値が出せるもの。Streaks は含めない） */
export type OpponentSplitCategory =
  | "traditional"
  | "advanced"
  | "misc"
  | "scoring"
  | "shooting"
  | "forcedTurnovers"
  | "foreignPlayers"
  | "scoringComposition"
  | "periods";

export const OPPONENT_SPLIT_CATEGORY_KEYS: readonly OpponentSplitCategory[] = [
  "traditional",
  "advanced",
  "misc",
  "scoring",
  "shooting",
  "forcedTurnovers",
  "foreignPlayers",
  "scoringComposition",
  "periods",
];

export const OPPONENT_SPLIT_CATEGORIES: { key: OpponentSplitCategory; label: string }[] = OPPONENT_SPLIT_CATEGORY_KEYS.map((key) => ({
  key,
  label: CATEGORY_LABELS[key],
}));

/** Yahoo の記録（シュートの種類・ターンオーバーの種類）が要るカテゴリ */
export function categoryNeedsYahoo(category: OpponentSplitCategory): boolean {
  return category === "shooting" || category === "forcedTurnovers";
}

/** 視点を「+/-」にできないカテゴリ（On-Court Foreign は全チームスタッツと同じく対象外。Shooting は自チーム／opp の値を並べるだけ） */
export function categoryDisabledPerspectives(category: OpponentSplitCategory): TeamPerspective[] {
  return category === "foreignPlayers" || category === "shooting" ? ["diff"] : [];
}

/** 対戦相手別の1行（対戦相手ごと。isTotal が true の行は「全体」＝その条件のシーズン全体） */
export interface OpponentSplitRow extends AllTeamsRow, OpponentRowBase {
  isTotal: boolean;
  /** この行に属する試合ログ */
  logs: TeamGameLog[];
  /** Periods の区間別の得点（試合ログの区間別の得点から） */
  scoring: PeriodScoringRow;
}

export const OPPONENT_SPLIT_TOTAL_LABEL = "全体";

function makeRow(teamId: string, key: string, name: string, opponentTeamId: string | null, logs: TeamGameLog[]): OpponentSplitRow {
  const wins = logs.filter((g) => g.win).length;
  return {
    key,
    name,
    team: { teamId, teamName: name },
    opponentTeamId,
    isTotal: opponentTeamId === null,
    gamesPlayed: logs.length,
    wins,
    losses: logs.length - wins,
    totals: sumTeamGameLogs(logs),
    logs,
    scoring: aggregatePeriodScoring(logs),
  };
}

/**
 * 試合ログ（試合区分で絞り込み済み）を対戦相手ごとにまとめる。名称は、その相手との最後の試合の名称。
 * 並びは試合数の多い順、同じなら名称順。total は条件に合う全試合（「全体」の行）
 */
export function buildOpponentSplitRows(teamId: string, logs: readonly TeamGameLog[]): { rows: OpponentSplitRow[]; total: OpponentSplitRow } {
  const byOpponent = new Map<string, TeamGameLog[]>();
  for (const g of logs) {
    const list = byOpponent.get(g.opponentTeamId);
    if (list) list.push(g);
    else byOpponent.set(g.opponentTeamId, [g]);
  }
  const rows = [...byOpponent.entries()].map(([opponentId, list]) => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
    const name = sorted[sorted.length - 1]!.opponentTeamName;
    return makeRow(teamId, opponentId, name, opponentId, sorted);
  });
  rows.sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.team.teamName.localeCompare(b.team.teamName, "ja"));
  return { rows, total: makeRow(teamId, "total", OPPONENT_SPLIT_TOTAL_LABEL, null, [...logs]) };
}

// --- Traditional / Advanced / Misc / Scoring ---

export function standardColumns(
  category: "traditional" | "advanced" | "misc" | "scoring",
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
  opts: { paintSupported: boolean; foulSplit: boolean },
): Column<OpponentSplitRow>[] {
  switch (category) {
    case "traditional":
      return buildTraditionalColumns(mode, perspective);
    case "advanced":
      return buildAdvancedColumns(mode, perspective);
    case "misc":
      return buildMiscColumns(mode, perspective, true, opts.foulSplit);
    case "scoring":
      return buildScoringColumns(mode, perspective, opts.paintSupported);
  }
}

// --- Scoring %（得点構成・登録区分・FG試投構成の割合。チームスタッツの同じ名前の列を並べる） ---

/** 得点構成（%3P・%FT・%PoutP〔ミッドレンジ〕・PITP%〔ペイント〕）→ 登録区分（日本人・外国籍等）→ FG試投構成（%3PA・%MID2A・%PAINT2A）の順 */
const SCORING_COMPOSITION_KEYS: readonly { from: "share" | "scoring"; key: string }[] = [
  { from: "share", key: "pct3p" },
  { from: "share", key: "pctft" },
  { from: "share", key: "pctpoutp" },
  { from: "scoring", key: "pitppct" },
  { from: "scoring", key: "pctjapanese3" },
  { from: "scoring", key: "pctinternational3" },
  { from: "scoring", key: "pct3pa" },
  { from: "scoring", key: "pctmid2a" },
  { from: "scoring", key: "pctpaint2a" },
];

export function scoringCompositionColumns(perspective: TeamPerspective, opts: { paintSupported: boolean }): Column<OpponentSplitRow>[] {
  const lists = { share: buildPointsShareColumns(perspective), scoring: buildScoringColumns("perGame", perspective, opts.paintSupported) };
  return SCORING_COMPOSITION_KEYS.flatMap(({ from, key }) => {
    const col = lists[from].find((c) => c.key === key);
    return col ? [col] : [];
  });
}

// --- Periods ---

export function periodColumns(mode: SeasonDisplayMode, perspective: TeamPerspective): Column<OpponentSplitRow>[] {
  return buildPeriodColumns<OpponentSplitRow>(mode === "total" ? "total" : "perGame", perspective);
}

// --- On-Court Foreign（人数別の在コート時間の割合。試合ログの人数別の秒数から） ---

export interface ForeignSplitData {
  /** 行のキー → 人数別の割合 */
  shares: Map<string, ForeignShare>;
  /** 時間が1秒でもある人数（列に出す人数） */
  counts: number[];
}

export function foreignSplitData(rows: readonly OpponentSplitRow[], side: "own" | "opp"): ForeignSplitData {
  const shares = new Map<string, ForeignShare>();
  for (const row of rows) {
    const sum = sumForeignCourt(null, row.logs, "all", side);
    if (sum) shares.set(row.key, foreignShareFromSeconds(sum.seconds, sum.games));
  }
  const counts = FOREIGN_COUNTS.filter((n) => [...shares.values()].some((s) => s.seconds[n]! > 0));
  return { shares, counts };
}

export function foreignColumns(data: ForeignSplitData): Column<OpponentSplitRow>[] {
  return data.counts.map((n) => {
    const valueOf = (r: OpponentSplitRow): number | null => {
      const share = data.shares.get(r.key);
      return share && share.totalSeconds > 0 ? share.pct[n]! : null;
    };
    return {
      key: `oc${n}`,
      label: `OC${n}%`,
      sortValue: (r) => valueOf(r) ?? -1,
      format: (r) => {
        const v = valueOf(r);
        return v === null ? "-" : `${formatDecimal(v, 2)}%`;
      },
    };
  });
}

// --- Forced TOV（ターンオーバーの種類別。Yahoo の記録から） ---

export function pbpsOf(logs: readonly TeamGameLog[], pbp: ReadonlyMap<string, YahooGamePbp>): YahooGamePbp[] {
  return logs.flatMap((g) => {
    const p = pbp.get(g.scheduleKey);
    return p ? [p] : [];
  });
}

function emptyForced(): TeamForcedTurnovers {
  return { gamesWithData: 0, offensiveFoul: 0, violation24sec: 0, backcourtViolation: 0, violation5sec: 0, violation8sec: 0, otherDead: 0, live: 0 };
}

/**
 * 試合の Yahoo の記録から、自チームが相手に強制した（forced）／自チームが記録した（committed）ターンオーバーの種類別の件数を足す
 * （teams.json の forcedTurnovers・turnoversCommitted と同じ分類・同じ数え方）
 */
export function sumForcedTurnovers(pbps: readonly YahooGamePbp[], ownTeamId: string): { forced: TeamForcedTurnovers; committed: TeamForcedTurnovers } {
  const forced = emptyForced();
  const committed = emptyForced();
  for (const pbp of pbps) {
    forced.gamesWithData += 1;
    committed.gamesWithData += 1;
    for (const to of pbp.turnovers) {
      const bucket = classifyForcedTurnover(to);
      if (to.teamId === ownTeamId) committed[bucket] += 1;
      else forced[bucket] += 1;
    }
  }
  return { forced, committed };
}

/**
 * Forced TOV の列。視点は 自チーム＝自チームが相手に強制した（奪った）／opp＝自チームが相手に強制された／+/-＝奪った−強制された。
 * 平均はデータのあった試合数で割る（データあり試合数の列は割らない）
 */
export function forcedTurnoverColumns(
  dataByKey: ReadonlyMap<string, { forced: TeamForcedTurnovers; committed: TeamForcedTurnovers }>,
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
): Column<OpponentSplitRow>[] {
  return FORCED_TURNOVER_COLUMNS.map((col) => {
    const valueOf = (r: OpponentSplitRow): number | null => {
      const d = dataByKey.get(r.key);
      if (!d || d.forced.gamesWithData === 0) return null;
      const own = col.value(d.forced);
      const opp = col.value(d.committed);
      const raw = perspective === "own" ? own : perspective === "opp" ? opp : own - opp;
      if (col.key === "gamesWithData") return d.forced.gamesWithData;
      return mode === "total" ? raw : raw / d.forced.gamesWithData;
    };
    return {
      key: col.key,
      label: col.label,
      sortValue: (r) => valueOf(r) ?? Number.NEGATIVE_INFINITY,
      format: (r) => {
        const v = valueOf(r);
        if (v === null) return "-";
        const digits = col.key === "gamesWithData" || mode === "total" ? 0 : 2;
        return perspective === "diff" && col.key !== "gamesWithData" ? (v > 0 ? "+" : "") + formatDecimal(v, digits) : formatDecimal(v, digits);
      },
      scalesWithGames: col.key !== "gamesWithData",
    };
  });
}

// --- Shooting（シュートの種類別。Yahoo の記録から） ---

export interface ShootingSplitData {
  byKey: Map<string, ShotTypeBreakdown>;
  shotTypeKeys: string[];
}

export function shootingSplitData(
  rows: readonly OpponentSplitRow[],
  pbp: ReadonlyMap<string, YahooGamePbp>,
  ownTeamId: string,
  side: "own" | "opp",
): ShootingSplitData {
  const byKey = new Map<string, ShotTypeBreakdown>();
  for (const row of rows) {
    const shots = pbpsOf(row.logs, pbp).flatMap((p) => p.shots.filter((s) => (side === "own" ? s.teamId === ownTeamId : s.teamId !== ownTeamId)));
    byKey.set(row.key, buildShotTypeBreakdown(shots));
  }
  const shotTypeKeys = sortShotTypeKeys([...new Set([...byKey.values()].flatMap((b) => Object.keys(b)))]);
  return { byKey, shotTypeKeys };
}

export function shootingColumns(data: ShootingSplitData, mode: SeasonDisplayMode): Column<OpponentSplitRow>[] {
  return shotTypeEntityColumns<OpponentSplitRow>(
    data.shotTypeKeys,
    (r) => data.byKey.get(r.key),
    mode === "total" ? "total" : "perGame",
    (r) => r.gamesPlayed,
  );
}
