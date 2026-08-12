// アドバンスドスタッツ計算式（DESIGN.md 6章）。
// Bリーグ公式の「スタッツ用語解説」(bleague.jp/glossary/)に定義がある項目はその式を採用し、
// 公式に定義がない項目のみNBA/Basketball-Reference流の一般的な式で補う。

export function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** EFG% = (FGM + 0.5*3PM) / FGA。公式定義と一致（DESIGN.md 6章） */
export function efgPct(fgm: number, threePm: number, fga: number): number {
  return safeDiv(fgm + 0.5 * threePm, fga);
}

/** TS% = PTS / (2*(FGA + 0.44*FTA))。公式定義と一致（DESIGN.md 6章） */
export function tsPct(pts: number, fga: number, fta: number): number {
  return safeDiv(pts, 2 * (fga + 0.44 * fta));
}

/** FTR = FTA / FGA。公式に定義がないためNBA流を採用（DESIGN.md 6章） */
export function ftRate(fta: number, fga: number): number {
  return safeDiv(fta, fga);
}

/** ORB% = 100 * TeamOREB / (TeamOREB + OppDREB)。公式に定義がないためNBA流を採用 */
export function orbPct(teamOreb: number, oppDreb: number): number {
  return safeDiv(100 * teamOreb, teamOreb + oppDreb);
}

export interface PossessionTotals {
  fga: number;
  fgm: number;
  fta: number;
  oreb: number;
  dreb: number;
  tov: number;
}

/**
 * Bリーグ公式のポゼッション推定式（DESIGN.md 6章）。自チーム視点の推定と相手チーム視点の推定を
 * 平均する精密な式。以前実装していた簡易式（FGA-OREB+TOV+0.44*FTA）から置き換え。
 *   POSS = 0.5 * [ (FGA + 0.4*FTA - 1.07*(OR/(OR+相手DR))*(FGA-FGM) + TO)
 *                 + (被FGA + 0.4*被FTA - 1.07*(被OR/(被OR+DR))*(被FGA-被FGM) + 被TO) ]
 */
export function estimatedPossessions(team: PossessionTotals, opponent: PossessionTotals): number {
  const teamEstimate =
    team.fga +
    0.4 * team.fta -
    1.07 * safeDiv(team.oreb, team.oreb + opponent.dreb) * (team.fga - team.fgm) +
    team.tov;
  const opponentEstimate =
    opponent.fga +
    0.4 * opponent.fta -
    1.07 * safeDiv(opponent.oreb, opponent.oreb + team.dreb) * (opponent.fga - opponent.fgm) +
    opponent.tov;
  return 0.5 * (teamEstimate + opponentEstimate);
}

/** ORtg/DRtg = 100 * PTS / POSS（公式定義と一致。DRtgは相手PTSを渡して計算する） */
export function offensiveRating(pts: number, poss: number): number {
  return safeDiv(100 * pts, poss);
}

/** PACE = 試合時間(40分) * POSS / (プレイタイム合計/5)。公式定義と一致（DESIGN.md 6章） */
export function pace(teamPoss: number, teamMinutesTotal: number, gameMinutes = 40): number {
  return safeDiv(gameMinutes * teamPoss, teamMinutesTotal / 5);
}

export interface EffTotals {
  pts: number;
  ast: number;
  blk: number;
  stl: number;
  reb: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  foulsDrawn: number;
  blockedAgainst: number;
}

/**
 * Bリーグ公式EFF（貢献度）。Game Score（NBA流の代替案）の代わりにこちらを採用する。
 * 年度で式が異なる（DESIGN.md 6章）。戻り値は常に「1試合あたり」の値（totals×gamesPlayedで
 * 割って揃えている。2019-20以前の式はもともと試合数で割る定義のため、この関数内で統一する）。
 *
 * - 2020-21シーズン以降: (PTS+AS+BS+ST+FD+TR) - (TO+BSR+F) - (FGA-FGM) - (FTA-FTM)
 *   ※ (2FGA-2FGM)+(3FGA-3FGM) は代数的に (FGA-FGM)（2P/3P合算値）と同じなので、
 *     内訳を分けて集計しなくても2P/3P合算のfgm/fgaでそのまま計算できる
 * - 2019-20シーズン以前: ((PTS+TR+AS+ST+BS) - (FGA-FGM) - (FTA-FTM) - TO) / 試合数
 *
 * 2026-27シーズンのみを扱う現時点では前者の分岐しか使わないが、Phase 5の過去シーズン
 * バックフィル時にそのまま使えるよう分岐を用意してある。
 */
export function eff(seasonStartYear: number, totals: EffTotals, gamesPlayed: number): number {
  const missedFg = totals.fga - totals.fgm;
  const missedFt = totals.fta - totals.ftm;

  if (seasonStartYear >= 2020) {
    const total =
      totals.pts +
      totals.ast +
      totals.blk +
      totals.stl +
      totals.foulsDrawn +
      totals.reb -
      (totals.tov + totals.blockedAgainst + totals.pf) -
      missedFg -
      missedFt;
    return safeDiv(total, gamesPlayed);
  }

  return safeDiv(
    totals.pts + totals.reb + totals.ast + totals.stl + totals.blk - missedFg - missedFt - totals.tov,
    gamesPlayed,
  );
}

/**
 * Usage% = 100 * ((FGA + 0.44*FTA + TOV) * (TeamMIN/5)) / (MIN * (TeamFGA + 0.44*TeamFTA + TeamTOV))。
 * 公式に定義がないためNBA流を採用（DESIGN.md 6章）。GeniusAPI生データの個人USGフィールドと
 * 一致することを確認済み（複数選手・1試合分で検証）
 */
export function usagePct(
  player: { fga: number; fta: number; tov: number; min: number },
  team: { fga: number; fta: number; tov: number; min: number },
): number {
  const numerator = (player.fga + 0.44 * player.fta + player.tov) * (team.min / 5);
  const denominator = player.min * (team.fga + 0.44 * team.fta + team.tov);
  return safeDiv(100 * numerator, denominator);
}

/** MM:SS または "DNP" 形式のPlayTimeを分（小数）に変換する */
export function parsePlayTime(playTime: string): number {
  const match = /^(\d+):(\d{2})$/.exec(playTime);
  if (!match) return 0;
  return Number(match[1]) + Number(match[2]) / 60;
}
