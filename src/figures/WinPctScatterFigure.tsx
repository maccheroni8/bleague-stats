import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Division } from "../../shared/types";
import { teamShortName } from "../../shared/teamNames";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { FilterBar } from "../components/FilterBar";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { ExportImageButton } from "../components/ExportImageButton";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { fetchTeams, fetchTeamGameLogs, fetchDivisionHistory, teamLogoUrl } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { divisionListParam, enumParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { divisionMultiAxis, gameTypeAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import { type SituationalFilter } from "../lib/situational";
import { situationalFilterLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS, divisionOrder } from "../lib/divisionGroups";
import { DIVISION_RATING_COLORS } from "../lib/figureRatings";
import { isMajorTick, scoringLabelStep, scoringYModes } from "../lib/figureScoring";
import { buildWinPctScatter, linearFit, winPctAverages, winPctDomain, winPctRate, winPctX, WIN_PCT_CLASS_LABELS, WIN_PCT_METRIC_COLORS, WIN_PCT_METRIC_LABELS, WIN_PCT_Y_TICKS, type WinPctClass, type WinPctMetric, type WinPctPoint } from "../lib/figureWinPct";
import { formatWinPct } from "../lib/format";
import { useTeamLabel } from "../lib/teamLabel";
import type { FigureProps } from "./catalog";
import "./RatingsScatterFigure.css";
import "./ScoringScatterFigure.css";
import "./WinPctScatterFigure.css";

const DEFAULT_RANGE: SituationalFilter = {range:{kind:"all"}};
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys:["rng"], read:p=>{
    const range=situationalParam.read(p)?.range;
    return range && (range.kind !== "recent" || range.n === 5 || range.n === 10) ? {range} : undefined;
  }, write:(p,value)=>situationalParam.write(p,{range:value.range}),
};
const gameCodec={...enumParam<SeasonGameTypeFilter>("gt",["regular","playoff","both"],"regular"),read:GAME_TYPE_PARAM.read};
type DivisionChoice = Division | "unknown";
const divisionCodec=divisionListParam<"unknown">("dv",["unknown"]);
const NO_DIVISIONS:DivisionChoice[]=[];
const classCodec=enumParam<WinPctClass>("wc",["intl","japanese","foreign"],"intl");
const metricCodec=enumParam<WinPctMetric>("wm",["pts","opp","diff"],"pts");
const divisionLabel=(division: Division | "unknown")=>division === "unknown" ? "地区不明" : DIVISION_LABELS[division];

const signed=(value:number,metric:WinPctMetric)=>metric==="diff"&&Math.round(value*100)>0?`+${value.toFixed(2)}`:value.toFixed(2);
const valueText=(value:number,metric:WinPctMetric)=>`${signed(value,metric)}点`;
const rText=(r:number|null)=>r===null?"—":`${r>=0?"+":"-"}${Math.abs(r).toFixed(2)}`;

export default function WinPctScatterFigure({season,category}:FigureProps) {
  const [filter,setFilter]=useUrlState(rangeCodec,DEFAULT_RANGE);
  const [gameType,setGameType]=useUrlState(gameCodec,"regular");
  const [division,setDivision]=useUrlState(divisionCodec,NO_DIVISIONS);
  const [classParam,setClassParam]=useUrlState(classCodec,"intl");
  const [metric,setMetric]=useUrlState(metricCodec,"pts");
  const [sort,setSort]=useState<{key:"x"|"rate"|"games";desc:boolean}>({key:"rate",desc:true});
  const [tooltipId,setTooltipId]=useState<string|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const target=useRef<HTMLDivElement>(null);
  const plot=useRef<HTMLDivElement>(null);
  const teamLabel=useTeamLabel();
  const splitSeason=scoringYModes(season).length>1;
  const classes:WinPctClass[]=splitSeason?["intl","japanese","foreign"]:["intl","japanese"];
  const cls:WinPctClass=classes.includes(classParam)?classParam:"intl";
  const request=useJsonData(async()=>{
    const teams=await fetchTeams(season,category);
    const [divisions,entries]=await Promise.all([fetchDivisionHistory().catch(()=>null),Promise.all(teams.map(async team=>{
      try {return [team.teamId,await fetchTeamGameLogs(season,team.teamId,category)] as const;}
      catch {return [team.teamId,null] as const;}
    }))]);
    const missing=entries.filter(([,logs])=>logs===null).map(([id])=>id);
    return {teams,divisions,missing,logs:new Map(entries.map(([id,logs])=>[id,logs??[]]))};
  },[season,category]);
  const model=useMemo(()=>request.data && !request.data.missing.length ? buildWinPctScatter(request.data.teams,request.data.logs,request.data.divisions,{season,category,range:filter.range,gameType}) : null,[request.data,season,category,filter,gameType]);
  const present=useMemo(()=>{
    const values=new Set(model?.points.map(point=>point.division??"unknown"));
    return [...divisionOrder(category).filter(d=>values.has(d)),...(values.has("unknown")?["unknown" as const]:[])];
  },[model,category]);
  const activeDivision=division.filter(d=>present.includes(d));
  const xOf=(p:WinPctPoint)=>winPctX(p,cls,metric);
  const visible=model?.points.filter(point=>activeDivision.length === 0 || activeDivision.includes(point.division??"unknown"))??[];
  const selected=visible.find(point=>point.teamId===selectedId)??null;
  const tooltip=visible.find(point=>point.teamId===tooltipId)??null;
  // 傾向線・r・平均は表示しているチームで計算する。軸の範囲は地区で絞っても変えない
  const domain=useMemo(()=>winPctDomain((model?.points??[]).map(p=>winPctX(p,cls,metric)),metric),[model,cls,metric]);
  const fit=useMemo(()=>linearFit(visible.map(p=>winPctX(p,cls,metric)),visible.map(p=>100*winPctRate(p))),[visible,cls,metric]);
  const average=useMemo(()=>winPctAverages(visible,cls,metric),[visible,cls,metric]);
  const [plotWidth,setPlotWidth]=useState(700);
  useEffect(()=>{
    const el=plot.current?.querySelector(".ratings-plot");
    if(!el)return;
    const observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width)setPlotWidth(width);});
    observer.observe(el);return ()=>observer.disconnect();
  },[model,visible.length]);
  const labelStep=scoringLabelStep(plotWidth,domain,metric==="diff"?34:26);
  const rangeAxes=situationalAxes(filter,next=>setFilter({range:next.range})).filter(axis=>axis.id === "s.range" || (filter.range.kind === "dateRange" && (axis.id === "s.dateStart" || axis.id === "s.dateEnd"))).map(axis=>{
    if(axis.kind === "select") return {...axis,options:axis.options.filter(option=>["all","recent:5","recent:10","custom"].includes(option.value))};
    return {...axis,tier:"primary" as const};
  });
  const axes:FilterAxis[]=[...rangeAxes,gameTypeAxis(gameType,setGameType,season),{
    kind:"select",id:"winPctClass",label:"登録区分",tier:"primary",value:cls,defaultValue:"intl",
    options:classes.map(c=>({value:c,label:WIN_PCT_CLASS_LABELS[c]})),onChange:value=>setClassParam(value as WinPctClass),
  },{
    kind:"select",id:"winPctMetric",label:"横軸",tier:"primary",value:metric,defaultValue:"pts",
    options:(["pts","opp","diff"] as const).map(m=>({value:m,label:WIN_PCT_METRIC_LABELS[m]})),onChange:value=>setMetric(value as WinPctMetric),
  },divisionMultiAxis<"unknown">({id:"winPctDivision",divisions:present.filter((d):d is Division=>d!=="unknown"),extra:present.includes("unknown")?[{value:"unknown",label:"地区不明"}]:[],selected:activeDivision,onChange:setDivision})];
  const conditions=[season,seasonGameTypeLabels(season)[gameType],...(filter.range.kind === "all"?[]:situationalFilterLabels(filter)),...(activeDivision.length === 0?[]:[activeDivision.map(divisionLabel).join("・")])];
  const xName=`${WIN_PCT_CLASS_LABELS[cls]}の${WIN_PCT_METRIC_LABELS[metric]}`;
  const color=WIN_PCT_METRIC_COLORS[metric];
  const sorted=[...visible].sort((a,b)=>{
    const value=(p:WinPctPoint)=>sort.key==="x"?xOf(p):sort.key==="rate"?winPctRate(p):p.games;
    return (value(a)-value(b))*(sort.desc?-1:1)||a.teamId.localeCompare(b.teamId);
  });
  const toggleSort=(key:typeof sort.key)=>setSort(previous=>({key,desc:previous.key===key?!previous.desc:true}));
  const arrow=(key:typeof sort.key)=>sort.key===key?(sort.desc?" ↓":" ↑"):" ↕";
  const baseDate={kind:"season" as const,season,gameType};
  const choose=(id:string,scroll=false)=>{setSelectedId(id);setTooltipId(scroll?null:id);if(scroll)plot.current?.scrollIntoView({block:"center",behavior:"smooth"});};
  const x=(value:number)=>(value-domain.min)/(domain.max-domain.min)*100, y=(value:number)=>100-value;
  const tooltipText=(p:WinPctPoint)=>`勝率 ${formatWinPct(winPctRate(p))}（${p.wins}勝${p.games-p.wins}敗）`;
  return <section aria-label="勝率と登録区分別の得失点の散布図">
    <FilterBar axes={axes} stateKey="figures:winpct" onClearAll={()=>{setFilter(DEFAULT_RANGE);setGameType("regular");setDivision(NO_DIVISIONS);setClassParam("intl");setMetric("pts");}} />
    {request.loading?<p role="status">読み込み中…</p>:request.error || request.data?.missing.length?<p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p>:!average || !visible.length?<p className="empty-message">この条件で表示できるチームがありません。</p>:<>
      <ExportImageButton targetRef={target} filename={`勝率_${xName}_${conditions.join("_")}`} baseDate={baseDate}/>
      <ExportTarget ref={target} className="ratings-export scoring-export winpct-export" baseDate={baseDate}>
        <ConditionTitle title={`勝率 × ${xName}`} exportScope={`${season}シーズン`} conditions={conditions} />
        <div className="ratings-legend">{present.map(d=><span key={d}><i style={{borderColor:DIVISION_RATING_COLORS[d]}}/>{divisionLabel(d)}</span>)}<span><i className="winpct-trend-key" style={{"--trend":color} as CSSProperties}/>傾向線</span><span><i className="scoring-average-key"/>平均</span>{metric==="diff"&&<span><i className="winpct-zero-key"/>0</span>}</div>
        <div ref={plot} onPointerDown={event=>{if(!(event.target as Element).closest(".ratings-point"))setTooltipId(null);}}>
          <div className="ratings-chart">
            <div className="ratings-plot-wrap">
              <span className="ratings-y-label">↑ 勝率（%）</span>
              <span className="winpct-r">r = {rText(fit?.r??null)}（{visible.length}チーム）</span>
              <div className="ratings-plot">
                {domain.ticks.map(tick=><span key={`v${tick}`} className={`ratings-grid-v scoring-grid ${isMajorTick(tick)?"is-major":"is-minor"}`} style={{left:`${x(tick)}%`}}/>)}
                {WIN_PCT_Y_TICKS.map(tick=><span key={`h${tick}`} className="ratings-grid-h scoring-grid is-major" style={{top:`${y(tick)}%`}}/>)}
                <span className="ratings-average-v" style={{left:`${x(average.x)}%`}}/><span className="ratings-average-h" style={{top:`${y(100*average.winRate)}%`}}/>
                {metric==="diff"&&<span className="winpct-zero-v" style={{left:`${x(0)}%`}}/>}
                {fit&&<div className="ratings-guide-clip winpct-trend" aria-hidden="true"><svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%">
                  <line x1={x(domain.min)} y1={y(fit.intercept+fit.slope*domain.min)} x2={x(domain.max)} y2={y(fit.intercept+fit.slope*domain.max)} stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" strokeLinecap="round"/>
                </svg></div>}
                {visible.map(point=><WinPctLogo key={point.teamId} point={point} label={teamLabel(point.teamId,point.teamName)} selected={selected?.teamId===point.teamId} expanded={tooltip?.teamId===point.teamId} left={x(xOf(point))} top={y(100*winPctRate(point))}
                  description={`${teamLabel(point.teamId,point.teamName)}：${tooltipText(point)}、${xName} ${valueText(xOf(point),metric)}`} onSelect={()=>choose(point.teamId)} onDismiss={()=>setTooltipId(null)}/>)}
                {tooltip&&<div role="tooltip" className="ratings-tooltip scoring-tooltip" style={{left:`clamp(0px, calc(${x(xOf(tooltip))}% - 130px), calc(100% - 260px))`,top:`clamp(0px, calc(${y(100*winPctRate(tooltip))}% + 30px), calc(100% - 110px))`}}>
                  <strong>{teamLabel(tooltip.teamId,tooltip.teamName)}</strong>
                  <span>{tooltipText(tooltip)}</span><span>{xName} {valueText(xOf(tooltip),metric)}</span>
                </div>}
              </div>
              {domain.ticks.filter(tick=>isMajorTick(tick)&&tick%labelStep===0).map(tick=><span key={`x${tick}`} className="ratings-tick-x" style={{left:`${x(tick)}%`}}>{tick}</span>)}
              {WIN_PCT_Y_TICKS.map(tick=><span key={`y${tick}`} className="ratings-tick-y" style={{top:`${y(tick)}%`}}>{tick}</span>)}
              <span className="ratings-x-label">{xName}（1試合平均） →</span>
            </div>
          </div>
        </div>
      </ExportTarget>
      <div className="ratings-team-detail scoring-detail" aria-live="polite">{selected?<>
        <h3><ResponsiveTeamName teamId={selected.teamId} name={selected.teamName}/></h3>
        <p>{selected.games}試合（{selected.firstDate}〜{selected.lastDate}）</p>
        <p><span>{tooltipText(selected)}</span><span>{xName} {valueText(xOf(selected),metric)}</span></p>
      </>:<p>ロゴに触れるか押すと、チームの勝率と横軸の値を表示します。</p>}</div>
      <div className="ratings-table-scroll" tabIndex={0} role="region" aria-label="散布図のチーム一覧">
        <table className="ratings-table"><thead><tr><th>チーム</th>
          <th><button onClick={()=>toggleSort("games")}>試合数{arrow("games")}</button></th>
          <th><button onClick={()=>toggleSort("rate")}>勝率{arrow("rate")}</button></th>
          <th><button onClick={()=>toggleSort("x")}>{xName}{arrow("x")}</button></th></tr></thead>
        <tbody>{sorted.map(point=><tr key={point.teamId} className={selected?.teamId===point.teamId?"is-selected":""}><td><button onClick={()=>choose(point.teamId,true)}><ResponsiveTeamName teamId={point.teamId} name={point.teamName}/></button></td>
          <td>{point.games}</td><td>{formatWinPct(winPctRate(point))}</td><td>{valueText(xOf(point),metric)}</td></tr>)}</tbody></table>
      </div>
    </>}
  </section>;
}
function WinPctLogo({point,label,description,selected,expanded,left,top,onSelect,onDismiss}:{point:WinPctPoint;label:string;description:string;selected:boolean;expanded:boolean;left:number;top:number;onSelect:()=>void;onDismiss:()=>void}) {
  const[failed,setFailed]=useState(false);
  return <button className={`ratings-point${selected?" is-selected":""}${expanded?" is-expanded":""}`} style={{left:`${left}%`,top:`${top}%`,borderColor:DIVISION_RATING_COLORS[point.division??"unknown"]}}
    aria-label={description} aria-pressed={selected} onPointerEnter={event=>{if(event.pointerType==="mouse")onSelect();}} onPointerLeave={event=>{if(event.pointerType==="mouse")onDismiss();}} onFocus={onSelect} onBlur={onDismiss} onClick={onSelect}>
    {failed?<span className="ratings-fallback">{teamShortName(point.teamId,point.teamName)}</span>:<img src={teamLogoUrl(point.teamId)} alt="" width={26} height={26} loading="eager" onError={()=>setFailed(true)}/>}
    <span className="scoring-sr">{label}</span>
  </button>;
}
