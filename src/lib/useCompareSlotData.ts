// トップレベル比較ページ（#/compare）のスロット1つ分のデータ取得・集計フック。
// 詳細ページの「比較」タブ（個人: PlayerDetailPage、チーム: TeamDetailPage）と同じ集計ロジック
// （filterGameLogs → buildTeamMultiGameBoxTotals / buildTeamSplitRows）を、スロット単位に
// 切り出したもの（DESIGN.md 100章）。
//
// 通信量対策（依頼4）: スロットが実際に選択された（チーム/選手が決まった）時点で初めて、その
// スロット自身の分だけを取得する。3スロットを同時に取得することはなく、スロットが空のあいだ・
// モードが違うあいだは何も取得しない。チーム版のみ、Misc/スコアリングタブの全項目に生データ
// （試合単位のボックススコア・Yahoo PBP）が要るが（DESIGN.md 64章）、シチュエーション別フィルタで
// 絞り込んだ後の試合だけを取得する（詳細ページが「そのシーズンの全試合」を取るのと違い、
// 「ホーム」「プレーオフ」等で絞れば取得量も減る）。試合単位の取得はモジュールスコープの
// Promiseキャッシュで重複排除するため、同じ試合を別スロットが必要としても二重取得にならない。

import { useEffect, useMemo, useState } from "react";
import type {
  DivisionHistoryFile,
  GameSummary,
  PlayerGameLog,
  SeasonEntry,
  StoredGame,
  TeamGameLog,
  YahooGamePbp,
} from "../../shared/types";
import { fetchGame, fetchGameSummaries, fetchPlayerGameLogs, fetchTeamGameLogs, fetchYahooGamePbp } from "./data";
import {
  buildTeamMultiGameBoxTotals,
  buildTeamSplitRows,
  filterByGameType,
  sumTeamTotalsForLogs,
  type SeasonGameTypeFilter,
  type TeamGameBoxTotals,
} from "./playerSeasonBoxscore";
import {
  buildGameTeamsByScheduleKey,
  buildRecordsBeforeGame,
  computeSeasonHalfBoundary,
  filterGameLogs,
  resolveOwnTeam,
  type GameTeamInfo,
  type SeasonHalfBoundary,
  type SituationalFilter,
} from "./situational";
import { useJsonData } from "./useJsonData";
import type { SeasonBoxscoreCtx } from "./playerSeasonBoxscore";

export type SlotStatus =
  /** スロットが未選択（何も取得していない） */
  | "idle"
  /** スロット自身の基本データ（試合ログ・日程）を取得中 */
  | "loading"
  | "error"
  /** 絞り込み条件に合う試合が0件 */
  | "empty"
  /** 絞り込み後の試合の生データを取得中（チーム版のみ） */
  | "fetching"
  | "ready";

interface SlotDataCommon {
  status: SlotStatus;
  error: string | null;
  /** 前半戦/後半戦ボタン用（そのスロットのシーズンの日程から算出） */
  boundary: SeasonHalfBoundary | null;
  /** 「対勝率別」ボタンの表示可否 */
  opponentWinRateSupported: boolean;
  /** 「対戦地区」の同地区・他地区の表示可否（自チームの地区を試合ごとに引けるか） */
  ownTeamDivisionSupported: boolean;
  /** 絞り込み後の試合数 */
  gamesCount: number;
  /** 取得待ちの試合数（チーム版のfetching中のみ0より大きい） */
  pendingGames: number;
}

export interface TeamSlotData extends SlotDataCommon {
  boxTotals: TeamGameBoxTotals | null;
}

export interface PlayerSlotData extends SlotDataCommon {
  ctx: SeasonBoxscoreCtx | null;
  /** 集計対象の試合で最後に所属していたチーム（ヘッダーのチームカラー用） */
  latestTeamId: string | null;
  /** 集計対象の試合で所属した全チーム（1チームなら1件。移籍で複数のとき「複数チーム」の合算） */
  teamIds: string[];
}

// --- 試合単位の生データ取得（モジュールスコープのキャッシュでスロット間の重複を排除） ---

const gameCache = new Map<string, Promise<StoredGame | null>>();
function loadGame(season: string, scheduleKey: string): Promise<StoredGame | null> {
  const key = `${season}/${scheduleKey}`;
  let p = gameCache.get(key);
  if (!p) {
    p = fetchGame(season, scheduleKey).catch(() => null);
    gameCache.set(key, p);
    // 一時的な失敗は次回の再取得を妨げないようキャッシュから外す（成功・恒久的な欠落は保持）
    void p.then((r) => {
      if (!r) gameCache.delete(key);
    });
  }
  return p;
}

const yahooCache = new Map<string, Promise<YahooGamePbp | null>>();
function loadYahoo(season: string, scheduleKey: string): Promise<YahooGamePbp | null> {
  const key = `${season}/${scheduleKey}`;
  let p = yahooCache.get(key);
  if (!p) {
    p = fetchYahooGamePbp(season, scheduleKey);
    yahooCache.set(key, p);
  }
  return p;
}

/** 指定した試合の生データ・Yahoo PBPを取得する。nullは「取得失敗/データ無し」として確定済みの意味 */
function useRawGames(season: string, scheduleKeys: string[], needYahoo: boolean) {
  const [games, setGames] = useState<Map<string, StoredGame | null>>(() => new Map());
  const [yahoo, setYahoo] = useState<Map<string, YahooGamePbp | null>>(() => new Map());
  const signature = scheduleKeys.join(",");

  useEffect(() => {
    const missingGames = scheduleKeys.filter((k) => !games.has(k));
    if (missingGames.length > 0) {
      void Promise.all(missingGames.map(async (k) => [k, await loadGame(season, k)] as const)).then((results) => {
        setGames((prev) => {
          const next = new Map(prev);
          for (const [k, g] of results) next.set(k, g);
          return next;
        });
      });
    }
    const missingYahoo = needYahoo ? scheduleKeys.filter((k) => !yahoo.has(k)) : [];
    if (missingYahoo.length > 0) {
      void Promise.all(missingYahoo.map(async (k) => [k, await loadYahoo(season, k)] as const)).then((results) => {
        setYahoo((prev) => {
          const next = new Map(prev);
          for (const [k, y] of results) next.set(k, y);
          return next;
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season, signature, needYahoo]);

  const pending = scheduleKeys.filter((k) => !games.has(k) || (needYahoo && !yahoo.has(k))).length;
  return { games, yahoo, pending };
}

interface CommonArgs {
  season: string;
  filter: SituationalFilter;
  gameType: SeasonGameTypeFilter;
  /** スロットが選択済み（かつそのシーズンに存在する）かどうか。falseの間は何も取得しない */
  active: boolean;
  divisionHistory: DivisionHistoryFile | null;
}

// --- チーム版 ---

export function useTeamCompareSlot({
  teamId,
  season,
  filter,
  gameType,
  active,
  divisionHistory,
  seasons,
}: CommonArgs & { teamId: string; seasons: SeasonEntry[] | null }): TeamSlotData {
  const { data, loading, error } = useJsonData(
    () =>
      active
        ? Promise.all([fetchTeamGameLogs(season, teamId), fetchGameSummaries(season)]).then(([logs, summaries]) => ({
            key: `${season}|${teamId}`,
            logs,
            summaries,
          }))
        : Promise.resolve(null),
    [active, season, teamId],
  );
  const base = data && data.key === `${season}|${teamId}` && !loading ? data : null;

  const boundary = useMemo(() => (base ? computeSeasonHalfBoundary(base.summaries) : null), [base]);
  const opponentRecords = useMemo(() => (base ? buildRecordsBeforeGame(base.summaries) : undefined), [base]);

  const filtered = useMemo<TeamGameLog[]>(() => {
    if (!base) return [];
    return filterGameLogs(
      filterByGameType(base.logs, gameType),
      { ...filter, includePlayoffs: true },
      opponentRecords,
      divisionHistory,
      season,
      () => teamId,
    );
  }, [base, gameType, filter, opponentRecords, divisionHistory, season, teamId]);

  const seasonEntry = seasons?.find((s) => s.season === season);
  const shotChartSupported = seasonEntry?.coverage === "full";
  const yahooPbpSupported = seasonEntry?.yahooPbp ?? false;
  const scheduleKeys = useMemo(() => filtered.map((g) => g.scheduleKey), [filtered]);
  const { games, yahoo, pending } = useRawGames(season, scheduleKeys, yahooPbpSupported);

  const boxTotals = useMemo(() => {
    if (!base || filtered.length === 0 || pending > 0) return null;
    const entries = filtered
      .map((g) => {
        const game = games.get(g.scheduleKey);
        return game ? { game, isHome: g.isHome } : null;
      })
      .filter((e): e is { game: StoredGame; isHome: boolean } => e !== null);
    const yahooTurnovers = new Map(entries.map(({ game }) => [game.scheduleKey, yahoo.get(game.scheduleKey)?.turnovers ?? []]));
    return buildTeamMultiGameBoxTotals(entries, yahooTurnovers, shotChartSupported, yahooPbpSupported);
  }, [base, filtered, pending, games, yahoo, shotChartSupported, yahooPbpSupported]);

  let status: SlotStatus;
  if (!active) status = "idle";
  else if (error) status = "error";
  else if (!base) status = "loading";
  else if (filtered.length === 0) status = "empty";
  else if (pending > 0) status = "fetching";
  else status = boxTotals ? "ready" : "empty";

  return {
    status,
    error: active ? error : null,
    boundary,
    opponentWinRateSupported: !!opponentRecords,
    ownTeamDivisionSupported: !!divisionHistory,
    gamesCount: filtered.length,
    pendingGames: pending,
    boxTotals,
  };
}

// --- 個人版 ---

interface PlayerBase {
  key: string;
  logs: PlayerGameLog[];
  summaries: GameSummary[];
  ownTeamByScheduleKey: Map<string, GameTeamInfo>;
  teamLogsByTeamId: Map<string, TeamGameLog[]>;
}

/**
 * 選手のシーズン試合ログ・日程・所属チームの試合ログを取得する。所属チームはシーズン内移籍で
 * 複数に分かれうるため、players.jsonの単一teamIdではなく試合ログから動的に導出する
 * （resolveOwnTeam。個人詳細ページの「比較」タブと同じ）
 */
async function loadPlayerBase(season: string, playerId: string): Promise<PlayerBase> {
  const [logs, summaries] = await Promise.all([fetchPlayerGameLogs(season, playerId), fetchGameSummaries(season)]);
  const gameTeams = buildGameTeamsByScheduleKey(summaries);
  const ownTeamByScheduleKey = new Map<string, GameTeamInfo>();
  for (const log of logs) {
    if (log.min <= 0) continue;
    const own = resolveOwnTeam(log, gameTeams);
    if (own) ownTeamByScheduleKey.set(log.scheduleKey, own);
  }
  const teamIds = [...new Set([...ownTeamByScheduleKey.values()].map((t) => t.teamId))];
  const teamLogsByTeamId = new Map<string, TeamGameLog[]>();
  await Promise.all(
    teamIds.map(async (id) => {
      try {
        teamLogsByTeamId.set(id, await fetchTeamGameLogs(season, id));
      } catch {
        // 取得失敗時はこのチームの分だけ空（USG%・%-shareの分母がEMPTY_TEAM_TOTALSにフォールバックする）
      }
    }),
  );
  return { key: `${season}|${playerId}`, logs, summaries, ownTeamByScheduleKey, teamLogsByTeamId };
}

export function usePlayerCompareSlot({
  playerId,
  season,
  filter,
  gameType,
  active,
  divisionHistory,
}: CommonArgs & { playerId: string }): PlayerSlotData {
  const { data, loading, error } = useJsonData(
    () => (active ? loadPlayerBase(season, playerId) : Promise.resolve(null)),
    [active, season, playerId],
  );
  const base = data && data.key === `${season}|${playerId}` && !loading ? data : null;

  const boundary = useMemo(() => (base ? computeSeasonHalfBoundary(base.summaries) : null), [base]);
  const opponentRecords = useMemo(() => (base ? buildRecordsBeforeGame(base.summaries) : undefined), [base]);

  const filtered = useMemo<PlayerGameLog[]>(() => {
    if (!base) return [];
    return filterGameLogs(
      filterByGameType(base.logs, gameType),
      { ...filter, includePlayoffs: true },
      opponentRecords,
      divisionHistory,
      season,
      (g) => base.ownTeamByScheduleKey.get(g.scheduleKey)?.teamId,
    );
  }, [base, gameType, filter, opponentRecords, divisionHistory, season]);

  const result = useMemo(() => {
    if (!base || filtered.length === 0) return null;
    // USG%・%-shareの分母となるチーム総計は、絞り込み後の試合（かつそのチームの試合）だけに限定する。
    // 詳細ページの「比較」タブはシーズン全体のチーム総計をそのまま使うため、シチュエーション別フィルタで
    // 絞ったときに分子（絞り込み後の個人値）と分母（シーズン全体のチーム値）が食い違う（DESIGN.md 100章）
    const played = filtered.filter((g) => g.min > 0);
    const teamTotals = sumTeamTotalsForLogs(filtered, base.ownTeamByScheduleKey, base.teamLogsByTeamId);
    const seasonStartYear = Number(season.split("-")[0]);
    const rows = buildTeamSplitRows("slot", filtered, base.ownTeamByScheduleKey, teamTotals, "perGame", seasonStartYear);
    const combined = rows[rows.length - 1];
    if (!combined) return null;
    const latest = [...played].sort((a, b) => b.date.localeCompare(a.date))[0];
    const latestTeamId = latest ? (base.ownTeamByScheduleKey.get(latest.scheduleKey)?.teamId ?? null) : null;
    const teamIds = rows.filter((r) => !r.isCombined && r.teamId).map((r) => r.teamId!);
    return { ctx: combined.ctx, latestTeamId, teamIds };
  }, [base, filtered, season]);

  let status: SlotStatus;
  if (!active) status = "idle";
  else if (error) status = "error";
  else if (!base) status = "loading";
  else if (!result) status = "empty";
  else status = "ready";

  return {
    status,
    error: active ? error : null,
    boundary,
    opponentWinRateSupported: !!opponentRecords,
    ownTeamDivisionSupported: !!divisionHistory && !!base,
    gamesCount: filtered.filter((g) => g.min > 0).length,
    pendingGames: 0,
    ctx: result?.ctx ?? null,
    latestTeamId: result?.latestTeamId ?? null,
    teamIds: result?.teamIds ?? [],
  };
}
