// Stage 2 only: reads raw games; writes reports only with explicit --report-dir (outside data/).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateTimeToShot, sumTts, TTS_CATEGORIES, type TtsShot, type TtsMark } from '../shared/timeToShot.ts';
import type { StoredGame, PlayByPlayEvent, BoxscoreRow } from '../shared/types.ts';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const value=(k:string)=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const bump=(o:Record<string,number>,k:string,n=1)=>{o[k]=(o[k]??0)+n;};
const boxFga=(rows:BoxscoreRow[])=>{const r=rows.find(r=>r.Category===3&&r.PeriodCategory===18);return r?r.PT2A+r.PT3A:null;};
function fixture(rows: [number,string,string|null,number?,string?][]) {
 const es=rows.map(([c,clock,team,q=1,text=''],i)=>({ActionCD1:c,RestTime:clock,TeamID:team,Period:q,PlayText:text,PlayerID1:team,No:i})) as PlayByPlayEvent[];
 return {season:'2026-27',homeTeam:{id:'A'},awayTeam:{id:'B'},raw:{PlayByPlays:es}} as StoredGame;
}
let fixtureChecks=0;
function test(rows: Parameters<typeof fixture>[0], expected: [string,number|null][]) {
 const r=calculateTimeToShot(fixture(rows));
 assert.deepEqual(r.shots.map(s=>[s.category??s.reason,s.seconds]),expected);fixtureChecks++;
}
test([[4,'9:50','A'],[4,'9:30','B']], [['quarter',10],['score',20]]);
test([[6,'9:50','A'],[9,'9:48','B'],[4,'9:40','B']], [['quarter',10],['dreb',8]]);
test([[6,'9:50','A'],[10,'9:48','A'],[6,'9:47','A'],[10,'9:46','A'],[4,'9:46','A']], [['quarter',10],['oreb',1],['oreb',0]]);
test([[13,'9:50','A'],[14,'9:50','B'],[4,'9:40','B']], [['steal',10]]);
test([[14,'9:50','B'],[13,'9:50','A'],[4,'9:40','B']], [['steal',10]]);
test([[13,'9:50','A'],[14,'9:49','B'],[4,'9:40','B']], [['steal',9]]);
test([[13,'9:50','A'],[4,'9:40','B']], [['deadTo',10]]);
test([[22,'9:55','B'],[8,'9:55','A'],[10,'9:53','A'],[4,'9:50','A']], [['oreb',3]]);
test([[22,'9:55','B'],[7,'9:55','A'],[7,'9:55','A'],[4,'9:45','B']], [['score',10]]);
test([[4,'9:55','A'],[7,'9:55','A'],[4,'9:40','B']], [['quarter',5],['score',15]]);
test([[22,'9:50','B'],[88,'9:50',null],[4,'9:30','A']], [['quarter',30]]);
test([[24,'9:50','B'],[7,'9:50','A'],[4,'9:30','A']], [['quarter',30]]);
test([[6,'9:50','A'],[4,'9:30','A']], [['quarter',10],['missing_rebound',null]]);
test([[4,'0:00','A'],[4,'9:50','B',2]], [['quarter',600],['quarter',10]]);
test([[6,'9:50','A'],[9,'9:48','B'],[23,'9:40','B'],[4,'9:30','A']], [['quarter',10],['other',10]]);
test([[22,'9:50','B'],[24,'9:50','B'],[7,'9:50','A'],[4,'9:30','B']], [['ambiguous_ft',null]]);
test([[4,'4:50','A',5],[4,'4:30','B',5]], [['quarter',10],['score',20]]);
test([[4,'9:50','A'],[24,'9:45','B'],[7,'9:45','A'],[4,'9:30','B']], [['quarter',10],['score',20]]);
const ns=calculateTimeToShot(fixture([[13,'9:50','A'],[22,'9:45','A'],[8,'9:45','B'],[9,'9:43','A'],[83,'0:00',null]]));
assert.deepEqual(ns.noShots.map(s=>s.reason),['turnover','free_throws','quarter_end']);fixtureChecks++;
const sides=calculateTimeToShot(fixture([[4,'9:50','A'],[4,'9:30','B'],[4,'9:55','B',2]]));
assert.equal(sumTts(sides.shots,'A').quarter.seconds,10);
assert.equal(sumTts(sides.shots,'B').score.seconds,20);
assert.equal(sumTts(sides.shots,'B',[2]).quarter.seconds,5);fixtureChecks++;
assert.throws(()=>calculateTimeToShot({...fixture([]),season:'2019-20'}));fixtureChecks++;
const probe=calculateTimeToShot(fixture([[13,'9:50','A'],[4,'9:45','B',1,'ファストブレイク']]));
assert.equal(probe.diagnostics.filter(d=>d.reason==='unpaired_to_fastbreak_no_stop').length,1);fixtureChecks++;

interface SeasonAudit {
 season:string; games:number; noPbp:string[]; unfinished:string[]; boxFga:number; pbpFga:number; measured:number;
 excluded:Record<string,number>; noShots:Record<string,number>; other:Record<string,number>; diagnostics:Record<string,number>;
 over24:Record<string,number>; over24Category:Record<string,number>; mismatch:unknown[]; teams:Record<string,unknown>;
 checks:number; invalidBox:number; over24Seconds:Record<string,number>; maxSeconds:number;
}
const seasons=readdirSync(path.join(ROOT,'data')).filter(s=>/^20\d\d-\d\d$/.test(s)&&s>=(args.includes('--legacy-research')?'2016-17':'2020-21')).sort();
const report:{definition:string;fixtureChecks:number;seasons:SeasonAudit[];examples:Record<string,unknown[]>;over24Examples:Record<string,unknown[]>;diagnosticExamples:Record<string,unknown[]>;sourceCommit:string}={definition:'stage2-v1; FG only; all stored completed games, including regular/postseason/special games; no B.ONE; no garbage/heave removal',fixtureChecks,seasons:[],examples:{},over24Examples:{},diagnosticExamples:{},sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim()};
function keep(map:Record<string,unknown[]>,key:string,item:unknown,limit=3){const a=map[key]??=[];if(a.length<limit)a.push(item);}
function timeline(events:TtsMark[],start:TtsMark|null,end:TtsMark){return events.filter(e=>e.period===end.period && e.index>=(start?.index??Math.max(0,end.index-8)) && e.index<=end.index && ![84,85,86,87,12,15].includes(e.code));}
for(const season of seasons) {
 if(args.includes('--legacy-research') && season>='2020-21')continue;
 if(value('--season') && value('--season')!==season)continue;
 const a:SeasonAudit={season,games:0,noPbp:[],unfinished:[],boxFga:0,pbpFga:0,measured:0,excluded:{},noShots:{},other:{},diagnostics:{},over24:{},over24Category:{},mismatch:[],teams:{},checks:0,invalidBox:0,over24Seconds:{},maxSeconds:0};
 const teamShots=new Map<string,TtsShot[]>();const names=new Map<string,string>();
 for(const file of readdirSync(path.join(ROOT,'data',season,'games')).filter(f=>f.endsWith('.json.gz')).sort()) {
  const g=JSON.parse(gunzipSync(readFileSync(path.join(ROOT,'data',season,'games',file))).toString()) as StoredGame;
  if(!g.gameEndedFlg){a.unfinished.push(String(g.scheduleKey));continue;}
  a.games++;
  const boxes=[boxFga(g.raw.HomeBoxscores),boxFga(g.raw.AwayBoxscores)];
  for(const b of boxes){if(b===null)a.invalidBox++;else a.boxFga+=b;}
  if(!g.raw.PlayByPlays?.length){a.noPbp.push(String(g.scheduleKey));bump(a.excluded,'no_pbp_fga',(boxes[0]??0)+(boxes[1]??0));continue;}
  const r=calculateTimeToShot(g,{legacyResearch:args.includes('--legacy-research')});
  const suspectTo=new Set(r.diagnostics.filter(d=>d.reason==='unpaired_to_nearby_steal'||d.reason==='unpaired_to_fastbreak_no_stop').map(d=>d.event.index));
  bump(a.diagnostics,'suspect_to_union',suspectTo.size);a.pbpFga+=r.shots.length;
  const rawFG=g.raw.PlayByPlays.filter(e=>[1,2,3,4,5,6].includes(e.ActionCD1));
  assert.equal(r.shots.length,rawFG.length);a.checks++;
  for(const [k,team] of [g.homeTeam,g.awayTeam].entries()){
   names.set(team.id,team.name);const shots=r.shots.filter(s=>s.team===team.id);
   const box=boxes[k]; if(box!==null&&box!==shots.length)a.mismatch.push({game:g.scheduleKey,team:team.id,box,pbp:shots.length,delta:shots.length-(box??0)});
   const prev=teamShots.get(team.id)??[];prev.push(...shots);teamShots.set(team.id,prev);
   const whole=sumTts(shots);const periods=[...new Set(shots.map(s=>s.period))];
   for(const c of TTS_CATEGORIES){
    const parts=periods.map(q=>sumTts(shots,undefined,[q])[c]);
    assert.equal(parts.reduce((n,p)=>n+p.count,0),whole[c].count);
    assert.equal(parts.reduce((n,p)=>n+p.seconds,0),whole[c].seconds);
   }
   const own=sumTts(r.shots,team.id);assert.deepEqual(own,whole);
   const opponentId=team.id===g.homeTeam.id?g.awayTeam.id:g.homeTeam.id;
   assert.deepEqual(sumTts(r.shots,opponentId),sumTts(r.shots.filter(s=>s.team!==team.id)));
   const n=Object.values(whole).reduce((n,b)=>n+b.count,0);
   assert.equal(n,shots.filter(s=>s.seconds!==null).length);
   const first=TTS_CATEGORIES.filter(c=>c!=='oreb').reduce((n,c)=>n+whole[c].count,0);
   assert.equal(first+whole.oreb.count,n);
   // Independently group primitive shot rows into halves/OT; never average averages.
   for(const ps of [[1,2],[3,4],periods.filter(q=>q>=5)]) {
    const selected=shots.filter(s=>ps.includes(s.period)&&s.seconds!==null);
    const totals=sumTts(shots,undefined,ps);
    assert.equal(Object.values(totals).reduce((n,x)=>n+x.count,0),selected.length);
    assert.equal(Object.values(totals).reduce((n,x)=>n+x.seconds,0),selected.reduce((n,s)=>n+s.seconds!,0));
   }
   a.checks+=24;
  }
  for(const s of r.shots){
   if(s.seconds===null){bump(a.excluded,s.reason);keep(report.diagnosticExamples,`excluded:${s.reason}`,{season,game:g.scheduleKey,...s,timeline:timeline(r.events,s.start,s.end)});continue;}
   a.measured++;a.maxSeconds=Math.max(a.maxSeconds,s.seconds);if(s.category==='other')bump(a.other,s.reason);
   if(season==='2026-27')keep(report.examples,s.category!,{game:g.scheduleKey,...s,timeline:timeline(r.events,s.start,s.end)});
   if(s.seconds>=60)keep(report.diagnosticExamples,'60seconds_plus',{season,game:g.scheduleKey,...s,timeline:timeline(r.events,s.start,s.end)},20);
   if(s.seconds>24){
    const reason=s.flags.includes('foul')?'foul':s.flags.includes('timeout')?'timeout_only':s.category==='score'?'score_no_foul_or_timeout':'no_recorded_extension';
    bump(a.over24Seconds,s.seconds<=29?'25-29':s.seconds<=39?'30-39':s.seconds<=59?'40-59':'60+');bump(a.over24,reason);bump(a.over24Category,s.category!);
    keep(report.over24Examples,reason,{season,game:g.scheduleKey,...s,timeline:timeline(r.events,s.start,s.end)},5);
   }
  }
  for(const s of r.noShots)bump(a.noShots,s.reason);
  for(const d of r.diagnostics){bump(a.diagnostics,d.reason);keep(report.diagnosticExamples,d.reason,{season,game:g.scheduleKey,...d,timeline:r.events.filter(e=>e.period===d.event.period && e.index>=d.event.index-5 && e.index<=d.event.index+12)},5);}
 }
 for(const [team,shots] of teamShots){const groups=sumTts(shots);const total=Object.values(groups).reduce((p,x)=>({count:p.count+x.count,seconds:p.seconds+x.seconds}),{count:0,seconds:0});a.teams[team]={name:names.get(team),pbp:shots.length,total,groups};}
 report.seasons.push(a);
 console.log(`${season}: measured ${a.measured}/${a.boxFga} (${(100*a.measured/a.boxFga).toFixed(3)}%); PBP ${a.pbpFga}; mismatched team-games ${a.mismatch.length}; >24 ${Object.values(a.over24).reduce((x,y)=>x+y,0)}; invariants PASS (${a.checks})`);
}
console.log(`Fixtures PASS (${fixtureChecks}). Data discrepancies are reported separately, not asserted away.`);
if(value('--report-dir')){
 const dir=path.resolve(value('--report-dir')!);if(dir===path.join(ROOT,'data')||dir.startsWith(path.join(ROOT,'data')+path.sep))throw new Error('Reports must be outside data/');
 mkdirSync(dir,{recursive:true});writeFileSync(path.join(dir,'audit.json'),JSON.stringify(report,null,2)+'\n');
}
