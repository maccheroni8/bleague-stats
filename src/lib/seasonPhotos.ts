// シーズン別の選手写真の台帳を読む（形式は shared/seasonPhotos.ts。置き場所は public/media/player-photos/）。
// 台帳はシーズンごとの小さなファイルで、1シーズン1回だけ取りに行き、ページをまたいで使い回す。
// 台帳を置いていないシーズン（進行中のシーズンなど）は取りに行かない。
import { useEffect, useState } from "react";
import { isSeasonPhotoIndex, pickSeasonPhotoTeam, seasonPhotoFileName, type SeasonPhotoIndex } from "../../shared/seasonPhotos";

declare const __SEASON_PHOTO_SEASONS__: readonly string[] | undefined;

/** null＝分からない（vite を通さない検証の束ね）。そのときは台帳を引かない（今の写真） */
const SEASON_PHOTO_SEASONS: readonly string[] | null =
  typeof __SEASON_PHOTO_SEASONS__ === "undefined" ? null : __SEASON_PHOTO_SEASONS__;

const base = `${import.meta.env?.BASE_URL ?? "/"}media/player-photos`;

export function hasSeasonPhotos(season: string | null | undefined): season is string {
  return !!season && SEASON_PHOTO_SEASONS !== null && SEASON_PHOTO_SEASONS.includes(season);
}

/** 読み終えた台帳（読めなかったシーズンは null。今の写真に戻す） */
const loaded = new Map<string, SeasonPhotoIndex | null>();
const pending = new Map<string, Promise<SeasonPhotoIndex | null>>();

export function loadSeasonPhotoIndex(season: string): Promise<SeasonPhotoIndex | null> {
  if (loaded.has(season)) return Promise.resolve(loaded.get(season)!);
  let p = pending.get(season);
  if (!p) {
    p = fetch(`${base}/${season}.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => (isSeasonPhotoIndex(json, season) ? json : null))
      .catch(() => null)
      .then((index) => {
        loaded.set(season, index);
        pending.delete(season);
        return index;
      });
    pending.set(season, p);
  }
  return p;
}

export function seasonPhotoUrl(season: string, teamId: string, playerId: string): string {
  return `${base}/${season}/${seasonPhotoFileName(teamId, playerId)}`;
}

/**
 * その選手・シーズンの写真のURL。
 * - 台帳を置いていないシーズン・シーズンの指定なし → null（今の写真）
 * - 台帳の読み込み中 → undefined（呼び出し側は枠だけ出して待つ）
 * - 台帳にその選手が無い → null（今の写真）。チームの指定にその写真が無ければ、同じシーズンの別のチームの写真
 */
export function useSeasonPhotoUrl(playerId: string, season?: string | null, teamId?: string | null): string | null | undefined {
  const target = hasSeasonPhotos(season) ? season : null;
  const [, setTick] = useState(0);
  const ready = target === null || loaded.has(target);
  useEffect(() => {
    if (target === null || loaded.has(target)) return;
    let alive = true;
    void loadSeasonPhotoIndex(target).then(() => {
      if (alive) setTick((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [target]);
  if (target === null) return null;
  if (!ready) return undefined;
  const team = pickSeasonPhotoTeam(loaded.get(target), playerId, teamId);
  return team ? seasonPhotoUrl(target, team, playerId) : null;
}
