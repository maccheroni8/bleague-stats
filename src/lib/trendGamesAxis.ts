// 推移グラフの横軸を「日付」から「試合数」に切り替えるための並べ替え（画面だけ。保存キーの対象外）。
// 日付ごとの行（reshape の出力）を、チームごとの「その時点までの試合数（勝＋敗）」の行に組み替える。
// 同じ試合数の値が複数の日にあるとき（試合のない日）は、最初の日の値を使う
import type { StandingsSnapshot } from "../../shared/types";

export type TrendRow = Record<string, number | string>;

export function toGamesAxis(history: StandingsSnapshot[], rows: TrendRow[]): TrendRow[] {
  const byGames = new Map<number, TrendRow>();
  const n = Math.min(history.length, rows.length);
  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    for (const t of history[i]!.teams) {
      const v = row[t.teamId];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const g = t.wins + t.losses;
      let out = byGames.get(g);
      if (!out) {
        out = { date: g };
        byGames.set(g, out);
      }
      if (out[t.teamId] === undefined) out[t.teamId] = v;
    }
  }
  if (byGames.size === 0) return [];
  const keys = [...byGames.keys()];
  const lo = Math.min(...keys);
  const hi = Math.max(...keys);
  const result: TrendRow[] = [];
  // 途中の試合数が飛んでも横軸が詰まらないよう、間は空の行で埋める
  for (let g = lo; g <= hi; g++) result.push(byGames.get(g) ?? { date: g });
  return result;
}

/** 日ごとの記録の中での、試合数（勝＋敗）の最小・最大。再生の時計の長さ（最大−最小+1）と、チャートごとの開始位置の基準に使う */
export function gamesRange(history: StandingsSnapshot[]): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const h of history) {
    for (const t of h.teams) {
      const g = t.wins + t.losses;
      if (g < lo) lo = g;
      if (g > hi) hi = g;
    }
  }
  return lo <= hi ? { lo, hi } : { lo: 0, hi: 0 };
}
