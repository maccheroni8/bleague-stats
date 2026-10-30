import { useEffect, useMemo, useRef, useState } from "react";
import type { Division } from "../../shared/types";
import { teamShortName } from "../../shared/teamNames";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { FilterBar } from "../components/FilterBar";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { ExportImageButton } from "../components/ExportImageButton";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { fetchTeams, fetchTeamGameLogs, fetchDivisionHistory, fetchStandingsHistory, teamLogoUrl } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { enumParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { gameTypeAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import { type SituationalFilter } from "../lib/situational";
import { situationalFilterLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS, divisionOrder } from "../lib/divisionGroups";
import { buildRatingScatter, ratingDomain, ratingColumn, RATING_KEYS, RATING_LABELS, DIVISION_RATING_COLORS, type RatingPoint, type RatingKey, ratingLabelLayout } from "../lib/figureRatings";
import { useNarrow, useTeamLabel } from "../lib/teamLabel";
import { statJa } from "../lib/statNames";
import { statDescription } from "../lib/statDescriptions";
import type { FigureProps } from "./catalog";
import "./RatingsScatterFigure.css";

const DEFAULT_RANGE: SituationalFilter = {range:{kind:"all"}};
// 期間だけを共通のURL形式で読む。他の図・表の勝敗等の条件を持ち込まない。
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys:["rng"], read:p=>{
    const range=situationalParam.read(p)?.range;
    return range && (range.kind !== "recent" || range.n === 5 || range.n === 10) ? {range} : undefined;
  }, write:(p,value)=>situationalParam.write(p,{range:value.range}),
};
const gameCodec={...enumParam<SeasonGameTypeFilter>("gt",["regular","playoff","both"],"regular"),read:GAME_TYPE_PARAM.read};
type DivisionChoice = Division | "all" | "unknown";
const divisionCodec=enumParam<DivisionChoice>("dv",["all","east","central","west","north","south","unknown"],"all");
const divisionLabel=(division: Division | "unknown")=>division === "unknown" ? "地区不明" : DIVISION_LABELS[division];

export default function RatingsScatterFigure({season,category}:FigureProps) {
  const [filter,setFilter]=useUrlState(rangeCodec,DEFAULT_RANGE);
  const [gameType,setGameType]=useUrlState(gameCodec,"regular");
  const [division,setDivision]=useUrlState(divisionCodec,"all");
  const [sort,setSort]=useState<{key:RatingKey|"division";bestFirst:boolean}>({key:"netrtg",bestFirst:true});
  const [tooltipId,setTooltipId]=useState<string|null>(null);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const target=useRef<HTMLDivElement>(null);
  const plot=useRef<HTMLDivElement>(null);
  const teamLabel=useTeamLabel();
  const request=useJsonData(async()=>{
    const teams=await fetchTeams(season,category);
    const [standings,divisions,entries]=await Promise.all([fetchStandingsHistory(season,category).catch(()=>null),fetchDivisionHistory().catch(()=>null),Promise.all(teams.map(async team=>{
      try {return [team.teamId,await fetchTeamGameLogs(season,team.teamId,category)] as const;}
      catch {return [team.teamId,null] as const;}
    }))]);
    const missing=entries.filter(([,logs])=>logs===null).map(([id])=>id);
    return {teams,divisions,standings:standings?.at(-1)??null,missing,logs:new Map(entries.map(([id,logs])=>[id,logs??[]]))};
  },[season,category]);
  const model=useMemo(()=>request.data && !request.data.missing.length ? buildRatingScatter(request.data.teams,request.data.logs,request.data.divisions,{season,category,range:filter.range,gameType}) : null,[request.data,season,category,filter,gameType]);
  const present=useMemo(()=>{
    const values=new Set(model?.points.map(point=>point.division??"unknown"));
    return [...divisionOrder(category).filter(d=>values.has(d)),...(values.has("unknown")?["unknown" as const]:[])];
  },[model]);
  const activeDivision=division === "all" || present.includes(division) ? division : "all";
  const visible=model?.points.filter(point=>activeDivision === "all" || (point.division??"unknown")===activeDivision)??[];
  const selected=visible.find(point=>point.teamId===selectedId)??null;
  const tooltip=visible.find(point=>point.teamId===tooltipId)??null;
  const rangeAxes=situationalAxes(filter,next=>setFilter({range:next.range})).filter(axis=>axis.id === "s.range" || (filter.range.kind === "dateRange" && (axis.id === "s.dateStart" || axis.id === "s.dateEnd"))).map(axis=>{
    if(axis.kind === "select") return {...axis,options:axis.options.filter(option=>["all","recent:5","recent:10","custom"].includes(option.value))};
    return {...axis,tier:"primary" as const};
  });
  const axes:FilterAxis[]=[...rangeAxes,gameTypeAxis(gameType,setGameType,season),{
    kind:"select",id:"ratingsDivision",label:"地区",tier:"primary",value:activeDivision,defaultValue:"all",
    options:[{value:"all",label:"全チーム"},...present.map(d=>({value:d,label:divisionLabel(d)}))],onChange:value=>setDivision(value as DivisionChoice),
  }];
  const conditions=[season,seasonGameTypeLabels(season)[gameType],...(filter.range.kind === "all"?[]:situationalFilterLabels(filter)),...(activeDivision === "all"?[]:[divisionLabel(activeDivision)])];
  const standingById=new Map(request.data?.standings?.teams.map(team=>[team.teamId,team]));
  const sortedVisible=[...visible].sort((a,b)=>{
    if(sort.key==="division") {
      const sa=standingById.get(a.teamId),sb=standingById.get(b.teamId);
      const order=(d:Division|undefined)=>d?divisionOrder(category).indexOf(d):99;
      return ((order(sa?.division)-order(sb?.division))||((sa?.divisionRank??999)-(sb?.divisionRank??999))||a.teamId.localeCompare(b.teamId))*(sort.bestFirst?1:-1);
    }
    return (a[sort.key]-b[sort.key])*(sort.key === "drtg"?1:-1)*(sort.bestFirst?1:-1);
  });
  const toggleSort=(key:RatingKey|"division")=>setSort(previous=>({key,bestFirst:previous.key===key?!previous.bestFirst:true}));
  const baseDate={kind:"season" as const,season,gameType};
  const choose=(id:string,scroll=false)=>{setSelectedId(id);setTooltipId(scroll?null:id);if(scroll)plot.current?.scrollIntoView({block:"center",behavior:"smooth"});};
  return <section aria-label="ORtg・DRtgの散布図">
    <FilterBar axes={axes} stateKey="figures:ratings" onClearAll={()=>{setFilter(DEFAULT_RANGE);setGameType("regular");setDivision("all");}} />
    {request.loading?<p role="status">読み込み中…</p>:request.error || request.data?.missing.length?<p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p>:!model?.league || !visible.length?<p className="empty-message">この条件で表示できるチームがありません。</p>:<>
      <ExportImageButton targetRef={target} filename={`ORtg_DRtg_${conditions.join("_")}`} baseDate={baseDate}/>
      <ExportTarget ref={target} className="ratings-export" baseDate={baseDate}>
        {/* 見出しと条件の行はほかのページと同じ部品（半角スペースでだけ折り返す・区切りは「／」・初期値は書かない。DESIGN.md 239章・296章） */}
        <ConditionTitle title={`${statJa("ORtg","team")} × ${statJa("DRtg","team")}`} exportScope={`${season}シーズン`} conditions={conditions} />
        <p className="ratings-league">リーグ平均：ORtg {model.league.ortg.toFixed(2)} ／ DRtg {model.league.drtg.toFixed(2)}</p>
        <div className="ratings-legend">{present.map(d=><span key={d}><i style={{borderColor:DIVISION_RATING_COLORS[d]}}/>{divisionLabel(d)}</span>)}<span><i className="ratings-diagonal-key"/>NetRtg 0</span></div>
        <div ref={plot} onPointerDown={event=>{if(!(event.target as Element).closest(".ratings-point"))setTooltipId(null);}}>
          <RatingChart points={visible} all={model.points} league={model.league} selectedId={selected?.teamId??null} tooltip={tooltip} teamLabel={teamLabel} onSelect={id=>choose(id)} onDismiss={()=>setTooltipId(null)}/>
          <RatingChart exportOnly points={visible} all={model.points} league={model.league} selectedId={null} tooltip={null} teamLabel={teamLabel} onSelect={()=>{}} onDismiss={()=>{}}/>
        </div>
        <div className="figure-notes"><p>破線の十字は選択した期間・試合区分のリーグ平均。地区で絞っても、軸・平均・順位はリーグ全体が基準です。区画名はリーグ平均に対する相対評価です。</p>
          <p>斜めの薄い線はNetRtg 0（ORtgとDRtgが等しい位置）。試合ごとの値の平均ではなく、選択した試合の合計から計算しています。</p>
          {filter.range.kind === "recent"&&<p>直近の試合はチームごとに選ぶため対象日は異なります。全チームスタッツと同じく、直近の試合を先に選び、その後に試合区分を絞ります。対象試合数が指定より少なくなる場合があります。</p>}
          {model.omitted.length>0&&<p>対象試合がない、または値を確認できない{model.omitted.length}チームは表示していません。</p>}
          {!request.data?.divisions&&<p>地区の情報を読み込めないため、色分けは地区不明として表示しています。</p>}
        </div>
      </ExportTarget>
      <div id="ratings-team-detail" className="ratings-team-detail" aria-live="polite">{selected?<>
        <h3><ResponsiveTeamName teamId={selected.teamId} name={selected.teamName}/></h3>
        <p>{selected.games}試合（{selected.firstDate}〜{selected.lastDate}）</p>
        <p>{RATING_KEYS.map(key=><span key={key}>{RATING_LABELS[key]} {ratingColumn(key).format!(selected.row)}（{selected.ranks[key]}位）　</span>)}</p>
      </>:<p>ロゴに触れるか押すと、チームの値とリーグ順位を表示します。</p>}</div>
      <p className="figure-notes">ロゴが重なる場合は下の一覧から選ぶと、そのチームを手前に表示します。順位は表示値の同率を同順位とし、次の順位を飛ばしています。</p>
      <p className="figure-notes">地区順位はシーズンの最新の順位表が基準です{request.data?.standings?`（${request.data.standings.date}）`:"（取得できない場合は—）"}。対象期間を変えても変わりません。</p>
      <div className="ratings-table-scroll" tabIndex={0} role="region" aria-label="散布図のチーム一覧">
        <table className="ratings-table"><thead><tr><th>チーム</th><th aria-sort={sort.key==="division"?(sort.bestFirst?"ascending":"descending"):"none"}><button onClick={()=>toggleSort("division")}>地区順位{sort.key==="division"?(sort.bestFirst?" ↑":" ↓"):" ↕"}</button></th>{RATING_KEYS.map(key=><th key={key} aria-sort={sort.key===key?(sort.bestFirst===(key==="drtg")?"ascending":"descending"):"none"}><button title={statDescription(RATING_LABELS[key],"team")} onClick={()=>toggleSort(key)}>{RATING_LABELS[key]}（リーグ順位）{sort.key===key?(sort.bestFirst===(key==="drtg")?" ↑":" ↓"):" ↕"}</button></th>)}</tr></thead>
        <tbody>{sortedVisible.map(point=><tr key={point.teamId} className={selected?.teamId===point.teamId?"is-selected":""}><td><button onClick={()=>choose(point.teamId,true)}><ResponsiveTeamName teamId={point.teamId} name={point.teamName}/></button></td><td className="ratings-standing">{(()=>{const standing=standingById.get(point.teamId);return standing?.division&&standing.divisionRank?`${DIVISION_LABELS[standing.division][0]}${standing.divisionRank}`:"—";})()}</td>{RATING_KEYS.map(key=><td key={key}>{ratingColumn(key).format!(point.row)}（{point.ranks[key]}位）</td>)}</tr>)}</tbody></table>
      </div>
    </>}
  </section>;
}
function RatingLogo({point,label,selected,expanded,left,top,onSelect,onDismiss}:{point:RatingPoint;label:string;selected:boolean;expanded:boolean;left:number;top:number;onSelect:()=>void;onDismiss:()=>void}) {
  const[failed,setFailed]=useState(false);
  const description=`${label}：${RATING_KEYS.map(key=>`${RATING_LABELS[key]} ${ratingColumn(key).format!(point.row)}（${point.ranks[key]}位）`).join("、")}`;
  return <button className={`ratings-point${selected?" is-selected":""}${expanded?" is-expanded":""}`} style={{left:`${left}%`,top:`${top}%`,borderColor:DIVISION_RATING_COLORS[point.division??"unknown"]}}
    aria-label={description} aria-pressed={selected} onPointerEnter={event=>{if(event.pointerType==="mouse")onSelect();}} onPointerLeave={event=>{if(event.pointerType==="mouse")onDismiss();}} onFocus={onSelect} onBlur={onDismiss} onClick={onSelect}>
    {failed?<span className="ratings-fallback">{teamShortName(point.teamId,point.teamName)}</span>:<img src={teamLogoUrl(point.teamId)} alt="" width={26} height={26} loading="eager" onError={()=>setFailed(true)}/>}
  </button>;
}

function RatingChart({points,all,league,selectedId,tooltip,teamLabel,onSelect,onDismiss,exportOnly=false}:{points:RatingPoint[];all:RatingPoint[];league:Record<RatingKey,number>;selectedId:string|null;tooltip:RatingPoint|null;teamLabel:(id:string,name:string)=>string;onSelect:(id:string)=>void;onDismiss:()=>void;exportOnly?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  const [size,setSize]=useState(exportOnly?870:770);
  useEffect(()=>{
    if(exportOnly||!ref.current)return;
    const observer=new ResizeObserver(entries=>{const width=entries[0]?.contentRect.width;if(width)setSize(width);});
    observer.observe(ref.current);return ()=>observer.disconnect();
  },[exportOnly]);
  const mobile=!exportOnly&&size<500;
  // スマホ幅（560px以下）の画面では、図の上の順位ラベルを出さない（順位は吹き出しと一覧で見る）。PC幅と保存画像は出す（DESIGN.md 296章）
  const narrow=useNarrow();
  const hideRankLabels=!exportOnly&&narrow;
  const layout=useMemo(()=>hideRankLabels?{labels:[],height:size}:ratingLabelLayout(points,all,size,mobile),[points,all,size,mobile,hideRankLabels]);
  const domain=ratingDomain(all),position=(value:number)=>(value-domain.min)/(domain.max-domain.min)*100;
  return <div className={`ratings-chart ${exportOnly?"ratings-export-chart":"ratings-screen-chart"}`}>
    <div className="ratings-plot-wrap" style={{marginBottom:55+layout.height-size}}>
      <span className="ratings-y-label" title={statDescription("DRtg","team")}>DRtg ↑ 小さいほど良い</span>
      <div className="ratings-plot" ref={ref}>
        <span className="ratings-guide-clip"><span className="ratings-net-zero"/></span>
        {domain.ticks.map(tick=><span key={`v${tick}`} className="ratings-grid-v" style={{left:`${position(tick)}%`}}/>)}
        {domain.ticks.map(tick=><span key={`h${tick}`} className="ratings-grid-h" style={{top:`${position(tick)}%`}}/>)}
        <span className="ratings-average-v" style={{left:`${position(league.ortg)}%`}}/><span className="ratings-average-h" style={{top:`${position(league.drtg)}%`}}/>
        <span className="ratings-quadrant top left">守備型</span><span className="ratings-quadrant top right">攻守とも良い</span><span className="ratings-quadrant bottom left">攻守とも課題</span><span className="ratings-quadrant bottom right">攻撃型</span>
        {layout.labels.map(box=>{
          const endX=Math.max(box.x,Math.min(box.anchorX,box.x+box.width)),endY=Math.max(box.y,Math.min(box.anchorY,box.y+box.height));
          const dx=endX-box.anchorX,dy=endY-box.anchorY;
          return <span key={box.id}>
            {box.leader&&<span className="ratings-label-leader" style={{left:`${box.anchorX/size*100}%`,top:`${box.anchorY/size*100}%`,width:`${Math.hypot(dx,dy)/size*100}%`,transform:`rotate(${Math.atan2(dy,dx)}rad)`}}/>}
            <span className="ratings-rank-label" style={{left:`${box.x/size*100}%`,top:`${box.y/size*100}%`,width:box.width,height:box.height,fontSize:mobile?9:10}}>{box.texts.map(text=><span key={text}>{text}</span>)}</span>
          </span>;
        })}
        {points.map(point=><RatingLogo key={point.teamId} point={point} label={teamLabel(point.teamId,point.teamName)} selected={selectedId===point.teamId} expanded={tooltip?.teamId===point.teamId} left={position(point.ortg)} top={position(point.drtg)} onSelect={()=>onSelect(point.teamId)} onDismiss={onDismiss}/>)}
        {tooltip&&<div role="tooltip" className="ratings-tooltip" style={{left:`clamp(0px, calc(${position(tooltip.ortg)}% - 100px), calc(100% - 200px))`,top:`clamp(0px, calc(${position(tooltip.drtg)}% + 30px), calc(100% - 120px))`}}><strong>{teamLabel(tooltip.teamId,tooltip.teamName)}</strong>{RATING_KEYS.map(key=><span key={key}>{RATING_LABELS[key]} {ratingColumn(key).format!(tooltip.row)}（{tooltip.ranks[key]}位）</span>)}</div>}
      </div>
      {domain.ticks.map(tick=><span key={`x${tick}`} className="ratings-tick-x" style={{left:`${position(tick)}%`}}>{tick}</span>)}
      {domain.ticks.map(tick=><span key={`y${tick}`} className="ratings-tick-y" style={{top:`${position(tick)}%`}}>{tick}</span>)}
      <span className="ratings-x-label" title={statDescription("ORtg","team")}>ORtg → 大きいほど良い</span>
    </div>
  </div>;
}
