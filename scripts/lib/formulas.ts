// アドバンスドスタッツ計算式（DESIGN.md 6章、Basketball Reference準拠）。

export function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function efgPct(fgm: number, threePm: number, fga: number): number {
  return safeDiv(fgm + 0.5 * threePm, fga);
}

export function tsPct(pts: number, fga: number, fta: number): number {
  return safeDiv(pts, 2 * (fga + 0.44 * fta));
}

export function ftRate(fta: number, fga: number): number {
  return safeDiv(fta, fga);
}

/** 推定ポゼッション数: FGA - OREB + TOV + 0.44*FTA */
export function estimatedPossessions(fga: number, oreb: number, tov: number, fta: number): number {
  return fga - oreb + tov + 0.44 * fta;
}

export function offensiveRating(pts: number, poss: number): number {
  return safeDiv(100 * pts, poss);
}

/** ORB% = 100 * TeamOREB / (TeamOREB + OppDREB) */
export function orbPct(teamOreb: number, oppDreb: number): number {
  return safeDiv(100 * teamOreb, teamOreb + oppDreb);
}

/** MM:SS または "DNP" 形式のPlayTimeを分（小数）に変換する */
export function parsePlayTime(playTime: string): number {
  const match = /^(\d+):(\d{2})$/.exec(playTime);
  if (!match) return 0;
  return Number(match[1]) + Number(match[2]) / 60;
}
