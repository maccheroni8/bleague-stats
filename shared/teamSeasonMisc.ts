// チーム詳細「シーズン別成績」の列用に、TeamGameLog から合算するシーズン集計（レギュラーシーズンのみ）。
// scripts/aggregate.ts のリーグ平均（league-average.json。DESIGN.md 149章）でも同じ合算を使うため、ページから切り出した
import type { TeamGameLog } from "./types.ts";

/**
 * 「シーズン別成績」Miscタブ用（Phase H3①）のPITP/FBPS/2ND PTS/PTSOFFTO/DUNKに加え、
 * 自チーム/opp/+/-トグル（Phase H8-2）用の相手チーム生カウントも持つ。TeamSummaryは
 * opponentPerGame（平均のみ）・opponentShooting（%のみ）しか持たず、FGM/FGA/PF/FD等の
 * 生カウントを公開していないため、TeamGameLog（careerData）側から都度合算する
 * （teams.jsonの他の集計と同じくレギュラーシーズンのみに揃える）
 */
export interface TeamSeasonMiscTotals {
  pt2in: number;
  fb: number;
  pt2nd: number;
  pft: number;
  dunks: number;
  oppPts: number;
  oppFgm: number;
  oppFga: number;
  oppTpm: number;
  oppTpa: number;
  oppFtm: number;
  oppFta: number;
  oppOreb: number;
  oppDreb: number;
  oppAst: number;
  oppStl: number;
  oppBlk: number;
  oppTov: number;
  oppPf: number;
  oppFoulsDrawn: number;
  oppPt2in: number;
  oppFb: number;
  oppPt2nd: number;
  oppPft: number;
  oppDunks: number;
  // Misc/スコアリングタブ拡張（2026-08-29）。TeamGameLogの同名フィールドをそのまま合算する
  technicalFouls: number;
  basketCounts: number;
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
  assisted2m: number;
  assisted3m: number;
  assistedFtm: number;
  paint2m: number;
  paint2a: number;
  mid2m: number;
  mid2a: number;
  oppTechnicalFouls: number;
  oppBasketCounts: number;
  oppUnsportsmanlikeFouls: number;
  oppDisqualifyingFouls: number;
  oppAssisted2m: number;
  oppAssisted3m: number;
  oppAssistedFtm: number;
  oppPaint2m: number;
  oppPaint2a: number;
  oppMid2m: number;
  oppMid2a: number;
}

export const EMPTY_TEAM_SEASON_MISC: TeamSeasonMiscTotals = {
  pt2in: 0,
  fb: 0,
  pt2nd: 0,
  pft: 0,
  dunks: 0,
  oppPts: 0,
  oppFgm: 0,
  oppFga: 0,
  oppTpm: 0,
  oppTpa: 0,
  oppFtm: 0,
  oppFta: 0,
  oppOreb: 0,
  oppDreb: 0,
  oppAst: 0,
  oppStl: 0,
  oppBlk: 0,
  oppTov: 0,
  oppPf: 0,
  oppFoulsDrawn: 0,
  oppPt2in: 0,
  oppFb: 0,
  oppPt2nd: 0,
  oppPft: 0,
  oppDunks: 0,
  technicalFouls: 0,
  basketCounts: 0,
  unsportsmanlikeFouls: 0,
  disqualifyingFouls: 0,
  assisted2m: 0,
  assisted3m: 0,
  assistedFtm: 0,
  paint2m: 0,
  paint2a: 0,
  mid2m: 0,
  mid2a: 0,
  oppTechnicalFouls: 0,
  oppBasketCounts: 0,
  oppUnsportsmanlikeFouls: 0,
  oppDisqualifyingFouls: 0,
  oppAssisted2m: 0,
  oppAssisted3m: 0,
  oppAssistedFtm: 0,
  oppPaint2m: 0,
  oppPaint2a: 0,
  oppMid2m: 0,
  oppMid2a: 0,
};

export function sumTeamSeasonMisc(logs: TeamGameLog[]): TeamSeasonMiscTotals {
  return logs
    .filter((g) => g.gameType === "regular")
    .reduce<TeamSeasonMiscTotals>(
      (acc, g) => ({
        pt2in: acc.pt2in + g.pt2in,
        fb: acc.fb + g.fb,
        pt2nd: acc.pt2nd + g.pt2nd,
        pft: acc.pft + g.pft,
        dunks: acc.dunks + g.dunks,
        oppPts: acc.oppPts + g.opponentScore,
        oppFgm: acc.oppFgm + g.opponentFgm,
        oppFga: acc.oppFga + g.opponentFga,
        oppTpm: acc.oppTpm + g.opponentTpm,
        oppTpa: acc.oppTpa + g.opponentTpa,
        oppFtm: acc.oppFtm + g.opponentFtm,
        oppFta: acc.oppFta + g.opponentFta,
        oppOreb: acc.oppOreb + g.opponentOreb,
        oppDreb: acc.oppDreb + g.opponentDreb,
        oppAst: acc.oppAst + g.opponentAst,
        oppStl: acc.oppStl + g.opponentStl,
        oppBlk: acc.oppBlk + g.opponentBlk,
        oppTov: acc.oppTov + g.opponentTov,
        oppPf: acc.oppPf + g.opponentPf,
        oppFoulsDrawn: acc.oppFoulsDrawn + g.opponentFoulsDrawn,
        oppPt2in: acc.oppPt2in + g.opponentPt2in,
        oppFb: acc.oppFb + g.opponentFb,
        oppPt2nd: acc.oppPt2nd + g.opponentPt2nd,
        oppPft: acc.oppPft + g.opponentPft,
        oppDunks: acc.oppDunks + g.opponentDunks,
        technicalFouls: acc.technicalFouls + g.technicalFouls,
        basketCounts: acc.basketCounts + g.basketCounts,
        unsportsmanlikeFouls: acc.unsportsmanlikeFouls + g.unsportsmanlikeFouls,
        disqualifyingFouls: acc.disqualifyingFouls + g.disqualifyingFouls,
        assisted2m: acc.assisted2m + g.assisted2m,
        assisted3m: acc.assisted3m + g.assisted3m,
        assistedFtm: acc.assistedFtm + g.assistedFtm,
        paint2m: acc.paint2m + g.paint2m,
        paint2a: acc.paint2a + g.paint2a,
        mid2m: acc.mid2m + g.mid2m,
        mid2a: acc.mid2a + g.mid2a,
        oppTechnicalFouls: acc.oppTechnicalFouls + g.opponentTechnicalFouls,
        oppBasketCounts: acc.oppBasketCounts + g.opponentBasketCounts,
        oppUnsportsmanlikeFouls: acc.oppUnsportsmanlikeFouls + g.opponentUnsportsmanlikeFouls,
        oppDisqualifyingFouls: acc.oppDisqualifyingFouls + g.opponentDisqualifyingFouls,
        oppAssisted2m: acc.oppAssisted2m + g.opponentAssisted2m,
        oppAssisted3m: acc.oppAssisted3m + g.opponentAssisted3m,
        oppAssistedFtm: acc.oppAssistedFtm + g.opponentAssistedFtm,
        oppPaint2m: acc.oppPaint2m + g.opponentPaint2m,
        oppPaint2a: acc.oppPaint2a + g.opponentPaint2a,
        oppMid2m: acc.oppMid2m + g.opponentMid2m,
        oppMid2a: acc.oppMid2a + g.opponentMid2a,
      }),
      { ...EMPTY_TEAM_SEASON_MISC },
    );
}
