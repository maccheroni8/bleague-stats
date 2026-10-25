// シーズン・リーグごとの規則（data/season-rules.json）の引き方（DESIGN.md 295章）。
// B.ONE の規則は league: "one" の行で持つ（2026-27 から）。B.ONE の行が無いシーズン（旧B2 2025-26 など）は、
// 今までどおりそのシーズンの B.PREMIER の行を使う
import type { Category, SeasonRules } from "./types.ts";

export function seasonRuleFor(rules: SeasonRules[], season: string, category: Category = "premier"): SeasonRules | undefined {
  const own = rules.find((r) => r.season === season && (r.league ?? "premier") === category);
  if (own) return own;
  return rules.find((r) => r.season === season && (r.league ?? "premier") === "premier");
}
