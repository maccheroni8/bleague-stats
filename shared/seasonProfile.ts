// 終了したシーズンの選手の身長・体重・ポジションを、当時の値で決める（DESIGN.md 148章）。
//
// - ポジション: 当時の選手一覧（season-positions.json）→ Wayback の当時の選手ページ（season-profiles.json）→
//   近いシーズンの当時の値（一覧・Wayback のどちらか。差が同じなら前のシーズン）→ 現在の値（選手マスタ）
// - 身長・体重: Wayback の当時の選手ページ → 現在の値（身長と体重はそれぞれ別に判定）
// 当時の値でないもの（近いシーズンの値・現在の値）は fallback に記録し、画面で印を付ける。
// 進行中・開幕前のシーズンは、選手マスタの値がそのまま当時の値なので従来どおり（ポジションは一覧があれば一覧）
import type { PlayerMasterEntry, ProfileFallback, SeasonPositionsFile, SeasonProfilesFile } from "./types.ts";

export interface ResolvedProfile {
  position?: string;
  heightCm?: number;
  weightKg?: number;
  fallback?: ProfileFallback;
}

const seasonStartYear = (season: string) => Number(season.slice(0, 4));

/** 当時のポジション（一覧 → Wayback）。無ければ undefined */
function positionAt(playerId: string, season: string, positions: SeasonPositionsFile, profiles: SeasonProfilesFile | null): string | undefined {
  return positions[season]?.[playerId] ?? profiles?.seasons[season]?.[playerId]?.position;
}

export function resolveSeasonProfile(
  playerId: string,
  season: string,
  opts: {
    master: PlayerMasterEntry | undefined;
    positions: SeasonPositionsFile;
    profiles: SeasonProfilesFile | null;
    /** 終了したシーズンか（false なら従来どおり: ポジションは一覧があれば一覧、身長・体重は現在の値） */
    past: boolean;
  },
): ResolvedProfile {
  const { master, positions, profiles, past } = opts;
  if (!past) {
    return {
      position: positions[season] ? positions[season]![playerId] : master?.position,
      heightCm: master?.heightCm,
      weightKg: master?.weightKg,
    };
  }
  const fallback: ProfileFallback = {};

  let position = positionAt(playerId, season, positions, profiles);
  if (!position) {
    const seasons = new Set([...Object.keys(positions), ...Object.keys(profiles?.seasons ?? {})]);
    const near = [...seasons]
      .filter((s) => s !== season && positionAt(playerId, s, positions, profiles))
      .sort((a, b) => Math.abs(seasonStartYear(a) - seasonStartYear(season)) - Math.abs(seasonStartYear(b) - seasonStartYear(season)) || a.localeCompare(b))[0];
    if (near) {
      position = positionAt(playerId, near, positions, profiles);
      fallback.position = "near";
    } else if (master?.position) {
      position = master.position;
      fallback.position = "current";
    }
  }

  const then = profiles?.seasons[season]?.[playerId];
  let heightCm = then?.heightCm;
  if (heightCm === undefined && master?.heightCm !== undefined) {
    heightCm = master.heightCm;
    fallback.height = "current";
  }
  let weightKg = then?.weightKg;
  if (weightKg === undefined && master?.weightKg !== undefined) {
    weightKg = master.weightKg;
    fallback.weight = "current";
  }
  return { position, heightCm, weightKg, fallback: Object.keys(fallback).length > 0 ? fallback : undefined };
}
