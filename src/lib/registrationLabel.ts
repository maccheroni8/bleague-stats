// 個人詳細・AI向け書き出し（詳しい版）で共通の、選手の「登録区分」の表示（設計書298章）。
// 画面だけの変更（保存キーの対象外）。
import type { PlayerSummary } from "../../shared/types";
import type { SeasonRegistrationEntry } from "../../shared/registration";
import { classificationGroup, splitClassificationSeason, splitGroupOf } from "./classificationFilter";

/**
 * 個人詳細の「登録区分」の表示（DESIGN.md 298章）。2026-27 以降は、そのシーズンの登録区分の記録（外国籍・帰化・アジア特別枠。見做し日本人は「日本人（見做し日本人）」、
 * シーズン途中の変更は「外国籍 → 帰化（2027-01-10から）」）。2025-26 以前は「日本人」か「外国籍・帰化・アジア」（区分を分けて記録していない）
 */
export function registrationLabel(season: string, classification: PlayerSummary["classification"], entry: SeasonRegistrationEntry | undefined): string {
  if (!splitClassificationSeason(season)) return classificationGroup(classification) ?? classification ?? "-";
  const name = (c: PlayerSummary["classification"], deemed?: boolean) => (deemed ? "日本人（見做し日本人）" : (splitGroupOf(c) ?? "-"));
  if (!entry) return name(classification);
  const parts = [name(entry.classification, entry.deemedJapanese)];
  for (const c of entry.changes ?? []) parts.push(`${name(c.classification, c.deemedJapanese)}（${c.from.replaceAll("-", "/")}から）`);
  return parts.join(" → ");
}

