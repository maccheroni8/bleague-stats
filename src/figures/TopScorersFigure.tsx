import { usePlayerFigureFilter } from './usePlayerFigureFilter';
import { onCourtShareSeasonUnsupported } from '../lib/onCourtShareSeason';
import { buildPlayerFigurePoints, passesRatio } from '../lib/figurePlayerPoints';
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
import { useHighlightClubs } from './highlightClubs';
import { usePlayerLabel } from '../lib/playerLabel';
import { statDescription } from '../lib/statDescriptions';
import { teamShortName } from '../../shared/teamNames';
import { TeamChip } from '../components/TeamChip';
import { formatMinutesColon } from '../lib/minutesFormat';
import { formatDecimal, formatPct100, formatWinPct } from '../lib/format';
import { situationalFilterLabels } from '../lib/conditionLabels';
import { EligibilitySlider } from '../components/EligibilitySlider';
import { FilterBar } from '../components/FilterBar';
import { ratioEligibilityAxis } from './eligibilityAxis';
import { useFigureAchievable } from './useFigureAchievable';
import { eligibilityLabels } from '../lib/conditionLabels';

import { SortableTable, type Column } from '../components/SortableTable';
import { ExportTarget } from '../components/ExportTarget';
import { FigureExportButton } from "./FigureExport";
import { ConditionTitle } from '../components/ConditionTitle';
import type { FigureProps } from './catalog';
import { PlotCounts } from './PlotCounts';
import { playerCountLines } from '../lib/figurePlayerCounts';
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
const valueText=(v:number|null,axis:ScorerAxis)=>v===null?'—':axis==='win'?formatWinPct(v/100):axis==='min'?formatMinutesColon(v):axis==='share'||axis==='efg'?formatPct100(v):formatDecimal(v);
export default function TopScorersFigure({season,category}:FigureProps){
 const [filter,setFilter]=useUrlState(rangeCodec,DEFAULT),[gameType,setGameType]=useUrlState(gameCodec,'regular');
 const [classification,setClassification]=useUrlState(clsCodec,'all'),[xParam,setX]=useUrlState(xCodec,'win');
 const [minRatio,setMinRatio]=useUrlState(ratioCodec,DEFAULT_RATIO);
 const [hover,setHover]=useState<string|null>(null);
 const target=useRef<HTMLDivElement>(null),teamLabel=useTeamLabel();
 const request=useJsonData(async()=>{
   const [players,teams,divisions,registrations]=await Promise.all([fetchPlayers(season,category),fetchTeams(season,category),fetchDivisionHistory(),season>='2026-27'?fetchSeasonRegistrations(season,category):Promise.resolve(null)]);
   const [playerLogs,teamLogs]=await Promise.all([Promise.all(players.map(async p=>[p.playerId,await fetchPlayerGameLogs(season,p.playerId,category)] as const)),Promise.all(teams.map(async t=>[t.teamId,await fetchTeamGameLogs(season,t.teamId,category)] as const))]);
   return {players,teams,divisions,registrations,playerLogs:new Map(playerLogs),teamLogs:new Map(teamLogs)};
 },[season,category]);
 const teams=request.data?.teams??[];
 const divisionOf=(id:string)=>request.data?.divisions?.[category]?.[season]?.[id];
 const figurePoints=useMemo(()=>request.data?buildPlayerFigurePoints(request.data,{season,category,range:filter.range,gameType,classification}):[],[request.data,season,category,filter,gameType,classification]);
 const ach=useFigureAchievable(season,category,{range:filter.range,gameType});
 const ratioPassed=useMemo(()=>figurePoints.filter(p=>passesRatio(p,minRatio,ach.remaining)),[figurePoints,minRatio,ach.remaining]);
 const pf=usePlayerFigureFilter({season,category,teams,divisionOf,ratioPassed,clubKey:'scl',legacyDivisionKey:'dv',axisId:'scorerClubs'});
 // 絞っているときは、その選手の中から各チームの上位3人を選ぶ
 const allowed=useMemo(()=>pf.active?new Set(pf.eligible.map(p=>p.id)):undefined,[pf.active,pf.eligible]);
 const points=useMemo(()=>request.data?buildTopScorers(request.data,{season,category,range:filter.range,gameType,classification,minRatio,remainingByTeam:ach.remaining,allowed}):[],[request.data,season,category,filter,gameType,classification,minRatio,ach.remaining,allowed]);
 const playerLabel=usePlayerLabel(points.map(p=>p.name));
 const hl=useHighlightClubs({season,category,teams,divisionOf});
 const axesAvailable=SCORER_AXES.filter(a=>!onCourtShareSeasonUnsupported(season)||(a!=='on'&&a!=='share'));
 const axis=axesAvailable.includes(xParam)?xParam:'win';
 const visible=points;
 const plotted=visible.filter(p=>p.values[axis]!==null),tip=plotted.find(p=>p.id===hover);
 const countLines=playerCountLines(plotted.map(p=>p.playerId),request.data?.players??[],request.data?.registrations,classification);
 const xDomain=scorerDomain(points.map(p=>p.values[axis]),axis),yDomain=scorerDomain(points.map(p=>p.pts),'pts');
 const x=(v:number)=>(v-xDomain.min)/(xDomain.max-xDomain.min)*100,y=(v:number)=>(yDomain.max-v)/(yDomain.max-yDomain.min)*100;
 const rangeAxes=situationalAxes(filter,v=>setFilter({range:v.range})).filter(a=>a.id==='s.range'||(filter.range.kind==='dateRange'&&(a.id==='s.dateStart'||a.id==='s.dateEnd'))).map(a=>a.kind==='select'?{...a,options:a.options.filter(o=>['all','recent:5','recent:10','custom'].includes(o.value))}:{...a,tier:'primary' as const});
 const axes:FilterAxis[]=[...rangeAxes,gameTypeAxis(gameType,setGameType,season),
 {kind:'select',id:'scorerX',label:'横軸',tier:'primary',value:axis,defaultValue:'win',options:axesAvailable.map(a=>({value:a,label:SCORER_LABELS[a]})),onChange:v=>setX(v as ScorerAxis)},
 classificationAxis(classification,setClassification,{season}),
 pf.clubAxis, pf.positionAxis,
 hl.axis,
 ratioEligibilityAxis({id:'scorerRatio',value:minRatio,defaultValue:DEFAULT_RATIO,onChange:setMinRatio,achievable:ach.axis})];
 const conditions=[season,seasonGameTypeLabels(season)[gameType],...situationalFilterLabels(filter),classificationFilterLabel(classification),...pf.labels,...eligibilityLabels({gamesRatio:minRatio/100,achievable:ach.achievable}),...hl.labels];
 const baseDate={kind:'season' as const,season,gameType};
 const select=(p:ScorerPoint)=>{setHover(p.id);};
 const columns:Column<ScorerPoint>[]=[
  {key:'team',label:'選手名（チーム）',align:'left',sortValue:p=>p.name,render:p=><button className="ratings-team-button" onClick={()=>select(p)}>{playerLabel(p.name)}（<TeamChip teamId={p.teamId}>{teamShortName(p.teamId,p.teamName)}</TeamChip>）</button>},
  {key:'games',label:'G',sortValue:p=>p.games},
  {key:'pts',label:'PTS',sortValue:p=>p.pts,render:p=>formatDecimal(p.pts)},
  ...SCORER_AXES.map(a=>({key:a,label:SCORER_LABELS[a],sortValue:(p:ScorerPoint)=>p.values[a]??Number.NaN,render:(p:ScorerPoint)=>valueText(p.values[a],a)})),
 ];
 const major=(tick:number,step:number)=>Math.abs(tick/(step*2)-Math.round(tick/(step*2)))<1e-6;
 return <section aria-label="各チームのトップスコアラー3人">
  <FilterBar axes={axes} stateKey="figures:top-scorers" advancedExtra={pf.advancedExtra} onClearAll={()=>{setFilter(DEFAULT);setGameType('regular');setClassification('all');pf.reset();setMinRatio(DEFAULT_RATIO);ach.reset();setX('win');hl.setIds([]);}}/>
  {splitClassificationBlocked(figureClassGroup(classification),season)?<p>{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p>:request.loading?<p role="status">選手の試合データを読み込み中…</p>:request.error?<p role="alert">データを読み込めませんでした。ページを読み直してください。</p>:!visible.length?<p>この条件に該当する選手はいません。</p>:<>
  <p className="figure-count">{plotted.length}人を表示</p>
  <FigureExportButton targetRef={target} filename={`トップスコアラー_${SCORER_LABELS[axis]}_${conditions.join('_')}`} baseDate={baseDate}/>
  <ExportTarget ref={target} className="ratings-export scorers-export" baseDate={baseDate}>
   <ConditionTitle title={`各チームのトップスコアラー3人：${SCORER_LABELS[axis]} × 平均得点`} exportScope={`${season}シーズン`} conditions={conditions}/>
   <div className="ratings-chart" onPointerDown={e=>{if(!(e.target as Element).closest('.ratings-point'))setHover(null);}}><div className="ratings-plot-wrap">
    <span className="ratings-y-label">↑ 平均得点（PTS）</span>
    <div className="ratings-plot">
     {xDomain.ticks.map(t=><span key={`x${t}`} className={`ratings-grid-v scoring-grid ${major(t,xDomain.step)?'is-major':'is-minor'}`} style={{left:`${x(t)}%`}}/>)}
     {yDomain.ticks.map(t=><span key={`y${t}`} className={`ratings-grid-h scoring-grid ${major(t,yDomain.step)?'is-major':'is-minor'}`} style={{top:`${y(t)}%`}}/>)}
     {plotted.map(p=><ScorerPhoto key={p.id} point={p} label={`${playerLabel(p.name)}：平均得点 ${formatDecimal(p.pts)}、${SCORER_LABELS[axis]} ${valueText(p.values[axis],axis)}`} selected={hl.has([p.teamId])} expanded={hover===p.id} left={x(p.values[axis]!)} top={y(p.pts)} onSelect={()=>select(p)} onDismiss={()=>setHover(null)}/>)}
     <PlotCounts points={plotted.map(p=>({left:x(p.values[axis]!),top:y(p.pts)}))} lines={countLines}/>
     {tip&&<div className="ratings-tooltip scoring-tooltip" role="tooltip" style={{left:`clamp(0px, calc(${x(tip.values[axis]!)}% - 130px), calc(100% - 260px))`,top:`clamp(0px, calc(${y(tip.pts)}% + 24px), calc(100% - 120px))`}}><strong>{playerLabel(tip.name)}（{teamLabel(tip.teamId,tip.teamName)}）</strong><span>平均得点 {formatDecimal(tip.pts)}</span><span>{SCORER_LABELS[axis]} {valueText(tip.values[axis],axis)}</span><span>{tip.games}試合・{tip.wins}勝{tip.games-tip.wins}敗</span></div>}
    </div>
    {xDomain.ticks.filter(t=>major(t,xDomain.step)).map(t=><span className={`ratings-tick-x${Math.abs(t/(xDomain.step*4)-Math.round(t/(xDomain.step*4)))<1e-6?'':' scorer-tick-secondary'}`} key={t} style={{left:`${x(t)}%`}}>{axis==='ppp'||axis==='pps'?t.toFixed(1):t}</span>)}
    {yDomain.ticks.filter(t=>major(t,yDomain.step)).map(t=><span className="ratings-tick-y" key={t} style={{top:`${y(t)}%`}}>{t}</span>)}
    <span className="ratings-x-label">{SCORER_LABELS[axis]}{['win','share','efg'].includes(axis)?'（%）':axis==='min'?'（1試合平均）':''} →</span>
   </div></div>
  </ExportTarget>
  {plotted.length<visible.length&&<p className="figure-notes export-hide">横軸の値がない{visible.length-plotted.length}人は図から除き、一覧には「—」で残しています。</p>}
  <div className="table-scroll scorers-table" tabIndex={0} role="region" aria-label="チーム別の選手一覧"><SortableTable columns={columns} rows={visible} rowKey={p=>p.id} defaultSortKey="pts"
    rowHighlightColor={p=>hl.has([p.teamId])?'var(--accent)':undefined} rowHighlightStrength={()=>'half'}/></div>
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
export function ScorerSilhouette({name}:{name:string}){
 const lines=scorerNameLines(name),size=lines.length===1?'one':Math.max(...lines.map(l=>Array.from(l).length))>3?'long':'two';
 return <span className={`scorer-silhouette scorer-name-${size}`} aria-hidden="true">
  <svg viewBox="0 0 24 24" width="100%" height="100%"><circle cx="12" cy="8" r="4.2"/><path d="M3 24c0-5.6 4-8.6 9-8.6s9 3 9 8.6z"/></svg>
  <span className="scorer-name">{lines.map((l,i)=><span key={i}>{l}</span>)}</span>
 </span>;
}
export function ScorerPhoto({point,label,selected,expanded,left,top,onSelect,onDismiss}:{point:Pick<ScorerPoint,'playerId'|'name'|'division'>;label:string;selected:boolean;expanded:boolean;left:number;top:number;onSelect:()=>void;onDismiss:()=>void}){
 const [failed,setFailed]=useState(false);
 return <button className={`ratings-point scorer-point${selected?' is-selected is-emphasized':''}${expanded?' is-expanded':''}`} aria-label={label} aria-pressed={selected} style={{left:`${left}%`,top:`${top}%`,borderColor:DIVISION_RATING_COLORS[point.division??'unknown']}} onPointerEnter={e=>{if(e.pointerType==='mouse')onSelect();}} onPointerLeave={e=>{if(e.pointerType==='mouse')onDismiss();}} onFocus={onSelect} onBlur={onDismiss} onClick={onSelect}>
 {!failed?<img src={playerPhotoUrl(point.playerId)} alt="" loading="eager" width={32} height={32} onError={()=>setFailed(true)}/>:<ScorerSilhouette name={point.name}/>}
 </button>;
}
