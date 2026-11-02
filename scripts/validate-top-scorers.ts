import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildTopScorers, scorerDomain, type ScorerData, type ScorerQuery } from '../src/lib/figureTopScorers';
import { sumPlayerGameLogs, SEASON_ADVANCED_COLUMNS, SEASON_SCORING_COLUMNS, buildSeasonBoxscoreCtx, sumTeamGameLogsFor } from '../src/lib/playerSeasonBoxscore';
import { onOffTotalsFromLogs, SEASON_ONOFF_COLUMNS } from '../src/lib/playerOnOffColumns';
import type { PlayerGameLog, PlayerSummary, TeamGameLog } from '../shared/types';
function read<T>(p:string):T {const f=existsSync(p)?p:`${p}.gz`;return JSON.parse((f.endsWith('.gz')?gunzipSync(readFileSync(f)):readFileSync(f)).toString()) as T;}
const reports=[];
for(const season of readdirSync('data').filter(s=>/^20\d\d-\d\d$/.test(s)).sort()) for(const category of ['premier','one'] as const){
 const dir=`data/${season}${category==='one'?'/one':''}`;
 if(!existsSync(`${dir}/players.json`)&&!existsSync(`${dir}/players.json.gz`))continue;
 const players=read<PlayerSummary[]>(`${dir}/players.json`),teams=read<ScorerData['teams']>(`${dir}/teams.json`);
 const data:ScorerData={players,teams,playerLogs:new Map(players.map(p=>[p.playerId,read<PlayerGameLog[]>(`${dir}/player-games/${p.playerId}.json`)])),teamLogs:new Map(teams.map(t=>[t.teamId,read<TeamGameLog[]>(`${dir}/team-games/${t.teamId}.json`)])),divisions:null,registrations:existsSync(`${dir}/registrations.json`)?read(`${dir}/registrations.json`):null};
 const query:ScorerQuery={season,category,range:{kind:'all'},gameType:'regular',classification:'all',minRatio:85};
 const points=buildTopScorers(data,query);
 // 選手の試合ログだけから数え直した、出場率85%のときの各チーム上位3人（平均得点の並びの値）と一致すること
 for(const t of teams){
  const tl=data.teamLogs.get(t.teamId)!.filter(g=>g.gameType==='regular'),home=new Map(tl.map(g=>[g.scheduleKey,g.isHome]));
  if(!tl.length)continue;
  const own=players.flatMap(pl=>{const lg=data.playerLogs.get(pl.playerId)!.filter(g=>g.min>0&&g.gameType==='regular'&&home.get(g.scheduleKey)===g.isHome);return lg.length&&lg.length/tl.length*100>=85?[lg.reduce((a,g)=>a+g.pts,0)/lg.length]:[];}).sort((a,b)=>b-a).slice(0,3);
  const got=points.filter(p=>p.teamId===t.teamId).map(p=>p.pts);
  assert.equal(got.length,own.length,`${season} ${t.teamName} 人数`);
  got.forEach((v,i)=>assert(Math.abs(v-own[i]!)<1e-9,`${season} ${t.teamName} 上位${i+1}の平均得点`));
 }
 if(season==='2026-27'&&category==='premier'){
  const team=teams[0]!,templates=data.teamLogs.get(team.teamId)!.filter(g=>g.gameType==='regular').slice(0,2);
  const source=players.find(p=>p.teamId===team.teamId)!;
  const example=data.playerLogs.get(source.playerId)!.find(g=>g.min>0)!;
  const synthetic:ScorerData={...data,teams:[team],teamLogs:new Map([[team.teamId,templates]]),players:[0,1,2,3].map(i=>({...source,playerId:`test${i}`,advanced:{...source.advanced,ppp:undefined}})),playerLogs:new Map([0,1,2,3].map(i=>[`test${i}`,templates.slice(0,i===0?1:2).map(t=>({...example,scheduleKey:t.scheduleKey,date:t.date,isHome:t.isHome,gameType:t.gameType,pts:i===0?100:i===3?19:20,min:i===2?30:20}))]))};
  assert.equal(buildTopScorers(synthetic,{...query,minRatio:0})[0]!.playerId,'test0');
  const eligible=buildTopScorers(synthetic,{...query,minRatio:100});
  assert.deepEqual(eligible.map(p=>p.playerId),['test2','test1','test3'],'下限で除外してから3人を選び、同点は出場時間で決める');
 }

 assert(points.length<=teams.length*3);
 let verified=0;
 for(const p of points){
  const source=players.find(s=>s.playerId===p.playerId)!;
  const logs=data.playerLogs.get(p.playerId)!.filter(g=>g.min>0&&g.gameType==='regular');
  if(logs.length!==p.games||source.teamId!==p.teamId)continue;
  assert(Math.abs(source.perGame.pts-p.pts)<1e-8,`${season} ${p.name} PTS`);
  assert(Math.abs(100*logs.filter(g=>g.win).length/logs.length-p.values.win!)<1e-8);
  assert(Math.abs(source.shooting.efgPct*100-p.values.efg!)<1e-8);
  const tl=data.teamLogs.get(p.teamId)!;
  const raw=sumPlayerGameLogs(logs),ctx=buildSeasonBoxscoreCtx(raw,sumTeamGameLogsFor(tl,new Set(tl.filter(g=>g.gameType==='regular').map(g=>g.scheduleKey))),'perGame',Number(season.slice(0,4)));
  const pps=SEASON_ADVANCED_COLUMNS.find(c=>c.key==='pps')!;
  assert(Math.abs(pps.value(ctx,'perGame')-p.values.pps!)<1e-8);
  const share=SEASON_SCORING_COLUMNS.find(c=>c.label==='%PTS')!;
  if(p.values.share!==null) assert(Math.abs(share.value(ctx,'perGame')-p.values.share)<1e-8);
  if(p.values.on!==null){ctx.onOff=onOffTotalsFromLogs(logs,g=>tl.find(t=>t.scheduleKey===g.scheduleKey));const col=SEASON_ONOFF_COLUMNS.find(c=>c.label==='On ORtg')!;assert(Math.abs(col.value(ctx,'perGame')-p.values.on)<1e-8);}
  if(p.values.ppp!==null)assert.equal(source.advanced.ppp,p.values.ppp);
  verified++;
 }
 for(const range of [{kind:'recent',n:5},{kind:'recent',n:10},{kind:'dateRange',start:`${season.slice(0,4)}-10-01`,end:`${season.slice(0,4)}-10-31`}] as ScorerQuery['range'][]){
   const scoped=buildTopScorers(data,{...query,range,minRatio:60});
   for(const p of scoped){assert(p.games/p.teamGames>=0.6);assert(p.games<=p.teamGames);}
 }
 const japanese=buildTopScorers(data,{...query,classification:'jp'});
 for(const p of japanese){const original=points.find(o=>o.id===p.id);if(original&&p.games===original.games)assert.equal(p.values.ppp,original.values.ppp,'登録区分だけで同じ出場試合のPPPを変えない');}
 const photos=points.filter(p=>existsSync(`data/player-photos/${p.playerId}.webp`));
 reports.push({season,category,teams:teams.length,points:points.length,photos:photos.length,missing:points.filter(p=>!photos.includes(p)).map(p=>`${p.name} (${p.playerId})`),verified,samples:points.slice(0,3)});
 console.log(`${season} ${category}: ${photos.length}/${points.length} photos; ${verified} players verified`);
}
assert(scorerDomain([42],'pts').max>=42);
assert.equal(scorerDomain([20],'pts').max,30);
assert(scorerDomain([null],'on').ticks.length>0);
if(process.env.TOP_SCORERS_REPORT)writeFileSync(process.env.TOP_SCORERS_REPORT,JSON.stringify(reports,null,2));
console.log('Top scorers: PASS');
