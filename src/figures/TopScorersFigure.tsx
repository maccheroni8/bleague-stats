import { useMemo, useRef, useState } from 'react';
import { fetchPlayers, fetchTeams, fetchPlayerGameLogs, fetchTeamGameLogs, fetchDivisionHistory, fetchSeasonRegistrations, playerPhotoUrl,  } from '../lib/data';
import { useJsonData } from '../lib/useJsonData';
import type { Division } from '../../shared/types';
import { divisionListParam, enumParam, numberParam, situationalParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { classificationAxis, divisionMultiAxis, gameTypeAxis, situationalAxes, type FilterAxis } from '../lib/filterAxes';
import type { SituationalFilter } from '../lib/situational';
import type { SeasonGameTypeFilter } from '../../shared/gameType';
import { seasonGameTypeLabels } from '../../shared/gameType';
import { figureClassGroup } from '../lib/figureAge';
import { CLASSIFICATION_PARAM } from '../lib/urlFilterParams';
import { classificationFilterLabel, splitClassificationBlocked, SPLIT_CLASSIFICATION_UNAVAILABLE_REASON } from '../lib/classificationFilter';
import { buildTopScorers, scorerDomain, SCORER_AXES, SCORER_LABELS, scorerAxisTitle, type ScorerAxis, type ScorerPoint } from '../lib/figureTopScorers';
import { DIVISION_LABELS, divisionOrder } from '../lib/divisionGroups';
import { DIVISION_RATING_COLORS } from '../lib/figureRatings';
import { surnameOf } from '../lib/playerSurname';
import { useTeamLabel } from '../lib/teamLabel';
import { usePlayerLabel } from '../lib/playerLabel';
import { statDescription } from '../lib/statDescriptions';
import { formatDecimal, formatPct100, formatWinPct } from '../lib/format';
import { situationalFilterLabels } from '../lib/conditionLabels';
import { EligibilitySlider } from '../components/EligibilitySlider';
import { FilterBar } from '../components/FilterBar';
import { ExportTarget } from '../components/ExportTarget';
import { ExportImageButton } from '../components/ExportImageButton';
import { ConditionTitle } from '../components/ConditionTitle';
import type { FigureProps } from './catalog';
import './RatingsScatterFigure.css';
import './ScoringScatterFigure.css';
import './TopScorersFigure.css';
const DEFAULT:SituationalFilter={range:{kind:'all'}};
const rangeCodec:UrlCodec<SituationalFilter>={keys:['rng'],read:p=>{const range=situationalParam.read(p)?.range;return range&&(range.kind!=='recent'||range.n===5||range.n===10)?{range}:undefined;},write:(p,v)=>situationalParam.write(p,{range:v.range})};
const gameCodec=enumParam<SeasonGameTypeFilter>('gt',['regular','playoff','both'],'regular');
const clsCodec=CLASSIFICATION_PARAM;
const xCodec=enumParam<ScorerAxis>('sx',SCORER_AXES,'win');
const DEFAULT_RATIO=85;
const ratioCodec=numberParam('sgp',DEFAULT_RATIO,{min:0,max:100});
const divisionCodec=divisionListParam('dv');
const NO_DIVISIONS:Division[]=[];
const valueText=(v:number|null,axis:ScorerAxis)=>v===null?'—':axis==='win'?formatWinPct(v/100):axis==='share'||axis==='efg'?formatPct100(v):formatDecimal(v);
export default function TopScorersFigure({season,category}:FigureProps){
 const [filter,setFilter]=useUrlState(rangeCodec,DEFAULT),[gameType,setGameType]=useUrlState(gameCodec,'regular');
 const [classification,setClassification]=useUrlState(clsCodec,'all'),[xParam,setX]=useUrlState(xCodec,'win');
 const [minRatio,setMinRatio]=useUrlState(ratioCodec,DEFAULT_RATIO),[division,setDivision]=useUrlState(divisionCodec,NO_DIVISIONS);
 const [team,setTeam]=useState('all'),[hover,setHover]=useState<string|null>(null);
 const [sort,setSort]=useState<{key:'team'|'pts'|'games'|ScorerAxis;desc:boolean}>({key:'team',desc:false});
 const target=useRef<HTMLDivElement>(null),teamLabel=useTeamLabel();
 const request=useJsonData(async()=>{
   const [players,teams,divisions,registrations]=await Promise.all([fetchPlayers(season,category),fetchTeams(season,category),fetchDivisionHistory(),season>='2026-27'?fetchSeasonRegistrations(season,category):Promise.resolve(null)]);
   const [playerLogs,teamLogs]=await Promise.all([Promise.all(players.map(async p=>[p.playerId,await fetchPlayerGameLogs(season,p.playerId,category)] as const)),Promise.all(teams.map(async t=>[t.teamId,await fetchTeamGameLogs(season,t.teamId,category)] as const))]);
   return {players,teams,divisions,registrations,playerLogs:new Map(playerLogs),teamLogs:new Map(teamLogs)};
 },[season,category]);
 const points=useMemo(()=>request.data?buildTopScorers(request.data,{season,category,range:filter.range,gameType,classification,minRatio}):[],[request.data,season,category,filter,gameType,classification,minRatio]);
 const playerLabel=usePlayerLabel(points.map(p=>p.name));
 const axesAvailable=SCORER_AXES.filter(a=>season>='2020-21'||(a!=='on'&&a!=='share'));
 const axis=axesAvailable.includes(xParam)?xParam:'win';
 const visible=points.filter(p=>division.length===0||(!!p.division&&division.includes(p.division)));
 const plotted=visible.filter(p=>p.values[axis]!==null),tip=plotted.find(p=>p.id===hover);
 const xDomain=scorerDomain(points.map(p=>p.values[axis]),axis),yDomain=scorerDomain(points.map(p=>p.pts),'pts');
 const x=(v:number)=>(v-xDomain.min)/(xDomain.max-xDomain.min)*100,y=(v:number)=>(yDomain.max-v)/(yDomain.max-yDomain.min)*100;
 const rangeAxes=situationalAxes(filter,v=>setFilter({range:v.range})).filter(a=>a.id==='s.range'||(filter.range.kind==='dateRange'&&(a.id==='s.dateStart'||a.id==='s.dateEnd'))).map(a=>a.kind==='select'?{...a,options:a.options.filter(o=>['all','recent:5','recent:10','custom'].includes(o.value))}:{...a,tier:'primary' as const});
 const axes:FilterAxis[]=[...rangeAxes,gameTypeAxis(gameType,setGameType,season),
 {kind:'select',id:'scorerX',label:'横軸',tier:'primary',value:axis,defaultValue:'win',options:axesAvailable.map(a=>({value:a,label:SCORER_LABELS[a]})),onChange:v=>setX(v as ScorerAxis)},
 classificationAxis(classification,setClassification,{season}),
 divisionMultiAxis({id:'scorerDivision',divisions:divisionOrder(category).filter(d=>points.some(p=>p.division===d)),selected:division,onChange:setDivision}),
 {kind:'popover',id:'scorerRatio',label:'出場率',tier:'primary',value:String(minRatio),defaultValue:String(DEFAULT_RATIO),onChange:()=>setMinRatio(DEFAULT_RATIO),summary:`出場率${minRatio}%以上`,chipValue:`出場率${minRatio}%以上`,content:<EligibilitySlider label="出場率" value={minRatio} min={0} max={100} step={1} format={v=>`${v}%`} onChange={setMinRatio}/>}];
 const conditions=[season,seasonGameTypeLabels(season)[gameType],...situationalFilterLabels(filter),classificationFilterLabel(classification),...(division.length===0?[]:[division.map(d=>DIVISION_LABELS[d]).join('・')]),`出場率${minRatio}%以上`];
 const baseDate={kind:'season' as const,season,gameType};
 const sorted=[...visible].sort((a,b)=>{
  if(sort.key==='team')return (a.teamName.localeCompare(b.teamName,'ja')||b.pts-a.pts)*(sort.desc?-1:1);
  const val=(p:ScorerPoint)=>sort.key==='pts'?p.pts:sort.key==='games'?p.games:p.values[sort.key as ScorerAxis];
  const av=val(a),bv=val(b);return av===null?bv===null?0:1:bv===null?-1:(av-bv)*(sort.desc?-1:1);
 });
 const select=(p:ScorerPoint)=>{setTeam(p.teamId);setHover(p.id);};
 const sortButton=(key:typeof sort.key,label:string)=><button title={statDescription(label)} onClick={()=>setSort(s=>({key,desc:s.key===key?!s.desc:true}))}>{label}{sort.key===key?(sort.desc?' ↓':' ↑'):' ↕'}</button>;
 const major=(tick:number,step:number)=>Math.abs(tick/(step*2)-Math.round(tick/(step*2)))<1e-6;
 return <section aria-label="各チームのトップスコアラー3人">
  <FilterBar axes={axes} stateKey="figures:top-scorers" onClearAll={()=>{setFilter(DEFAULT);setGameType('regular');setClassification('all');setDivision(NO_DIVISIONS);setMinRatio(DEFAULT_RATIO);setX('win');setTeam('all');}}/>
  {splitClassificationBlocked(figureClassGroup(classification),season)?<p>{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p>:request.loading?<p role="status">選手の試合データを読み込み中…</p>:request.error?<p role="alert">データを読み込めませんでした。ページを読み直してください。</p>:!visible.length?<p>この条件に該当する選手はいません。</p>:<>
  <div className="figures-controls"><label>手前に表示するチーム<select value={visible.some(p=>p.teamId===team)?team:'all'} onChange={e=>{setTeam(e.target.value);setHover(null);}}><option value="all">指定なし</option>{[...new Map(visible.map(p=>[p.teamId,p])).values()].map(p=><option key={p.teamId} value={p.teamId}>{teamLabel(p.teamId,p.teamName)}</option>)}</select></label><span>{plotted.length}人を表示</span></div>
  <ExportImageButton targetRef={target} filename={`トップスコアラー_${SCORER_LABELS[axis]}_${conditions.join('_')}`} baseDate={baseDate}/>
  <ExportTarget ref={target} className="ratings-export scorers-export" baseDate={baseDate}>
   <ConditionTitle title={`各チームのトップスコアラー3人：${SCORER_LABELS[axis]} × 平均得点`} exportScope={`${season}シーズン`} conditions={conditions}/>
   <div className="ratings-chart"><div className="ratings-plot-wrap">
    <span className="ratings-y-label">↑ 平均得点（PTS）</span>
    <div className="ratings-plot">
     {xDomain.ticks.map(t=><span key={`x${t}`} className={`ratings-grid-v scoring-grid ${major(t,xDomain.step)?'is-major':'is-minor'}`} style={{left:`${x(t)}%`}}/>)}
     {yDomain.ticks.map(t=><span key={`y${t}`} className={`ratings-grid-h scoring-grid ${major(t,yDomain.step)?'is-major':'is-minor'}`} style={{top:`${y(t)}%`}}/>)}
     {plotted.map(p=><ScorerPhoto key={p.id} point={p} label={`${playerLabel(p.name)}：平均得点 ${formatDecimal(p.pts)}、${SCORER_LABELS[axis]} ${valueText(p.values[axis],axis)}`} selected={team===p.teamId} expanded={hover===p.id} left={x(p.values[axis]!)} top={y(p.pts)} onSelect={()=>select(p)} onDismiss={()=>setHover(null)}/>)}
     {tip&&<div className="ratings-tooltip scoring-tooltip" role="tooltip" style={{left:`clamp(0px, calc(${x(tip.values[axis]!)}% - 130px), calc(100% - 260px))`,top:`clamp(0px, calc(${y(tip.pts)}% + 24px), calc(100% - 120px))`}}><strong>{playerLabel(tip.name)}（{teamLabel(tip.teamId,tip.teamName)}）</strong><span>平均得点 {formatDecimal(tip.pts)}</span><span>{SCORER_LABELS[axis]} {valueText(tip.values[axis],axis)}</span><span>{tip.games}試合・{tip.wins}勝{tip.games-tip.wins}敗</span></div>}
    </div>
    {xDomain.ticks.filter(t=>major(t,xDomain.step)).map(t=><span className={`ratings-tick-x${Math.abs(t/(xDomain.step*4)-Math.round(t/(xDomain.step*4)))<1e-6?'':' scorer-tick-secondary'}`} key={t} style={{left:`${x(t)}%`}}>{axis==='ppp'||axis==='pps'?t.toFixed(1):t}</span>)}
    {yDomain.ticks.filter(t=>major(t,yDomain.step)).map(t=><span className="ratings-tick-y" key={t} style={{top:`${y(t)}%`}}>{t}</span>)}
    <span className="ratings-x-label">{SCORER_LABELS[axis]}{['win','share','efg'].includes(axis)?'（%）':''} →</span>
   </div></div>
  </ExportTarget>
  <div className="figure-notes"><p>条件と出場率の下限で絞った後、各チームの平均得点上位3人を表示。平均得点が同じ場合は総得点、出場時間、選手IDの順で決めます。数値は丸める前に比較しています。</p><p>出場率は対象期間のチーム試合数が分母。直近5・10試合はチームごとに選び、その後に試合種別を絞ります。移籍した選手はチームごとに別の点です。勝率は本人が出場した試合だけで計算します。</p><p>写真は現在保存されている1枚を使うため、当時のユニフォームとは限りません。写真がない場合は人の影の上に名字を表示します。重なる選手はチーム選択または下の一覧から選べます。</p><p>{scorerAxisTitle(axis)}。%PTSとOn ORtgは記録のそろう試合で計算します。PPPは既存の個人攻撃効率と同じ計算、PPSは得点÷FG試投数です。</p>{season<'2020-21'&&<p>%PTS・On ORtgは2020-21以降のため、横軸の選択肢に出していません。</p>}{plotted.length<visible.length&&<p>横軸の値がない{visible.length-plotted.length}人は図から除き、一覧には「—」で残しています。次点の選手との入れ替えはしません。</p>}</div>
  <div className="ratings-table-scroll scorers-table" tabIndex={0} role="region" aria-label="チーム別の選手一覧"><table className="ratings-table"><thead><tr><th>{sortButton('team','選手／チーム')}</th><th>{sortButton('games','G')}</th><th>{sortButton('pts','PTS')}</th>{SCORER_AXES.map(a=><th key={a}>{sortButton(a,SCORER_LABELS[a])}</th>)}</tr></thead><tbody>{sorted.map(p=><tr key={p.id} className={team===p.teamId?'is-selected':''}><td><button onClick={()=>select(p)}>{playerLabel(p.name)} / {teamLabel(p.teamId,p.teamName)}</button></td><td>{p.games}</td><td>{formatDecimal(p.pts)}</td>{SCORER_AXES.map(a=><td key={a}>{valueText(p.values[a],a)}</td>)}</tr>)}</tbody></table></div>
  </>}
 </section>;
}
// 写真がない選手の点：自作の上半身の影の上に名字を載せる。点（36px／スマホ28px）の中に収めるため、名字だけを使い、
// 3文字までは1行、4文字以上は2行に折り返して文字を小さくする
export function scorerNameLines(name:string):string[]{
 const s=Array.from(surnameOf(name.replace(/\s+/g,' ').trim()));
 if(s.length<=3)return [s.join('')];
 const half=Math.ceil(s.length/2);
 return [s.slice(0,half).join(''),s.slice(half).join('')];
}
function ScorerSilhouette({name}:{name:string}){
 const lines=scorerNameLines(name),size=lines.length===1?'one':Math.max(...lines.map(l=>Array.from(l).length))>3?'long':'two';
 return <span className={`scorer-silhouette scorer-name-${size}`} aria-hidden="true">
  <svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="8" r="4.2"/><path d="M3 24c0-5.6 4-8.6 9-8.6s9 3 9 8.6z"/></svg>
  <span className="scorer-name">{lines.map((l,i)=><span key={i}>{l}</span>)}</span>
 </span>;
}
export function ScorerPhoto({point,label,selected,expanded,left,top,onSelect,onDismiss}:{point:Pick<ScorerPoint,'playerId'|'name'|'division'>;label:string;selected:boolean;expanded:boolean;left:number;top:number;onSelect:()=>void;onDismiss:()=>void}){
 const [failed,setFailed]=useState(false);
 return <button className={`ratings-point scorer-point${selected?' is-selected':''}${expanded?' is-expanded':''}`} aria-label={label} aria-pressed={selected} style={{left:`${left}%`,top:`${top}%`,borderColor:DIVISION_RATING_COLORS[point.division??'unknown']}} onPointerEnter={e=>{if(e.pointerType==='mouse')onSelect();}} onPointerLeave={e=>{if(e.pointerType==='mouse')onDismiss();}} onFocus={onSelect} onBlur={onDismiss} onClick={onSelect}>
 {!failed?<img src={playerPhotoUrl(point.playerId)} alt="" loading="eager" width={32} height={32} onError={()=>setFailed(true)}/>:<ScorerSilhouette name={point.name}/>}
 </button>;
}
