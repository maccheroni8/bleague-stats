import type { GameSummary } from "../../shared/types";

/**
 * 順位表の「対戦相手の強さ」（設計書251章）: これまでに対戦した相手それぞれの今季の勝率を、その相手と戦った試合数で重み付けして平均した値。
 * 相手が強い（勝率が高い）クラブと多く当たっているほど高い。リーグ内の順位は、この値が高い順（1位＝最も強い相手と当たってきた）。
 *
 * 対象の試合はレギュラーシーズンの終了した試合（結果だけの試合〔resultOnlyGames〕も、順位表と同じく勝敗・試合数に含める）。
 * 相手の勝率は順位表の勝率（結果だけの試合を含む）をそのまま使う。まだ試合をしていないクラブは値を持たない
 */
export interface OpponentStrength {
  /** 対戦した相手の今季の勝率の、対戦試合数での加重平均（0〜1） */
  value: number;
  /** 値を出した試合数（この試合数でクラブの試合数と一致する） */
  games: number;
  /** リーグ内の順位（高い順。同じ表示値＝小数第3位まで同じなら同じ順位で、次の順位は飛ばす） */
  rank: number;
}

export function computeOpponentStrength(
  teams: readonly { teamId: string; wins: number; losses: number }[],
  games: readonly GameSummary[],
): Map<string, OpponentStrength> {
  const winPctById = new Map<string, number>();
  for (const t of teams) {
    const played = t.wins + t.losses;
    if (played > 0) winPctById.set(t.teamId, t.wins / played);
  }
  const sums = new Map<string, { sum: number; games: number }>();
  const add = (teamId: string, opponentId: string) => {
    const opponentWinPct = winPctById.get(opponentId);
    if (opponentWinPct === undefined || !winPctById.has(teamId)) return;
    const s = sums.get(teamId) ?? { sum: 0, games: 0 };
    s.sum += opponentWinPct;
    s.games += 1;
    sums.set(teamId, s);
  };
  for (const g of games) {
    if (g.gameType !== "regular" || !g.gameEndedFlg) continue;
    add(g.homeTeamId, g.awayTeamId);
    add(g.awayTeamId, g.homeTeamId);
  }
  const entries = [...sums].map(([teamId, s]) => ({ teamId, value: s.sum / s.games, games: s.games }));
  // 同じ順位かどうかは表示している値（小数第3位）で決める（ランキングの順位の付け方と同じ）
  const key = (v: number) => v.toFixed(3);
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const result = new Map<string, OpponentStrength>();
  sorted.forEach((e, i) => {
    let j = i;
    while (j > 0 && key(sorted[j - 1]!.value) === key(e.value)) j -= 1;
    result.set(e.teamId, { value: e.value, games: e.games, rank: j + 1 });
  });
  return result;
}
