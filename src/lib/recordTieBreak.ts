// 1試合記録の成功率の同じ値のときの決め方: 同じ成功率なら成功数が多いほうを上にし、成功数も同じなら同順位。
// 上位だけを書き出したファイル（保存キーの対象で、同じ率の中は試投数の多い順・順位は率だけで付けている）の行にも、画面側で同じ決め方を当てる。
// 画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。

interface TiedRow {
  value: number;
  rank: number;
  made?: number;
}

/** 並びは「値の順」を保ったまま、同じ値の中だけ成功数の多い順にし、順位を（値, 成功数）で付け直す。成功数の無い行（成功率でない項目）は何も変えない */
export function rerankByMade<T extends TiedRow>(rows: readonly T[], topN?: number): T[] {
  if (rows.length === 0 || rows.every((r) => r.made === undefined)) return rows as T[];
  const out: T[] = [];
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j]!.value === rows[i]!.value) j += 1;
    out.push(...rows.slice(i, j).sort((a, b) => (b.made ?? 0) - (a.made ?? 0)));
    i = j;
  }
  let rank = 0;
  const ranked = out.map((r, i) => {
    if (i === 0 || r.value !== out[i - 1]!.value || (r.made ?? 0) !== (out[i - 1]!.made ?? 0)) rank = i + 1;
    return r.rank === rank ? r : { ...r, rank };
  });
  // 順位の付け方が細かくなったぶん、書き出しの範囲（N位と同じ値をすべて）の後ろにはみ出す行は外す
  return topN === undefined ? ranked : ranked.filter((r) => r.rank <= topN);
}

/** RankedList の tieKey: 値と成功数が同じなら同じ順位 */
export function tieKeyWithMade(r: { value: number; made?: number }): string {
  return r.made === undefined ? String(r.value) : `${r.value}|${r.made}`;
}
