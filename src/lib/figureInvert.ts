// 画面専用（図解の散布図の「軸の反転」）。反転すると、値の小さいほうが上（縦軸）・右（横軸）になる。
// 小さいほど良い項目（rankDirection.ts の向き）を選ぶと自動でチェックが入り、手で外すこともできる。URL は軸ごとに `fyi`・`fxi`（チーム）／`pyi`・`pxi`（選手）。
import type { UrlCodec } from './urlState';
import { rankDirectionOf, type RankPerspective } from './rankDirection';

export const INVERT_SUFFIX = '（反転）';
export const invertCodec = (key: string): UrlCodec<boolean> => ({
  keys: [key],
  read: p => (p.get(key) === '1' ? true : undefined),
  write: (p, v) => { if (v) p.set(key, '1'); },
});
/** 軸の名前。反転している軸には「（反転）」を付ける（画面・保存画像の軸の見出しとタイトル） */
export const invertedName = (name: string, inverted: boolean) => (inverted ? `${name}${INVERT_SUFFIX}` : name);
/** その項目を選んだとき、自動でチェックを入れるか（少ないほど良い項目） */
export const defaultInvert = (key: string, perspective: RankPerspective = 'own') => rankDirectionOf(key, perspective) === 'lower';
