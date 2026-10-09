// 選手名の表記をそろえる共通部分（集計と画面で使う。DESIGN.md 222章）。
// 公式の選手名には、全角空白（「金丸　晃輔」）・連続した空白・前後の空白が混ざる（2016-17に多い）。表では常に半角の空白1つにそろえる。
// 複数のシーズンをまたぐ表（歴代・通算など）は、選手マスタの今の登録名にそろえる。

/** 空白（全角・連続・前後）を半角の空白1つにそろえる */
export function normalizePlayerName(name: string): string {
  return name.replace(/[\s　 ]+/g, " ").trim();
}

/** 選手ID → 今の登録名（選手マスタの名前。空白をそろえたもの）。マスタに無い選手は含まれない */
export function currentPlayerNames(master: readonly { playerId: string; name: string }[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const p of master) {
    const name = normalizePlayerName(p.name);
    if (name) names.set(p.playerId, name);
  }
  return names;
}
