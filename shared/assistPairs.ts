// アシストペア（アシストした選手→アシストを受けて得点した選手）の試合ごとの行（DESIGN.md 221章）。
// shared/assistedScoring.ts の computeAssistedScoring の pairs（Map。挿入順は処理するイベントの順で変わる）を、キーの順に固定した配列にする。
import type { AssistPair } from "./assistedScoring.ts";

export interface AssistPairRow {
  assisterId: string;
  scorerId: string;
  /** アシストされた2P成功数・3P成功数・FT成功数 */
  n2: number;
  n3: number;
  nf: number;
}

export function assistPairPoints(r: { n2: number; n3: number; nf: number }): number {
  return r.n2 * 2 + r.n3 * 3 + r.nf;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 1試合のペアを、(アシストした選手ID, 得点した選手ID) の昇順に並べた配列にする（Mapの挿入順に依存しない） */
export function sortedAssistPairRows(pairs: Iterable<AssistPair>): AssistPairRow[] {
  return [...pairs]
    .map((p) => ({ assisterId: p.assisterId, scorerId: p.scorerId, n2: p.assisted2m, n3: p.assisted3m, nf: p.assistedFtm }))
    .sort((a, b) => compareIds(a.assisterId, b.assisterId) || compareIds(a.scorerId, b.scorerId));
}
