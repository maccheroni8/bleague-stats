import { useEffect, useMemo, useRef, useState } from "react";
import type { Division } from "../../shared/types";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { FilterBar } from "../components/FilterBar";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { FigureExportButton } from "./FigureExport";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { TeamLogo } from "../components/TeamLogo";
import { fetchTeams, fetchTeamGameLogs, fetchDivisionHistory } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { divisionListParam, enumParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { divisionMultiAxis, gameTypeAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import { type SituationalFilter } from "../lib/situational";
import { situationalFilterLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS, divisionOrder } from "../lib/divisionGroups";
import { buildRatingScatter } from "../lib/figureRatings";
import { buildFourFactors, ffRanks, ffText, sortFourFactors, FF_DEF, FF_DEFS, FF_KEYS, FF_NOTE, type FfKey } from "../lib/figureFourFactors";
import { statDescription } from "../lib/statDescriptions";
import { statJa } from "../lib/statNames";
import { useTeamLabel } from "../lib/teamLabel";
import type { FigureProps } from "./catalog";
import "./FourFactorsFigure.css";

const DEFAULT_RANGE: SituationalFilter = {range:{kind:"all"}};
// 期間だけを共通のURL形式で読む（ORtg・DRtgの図と同じ）。
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
const divisionLabel=(division: Division | "unknown")=>division === "unknown" ? "地区不明" : DIVISION_LABELS[division];
const headerTitle=(label:string)=>label.startsWith("opp ")?`相手の${statDescription(label.slice(4),"team")??statJa(label,"team")}`:statDescription(label,"team")??statJa(label,"team");
// 並べ替え（ffs=項目 または 項目:rev）。初期値（NetRtg の良い順）は URL に載せない
type SortState={key:FfKey;bestFirst:boolean};
const DEFAULT_SORT:SortState={key:"netrtg",bestFirst:true};
const sortCodec:UrlCodec<SortState>={
  keys:["ffs"],read:p=>{
    const [key,dir]=(p.get("ffs")??"").split(":");
    const found=FF_DEFS.find(def=>def.key===key);
    return found?{key:found.key,bestFirst:dir!=="rev"}:undefined;
  },write:(p,value)=>{
    p.delete("ffs");
    if(value.key!==DEFAULT_SORT.key||!value.bestFirst)p.set("ffs",value.bestFirst?value.key:`${value.key}:rev`);
  },
};
const GROUPS=[
  {id:"rating",label:"RATING"},
  {id:"offense",label:"OFFENSE"},
  {id:"defense",label:"DEFENSE"},
] as const;

export default function FourFactorsFigure({season,category}:FigureProps) {
  const [filter,setFilter]=useUrlState(rangeCodec,DEFAULT_RANGE);
  const [gameType,setGameType]=useUrlState(gameCodec,"regular");
  const [division,setDivision]=useUrlState(divisionCodec,NO_DIVISIONS);
  const [sort,setSort]=useUrlState(sortCodec,DEFAULT_SORT);
  const request=useJsonData(async()=>{
    const teams=await fetchTeams(season,category);
    const [divisions,entries]=await Promise.all([fetchDivisionHistory().catch(()=>null),Promise.all(teams.map(async team=>{
      try {return [team.teamId,await fetchTeamGameLogs(season,team.teamId,category)] as const;}
      catch {return [team.teamId,null] as const;}
    }))]);
    const missing=entries.filter(([,logs])=>logs===null).map(([id])=>id);
    return {teams,divisions,missing,logs:new Map(entries.map(([id,logs])=>[id,logs??[]]))};
  },[season,category]);
  const model=useMemo(()=>request.data && !request.data.missing.length ? buildRatingScatter(request.data.teams,request.data.logs,request.data.divisions,{season,category,range:filter.range,gameType}) : null,[request.data,season,category,filter,gameType]);
  const present=useMemo(()=>{
    const values=new Set(model?.points.map(point=>point.division??"unknown"));
    return [...divisionOrder(category).filter(d=>values.has(d)),...(values.has("unknown")?["unknown" as const]:[])];
  },[model,category]);
  const activeDivision=division.filter(d=>present.includes(d));
  // 色は「表示しているチーム」の中で決める（地区で絞ったら、その地区のチームの中での位置）
  const rows=useMemo(()=>buildFourFactors((model?.points??[]).filter(point=>activeDivision.length === 0 || activeDivision.includes(point.division??"unknown"))),[model,activeDivision.join(",")]);
  const sorted=useMemo(()=>sortFourFactors(rows,sort.key,sort.bestFirst),[rows,sort]);
  const ranks=useMemo(()=>ffRanks(sorted,sort.key),[sorted,sort.key]);
  // 数字のマスのポップアップ（ORtg × DRtg の図の吹き出しと同じ動き: マウスを乗せると出て外すと消える、タッチ・キーボードは押す／フォーカス）。順位は表示しているチームの中（色の向きと同じ）
  const rankMaps=useMemo(()=>Object.fromEntries(FF_KEYS.map(key=>{const list=ffRanks(rows,key);return [key,new Map(rows.map((row,i)=>[row.item.teamId,list[i]!]))];})) as Record<FfKey,Map<string,number>>,[rows]);
  const [tip,setTip]=useState<{teamId:string;key:FfKey;x:number;top:number;bottom:number}|null>(null);
  const teamLabel=useTeamLabel();
  const tipCell=useRef<{cell:HTMLElement;at:number}|null>(null);
  const showTip=(teamId:string,key:FfKey,cell:HTMLElement)=>{tipCell.current={cell,at:Date.now()};const r=cell.getBoundingClientRect();setTip({teamId,key,x:r.left+r.width/2,top:r.top,bottom:r.bottom});};
  useEffect(()=>{
    if(!tip)return;
    const hide=()=>setTip(null);
    // 押した直後はブラウザが押したマスを見える位置へ動かす（スクロールが起きる）ので、そのときは消さずに位置を取り直す。ほかのスクロールでは消す
    const onScroll=()=>{const shown=tipCell.current;if(shown&&Date.now()-shown.at<500&&shown.cell.isConnected){const r=shown.cell.getBoundingClientRect();setTip(previous=>previous&&{...previous,x:r.left+r.width/2,top:r.top,bottom:r.bottom});}else hide();};
    const outside=(event:PointerEvent)=>{if(!(event.target as Element | null)?.closest?.(".ff-cell"))hide();};
    document.addEventListener("pointerdown",outside);window.addEventListener("scroll",onScroll,true);window.addEventListener("resize",hide);
    return ()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("scroll",onScroll,true);window.removeEventListener("resize",hide);};
  },[tip]);
  const tipRow=tip?rows.find(row=>row.item.teamId===tip.teamId):undefined;
  const rangeAxes=situationalAxes(filter,next=>setFilter({range:next.range})).filter(axis=>axis.id === "s.range" || (filter.range.kind === "dateRange" && (axis.id === "s.dateStart" || axis.id === "s.dateEnd"))).map(axis=>{
    if(axis.kind === "select") return {...axis,options:axis.options.filter(option=>["all","recent:5","recent:10","custom"].includes(option.value))};
    return {...axis,tier:"primary" as const};
  });
  const axes:FilterAxis[]=[...rangeAxes,gameTypeAxis(gameType,setGameType,season),divisionMultiAxis<"unknown">({id:"fourFactorsDivision",divisions:present.filter((d):d is Division=>d!=="unknown"),extra:present.includes("unknown")?[{value:"unknown",label:"地区不明"}]:[],selected:activeDivision,onChange:setDivision})];
  const [periodLabel]=situationalFilterLabels(filter);
  // 副題は「期間／試合種別／（絞り込んだときだけ）地区」。期間は「シーズン全体」のときも書く
  const conditions=[`${season} ${periodLabel}`,seasonGameTypeLabels(season)[gameType],...(activeDivision.length === 0?[]:[activeDivision.map(divisionLabel).join("・")])];
  // 並べている項目と向き（↓＝値が大きい順、↑＝小さい順）。副題の末尾に書く
  const sortLabel=`${FF_DEF[sort.key].label}${sort.bestFirst===FF_DEF[sort.key].higherIsBetter?"↓":"↑"}`;
  const baseDate={kind:"season" as const,season,gameType};
  const targetRef=useRef<HTMLDivElement>(null);
  const toggleSort=(key:FfKey)=>setSort(previous=>({key,bestFirst:previous.key===key?!previous.bestFirst:true}));
  return <section aria-label="Four Factors とレーティングの色分け表">
    <FilterBar axes={axes} stateKey="figures:fourfactors" onClearAll={()=>{setFilter(DEFAULT_RANGE);setGameType("regular");setDivision(NO_DIVISIONS);setSort(DEFAULT_SORT);}} />
    {request.loading?<p role="status">読み込み中…</p>:request.error || request.data?.missing.length?<p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p>:!model || !rows.length?<p className="empty-message">この条件で表示できるチームがありません。</p>:<>
      <FigureExportButton targetRef={targetRef} filename={`Four_Factors_${conditions.join("_")}`} baseDate={baseDate}/>
      <ExportTarget ref={targetRef} className="ratings-export fourfactors-export" baseDate={baseDate}>
        <ConditionTitle title="Four Factors" exportScope={`${season}シーズン`} conditions={[...conditions,sortLabel]} />
        <div className="fourfactors-scroll" tabIndex={0} role="region" aria-label="Four Factors とレーティングの表">
          <table className="fourfactors-table">
            <colgroup><col className="ff-col-rank"/><col className="ff-col-team"/>{FF_DEFS.map(def=><col key={def.key} className="ff-col-value"/>)}</colgroup>
            <thead>
              <tr>
                <th rowSpan={2} className="ff-rank">#</th>
                <th rowSpan={2} className="ff-team">TEAM</th>
                {GROUPS.map(group=><th key={group.id} colSpan={FF_DEFS.filter(def=>def.group===group.id).length} className={`ff-group ff-group-${group.id}`}>{group.label}</th>)}
              </tr>
              <tr>
                {FF_DEFS.map(def=><th key={def.key} className={`ff-col${def.key==="efg"||def.key==="oppefg"||def.key==="netrtg"?" ff-group-start":""}`} aria-sort={sort.key===def.key?(sort.bestFirst===def.higherIsBetter?"descending":"ascending"):"none"}>
                  <button title={headerTitle(def.label)} onClick={()=>toggleSort(def.key)}>{def.label.startsWith("opp ")?<><span className="ff-opp">opp</span><span className="ff-opp">{def.label.slice(4)}<span className="export-hide">{sort.key===def.key?(sort.bestFirst===def.higherIsBetter?" ↓":" ↑"):" ↕"}</span></span></>:<>{def.label}<span className="export-hide">{sort.key===def.key?(sort.bestFirst===def.higherIsBetter?" ↓":" ↑"):" ↕"}</span></>}</button>
                </th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row,i)=><tr key={row.item.teamId}>
                <td className="ff-rank">{ranks[i]}</td>
                <td className="ff-team"><span className="team-name-cell"><TeamLogo teamId={row.item.teamId} size={20}/><ResponsiveTeamName teamId={row.item.teamId} name={row.item.teamName} nowrap/></span></td>
                {FF_DEFS.map(def=><td key={def.key} tabIndex={0} onPointerEnter={event=>{if(event.pointerType==="mouse")showTip(row.item.teamId,def.key,event.currentTarget);}} onPointerLeave={event=>{if(event.pointerType==="mouse")setTip(null);}} onFocus={event=>showTip(row.item.teamId,def.key,event.currentTarget)} onBlur={()=>setTip(null)} onClick={event=>showTip(row.item.teamId,def.key,event.currentTarget)} className={`ff-cell ff-l${row.levels[def.key]}${def.key==="efg"||def.key==="oppefg"||def.key==="netrtg"?" ff-group-start":""}`} data-level={row.levels[def.key]}>{ffText(def.key,row.item.row)}</td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
        <p className="figure-notes ff-note">{FF_NOTE}</p>
      </ExportTarget>
      {tip&&tipRow&&<div role="tooltip" className="ff-tooltip" style={{left:`clamp(8px, calc(${tip.x}px - 130px), calc(100vw - 268px))`,...(tip.bottom+120>innerHeight&&tip.top>130?{top:tip.top-6,transform:"translateY(-100%)"}:{top:tip.bottom+6})}}>
        <strong>{teamLabel(tipRow.item.teamId,tipRow.item.teamName)}</strong>
        <span>{FF_DEF[tip.key].label}</span>
        <span>{ffText(tip.key,tipRow.item.row)}</span>
        <span>{rankMaps[tip.key].get(tip.teamId)}位／{rows.length}チーム</span>
      </div>}
      {model.omitted.length>0&&<p className="figure-notes export-hide">対象試合がない、または値を確認できない{model.omitted.length}チームは表示していません。</p>}
      {!request.data?.divisions&&<p className="figure-notes export-hide">地区の情報を読み込めないため、地区不明として扱っています。</p>}
    </>}
  </section>;
}
