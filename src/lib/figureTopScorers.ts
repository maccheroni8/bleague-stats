// 画面専用。既存の試合ログと個人詳細の列定義から計算する。
import type { Category, Division, DivisionHistoryFile, PlayerGameLog, PlayerSummary, TeamGameLog } from '../../shared/types';
import type { SeasonRegistrationFile } from '../../shared/registration';
import { filterByGameType, type SeasonGameTypeFilter } from '../../shared/gameType';
import { filterGameLogs, type SituationalRange } from './situational';
import { sumPlayerGameLogs, sumTeamGameLogsFor, buildSeasonBoxscoreCtx, SEASON_ADVANCED_COLUMNS, onCourtSharePct } from './playerSeasonBoxscore';
import { onOffTotalsFromLogs } from './playerOnOffColumns';
import { changedRegistrations, scopedPlayerMatches, scopeLogsByClassification } from './registrationScopeCore';
import { figureClassGroup, type FigureClass } from './figureAge';
import { statJa } from './statNames';
export const SCORER_AXES = ['win', 'min', 'share', 'efg', 'on', 'ppp', 'pps'] as const;
export type ScorerAxis = typeof SCORER_AXES[number];
export const SCORER_LABELS: Record<ScorerAxis,string> = {win:statJa('出場試合の勝率'),min:'出場時間',share:'%PTS',efg:'eFG%',on:'On ORtg',ppp:'PPP',pps:'PPS'};
export const scorerAxisTitle = (axis:ScorerAxis) => axis === 'win' || axis === 'min' ? SCORER_LABELS[axis] : statJa(SCORER_LABELS[axis]);
export interface ScorerPoint {
  id:string; playerId:string; name:string; teamId:string; teamName:string; division?:Division;
  games:number; teamGames:number; wins:number; pts:number; totalPts:number; minutes:number;
  values:Record<ScorerAxis,number|null>;
}
export interface ScorerData {
  players:PlayerSummary[]; teams:{teamId:string;teamName:string}[];
  playerLogs:Map<string,PlayerGameLog[]>; teamLogs:Map<string,TeamGameLog[]>;
  divisions:DivisionHistoryFile|null; registrations:SeasonRegistrationFile|null;
}
export interface ScorerQuery {season:string;category:Category;range:SituationalRange;gameType:SeasonGameTypeFilter;classification:FigureClass;minRatio:number}
export function buildTopScorers(data:ScorerData,q:ScorerQuery):ScorerPoint[] {
  const changed=changedRegistrations(data.registrations),group=figureClassGroup(q.classification);
  const points:ScorerPoint[]=[];
  const ownTeams=new Map<string,string>();
  for(const [teamId,list] of data.teamLogs)for(const g of list)ownTeams.set(`${g.scheduleKey}|${g.isHome}`,teamId);
  const ownTeamOf=(g:{scheduleKey:string;isHome:boolean})=>ownTeams.get(`${g.scheduleKey}|${g.isHome}`);
  for(const team of data.teams){
    const allTeamLogs=data.teamLogs.get(team.teamId)??[];
    const scoped=filterByGameType(filterGameLogs(allTeamLogs,{range:q.range,includePlayoffs:true},undefined,undefined,undefined,undefined,q.category),q.gameType);
    if(!scoped.length)continue;
    const byKey=new Map(scoped.map(g=>[g.scheduleKey,g]));
    const candidates:ScorerPoint[]=[];
    for(const p of data.players){
      if(!scopedPlayerMatches(p,group,changed))continue;
      const logs=scopeLogsByClassification(data.playerLogs.get(p.playerId)??[],p.playerId,group,changed)
        .filter(g=>g.min>0&&byKey.get(g.scheduleKey)?.isHome===g.isHome);
      if(!logs.length||logs.length/scoped.length*100<q.minRatio)continue;
      const raw=sumPlayerGameLogs(logs);
      // 条件ありは個人詳細のシチュエーションと同じく本人の出場試合のチーム合計。
      const full=q.range.kind==='all'&&q.gameType==='regular'&&!(group!=='all'&&changed.has(p.playerId));
      // USG%・PPP・DRtg の分母は、本人が出場した試合のチーム合計（DESIGN.md 333章）
      const teamTotals=sumTeamGameLogsFor(scoped,new Set(logs.map(g=>g.scheduleKey)));
      const ctx=buildSeasonBoxscoreCtx(raw,teamTotals,'perGame',Number(q.season.slice(0,4)));
      const ortg=SEASON_ADVANCED_COLUMNS.find(c=>c.key==='ortg')!;
      const on=q.season>='2020-21'?onOffTotalsFromLogs(logs,g=>byKey.get(g.scheduleKey)):null;
      const wins=logs.filter(g=>g.win).length;
      const singleTeam=(data.playerLogs.get(p.playerId)??[]).filter(g=>g.min>0&&g.gameType==='regular').length===logs.length;
      candidates.push({id:`${p.playerId}@${team.teamId}`,playerId:p.playerId,name:p.name,...team,
        division:data.divisions?.[q.category]?.[q.season]?.[team.teamId],games:logs.length,teamGames:scoped.length,wins,
        pts:raw.pts/raw.gamesPlayed,totalPts:raw.pts,minutes:raw.min,
        values:{win:100*wins/logs.length,min:raw.gamesPlayed>0?raw.min/raw.gamesPlayed:null,share:q.season>='2020-21'?onCourtSharePct(raw,raw.ocPts,raw.ocTeamPts):null,
          efg:raw.fga>0?100*(raw.fgm+0.5*raw.tpm)/raw.fga:null,
          on:on&&on.on.ownPoss>0?100*on.on.ownPts/on.on.ownPoss:null,
          ppp:full&&singleTeam?(p.advanced.ppp??null):ortg.format(ctx,'perGame')==='-'?null:ortg.value(ctx,'perGame')/100,
          pps:raw.fga>0?raw.pts/raw.fga:null}});
    }
    candidates.sort((a,b)=>b.pts-a.pts||b.totalPts-a.totalPts||b.minutes-a.minutes||a.playerId.localeCompare(b.playerId,undefined,{numeric:true}));
    points.push(...candidates.slice(0,3));
  }
  return points;
}
export function scorerDomain(values:(number|null)[],axis:ScorerAxis|'pts'){
  const base:Record<ScorerAxis|'pts',[number,number,number]>={pts:[0,30,5],win:[0,100,5],min:[0,40,5],share:[0,50,5],efg:[30,80,5],on:[70,140,5],ppp:[0.5,1.5,0.05],pps:[0.5,2,0.05]};
  const [lo,hi,step]=base[axis],valid=values.filter((v):v is number=>v!==null&&Number.isFinite(v));
  const min=Math.min(lo,...valid.map(v=>Math.floor(v/step)*step)),max=Math.max(hi,...valid.map(v=>Math.ceil(v/step)*step));
  return {min,max,step,ticks:Array.from({length:Math.round((max-min)/step)+1},(_,i)=>Number((min+i*step).toFixed(6)))};
}
