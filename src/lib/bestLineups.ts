// 図解「歴代最強ラインナップ」（DESIGN.md 370章）の計算。導出データ（shared/bestLineups.ts の形。scripts/aggregate-best-lineups.ts が作る）を、
// 組（1シーズン×1クラブ×同じ組み合わせ）にまとめ、試合区分・OC・下限で絞って並べる。率は読むときに計算する（src/lib/lineupRatings.ts の ratingsFromPossessions。
// チーム詳細の5人組の表と同じ式）。通信・画面の部品を含まない（検証スクリプトからも使う）。集計のコードから読まれない場所（保存キーの対象外）。
import {
  BL_GAMES,
  BL_OPP,
  BL_OPP_POSS,
  BL_OWN_POSS,
  BL_PTS,
  BL_SEC,
  BL_SUM_WIDTH,
  type BestLineupSize,
  type BestLineupsFile,
} from "../../shared/bestLineups";
import { ratingsFromPossessions } from "./lineupRatings";

export type BestLineupSort = "net" | "off" | "def" | "min";
export const BEST_LINEUP_SORTS: readonly BestLineupSort[] = ["net", "off", "def", "min"];
export const BEST_LINEUP_SORT_LABELS: Record<BestLineupSort, string> = { net: "NetRtg", off: "ORtg", def: "DRtg", min: "出場時間" };
export type BestLineupGameType = "regular" | "playoff" | "both";

export interface BestLineupPlayer {
  id: string;
  name: string;
}

/** OC ごとの部分（シーズンの途中で登録区分が変わった選手がいる組だけ、複数になる） */
interface Part {
  oc: number;
  sums: readonly number[];
}

export interface BestLineupGroup {
  /** シーズン:チームID:選手ID（昇順）。一意 */
  key: string;
  season: string;
  teamId: string;
  teamName: string;
  players: BestLineupPlayer[];
  parts: Part[];
}

export interface BestLineupTotals {
  seconds: number;
  games: number;
  ownPoints: number;
  oppPoints: number;
  ownPoss: number;
  oppPoss: number;
}

export interface BestLineupRow extends BestLineupTotals {
  group: BestLineupGroup;
  off: number | null;
  def: number | null;
  net: number | null;
}

export interface RankedBestLineup {
  row: BestLineupRow;
  /** 同じ値は同じ順位、次は飛ばす（143-3章）。率は表示の小数第2位、時間は秒で判定 */
  rank: number;
}

/** 導出データを組ごとにまとめる */
export function bestLineupGroups(file: BestLineupsFile): BestLineupGroup[] {
  const size = file.size;
  const map = new Map<string, BestLineupGroup>();
  for (const r of file.rows) {
    const [seasonNo, teamId, teamName] = file.teams[r[0]!]!;
    const season = file.seasons[seasonNo]!;
    const players = r.slice(1, 1 + size).map((n) => {
      const [id, name] = file.players[n]!;
      return { id, name };
    });
    const key = `${season}:${teamId}:${players.map((p) => p.id).join(",")}`;
    let g = map.get(key);
    if (!g) {
      g = { key, season, teamId, teamName, players, parts: [] };
      map.set(key, g);
    }
    g.parts.push({ oc: r[1 + size]!, sums: r.slice(2 + size) });
  }
  return [...map.values()];
}

/** その組で選べる OC の値（実際にある値だけ、小さい順） */
export function bestLineupOcValues(groups: readonly BestLineupGroup[]): number[] {
  const set = new Set<number>();
  for (const g of groups) for (const p of g.parts) if (p.oc >= 0) set.add(p.oc);
  return [...set].sort((a, b) => a - b);
}

function totalsOf(parts: readonly Part[], gameType: BestLineupGameType): BestLineupTotals {
  const t: BestLineupTotals = { seconds: 0, games: 0, ownPoints: 0, oppPoints: 0, ownPoss: 0, oppPoss: 0 };
  const offsets = gameType === "regular" ? [0] : gameType === "playoff" ? [BL_SUM_WIDTH] : [0, BL_SUM_WIDTH];
  for (const p of parts) {
    for (const o of offsets) {
      t.seconds += p.sums[o + BL_SEC]!;
      t.games += p.sums[o + BL_GAMES]!;
      t.ownPoints += p.sums[o + BL_PTS]!;
      t.oppPoints += p.sums[o + BL_OPP]!;
      t.ownPoss += p.sums[o + BL_OWN_POSS]!;
      t.oppPoss += p.sums[o + BL_OPP_POSS]!;
    }
  }
  return t;
}

export interface BestLineupQuery {
  gameType: BestLineupGameType;
  /** null はすべて。数値はその OC の部分だけ */
  oc: number | null;
  /** 攻守とも、この数以上のポゼッション */
  minPoss: number;
  sort: BestLineupSort;
}

/** 表示の値（順位の判定に使う）。率は小数第2位に丸めた値、時間は秒 */
function rankValue(row: BestLineupRow, sort: BestLineupSort): number {
  if (sort === "min") return row.seconds;
  const v = row[sort]!;
  return Math.round(v * 100) / 100;
}

/** 条件で絞って並べた全部の組（順位つき）。並びは NetRtg・ORtg・出場時間は大きい順、DRtg は小さい順。同じ順位の中は出場時間の長い順 */
export function queryBestLineups(groups: readonly BestLineupGroup[], q: BestLineupQuery): RankedBestLineup[] {
  const rows: BestLineupRow[] = [];
  for (const g of groups) {
    const parts = q.oc === null ? g.parts : g.parts.filter((p) => p.oc === q.oc);
    if (parts.length === 0) continue;
    const t = totalsOf(parts, q.gameType);
    if (t.games === 0 && t.seconds === 0) continue;
    if (Math.min(t.ownPoss, t.oppPoss) < q.minPoss) continue;
    const r = ratingsFromPossessions(t.ownPoints, t.oppPoints, t.ownPoss, t.oppPoss);
    if (r.net === null) continue;
    rows.push({ ...t, group: g, off: r.off, def: r.def, net: r.net });
  }
  const dir = q.sort === "def" ? 1 : -1;
  rows.sort((a, b) => dir * (rankValue(a, q.sort) - rankValue(b, q.sort)) || b.seconds - a.seconds || a.group.key.localeCompare(b.group.key));
  const out: RankedBestLineup[] = [];
  rows.forEach((row, i) => {
    const prev = out[i - 1];
    const rank = prev && rankValue(prev.row, q.sort) === rankValue(row, q.sort) ? prev.rank : i + 1;
    out.push({ row, rank });
  });
  return out;
}

/** 上位 top 組（境目と同じ順位の組はすべて入れる） */
export function topBestLineups(ranked: readonly RankedBestLineup[], top: number): RankedBestLineup[] {
  if (ranked.length <= top) return [...ranked];
  const edge = ranked[top - 1]!.rank;
  return ranked.filter((r, i) => i < top || r.rank === edge);
}

/** 強調するクラブのうち、表示中の範囲に組が1つも無いクラブの最上位の組（無ければ入れない）。並びは選んだクラブの順 */
export function highlightedBest(ranked: readonly RankedBestLineup[], shown: readonly RankedBestLineup[], clubIds: readonly string[]): { teamId: string; best: RankedBestLineup | null }[] {
  const shownTeams = new Set(shown.map((r) => r.row.group.teamId));
  return clubIds
    .filter((id) => !shownTeams.has(id))
    .map((id) => ({ teamId: id, best: ranked.find((r) => r.row.group.teamId === id) ?? null }));
}

/** 選手の組の人数ごとの OC の選択肢（0〜人数のうち、実際にある値） */
export function ocChoices(groups: readonly BestLineupGroup[], size: BestLineupSize): number[] {
  return bestLineupOcValues(groups).filter((v) => v <= size);
}
