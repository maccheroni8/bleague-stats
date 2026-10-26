// 登録区分の記録（registrations.json）の、ブラウザでの読み込みと「その区分で出場した試合だけ」の数え直し（DESIGN.md 298章）。
// シーズン単位の集計済みの値（players.json）は、選手ごとに1つの区分（シーズンの初めの区分）しか持たない。シーズンの途中で区分が変わった選手
// （記録の changes がある選手）だけは、試合ログをその区分の試合に絞って足し直す。それ以外の選手は、今までどおり集計済みの値と区分を使う。
// 区分を決める処理は shared/registration.ts の registrationOn（集計と同じ。読むだけ）。画面だけの部品（保存キーの対象外）。
import { useCallback, useMemo, useState } from "react";
import { SPLIT_CLASSIFICATION_FIRST_SEASON, type SeasonRegistrationFile } from "../../shared/registration";
import type { PlayerGameLog, PlayerSummary } from "../../shared/types";
import type { PlayerGroupFilter } from "./classificationFilter";
import {
  changedRegistrations,
  EMPTY_CHANGED as EMPTY,
  scopeLogsByClassification,
  summaryScopedToClassification,
  type ChangedRegistrations,
} from "./registrationScopeCore";
import { fetchPlayerGameLogs, fetchSeasonRegistrations } from "./data";
import { leagueCacheKey, type League } from "./league";
import { useJsonData } from "./useJsonData";

export * from "./registrationScopeCore";

const cache = new Map<string, Promise<SeasonRegistrationFile | null>>();

/** 1シーズン・1リーグの登録区分の記録（2025-26 以前は読まずに null。同じものはページを開いている間メモリに持つ） */
export function loadSeasonRegistrations(season: string, league: League = "premier"): Promise<SeasonRegistrationFile | null> {
  if (season < SPLIT_CLASSIFICATION_FIRST_SEASON) return Promise.resolve(null);
  const key = leagueCacheKey(season, league);
  let p = cache.get(key);
  if (!p) {
    p = fetchSeasonRegistrations(season, league);
    p.then((v) => v ?? cache.delete(key), () => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export interface RegistrationChangesState {
  /** シーズン → 途中で区分が変わった選手。読み込み前・使わないときは null */
  bySeason: ReadonlyMap<string, ChangedRegistrations> | null;
  loading: boolean;
  retry: () => void;
}

/**
 * enabled のときだけ、指定したシーズン（2026-27 以降だけ読む）の登録区分の記録を読み、途中で区分が変わった選手を返す。
 * 読めなかったシーズンは「変わった選手なし」として扱う（集計済みの区分のまま。記録が無いシーズンと同じ）
 */
export function useRegistrationChanges(seasons: readonly string[], league: League, enabled: boolean): RegistrationChangesState {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const seasonsKey = seasons.join(",");
  const { data, loading } = useJsonData(async () => {
    if (!enabled) return null;
    const list = seasonsKey ? seasonsKey.split(",") : [];
    const files = await Promise.all(list.map((s) => loadSeasonRegistrations(s, league).catch(() => null)));
    return new Map(list.map((s, i) => [s, changedRegistrations(files[i])] as const));
  }, [enabled, seasonsKey, league, attempt]);
  return { bySeason: enabled ? data : null, loading: enabled && loading, retry };
}

/** そのシーズンに、途中で区分が変わった選手が1人でもいるか */
export function hasRegistrationChanges(state: RegistrationChangesState): boolean {
  if (!state.bySeason) return false;
  for (const m of state.bySeason.values()) if (m.size > 0) return true;
  return false;
}

export interface ClassScopedPlayers {
  /** 区分を選んでいるときは、途中で区分が変わった選手をその区分の試合だけの値に置き換えた一覧（その区分の試合が無ければ外す）。ほかはそのまま */
  players: PlayerSummary[] | null;
  /** そのシーズンに途中で区分が変わった選手（区分を選んでいないとき・2025-26 以前は空） */
  changed: ChangedRegistrations;
  loading: boolean;
}

/**
 * 1シーズンの選手一覧（players.json）を、選んだ登録区分の「その区分で出場した試合だけ」に合わせる（DESIGN.md 298章）。
 * 途中で区分が変わった選手の試合ログだけを読む（その人数分）。区分を選んでいないとき・ルーキーのときは、何も読まずにそのまま返す
 */
export function useClassScopedPlayers(
  season: string,
  league: League,
  players: PlayerSummary[] | null,
  filter: PlayerGroupFilter,
  enabled: boolean = true,
): ClassScopedPlayers {
  const classActive = enabled && filter !== "all" && filter !== "rookie" && season >= SPLIT_CLASSIFICATION_FIRST_SEASON;
  const seasons = classActive ? [season] : [];
  const reg = useRegistrationChanges(seasons, league, classActive);
  const changed = (classActive && reg.bySeason?.get(season)) || EMPTY;
  const targetIds = players ? players.filter((p) => changed.has(p.playerId)).map((p) => p.playerId).sort() : [];
  const targetKey = targetIds.join(",");
  const { data: logsData, loading: logsLoading } = useJsonData(async () => {
    if (!targetKey) return null;
    const ids = targetKey.split(",");
    const lists = await Promise.all(ids.map((id) => fetchPlayerGameLogs(season, id, league).catch(() => [] as PlayerGameLog[])));
    return { key: `${season}:${league}:${targetKey}`, map: new Map(ids.map((id, i) => [id, lists[i]!] as const)) };
  }, [season, league, targetKey]);
  const logs = logsData?.key === `${season}:${league}:${targetKey}` ? logsData.map : null;
  const waiting = classActive && (reg.loading || (targetKey !== "" && (logsLoading || !logs)));
  const scopedPlayers = useMemo(() => {
    if (!players || !classActive || changed.size === 0) return players;
    if (!logs) return null;
    const out: PlayerSummary[] = [];
    for (const p of players) {
      if (!changed.has(p.playerId)) {
        out.push(p);
        continue;
      }
      const scoped = summaryScopedToClassification(p, scopeLogsByClassification(logs.get(p.playerId) ?? [], p.playerId, filter, changed));
      if (scoped) out.push(scoped);
    }
    return out;
  }, [players, classActive, changed, logs, filter]);
  return { players: waiting ? null : scopedPlayers, changed, loading: waiting };
}
