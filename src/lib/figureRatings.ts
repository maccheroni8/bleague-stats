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
    const ranged = filterGameLogs(logsByTeam.get(team.teamId) ?? [], {range:query.range, includePlayoffs:true}, undefined, undefined, undefined, undefined, query.category);
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
  const step = 5; // グリッド線と目盛りは常に5刻み。データが広がっても範囲だけ広げる
  return {min,max,ticks:Array.from({length:Math.floor((max-min)/step)+1},(_,i)=>min+i*step)};
}
export const DIVISION_RATING_COLORS: Record<Division | "unknown",string> = {
  east:"#2878b5",central:"#218357",west:"#cd681b",north:"#8454a3",south:"#95670f",unknown:"#767676",
};

/** 上下3枠の境目と同率なら全て表示。順位は地区絞り込み前の実順位。 */
export function ratingBadges(point: RatingPoint, points: readonly RatingPoint[]): string[] {
  return RATING_KEYS.filter(key=>{
    const ranks=points.map(p=>p.ranks[key]).sort((a,b)=>a-b);
    const bottom=ranks[Math.max(0,ranks.length-3)]??Infinity;
    return point.ranks[key]<=3 || point.ranks[key]>=bottom;
  }).map(key=>`#${point.ranks[key]} ${RATING_LABELS[key]}`);
}

export interface RatingLabelBox { id:string; x:number; y:number; width:number; height:number; anchorX:number; anchorY:number; leader:boolean; texts:string[] }
type Rect = {x:number;y:number;width:number;height:number};
export function ratingLabelLayout(points: readonly RatingPoint[], all: readonly RatingPoint[], size:number, mobile=false) {
  const domain=ratingDomain(all);
  const pos=(v:number)=>(v-domain.min)/(domain.max-domain.min)*size;
  const radius=30, font=mobile?9:10, gap=4;
  const occupied:Rect[]=points.map(p=>({x:pos(p.ortg)-radius,y:pos(p.drtg)-radius,width:radius*2,height:radius*2}));
  occupied.push(...[0,size-110].flatMap(x=>[0,size-24].map(y=>({x,y,width:110,height:24}))));
  const intersects=(a:Rect,b:Rect)=>a.x<b.x+b.width+gap&&a.x+a.width+gap>b.x&&a.y<b.y+b.height+gap&&a.y+a.height+gap>b.y;
  occupied.push({x:0,y:size,width:size,height:55}); // 横軸の目盛り・説明も避ける
  const labels:RatingLabelBox[]=[];
  let bottom=size;
  for(const point of points) {
    const texts=ratingBadges(point,all);if(!texts.length)continue;
    const width=Math.ceil(Math.max(...texts.map(t=>t.length))*font*.7+8),height=texts.length*(font+4)+4;
    const anchorX=pos(point.ortg),anchorY=pos(point.drtg);
    const candidates:Rect[]=[
      {x:anchorX+radius+gap,y:anchorY-height/2,width,height},
      {x:anchorX-radius-gap-width,y:anchorY-height/2,width,height},
      {x:anchorX-width/2,y:anchorY-radius-gap-height,width,height},
      {x:anchorX-width/2,y:anchorY+radius+gap,width,height},
    ];
    // 近傍に空きが無ければ全面を探索。密集したスマホは図下の余白も使い、文字を重ねない。
    const grid:Rect[]=[];
    for(let y=4;y<size+500;y+=8)for(let x=4;x+width<=size-4;x+=8)grid.push({x,y,width,height});

    const fits=(r:Rect)=>r.x>=4&&r.x+r.width<=size-4&&r.y>=4&&!occupied.some(o=>intersects(r,o));
    const local=candidates.find(fits);
    let box=local,bestDistance=Infinity;
    if(!box)for(const candidate of grid) {
      const distance=Math.hypot(candidate.x+width/2-anchorX,candidate.y+height/2-anchorY);
      if(distance<bestDistance&&fits(candidate)){box=candidate;bestDistance=distance;}
    }
    box??={x:4,y:Math.max(bottom+8,size+60),width,height};
    occupied.push(box);bottom=Math.max(bottom,box.y+height+4);
    labels.push({...box,id:point.teamId,anchorX,anchorY,leader:!local,texts});
  }
  return {labels,height:bottom};
}
