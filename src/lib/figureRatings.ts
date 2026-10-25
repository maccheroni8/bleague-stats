// 画面専用。全チームスタッツと同じ試合の絞り方・合計・Advanced列を使う。
import type { Category, Division, DivisionHistoryFile, TeamGameLog } from "../../shared/types";
import { filterByGameType, type SeasonGameTypeFilter } from "../../shared/gameType";
import { filterGameLogs, type SituationalRange } from "./situational";
import { buildAdvancedColumns, sumTeamGameLogs, type AllTeamsRow } from "./teamStatsColumns";
import { averageTotals } from "./leagueAverage";
import { rankPositions } from "./seasonCompare";

export const RATING_KEYS = ["ortg", "drtg", "netrtg"] as const;
export type RatingKey = typeof RATING_KEYS[number];
export const RATING_LABELS: Record<RatingKey, string> = { ortg: "ORtg", drtg: "DRtg", netrtg: "NetRtg" };
const columns = buildAdvancedColumns("perGame", "own");
export const ratingColumn = (key: RatingKey) => columns.find(column => column.key === key)!;
export interface RatingTeam { teamId: string; teamName: string }
export interface RatingPoint extends RatingTeam {
  division?: Division;
  games: number; firstDate: string; lastDate: string;
  ortg: number; drtg: number; netrtg: number;
  ranks: Record<RatingKey, number>;
  row: AllTeamsRow;
}
export interface RatingQuery { season: string; category: Category; range: SituationalRange; gameType: SeasonGameTypeFilter }
export function ratingMetrics(row: AllTeamsRow) {
  return Object.fromEntries(RATING_KEYS.map(key => [key, Number(ratingColumn(key).sortValue(row))])) as Record<RatingKey, number>;
}
export function buildRatingScatter(teams: readonly RatingTeam[], logsByTeam: ReadonlyMap<string, TeamGameLog[]>, divisions: DivisionHistoryFile | null, query: RatingQuery) {
  const points: RatingPoint[] = [];
  const omitted: string[] = [];
  for (const team of teams) {
    // 全チームスタッツと同じ順序: 期間を選び、その後に試合区分を適用する。
    const ranged = filterGameLogs(logsByTeam.get(team.teamId) ?? [], {range:query.range, includePlayoffs:true});
    const scoped = filterByGameType(ranged, query.gameType);
    const row: AllTeamsRow = { team, gamesPlayed:scoped.length, wins:scoped.filter(g=>g.win).length, losses:scoped.filter(g=>!g.win).length, totals:sumTeamGameLogs(scoped) };
    const metrics = ratingMetrics(row);
    if (!row.gamesPlayed || !(row.totals.poss > 0) || !RATING_KEYS.every(key=>Number.isFinite(metrics[key]))) { omitted.push(team.teamId); continue; }
    points.push({...team, ...metrics, division:divisions?.[query.category]?.[query.season]?.[team.teamId], games:scoped.length,
      firstDate:scoped[0]!.date, lastDate:scoped.at(-1)!.date, ranks:{ortg:0,drtg:0,netrtg:0}, row});
  }
  // 順位は地区で絞る前のリーグ全体。同じ表示値は同順位、次を飛ばす（ランキングと共通）。
  for (const key of RATING_KEYS) {
    const column = ratingColumn(key);
    const sorted = [...points].sort((a,b)=>key === "drtg" ? a[key]-b[key] : b[key]-a[key]);
    const ranks = rankPositions(sorted.map(point=>column.format!(point.row)));
    sorted.forEach((point,i)=>{point.ranks[key]=ranks[i]!;});
  }
  const leagueRow: AllTeamsRow | null = points.length ? {
    team:{teamId:"league",teamName:"リーグ平均"}, gamesPlayed:points.reduce((sum,p)=>sum+p.games,0)/points.length,
    wins:0,losses:0,totals:averageTotals(points.map(point=>point.row.totals)),
  } : null;
  return {points, omitted, league:leagueRow ? ratingMetrics(leagueRow) : null, leagueRow};
}
export function ratingDomain(points: readonly Pick<RatingPoint,"ortg"|"drtg">[]) {
  const values = points.flatMap(point=>[point.ortg,point.drtg]);
  if (!values.length) return {min:80,max:120,ticks:[80,90,100,110,120]};
  const min = Math.floor((Math.min(...values)-4)/5)*5;
  const max = Math.ceil((Math.max(...values)+4)/5)*5;
  const step = Math.max(5,Math.ceil((max-min)/7/5)*5);
  return {min,max,ticks:Array.from({length:Math.floor((max-min)/step)+1},(_,i)=>min+i*step)};
}
export const DIVISION_RATING_COLORS: Record<Division | "unknown",string> = {
  east:"#2878b5",central:"#218357",west:"#cd681b",north:"#8454a3",south:"#95670f",unknown:"#767676",
};
