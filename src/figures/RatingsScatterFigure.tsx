import { useMemo, useRef, useState } from "react";
import type { Division } from "../../shared/types";
import { teamShortName } from "../../shared/teamNames";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { FilterBar } from "../components/FilterBar";
import { ExportTarget } from "../components/ExportTarget";
import { ExportImageButton } from "../components/ExportImageButton";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { fetchTeams, fetchTeamGameLogs, fetchDivisionHistory, teamLogoUrl } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { enumParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { gameTypeAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import { type SituationalFilter } from "../lib/situational";
import { situationalFilterLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS, DIVISION_ORDER } from "../lib/divisionGroups";
import { buildRatingScatter, ratingDomain, ratingColumn, RATING_KEYS, RATING_LABELS, DIVISION_RATING_COLORS, type RatingPoint } from "../lib/figureRatings";
import { useTeamLabel } from "../lib/teamLabel";
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
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const target=useRef<HTMLDivElement>(null);
  const plot=useRef<HTMLDivElement>(null);
  const teamLabel=useTeamLabel();
  const request=useJsonData(async()=>{
    const teams=await fetchTeams(season,category);
    const [divisions,entries]=await Promise.all([fetchDivisionHistory().catch(()=>null),Promise.all(teams.map(async team=>{
      try {return [team.teamId,await fetchTeamGameLogs(season,team.teamId)] as const;}
      catch {return [team.teamId,null] as const;}
    }))]);
    const missing=entries.filter(([,logs])=>logs===null).map(([id])=>id);
    return {teams,divisions,missing,logs:new Map(entries.map(([id,logs])=>[id,logs??[]]))};
  },[season,category]);
  const model=useMemo(()=>request.data && !request.data.missing.length ? buildRatingScatter(request.data.teams,request.data.logs,request.data.divisions,{season,category,range:filter.range,gameType}) : null,[request.data,season,category,filter,gameType]);
  const present=useMemo(()=>{
    const values=new Set(model?.points.map(point=>point.division??"unknown"));
    return [...DIVISION_ORDER.filter(d=>values.has(d)),...(values.has("unknown")?["unknown" as const]:[])];
  },[model]);
  const activeDivision=division === "all" || present.includes(division) ? division : "all";
  const visible=model?.points.filter(point=>activeDivision === "all" || (point.division??"unknown")===activeDivision)??[];
  const selected=visible.find(point=>point.teamId===selectedId)??null;
  const domain=ratingDomain(model?.points??[]);
  const position=(value:number)=>(value-domain.min)/(domain.max-domain.min)*100;
  const rangeAxes=situationalAxes(filter,next=>setFilter({range:next.range})).filter(axis=>axis.id === "s.range" || (filter.range.kind === "dateRange" && (axis.id === "s.dateStart" || axis.id === "s.dateEnd"))).map(axis=>{
    if(axis.kind === "select") return {...axis,options:axis.options.filter(option=>["all","recent:5","recent:10","custom"].includes(option.value))};
    return {...axis,tier:"primary" as const};
  });
  const axes:FilterAxis[]=[...rangeAxes,gameTypeAxis(gameType,setGameType,season),{
    kind:"select",id:"ratingsDivision",label:"地区",tier:"primary",value:activeDivision,defaultValue:"all",
    options:[{value:"all",label:"全チーム"},...present.map(d=>({value:d,label:divisionLabel(d)}))],onChange:value=>setDivision(value as DivisionChoice),
  }];
  const conditions=[season,seasonGameTypeLabels(season)[gameType],...(filter.range.kind === "all"?[]:situationalFilterLabels(filter)),...(activeDivision === "all"?[]:[divisionLabel(activeDivision)])];
  const baseDate={kind:"season" as const,season,gameType};
  const choose=(id:string,scroll=false)=>{setSelectedId(id);if(scroll)plot.current?.scrollIntoView({block:"center",behavior:"smooth"});};
  return <section aria-label="ORtg・DRtgの散布図">
    <FilterBar axes={axes} stateKey="figures:ratings" onClearAll={()=>{setFilter(DEFAULT_RANGE);setGameType("regular");setDivision("all");}} />
    {request.loading?<p role="status">読み込み中…</p>:request.error || request.data?.missing.length?<p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p>:!model?.league || !visible.length?<p className="empty-message">この条件で表示できるチームがありません。</p>:<>
      <ExportImageButton targetRef={target} filename={`ORtg_DRtg_${conditions.join("_")}`} baseDate={baseDate}/>
      <ExportTarget ref={target} className="ratings-export" baseDate={baseDate}>
        <div className="condition-title"><h2>{statJa("ORtg","team")}・{statJa("DRtg","team")}</h2><p>{conditions.join(" · ")}</p></div>
        <p className="ratings-league">リーグ平均：ORtg {model.league.ortg.toFixed(1)} ／ DRtg {model.league.drtg.toFixed(1)}</p>
        <div className="ratings-legend">{present.map(d=><span key={d}><i style={{borderColor:DIVISION_RATING_COLORS[d]}}/>{divisionLabel(d)}</span>)}<span><i className="ratings-diagonal-key"/>NetRtg 0</span></div>
        <div className="ratings-chart" ref={plot}>
          <div className="ratings-plot-wrap">
            <span className="ratings-y-label" title={statDescription("DRtg","team")}>DRtg ↑ 小さいほど良い</span>
            <div className="ratings-plot">
              <span className="ratings-guide-clip"><span className="ratings-net-zero"/></span>
              {domain.ticks.map(tick=><span key={tick} className="ratings-grid-v" style={{left:`${position(tick)}%`}}/>)}
              {domain.ticks.map(tick=><span key={tick} className="ratings-grid-h" style={{top:`${position(tick)}%`}}/>)}
              <span className="ratings-average-v" style={{left:`${position(model.league.ortg)}%`}}/>
              <span className="ratings-average-h" style={{top:`${position(model.league.drtg)}%`}}/>
              <span className="ratings-quadrant top left">守備型</span><span className="ratings-quadrant top right">攻守とも良い</span>
              <span className="ratings-quadrant bottom left">攻守とも課題</span><span className="ratings-quadrant bottom right">攻撃型</span>
              {visible.map(point=><RatingLogo key={point.teamId} point={point} label={teamLabel(point.teamId,point.teamName)} selected={selected?.teamId===point.teamId}
                left={position(point.ortg)} top={position(point.drtg)} onSelect={()=>choose(point.teamId)}/>)}
            </div>
            {domain.ticks.map(tick=><span key={`x${tick}`} className="ratings-tick-x" style={{left:`${position(tick)}%`}}>{tick}</span>)}
            {domain.ticks.map(tick=><span key={`y${tick}`} className="ratings-tick-y" style={{top:`${position(tick)}%`}}>{tick}</span>)}
            <span className="ratings-x-label" title={statDescription("ORtg","team")}>ORtg → 大きいほど良い</span>
          </div>
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
      <div className="ratings-table-scroll" tabIndex={0} role="region" aria-label="散布図のチーム一覧">
        <table className="ratings-table"><thead><tr><th>チーム</th>{RATING_KEYS.map(key=><th key={key} title={statDescription(RATING_LABELS[key],"team")}>{RATING_LABELS[key]}（リーグ順位）</th>)}</tr></thead>
        <tbody>{[...visible].sort((a,b)=>b.netrtg-a.netrtg).map(point=><tr key={point.teamId} className={selected?.teamId===point.teamId?"is-selected":""}><td><button onClick={()=>choose(point.teamId,true)}><ResponsiveTeamName teamId={point.teamId} name={point.teamName}/></button></td>{RATING_KEYS.map(key=><td key={key}>{ratingColumn(key).format!(point.row)}（{point.ranks[key]}位）</td>)}</tr>)}</tbody></table>
      </div>
    </>}
  </section>;
}
function RatingLogo({point,label,selected,left,top,onSelect}:{point:RatingPoint;label:string;selected:boolean;left:number;top:number;onSelect:()=>void}) {
  const[failed,setFailed]=useState(false);
  const description=`${label}：${RATING_KEYS.map(key=>`${RATING_LABELS[key]} ${ratingColumn(key).format!(point.row)}（${point.ranks[key]}位）`).join("、")}`;
  return <button className={`ratings-point${selected?" is-selected":""}`} style={{left:`${left}%`,top:`${top}%`,borderColor:DIVISION_RATING_COLORS[point.division??"unknown"]}}
    aria-label={description} aria-pressed={selected} title={description} onMouseEnter={onSelect} onFocus={onSelect} onClick={onSelect}>
    {failed?<span className="ratings-fallback">{teamShortName(point.teamId,point.teamName)}</span>:<img src={teamLogoUrl(point.teamId)} alt="" width={26} height={26} loading="eager" onError={()=>setFailed(true)}/>}
  </button>;
}
