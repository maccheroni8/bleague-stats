// 身長・体重・ポジションの「当時の値でない」印（DESIGN.md 148章）。終了したシーズンは当時の値を使い、当時の値が見つからず
// 近いシーズンの値・現在の値で補ったもの（PlayerSummary.profileFallback）にだけ印を付ける。注記は、そうした選手がいる
// シーズンにだけ出す（HeightWeightNote）
import type { PlayerSummary } from "../../shared/types";

export const PROFILE_MARK = "＊";

export const PROFILE_FALLBACK_NOTE =
  "身長・体重・ポジションは当時の値です。＊は当時の値が見つからず補った値です（ポジションは近いシーズンの当時の値、無ければ現在の値。身長・体重は現在の値）";

type ProfileFields = Pick<PlayerSummary, "position" | "heightCm" | "weightKg" | "profileFallback">;

export function positionText(p: ProfileFields): string | undefined {
  return p.position ? `${p.position}${p.profileFallback?.position ? PROFILE_MARK : ""}` : undefined;
}

// 身長・体重の 0 は値なし（公式に載っていない選手。DESIGN.md 174章）。作り直す前のデータに 0 が残っていても出さない
export function heightText(p: ProfileFields): string | undefined {
  return p.heightCm ? `${p.heightCm}cm${p.profileFallback?.height ? PROFILE_MARK : ""}` : undefined;
}

export function weightText(p: ProfileFields): string | undefined {
  return p.weightKg ? `${p.weightKg}kg${p.profileFallback?.weight ? PROFILE_MARK : ""}` : undefined;
}

/** そのシーズンに、当時の値でない身長・体重・ポジションの選手がいるか */
export function seasonHasProfileFallback(players: ProfileFields[] | null | undefined): boolean {
  return (players ?? []).some((p) => !!p.profileFallback);
}
