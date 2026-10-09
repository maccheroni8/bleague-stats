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

export const ASSIST_PAIRS_VERSION = 1;

/**
 * data/{season}/assist-pairs.json.gz（導出データB。DESIGN.md 221章）。B.PREMIERのレギュラーシーズン・ポストシーズンの、試合ごとのアシストペアの行。
 * 列ごとに数値を並べる。keys は試合番号（ScheduleKey）の昇順、players は選手IDの昇順。行は (試合, アシストした選手ID, 得点した選手ID) の昇順。
 * 1行 = 1試合×1ペア（その試合でアシスト付きの得点が1回以上あったペア）。点数は assistPairPoints
 */
export interface AssistPairsFile {
  version: typeof ASSIST_PAIRS_VERSION;
  generatedAt: string;
  season: string;
  keys: string[];
  players: string[];
  rows: {
    /** keys の番号 */
    game: number[];
    /** players の番号 */
    assister: number[];
    scorer: number[];
    n2: number[];
    n3: number[];
    nf: number[];
  };
}

export function buildAssistPairsFile(season: string, games: { key: string; rows: AssistPairRow[] }[]): AssistPairsFile {
  const sortedGames = [...games].sort((a, b) => compareIds(a.key, b.key));
  const keys = sortedGames.map((g) => g.key);
  const players = [...new Set(sortedGames.flatMap((g) => g.rows.flatMap((r) => [r.assisterId, r.scorerId])))].sort(compareIds);
  const playerIndex = new Map(players.map((id, i) => [id, i]));
  const rows: AssistPairsFile["rows"] = { game: [], assister: [], scorer: [], n2: [], n3: [], nf: [] };
  sortedGames.forEach((g, gi) => {
    for (const r of [...g.rows].sort((a, b) => compareIds(a.assisterId, b.assisterId) || compareIds(a.scorerId, b.scorerId))) {
      rows.game.push(gi);
      rows.assister.push(playerIndex.get(r.assisterId)!);
      rows.scorer.push(playerIndex.get(r.scorerId)!);
      rows.n2.push(r.n2);
      rows.n3.push(r.n3);
      rows.nf.push(r.nf);
    }
  });
  return { version: ASSIST_PAIRS_VERSION, generatedAt: new Date().toISOString(), season, keys, players, rows };
}
