/**
 * 勝敗の短い表記（「45-15」。チーム詳細のチームスタッツの表で、試合数の横・シーズン別成績に使う）。
 * 文中の「45勝15敗」（format.ts の formatRecord）とは別。format.ts は保存キーの対象なので、ここに置く
 */
export function formatRecordShort(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}
