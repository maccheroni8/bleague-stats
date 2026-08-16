// data/team-colors.json由来の色をUIのアクセント（ボーダー・塗り）として使う前に、
// 視認性チェックを通すための汎用ユーティリティ。
//
// ロゴ画像から自動抽出した色の中には、ロゴ自体が濃色主体のデザインだったり
// （例: 紺一色のエンブレム）、逆に明るすぎたりして、テーマの背景色（ライトテーマは
// ほぼ白、ダークテーマはほぼ黒）に対してほとんど見えなくなるものが混ざりうる。
// ここでの判定はテーマを問わず安全な中間の明度レンジに絞る簡易的なものだが、
// 個別のチームIDをハードコードせず、どんな色が来ても・将来ロゴが差し替わっても
// 自動的に同じ基準で弾けるようにするための一般的な安全策として実装している。

/** "#rrggbb"形式の16進数から相対輝度(0-255スケール)を計算する */
export function relativeLuminance(hex: string): number | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return null;
  const value = match[1]!;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ライトテーマ(--bg: #ffffff、輝度255)・ダークテーマ(--bg: #15171a、輝度約23)の
// どちらの背景に対しても最低限の視認性を確保できる範囲に絞る。
// アクセントは3〜4px程度のボーダー線としての装飾的な用途（数値・文字自体は常に
// 既存の文字色のまま）なので、本文テキストほど厳しい基準は不要。45/210だと
// 宇都宮ブレックスの黄色(#ffe000、輝度214)のような実在のブランドカラーまで
// 弾いてしまったため、35/220まで緩めている（2026-08-16調整）
const MIN_LUMINANCE = 35;
const MAX_LUMINANCE = 220;

/** アクセント色として使うのに十分な視認性があるか */
export function isAccentColorLegible(hex: string | undefined | null): hex is string {
  if (!hex) return false;
  const lum = relativeLuminance(hex);
  if (lum === null) return false;
  return lum >= MIN_LUMINANCE && lum <= MAX_LUMINANCE;
}

/** 視認性のある色ならそのまま、無ければundefined（呼び出し側は既存の配色にフォールバックする） */
export function legibleAccentColor(hex: string | undefined | null): string | undefined {
  return isAccentColorLegible(hex) ? hex : undefined;
}
