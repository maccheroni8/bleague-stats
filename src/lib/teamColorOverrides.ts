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
//
// - 横浜ビー・コルセアーズ（694）: 公式サイトのチームカラーの1番目「大海の深い紺色」#00263A（2026-09-26、ユーザー指定）。
//   自動抽出は #001030（さらに濃い紺）で、視認性チェック（輝度35未満は不可）に通らず、secondary の金色（#c0a040）が
//   チームカラーとして使われていた。#00263A も輝度約31でチェックに通らないため、確認済みの公式色として
//   チェックを通さずに採用する（skipLegibilityCheck）。ダークテーマの背景に対しては見えにくい
export const TEAM_COLOR_OVERRIDES: Record<string, { primary?: string; secondary?: string; skipLegibilityCheck?: boolean }> = {
  "720": { primary: "#003ca5" },
  "701": { primary: "#dbc073", secondary: "#003f6b" },
  "694": { primary: "#00263A", skipLegibilityCheck: true },
};

/**
 * 全クラブのサブカラー（2026-09-26、DESIGN.md 156章）。同じ画面に並ぶ2チームのチームカラーが近いとき、アウェイ
 * （比較では2つ目以降）をこの色に替える（src/lib/teamColorPairs.ts）。色名は各クラブが公式に示すチームカラーのうち
 * メイン以外の1色。公式にカラーコードを出しているクラブはほぼ無いため、値は公式ロゴから自動抽出した色
 * （data/team-colors.json の secondary）が色名と合うときはその値、合わないときは色名の代表値。
 * 黒・白は画面の文字色（テーマに追従。ライトは黒、ダークは白）で表す（"mono"）。source は色名を確かめたページ
 */
export interface TeamSubColor {
  color: string | "mono";
  name: string;
  source: string;
  /** 値の出どころ（logo: ロゴからの自動抽出、representative: 色名の代表値、override: 既存の手動上書き、mono: 文字色） */
  valueFrom: "logo" | "representative" | "override" | "mono";
}

export const TEAM_SUB_COLORS: Record<string, TeamSubColor> = {
  "702": { color: "#a58fc7", name: "ラベンダーパープル", source: "https://www.levanga.com/lp/rebranding/", valueFrom: "representative" },
  "692": { color: "mono", name: "ナイナーズブラック", source: "https://www.89ers.jp/team/", valueFrom: "mono" },
  "693": { color: "#e6b422", name: "いなほゴールド", source: "https://northern-happinets.com/", valueFrom: "representative" },
  "712": { color: "#f09020", name: "つくばオレンジ", source: "https://www.ibarakirobots.win/", valueFrom: "logo" },
  "703": { color: "#003050", name: "紺（ブルーシアインディゴ）", source: "https://www.utsunomiyabrex.com/team/concept/", valueFrom: "logo" },
  "713": { color: "mono", name: "GCTブラック", source: "https://g-crane-thunders.jp/", valueFrom: "mono" },
  "2486": { color: "mono", name: "黒", source: "https://altiri.jp/club/", valueFrom: "mono" },
  "704": { color: "#b4b4b4", name: "ライジングプラチナ", source: "https://chibajets.jp/lp/2021_rebranding/", valueFrom: "representative" },
  "706": { color: "mono", name: "ブラック", source: "https://www.alvark-tokyo.jp/team/", valueFrom: "mono" },
  "726": { color: "#ffd000", name: "イエロー（旧クラブカラー。ロゴに残る色）", source: "https://www.sunrockers.jp/news/detail/id=22694", valueFrom: "logo" },
  "727": { color: "#b09020", name: "ヴィクトリーゴールド", source: "https://kawasaki-bravethunders.com/news/detail/id=7799", valueFrom: "logo" },
  "694": { color: "#c8102e", name: "赤（横浜の文化と伝統）", source: "https://b-corsairs.com/team/", valueFrom: "representative" },
  "696": { color: "mono", name: "ブラック（ロゴの黒）", source: "https://grouses.jp/team/", valueFrom: "mono" },
  "716": { color: "mono", name: "黒", source: "https://www.b-warriors.net/team/", valueFrom: "mono" },
  "697": { color: "#e0c000", name: "イエロー（ロゴの黄）", source: "https://www.neophoenix.jp/about/", valueFrom: "logo" },
  "728": { color: "mono", name: "トラディショナルブラック", source: "https://go-seahorses.jp/team/teamcolor/", valueFrom: "mono" },
  "729": { color: "#e00010", name: "ドルフィンズレッド", source: "https://nagoya-dolphins.jp/", valueFrom: "logo" },
  "698": { color: "#c9a227", name: "ゴールド", source: "https://www.lakestars.net/news/detail/id=17451", valueFrom: "representative" },
  "699": { color: "mono", name: "ブラック", source: "https://hannaryz.jp/", valueFrom: "mono" },
  "700": { color: "#d0b070", name: "KINGLY GOLD", source: "https://www.evessa.com/", valueFrom: "logo" },
  "718": { color: "mono", name: "黒（ロゴの黒。公式のチームカラーは緑のみ）", source: "https://www.bleague.jp/media_news/detail/id=459564", valueFrom: "mono" },
  "720": { color: "#a0a0a0", name: "銀", source: "https://www.susanoo-m.com/", valueFrom: "representative" },
  "721": { color: "#10a0a0", name: "青（瀬戸内海）", source: "https://hiroshimadragonflies.com/team/", valueFrom: "logo" },
  "1638": { color: "#d04090", name: "ピンク", source: "https://ballooners.jp/", valueFrom: "logo" },
  "2488": { color: "mono", name: "キャンバスホワイト", source: "https://www.velca.jp/uniform/", valueFrom: "mono" },
  "701": { color: "#003f6b", name: "スチールブルー（紺）", source: "https://goldenkings.jp/", valueFrom: "override" },
  // 過去在籍クラブ
  "695": { color: "#0050a0", name: "青", source: "https://www.albirex.com/team/profile/", valueFrom: "representative" },
  "717": { color: "mono", name: "（公式のサブカラーを確認できず）", source: "https://www.fightingeagles.jp/", valueFrom: "mono" },
  "745": { color: "#c9a227", name: "ゴールド", source: "https://www.koshigaya-alphas.com/team/", valueFrom: "representative" },
  "753": { color: "#d0101f", name: "レッド", source: "https://www.b3league.jp/club/753", valueFrom: "representative" },
};
