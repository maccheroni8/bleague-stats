// アドバンスドスタッツ計算式（scripts/lib/formulas.tsのフロントエンド版）。
// シチュエーション別フィルタ（TeamDetailPage/PlayerDetailPage）でtry-games/player-gamesの
// 生ログをその場で集計する際に使う。バックエンド側と同じ式を保つこと（DESIGN.md 6章）

export function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** EFG% = (FGM + 0.5*3PM) / FGA */
export function efgPct(fgm: number, threePm: number, fga: number): number {
  return safeDiv(fgm + 0.5 * threePm, fga);
}

/** TS% = PTS / (2*(FGA + 0.44*FTA)) */
export function tsPct(pts: number, fga: number, fta: number): number {
  return safeDiv(pts, 2 * (fga + 0.44 * fta));
}

/** ORtg/DRtg = 100 * PTS / POSS */
export function offensiveRating(pts: number, poss: number): number {
  return safeDiv(100 * pts, poss);
}

/** PACE = 試合時間(40分) * POSS / (プレイタイム合計/5) */
export function pace(teamPoss: number, teamMinutesTotal: number, gameMinutes = 40): number {
  return safeDiv(gameMinutes * teamPoss, teamMinutesTotal / 5);
}
