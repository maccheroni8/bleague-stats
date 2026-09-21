// スタッツのカテゴリタブ（Traditional/Advanced/Misc/Scoring/Shooting/Forced TOV/On-Court Foreign/
// Scoring %/Profile）の表示名の唯一の定義。タブのボタン・表題（ConditionTitle）・画像出力のタイトル・
// 「〜は対象外」等の案内文が、すべてここを参照する（2026-09-21に英語表記へ統一）。
// 状態保存・URLはキー（"traditional"等）で持っており、表示名には依存しない。
// 円グラフの見出し（「得点構成」等）はタブ名とは別物として日本語のまま（この定義の対象外）

export const CATEGORY_LABELS = {
  traditional: "Traditional",
  advanced: "Advanced",
  misc: "Misc",
  scoring: "Scoring",
  shooting: "Shooting",
  forcedTurnovers: "Forced TOV",
  foreignPlayers: "On-Court Foreign",
  scoringComposition: "Scoring %",
  profile: "Profile",
} as const;

/** ボックススコア系4カテゴリ（試合詳細・比較・チーム系・個人系で共通のタブ） */
export type BoxCategoryKey = "traditional" | "advanced" | "misc" | "scoring";

export const BOX_CATEGORY_TABS: { key: BoxCategoryKey; label: string }[] = (
  ["traditional", "advanced", "misc", "scoring"] as const
).map((key) => ({ key, label: CATEGORY_LABELS[key] }));
