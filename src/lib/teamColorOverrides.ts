// 自動抽出（scripts/extract-team-colors.ts）が実際のブランドカラーと大きくズレる
// チームの手動上書きリスト。scripts/lib/playerClassificationOverrides.tsと同じパターンで、
// 少数の確認済み例外だけをここに記録し、それ以外は自動抽出結果（data/team-colors.json）を
// そのまま使う。fetchTeamColors()がここを自動抽出結果より優先して適用する。
//
// 2026-08-18、26クラブの公式サイト（bleague.jp/club_detail/記載の公式サイトURL）を実際に
// ブラウザでレンダリングし、ヘッダー/ナビ等のcomputed style（面積加重）から支配色を抽出して
// data/team-colors.jsonと比較した結果、明確にズレていたのは以下の2クラブのみだった
// （それ以外は自動抽出値が公式サイトの配色とRGB距離50未満で近似しており上書き不要と判断。
// 富山・神戸はやや差はあったが同系統色内の濃淡差にとどまるため見送った）。
//
// - 島根スサノオマジック（720）: 自動抽出はロゴが無彩色主体のため無彩色
//   （primary #c0c0c0 / secondary #909090、実質モノクロフォールバック相当）になっていたが、
//   公式サイト（susanoo-m.com）のヘッダー色は鮮やかな青（#003ca5）。ボランティアスタッフの
//   愛称が「スサマジブルーキャスト」であることも確認し、青が公式カラーであることを裏付けた。
//   secondaryは公式サイトから明確な値を確認できなかったため上書きせず、自動抽出のsecondary
//   （#909090）に委ねる
// - 琉球ゴールデンキングス（701）: 自動抽出は紺（primary #004070 / secondary #d01020）が
//   主役になっていたが、公式サイト（goldenkings.jp）はゴールド（#dbc073。footer/navの
//   背景色として確認）が最も面積の大きい配色で、紺（#003f6b、自動抽出のprimaryとほぼ同値）は
//   従属色という実態だった。primary/secondaryを入れ替える形で採用する
export const TEAM_COLOR_OVERRIDES: Record<string, { primary?: string; secondary?: string }> = {
  "720": { primary: "#003ca5" },
  "701": { primary: "#dbc073", secondary: "#003f6b" },
};
