// 終了したシーズンの選手の身長・体重・ポジションを、当時の値で決める（DESIGN.md 148章）。
//
// - ポジション: 当時の選手一覧（season-positions.json）→ Wayback の当時の選手ページ（season-profiles.json）→
//   近いシーズンの当時の値（一覧・Wayback のどちらか。差が同じなら前のシーズン）→ 現在の値（選手マスタ）
// - 身長・体重: Wayback の当時の選手ページ → 現在の値（身長と体重はそれぞれ別に判定）
// 当時の値でないもの（近いシーズンの値・現在の値）は fallback に記録し、画面で印を付ける。
// season-profiles.json の当時の値は、2025-26 までは Wayback、2026-27 以降は夜間実行で1月15日の選手名簿の値を固定したもの
// （scripts/freeze-season-profiles.ts）。進行中・開幕前のシーズンは、固定した値があればそれを、無ければ（1月15日より前・固定前の選手）
// 選手マスタの現在の値を使い、どちらも印は付けない（ポジションは一覧があれば一覧を優先）
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
    /** 終了したシーズンか（false なら進行中: 固定した値か現在の値。印は付けない） */
    past: boolean;
  },
): ResolvedProfile {
  const { master, positions, profiles, past } = opts;
  if (!past) {
    const frozen = profiles?.seasons[season]?.[playerId];
    return {
      position: positions[season] ? positions[season]![playerId] : (frozen?.position ?? master?.position),
      heightCm: frozen?.heightCm ?? master?.heightCm,
      weightKg: frozen?.weightKg ?? master?.weightKg,
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
