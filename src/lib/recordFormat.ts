/**
 * 勝敗の短い表記（「45-15」。チーム詳細のチームスタッツの表で、試合数の横・シーズン別成績に使う）。
 * 文中の「45勝15敗」（format.ts の formatRecord）とは別。format.ts は保存キーの対象なので、ここに置く
 */
export function formatRecordShort(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}

/**
 * 勝敗に、スタッツの無い試合（結果だけの試合。ボックススコアが公式に無い試合・不戦勝。DESIGN.md 228章）を含むときに、勝敗の横へ付ける印とその説明。
 * 試合数（スタッツの対象の試合数）と勝敗の合計が食い違って見えるのを、該当のチーム・シーズンだけで説明する
 */
export const RESULT_ONLY_MARK = "※";

export function resultOnlyMarkTitle(resultOnlyGames: number): string {
  return `勝敗には、スタッツ（ボックススコア）の無い試合を${resultOnlyGames}試合含みます。試合数・スタッツには入っていません`;
}
