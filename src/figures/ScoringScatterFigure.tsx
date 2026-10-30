import { useEffect, useMemo, useRef, useState } from "react";
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
import { GAME_TYPE_PARAM, PERSPECTIVE_PARAM } from "../lib/urlFilterParams";
import { enumParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { gameTypeAxis, perspectiveAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import { type SituationalFilter } from "../lib/situational";
import { situationalFilterLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS, divisionOrder } from "../lib/divisionGroups";
import { DIVISION_RATING_COLORS } from "../lib/figureRatings";
import { buildScoringScatter, isMajorTick, scoringAxisKey, scoringDomain, scoringLabelStep, scoringPerGame, scoringShare, scoringYModes, SCORING_Y_LABELS, type ScoringPoint, type ScoringYMode } from "../lib/figureScoring";
import type { TeamPerspective } from "../lib/teamStatsColumns";
import { useTeamLabel } from "../lib/teamLabel";
import { statJa } from "../lib/statNames";
import type { FigureProps } from "./catalog";
import "./RatingsScatterFigure.css";
import "./ScoringScatterFigure.css";

const DEFAULT_RANGE: SituationalFilter = {range:{kind:"all"}};
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys:["rng"], read:p=>{
    const range=situationalParam.read(p)?.range;
    return range && (range.kind !== "recent" || range.n === 5 || range.n === 10) ? {range} : undefined;
  }, write:(p,value)=>situationalParam.write(p,{range:value.range}),
};
const gameCodec={...enumParam<SeasonGameTypeFilter>("gt",["regular","playoff","both"],"regular"),read:GAME_TYPE_PARAM.read};
type DivisionChoice = Division | "all" | "unknown";
const divisionCodec=enumParam<DivisionChoice>("dv",["all","east","central","west","north","south","unknown"],"all");
const yCodec=enumParam<ScoringYMode>("yc",["foreign","intl"],"foreign");
const divisionLabel=(division: Division | "unknown")=>division === "unknown" ? "地区不明" : DIVISION_LABELS[division];

type Key = "japanese" | "foreign" | "intl";
const STAT_LABEL: Record<Key,string> = { japanese:"日本人 PTS", foreign:"外国籍 PTS", intl:"外国籍・帰化・アジア PTS" };
/** 項目名。視点が相手なら「相手の…」、差なら「…の差（自チーム − 相手）」 */
const statName=(key:Key,pv:TeamPerspective)=>pv==="opp"?statJa(`opp ${STAT_LABEL[key]}`,"team"):pv==="diff"?`${statJa(STAT_LABEL[key],"team")}の差`:statJa(STAT_LABEL[key],"team");
const signed=(value:number,pv:TeamPerspective,digits=2)=>pv==="diff"&&Math.round(value*10**digits)>0?`+${value.toFixed(digits)}`:value.toFixed(digits);
const perGameText=(value:number,pv:TeamPerspective)=>`${signed(value,pv)}点`;
const shareText=(value:number|null,pv:TeamPerspective)=>value===null?"—":pv==="diff"?`${signed(value,pv)}ポイント`:`${value.toFixed(2)}%`;

export default function ScoringScatterFigure({season,category}:FigureProps) {
  const [filter,setFilter]=useUrlState(rangeCodec,DEFAULT_RANGE);
  const [gameType,setGameType]=useUrlState(gameCodec,"regular");
  const [division,setDivision]=useUrlState(divisionCodec,"all");
  const [perspective,setPerspective]=useUrlState(PERSPECTIVE_PARAM,"own");
  const [yParam,setYParam]=useUrlState(yCodec,"foreign");
  const [sort,setSort]=useState<{key:"x"|"y"|"games"|"xs"|"ys";desc:boolean}>({key:"y",desc:true});
  const [tooltipId,setTooltipId]=useState<string|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const target=useRef<HTMLDivElement>(null);
  const plot=useRef<HTMLDivElement>(null);
  const teamLabel=useTeamLabel();
  const modes=scoringYModes(season);
  const yMode:ScoringYMode=modes.includes(yParam)?yParam:modes[0]!;
  const request=useJsonData(async()=>{
    const teams=await fetchTeams(season,category);
    const [divisions,entries]=await Promise.all([fetchDivisionHistory().catch(()=>null),Promise.all(teams.map(async team=>{
      try {return [team.teamId,await fetchTeamGameLogs(season,team.teamId,category)] as const;}
      catch {return [team.teamId,null] as const;}
    }))]);
    const missing=entries.filter(([,logs])=>logs===null).map(([id])=>id);
    return {teams,divisions,missing,logs:new Map(entries.map(([id,logs])=>[id,logs??[]]))};
  },[season,category]);
  const model=useMemo(()=>request.data && !request.data.missing.length ? buildScoringScatter(request.data.teams,request.data.logs,request.data.divisions,{season,category,range:filter.range,gameType}) : null,[request.data,season,category,filter,gameType]);
  const present=useMemo(()=>{
    const values=new Set(model?.points.map(point=>point.division??"unknown"));
    return [...divisionOrder(category).filter(d=>values.has(d)),...(values.has("unknown")?["unknown" as const]:[])];
  },[model,category]);
  const activeDivision=division === "all" || present.includes(division) ? division : "all";
  const xKey=scoringAxisKey("x",yMode) as Key, yKey=scoringAxisKey("y",yMode) as Key;
  const xOf=(p:ScoringPoint)=>scoringPerGame(p,xKey,perspective), yOf=(p:ScoringPoint)=>scoringPerGame(p,yKey,perspective);
  const visible=model?.points.filter(point=>activeDivision === "all" || (point.division??"unknown")===activeDivision)??[];
  const selected=visible.find(point=>point.teamId===selectedId)??null;
  const tooltip=visible.find(point=>point.teamId===tooltipId)??null;
  // 軸・リーグ平均はリーグ全体が基準（地区で絞っても変えない）
  // 基本の範囲に収まる条件ではどの視点・縦軸でも同じ範囲。外に出る点があるときだけ、今の表示に限って広げる
  const domain=useMemo(()=>scoringDomain((model?.points??[]).flatMap(p=>[scoringPerGame(p,xKey,perspective),scoringPerGame(p,yKey,perspective)]),perspective),[model,xKey,yKey,perspective]);
  const [plotWidth,setPlotWidth]=useState(700);
  useEffect(()=>{
    const el=plot.current?.querySelector(".ratings-plot");
    if(!el)return;
    const observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width)setPlotWidth(width);});
    observer.observe(el);return ()=>observer.disconnect();
  },[model,visible.length]);
  const labelStep=scoringLabelStep(plotWidth,domain,perspective==="diff"?34:26);
  const rangeAxes=situationalAxes(filter,next=>setFilter({range:next.range})).filter(axis=>axis.id === "s.range" || (filter.range.kind === "dateRange" && (axis.id === "s.dateStart" || axis.id === "s.dateEnd"))).map(axis=>{
    if(axis.kind === "select") return {...axis,options:axis.options.filter(option=>["all","recent:5","recent:10","custom"].includes(option.value))};
    return {...axis,tier:"primary" as const};
  });
  const axes:FilterAxis[]=[...rangeAxes,gameTypeAxis(gameType,setGameType,season),perspectiveAxis(perspective,setPerspective),{
    kind:"select",id:"scoringY",label:"縦軸",tier:"primary",value:yMode,defaultValue:modes[0]!,
    options:modes.map(m=>({value:m,label:SCORING_Y_LABELS[m]})),onChange:value=>setYParam(value as ScoringYMode),
    ...(modes.length<2?{disabledReason:"外国籍だけを分けて見られるのは2026-27シーズンからです。それより前は外国籍・帰化・アジアの合計で表示します。"}:{}),
  },{
    kind:"select",id:"scoringDivision",label:"地区",tier:"primary",value:activeDivision,defaultValue:"all",
    options:[{value:"all",label:"全チーム"},...present.map(d=>({value:d,label:divisionLabel(d)}))],onChange:value=>setDivision(value as DivisionChoice),
  }];
  const conditions=[season,seasonGameTypeLabels(season)[gameType],...(filter.range.kind === "all"?[]:situationalFilterLabels(filter)),...(activeDivision === "all"?[]:[divisionLabel(activeDivision)])];
  const xName=statName(xKey,perspective), yName=statName(yKey,perspective);
  const sorted=[...visible].sort((a,b)=>{
    const value=(p:ScoringPoint)=>sort.key==="x"?xOf(p):sort.key==="y"?yOf(p):sort.key==="games"?p.games:(scoringShare(p,sort.key==="xs"?xKey:yKey,perspective)??-Infinity);
    return (value(a)-value(b))*(sort.desc?-1:1)||a.teamId.localeCompare(b.teamId);
  });
  const toggleSort=(key:typeof sort.key)=>setSort(previous=>({key,desc:previous.key===key?!previous.desc:true}));
  const arrow=(key:typeof sort.key)=>sort.key===key?(sort.desc?" ↓":" ↑"):" ↕";
  const baseDate={kind:"season" as const,season,gameType};
  const choose=(id:string,scroll=false)=>{setSelectedId(id);setTooltipId(scroll?null:id);if(scroll)plot.current?.scrollIntoView({block:"center",behavior:"smooth"});};
  const league=model?.league??null;
  const x=(value:number)=>(value-domain.min)/(domain.max-domain.min)*100, y=(value:number)=>(domain.max-value)/(domain.max-domain.min)*100;
  const detail=(p:ScoringPoint)=><>
    <span>{xName} {perGameText(xOf(p),perspective)}（割合 {shareText(scoringShare(p,xKey,perspective),perspective)}）</span>
    <span>{yName} {perGameText(yOf(p),perspective)}（割合 {shareText(scoringShare(p,yKey,perspective),perspective)}）</span>
  </>;
  return <section aria-label="日本人と外国籍の得点の散布図">
    <FilterBar axes={axes} stateKey="figures:scoring" onClearAll={()=>{setFilter(DEFAULT_RANGE);setGameType("regular");setDivision("all");setPerspective("own");setYParam("foreign");}} />
    {request.loading?<p role="status">読み込み中…</p>:request.error || request.data?.missing.length?<p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p>:!league || !visible.length?<p className="empty-message">この条件で表示できるチームがありません。</p>:<>
      <ExportImageButton targetRef={target} filename={`${xName}_${yName}_${conditions.join("_")}`} baseDate={baseDate}/>
      <ExportTarget ref={target} className="ratings-export scoring-export" baseDate={baseDate}>
        <ConditionTitle title={`${xName} × ${yName}`} exportScope={`${season}シーズン`} conditions={conditions} />
        <p className="ratings-league">1試合平均　リーグ平均：{xName} {perGameText(xOf(league),perspective)} ／ {yName} {perGameText(yOf(league),perspective)}</p>
        <div className="ratings-legend">{present.map(d=><span key={d}><i style={{borderColor:DIVISION_RATING_COLORS[d]}}/>{divisionLabel(d)}</span>)}<span><i className="scoring-average-key"/>リーグ平均</span>{perspective==="diff"&&<span><i className="scoring-zero-key"/>0</span>}</div>
        <div ref={plot} onPointerDown={event=>{if(!(event.target as Element).closest(".ratings-point"))setTooltipId(null);}}>
          <div className="ratings-chart">
            <div className="ratings-plot-wrap">
              <span className="ratings-y-label">↑ {yName}（1試合平均）</span>
              <div className="ratings-plot">
                {domain.ticks.map(tick=><span key={`v${tick}`} className={`ratings-grid-v scoring-grid ${isMajorTick(tick)?"is-major":"is-minor"}`} style={{left:`${x(tick)}%`}}/>)}
                {domain.ticks.map(tick=><span key={`h${tick}`} className={`ratings-grid-h scoring-grid ${isMajorTick(tick)?"is-major":"is-minor"}`} style={{top:`${y(tick)}%`}}/>)}
                <span className="ratings-average-v" style={{left:`${x(xOf(league))}%`}}/><span className="ratings-average-h" style={{top:`${y(yOf(league))}%`}}/>
                {perspective==="diff"&&<><span className="scoring-zero-v" style={{left:`${x(0)}%`}}/><span className="scoring-zero-h" style={{top:`${y(0)}%`}}/></>}
                {visible.map(point=><ScoringLogo key={point.teamId} point={point} label={teamLabel(point.teamId,point.teamName)} selected={selected?.teamId===point.teamId} expanded={tooltip?.teamId===point.teamId} left={x(xOf(point))} top={y(yOf(point))}
                  description={`${teamLabel(point.teamId,point.teamName)}：${xName} ${perGameText(xOf(point),perspective)}、${yName} ${perGameText(yOf(point),perspective)}、${point.games}試合`} onSelect={()=>choose(point.teamId)} onDismiss={()=>setTooltipId(null)}/>)}
                {tooltip&&<div role="tooltip" className="ratings-tooltip scoring-tooltip" style={{left:`clamp(0px, calc(${x(xOf(tooltip))}% - 130px), calc(100% - 260px))`,top:`clamp(0px, calc(${y(yOf(tooltip))}% + 30px), calc(100% - 150px))`}}>
                  <strong>{teamLabel(tooltip.teamId,tooltip.teamName)}</strong>
                  <span>{xName} {perGameText(xOf(tooltip),perspective)}</span><span>{yName} {perGameText(yOf(tooltip),perspective)}</span>
                  <span>{tooltip.games}試合（{tooltip.firstDate}〜{tooltip.lastDate}）</span>
                </div>}
              </div>
              {domain.ticks.filter(tick=>isMajorTick(tick)&&tick%labelStep===0).map(tick=><span key={`x${tick}`} className="ratings-tick-x" style={{left:`${x(tick)}%`}}>{tick}</span>)}
              {domain.ticks.filter(tick=>isMajorTick(tick)&&tick%labelStep===0).map(tick=><span key={`y${tick}`} className="ratings-tick-y" style={{top:`${y(tick)}%`}}>{tick}</span>)}
              <span className="ratings-x-label">{xName}（1試合平均） →</span>
            </div>
          </div>
        </div>
        <div className="figure-notes">
          <p>点は1試合平均の得点です。破線の十字は選択した期間・試合区分のリーグ平均（全チームの合計 ÷ 全チームの試合数）。地区で絞っても、軸・平均はリーグ全体が基準です。</p>
          <p>日本人には見做し日本人を含みます。{yMode==="foreign"?"外国籍のみの縦軸では、帰化選手・アジア特別枠の得点はどちらの軸にも入りません。":"縦軸は外国籍・帰化・アジア特別枠の合計です。"}{!splitSeason(modes)&&"2025-26シーズン以前は、現在の登録情報に基づく参考値です。"}</p>
          {perspective==="diff"&&<p>+/-は、同じ試合の「自チーム − 相手」の1試合平均です（選手の出場中の+/-とは別の値）。0の線を太く示しています。</p>}
          {perspective==="opp"&&<p>相手は、そのチームとの試合で対戦相手が記録した得点です。</p>}
          {filter.range.kind === "recent"&&<p>直近の試合はチームごとに選ぶため対象日は異なります。直近の試合を先に選び、その後に試合区分を絞るため、対象試合数が指定より少なくなる場合があります。</p>}
          <p>ボックススコアが公式に無い試合（結果だけの試合）は、平均の対象に含めていません。</p>
          {model!.omitted.length>0&&<p>対象試合がない、または値を確認できない{model!.omitted.length}チームは表示していません。</p>}
          {!request.data?.divisions&&<p>地区の情報を読み込めないため、色分けは地区不明として表示しています。</p>}
        </div>
      </ExportTarget>
      <div className="ratings-team-detail scoring-detail" aria-live="polite">{selected?<>
        <h3><ResponsiveTeamName teamId={selected.teamId} name={selected.teamName}/></h3>
        <p>{selected.games}試合（{selected.firstDate}〜{selected.lastDate}）</p>
        <p>{detail(selected)}</p>
      </>:<p>ロゴに触れるか押すと、チームの1試合平均と得点の割合を表示します。</p>}</div>
      <p className="figure-notes">ロゴが重なる場合は下の一覧から選ぶと、そのチームを手前に表示します。割合は区分の得点 ÷ 総得点で、{perspective==="diff"?"差は自チームの割合 − 相手の割合（ポイント）です。":"選んだ視点のチームの得点が基準です。"}</p>
      <div className="ratings-table-scroll" tabIndex={0} role="region" aria-label="散布図のチーム一覧">
        <table className="ratings-table"><thead><tr><th>チーム</th>
          <th><button onClick={()=>toggleSort("games")}>試合数{arrow("games")}</button></th>
          <th><button onClick={()=>toggleSort("x")}>{xName}{arrow("x")}</button></th>
          <th><button onClick={()=>toggleSort("y")}>{yName}{arrow("y")}</button></th>
          <th><button onClick={()=>toggleSort("xs")}>{xName}の割合{arrow("xs")}</button></th>
          <th><button onClick={()=>toggleSort("ys")}>{yName}の割合{arrow("ys")}</button></th></tr></thead>
        <tbody>{sorted.map(point=><tr key={point.teamId} className={selected?.teamId===point.teamId?"is-selected":""}><td><button onClick={()=>choose(point.teamId,true)}><ResponsiveTeamName teamId={point.teamId} name={point.teamName}/></button></td>
          <td>{point.games}</td><td>{perGameText(xOf(point),perspective)}</td><td>{perGameText(yOf(point),perspective)}</td>
          <td>{shareText(scoringShare(point,xKey,perspective),perspective)}</td><td>{shareText(scoringShare(point,yKey,perspective),perspective)}</td></tr>)}</tbody></table>
      </div>
    </>}
  </section>;
}
const splitSeason=(modes:ScoringYMode[])=>modes.length>1;
function ScoringLogo({point,label,description,selected,expanded,left,top,onSelect,onDismiss}:{point:ScoringPoint;label:string;description:string;selected:boolean;expanded:boolean;left:number;top:number;onSelect:()=>void;onDismiss:()=>void}) {
  const[failed,setFailed]=useState(false);
  return <button className={`ratings-point${selected?" is-selected":""}${expanded?" is-expanded":""}`} style={{left:`${left}%`,top:`${top}%`,borderColor:DIVISION_RATING_COLORS[point.division??"unknown"]}}
    aria-label={description} aria-pressed={selected} onPointerEnter={event=>{if(event.pointerType==="mouse")onSelect();}} onPointerLeave={event=>{if(event.pointerType==="mouse")onDismiss();}} onFocus={onSelect} onBlur={onDismiss} onClick={onSelect}>
    {failed?<span className="ratings-fallback">{teamShortName(point.teamId,point.teamName)}</span>:<img src={teamLogoUrl(point.teamId)} alt="" width={26} height={26} loading="eager" onError={()=>setFailed(true)}/>}
    <span className="scoring-sr">{label}</span>
  </button>;
}
