/**
 * 身長・体重・ポジションの注記（DESIGN.md 148章）。終了したシーズンは当時の値を使い、当時の値が見つからず補った値には「＊」を付ける。
 * 注記は、そのシーズンに補った値の選手がいるときだけ出す（players はそのシーズンの players.json）。
 * 身長・体重・ポジションを表示する表・プロフィールの直下に置く
 */
import type { PlayerSummary } from "../../shared/types";
import { PROFILE_FALLBACK_NOTE, seasonHasProfileFallback } from "../lib/profileMark";

export function HeightWeightNote({ players }: { players: PlayerSummary[] | null | undefined }) {
  if (!seasonHasProfileFallback(players)) return null;
  return <p className="rule-change-footnote">※ {PROFILE_FALLBACK_NOTE}</p>;
}
