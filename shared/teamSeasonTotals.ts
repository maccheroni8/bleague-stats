// チームのシーズン合計（TeamSeasonRawTotals）の合算。個人のUSG%・%-shareスタッツ・個人ORtg/DRtg・PERの分母に使う。
// 集計（scripts/aggregate.ts。Nodeで直接動くため、src/lib は読めない）と画面（src/lib/playerSeasonBoxscore.ts）の両方から使うので shared に置く
import type { OliverBoxStats } from "./formulas.ts";
import type { TeamGameLog, TeamSeasonRawTotals } from "./types.ts";

export const EMPTY_TEAM_TOTALS: TeamSeasonRawTotals = {
  pts: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  tov: 0,
  min: 0,
  ast: 0,
  oreb: 0,
  dreb: 0,
  stl: 0,
  blk: 0,
  pf: 0,
  poss: 0,
  opponentMin: 0,
  opponentPts: 0,
  opponentFgm: 0,
  opponentFga: 0,
  opponentFtm: 0,
  opponentFta: 0,
  opponentOreb: 0,
  opponentDreb: 0,
  opponentTov: 0,
};


/** USG%・%-shareスタッツの分母用に、選手が出場した試合と同じScheduleKeyだけを対象にチーム総計を合算する */
export function sumTeamGameLogsFor(logs: TeamGameLog[], scheduleKeys: Set<string>): TeamSeasonRawTotals {
  const matched = logs.filter((g) => scheduleKeys.has(g.scheduleKey));
  return matched.reduce<TeamSeasonRawTotals>(
    (acc, g) => ({
      pts: acc.pts + g.teamScore,
      fgm: acc.fgm + g.fgm,
      fga: acc.fga + g.fga,
      tpm: acc.tpm + g.tpm,
      tpa: acc.tpa + g.tpa,
      ftm: acc.ftm + g.ftm,
      fta: acc.fta + g.fta,
      tov: acc.tov + g.tov,
      min: acc.min + g.min,
      ast: acc.ast + g.ast,
      oreb: acc.oreb + g.oreb,
      dreb: acc.dreb + g.dreb,
      stl: acc.stl + g.stl,
      blk: acc.blk + g.blk,
      pf: acc.pf + g.pf,
      poss: acc.poss + g.poss,
      opponentMin: acc.opponentMin + g.opponentMin,
      opponentPts: acc.opponentPts + g.opponentScore,
      opponentFgm: acc.opponentFgm + g.opponentFgm,
      opponentFga: acc.opponentFga + g.opponentFga,
      opponentFtm: acc.opponentFtm + g.opponentFtm,
      opponentFta: acc.opponentFta + g.opponentFta,
      opponentOreb: acc.opponentOreb + g.opponentOreb,
      opponentDreb: acc.opponentDreb + g.opponentDreb,
      opponentTov: acc.opponentTov + g.opponentTov,
    }),
    { ...EMPTY_TEAM_TOTALS },
  );
}


export function sumTeamSeasonTotals(a: TeamSeasonRawTotals, b: TeamSeasonRawTotals): TeamSeasonRawTotals {
  return {
    pts: a.pts + b.pts,
    fgm: a.fgm + b.fgm,
    fga: a.fga + b.fga,
    tpm: a.tpm + b.tpm,
    tpa: a.tpa + b.tpa,
    ftm: a.ftm + b.ftm,
    fta: a.fta + b.fta,
    tov: a.tov + b.tov,
    min: a.min + b.min,
    ast: a.ast + b.ast,
    oreb: a.oreb + b.oreb,
    dreb: a.dreb + b.dreb,
    stl: a.stl + b.stl,
    blk: a.blk + b.blk,
    pf: a.pf + b.pf,
    poss: a.poss + b.poss,
    opponentMin: a.opponentMin + b.opponentMin,
    opponentPts: a.opponentPts + b.opponentPts,
    opponentFgm: a.opponentFgm + b.opponentFgm,
    opponentFga: a.opponentFga + b.opponentFga,
    opponentFtm: a.opponentFtm + b.opponentFtm,
    opponentFta: a.opponentFta + b.opponentFta,
    opponentOreb: a.opponentOreb + b.opponentOreb,
    opponentDreb: a.opponentDreb + b.opponentDreb,
    opponentTov: a.opponentTov + b.opponentTov,
  };
}


export function teamOliverBox(team: TeamSeasonRawTotals): OliverBoxStats {
  return {
    min: team.min,
    fgm: team.fgm,
    fga: team.fga,
    fg3m: team.tpm,
    ftm: team.ftm,
    fta: team.fta,
    pts: team.pts,
    ast: team.ast,
    oreb: team.oreb,
    dreb: team.dreb,
    tov: team.tov,
    stl: team.stl,
    blk: team.blk,
    pf: team.pf,
  };
}

/** DRtgの「opponent」役はmin/pts/fgm/fga/ftm/fta/oreb/dreb/tovの9項目のみ使う
 * （ast/fg3m/stl/blk/pfは式が参照しないため0で埋めてよい。shared/formulas.ts参照） */
export function opponentOliverBox(team: TeamSeasonRawTotals): OliverBoxStats {
  return {
    min: team.opponentMin,
    fgm: team.opponentFgm,
    fga: team.opponentFga,
    fg3m: 0,
    ftm: team.opponentFtm,
    fta: team.opponentFta,
    pts: team.opponentPts,
    ast: 0,
    oreb: team.opponentOreb,
    dreb: team.opponentDreb,
    tov: team.opponentTov,
    stl: 0,
    blk: 0,
    pf: 0,
  };
}
