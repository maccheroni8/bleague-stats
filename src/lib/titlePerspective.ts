// 全チームスタッツ・シチュエーション別の保存画像のタイトルに入れる視点（設計書449章）。自チームは何も付けない。
// 画面・通信に依存しない純粋な関数だけ（保存キーの対象外）
export type TitlePerspective = "own" | "opp" | "diff";

/** タイトルの末尾に付ける視点（「（相手のスタッツ）」「（自チーム−相手の差）」）。自チームは空 */
export function perspectiveTitleSuffix(perspective: TitlePerspective): string {
  return perspective === "opp" ? "（相手のスタッツ）" : perspective === "diff" ? "（自チーム−相手の差）" : "";
}

/** ファイル名に入れる視点の部分。自チームは null */
export function perspectiveFilePart(perspective: TitlePerspective): string | null {
  return perspective === "opp" ? "相手のスタッツ" : perspective === "diff" ? "自チーム−相手の差" : null;
}
