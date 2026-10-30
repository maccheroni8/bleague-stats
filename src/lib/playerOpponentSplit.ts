// 個人詳細 > 対戦相手別（選んだシーズンの、対戦相手ごとの成績を1行ずつ）の行の作り方と列の定義。
// 行の作り方は個人詳細のシチュエーション別成績・シーズン別成績と同じ（試合ログを絞り、所属チームごとの分母〔USG%・%-share等〕を足して
// buildTeamSplitRows に渡す）。シーズンの途中で移籍した選手は、所属の違う試合も相手ごとに1行にまとめ、分母は「所属期間ごとの、所属した各チームの合計」
// （DESIGN.md 216章。transferredCombinedTeam）。出場しなかった試合（出場時間0）は数えない。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import type { Column } from "../components/SortableTable";
import type { OpponentRowBase } from "../components/OpponentSplitTable";
import type { PlayerGameLog, ShotTypeBreakdown, TeamGameLog, YahooShotEvent } from "../../shared/types";
import { CATEGORY_LABELS } from "./categoryLabels";
import { formatDecimal } from "./format";
import { fgaShare, playerScoringShare } from "./shareCharts";
import { buildShotTypeBreakdown, shotTypeEntityColumns, sortShotTypeKeys } from "./shotTypeBreakdown";
import {
  buildTeamSplitRows,
  countDoubleTripleDoubles,
  filterByGameType,
  seasonBoxColumnsFor,
  sumTeamTotalsForLogs,
  transferredCombinedTeam,
  type SeasonBoxscoreCtx,
  type SeasonBoxTabKey,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "./playerSeasonBoxscore";
import type { GameTeamInfo } from "./situational";

/** 対戦相手別（個人）のカテゴリ */
export type PlayerOpponentCategory = SeasonBoxTabKey | "shooting" | "scoringComposition";

export const PLAYER_OPPONENT_CATEGORY_KEYS: readonly PlayerOpponentCategory[] = ["traditional", "advanced", "misc", "scoring", "shooting", "scoringComposition"];

export const PLAYER_OPPONENT_CATEGORIES: { key: PlayerOpponentCategory; label: string }[] = PLAYER_OPPONENT_CATEGORY_KEYS.map((key) => ({
  key,
  label: CATEGORY_LABELS[key],
}));

export interface PlayerOpponentRow extends OpponentRowBase {
  ctx: SeasonBoxscoreCtx;
  /** この行に入った試合（出場した試合） */
  logs: PlayerGameLog[];
  /** ダブルダブル・トリプルダブルの数（試合全体の記録） */
  ddtd: { dd: number; td: number; p10: number };
  /** この行の試合のうち、いちばん新しい試合の自チーム（対戦成績タブへの行き先。解決できなければ null） */
  latestTeamId: string | null;
}

export const PLAYER_OPPONENT_TOTAL_LABEL = "全体";

export interface PlayerOpponentInput {
  playerId: string;
  season: string;
  /** そのシーズンの試合ログ（試合種別で絞る前。出場しなかった試合を含む） */
  logs: PlayerGameLog[];
  gameType: SeasonGameTypeFilter;
  displayMode: SeasonDisplayMode;
  /** 試合ごとの自チーム（出場した試合） */
  ownTeamByScheduleKey: Map<string, GameTeamInfo>;
  /** 所属したチームごとの、そのシーズンの試合ログ */
  teamLogsByTeamId: Map<string, TeamGameLog[]>;
}

function recordOf(logs: readonly PlayerGameLog[]): { wins: number; losses: number } {
  const wins = logs.filter((g) => g.win).length;
  return { wins, losses: logs.length - wins };
}

/**
 * 相手ごとの行（試合数の多い順、同じなら名称順）と「全体」の行。出場した試合が無ければ total は null。
 * 相手ごとの行の分母は、その相手との試合だけを数えたもの（シチュエーション別成績と同じ）
 */
export function buildPlayerOpponentRows(input: PlayerOpponentInput): { rows: PlayerOpponentRow[]; total: PlayerOpponentRow | null } {
  const { playerId, season, logs, gameType, displayMode, ownTeamByScheduleKey, teamLogsByTeamId } = input;
  const seasonStartYear = Number(season.split("-")[0]);
  const scoped = filterByGameType(logs, gameType);
  const played = scoped.filter((g) => g.min > 0);
  if (played.length === 0) return { rows: [], total: null };

  const rowFor = (key: string, name: string, opponentTeamId: string | null, matched: PlayerGameLog[]): PlayerOpponentRow | null => {
    const scopedTeamLogs = new Map(
      [...teamLogsByTeamId].map(([teamId, teamLogs]) => [
        teamId,
        filterByGameType(teamLogs, gameType).filter((g) => opponentTeamId === null || g.opponentTeamId === opponentTeamId),
      ]),
    );
    const combined = transferredCombinedTeam(logs, matched, ownTeamByScheduleKey, scopedTeamLogs);
    const split = buildTeamSplitRows(key, matched, ownTeamByScheduleKey, sumTeamTotalsForLogs(matched, ownTeamByScheduleKey, teamLogsByTeamId), displayMode, seasonStartYear, combined);
    // 所属の違う試合もまとめる: 複数チームにまたがるときは最後の行（合計）、1チームだけならその行
    const row = split[split.length - 1];
    if (!row) return null;
    const { wins, losses } = recordOf(row.logs);
    const latest = [...row.logs].sort((a, b) => b.date.localeCompare(a.date) || b.scheduleKey.localeCompare(a.scheduleKey))[0];
    return {
      key,
      opponentTeamId,
      name,
      gamesPlayed: row.ctx.raw.gamesPlayed,
      wins,
      losses,
      ctx: row.ctx,
      logs: row.logs,
      ddtd: countDoubleTripleDoubles(row.logs),
      latestTeamId: latest ? (ownTeamByScheduleKey.get(latest.scheduleKey)?.teamId ?? null) : null,
    };
  };

  const byOpponent = new Map<string, PlayerGameLog[]>();
  for (const g of played) {
    const list = byOpponent.get(g.opponentTeamId);
    if (list) list.push(g);
    else byOpponent.set(g.opponentTeamId, [g]);
  }
  const rows = [...byOpponent.entries()].flatMap(([opponentId, list]) => {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
    const row = rowFor(opponentId, sorted[sorted.length - 1]!.opponentTeamName, opponentId, sorted);
    return row ? [row] : [];
  });
  rows.sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.name.localeCompare(b.name, "ja"));
  return { rows, total: rowFor("total", PLAYER_OPPONENT_TOTAL_LABEL, null, played) };
}

// --- Traditional / Advanced / Misc / Scoring ---

/** 個人詳細のシーズン別成績と同じ列（G は左に固定の列があるので除く）に、DD2・TD3 を足す。Q別を選べないので、DD2・TD3 は常に出せる */
export function playerStandardColumns(category: SeasonBoxTabKey, mode: SeasonDisplayMode, foulSplit: boolean): Column<PlayerOpponentRow>[] {
  const columns: Column<PlayerOpponentRow>[] = seasonBoxColumnsFor(category, foulSplit)
    .filter((c) => c.key !== "g")
    .map((c) => ({
      key: c.key,
      label: c.label,
      sortValue: (r) => c.value(r.ctx, mode),
      format: (r) => c.format(r.ctx, mode),
      higherIsBetter: c.higherIsBetter,
    }));
  columns.push(
    { key: "dd2", label: "DD2", sortValue: (r) => r.ddtd.dd, format: (r) => String(r.ddtd.dd) },
    { key: "td3", label: "TD3", sortValue: (r) => r.ddtd.td, format: (r) => String(r.ddtd.td) },
    { key: "pts10", label: "PTS10", sortValue: (r) => r.ddtd.p10, format: (r) => String(r.ddtd.p10) },
  );
  return columns;
}

// --- Scoring %（得点構成と、FG試投構成。選手の割合） ---

/**
 * 得点構成（%3P・%FT・%PoutP〔ミッドレンジ〕・PITP%〔ペイント〕。選手が決めた得点の内訳）と、FG試投構成（3PA/FGA・MID2A/FGA・PAINT2A/FGA）。
 * ペイント内外（ミッドレンジ・ペイントの試投）は2022-23以降で、それ以前は「-」
 */
export function playerScoringCompositionColumns(): Column<PlayerOpponentRow>[] {
  const share = (r: PlayerOpponentRow) => playerScoringShare({ games: r.ctx.raw.gamesPlayed, ...r.ctx.raw });
  const fga = (r: PlayerOpponentRow) => fgaShare({ games: r.ctx.raw.gamesPlayed, ...r.ctx.raw });
  const pctColumn = (key: string, label: string, valueOf: (r: PlayerOpponentRow) => number | null): Column<PlayerOpponentRow> => ({
    key,
    label,
    sortValue: (r) => valueOf(r) ?? -1,
    format: (r) => {
      const v = valueOf(r);
      return v === null ? "-" : `${formatDecimal(v, 1)}%`;
    },
  });
  const hasPaintSplit = (r: PlayerOpponentRow) => r.ctx.raw.paint2a + r.ctx.raw.mid2a > 0;
  const total = (r: PlayerOpponentRow) => share(r).pct.reduce((a, b) => a + b, 0);
  return [
    pctColumn("pct3p", "%3P", (r) => (total(r) > 0 ? share(r).pct[0]! : null)),
    pctColumn("pctft", "%FT", (r) => (total(r) > 0 ? share(r).pct[1]! : null)),
    pctColumn("pctpoutp", "%PoutP", (r) => (total(r) > 0 ? share(r).pct[2]! : null)),
    pctColumn("pitppct", "PITP%", (r) => (total(r) > 0 ? share(r).pct[3]! : null)),
    pctColumn("pct3pafga", "3PA/FGA", (r) => (r.ctx.raw.fga > 0 ? fga(r).pct[0]! : null)),
    pctColumn("pctmid2afga", "MID2A/FGA", (r) => (hasPaintSplit(r) ? fga(r).pct[1]! : null)),
    pctColumn("pctpaint2afga", "PAINT2A/FGA", (r) => (hasPaintSplit(r) ? fga(r).pct[2]! : null)),
  ];
}

// --- Shooting（シュートの種類別。その選手のシーズンのスポーツナビの記録から） ---

export interface PlayerShootingData {
  byKey: Map<string, ShotTypeBreakdown>;
  shotTypeKeys: string[];
}

/** shotsByScheduleKey: 試合ごとの、この選手のシュート（スポーツナビの記録のある試合だけ） */
export function playerShootingData(rows: readonly PlayerOpponentRow[], shotsByScheduleKey: ReadonlyMap<string, YahooShotEvent[]>): PlayerShootingData {
  const byKey = new Map<string, ShotTypeBreakdown>();
  for (const r of rows) byKey.set(r.key, buildShotTypeBreakdown(r.logs.flatMap((l) => shotsByScheduleKey.get(l.scheduleKey) ?? [])));
  const shotTypeKeys = sortShotTypeKeys([...new Set([...byKey.values()].flatMap((b) => Object.keys(b)))]);
  return { byKey, shotTypeKeys };
}

export function playerShootingColumns(data: PlayerShootingData, mode: SeasonDisplayMode): Column<PlayerOpponentRow>[] {
  return shotTypeEntityColumns<PlayerOpponentRow>(
    data.shotTypeKeys,
    (r) => data.byKey.get(r.key),
    mode === "total" ? "total" : "perGame",
    (r) => r.ctx.raw.gamesPlayed,
  );
}
