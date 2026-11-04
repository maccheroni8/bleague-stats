import { useMemo, useRef, useState } from "react";
import type { Division } from "../../shared/types";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { FilterBar } from "../components/FilterBar";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { ExportImageButton } from "../components/ExportImageButton";
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
import { buildFourFactors, ffRanks, ffText, sortFourFactors, FF_DEF, FF_DEFS, FF_NOTE, type FfKey } from "../lib/figureFourFactors";
import { statDescription } from "../lib/statDescriptions";
import { statJa } from "../lib/statNames";
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
const GROUPS=[
  {id:"rating",label:"レーティング"},
  {id:"offense",label:"オフェンスの Four Factors"},
  {id:"defense",label:"ディフェンスの Four Factors（相手の数字）"},
] as const;

export default function FourFactorsFigure({season,category}:FigureProps) {
  const [filter,setFilter]=useUrlState(rangeCodec,DEFAULT_RANGE);
  const [gameType,setGameType]=useUrlState(gameCodec,"regular");
  const [division,setDivision]=useUrlState(divisionCodec,NO_DIVISIONS);
  const [sort,setSort]=useState<{key:FfKey;bestFirst:boolean}>({key:"netrtg",bestFirst:true});
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
  const rangeAxes=situationalAxes(filter,next=>setFilter({range:next.range})).filter(axis=>axis.id === "s.range" || (filter.range.kind === "dateRange" && (axis.id === "s.dateStart" || axis.id === "s.dateEnd"))).map(axis=>{
    if(axis.kind === "select") return {...axis,options:axis.options.filter(option=>["all","recent:5","recent:10","custom"].includes(option.value))};
    return {...axis,tier:"primary" as const};
  });
  const axes:FilterAxis[]=[...rangeAxes,gameTypeAxis(gameType,setGameType,season),divisionMultiAxis<"unknown">({id:"fourFactorsDivision",divisions:present.filter((d):d is Division=>d!=="unknown"),extra:present.includes("unknown")?[{value:"unknown",label:"地区不明"}]:[],selected:activeDivision,onChange:setDivision})];
  const conditions=[season,seasonGameTypeLabels(season)[gameType],...(filter.range.kind === "all"?[]:situationalFilterLabels(filter)),...(activeDivision.length === 0?[]:[activeDivision.map(divisionLabel).join("・")])];
  const baseDate={kind:"season" as const,season,gameType};
  const targetRef=useRef<HTMLDivElement>(null);
  const toggleSort=(key:FfKey)=>setSort(previous=>({key,bestFirst:previous.key===key?!previous.bestFirst:true}));
  return <section aria-label="Four Factors とレーティングの色分け表">
    <FilterBar axes={axes} stateKey="figures:fourfactors" onClearAll={()=>{setFilter(DEFAULT_RANGE);setGameType("regular");setDivision(NO_DIVISIONS);}} />
    {request.loading?<p role="status">読み込み中…</p>:request.error || request.data?.missing.length?<p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p>:!model || !rows.length?<p className="empty-message">この条件で表示できるチームがありません。</p>:<>
      <ExportImageButton targetRef={targetRef} filename={`Four_Factors_${conditions.join("_")}`} baseDate={baseDate}/>
      <ExportTarget ref={targetRef} className="ratings-export fourfactors-export" baseDate={baseDate}>
        <ConditionTitle title="Four Factors" exportScope={`${season}シーズン`} conditions={conditions} />
        <div className="fourfactors-scroll" tabIndex={0} role="region" aria-label="Four Factors とレーティングの表">
          <table className="fourfactors-table">
            <thead>
              <tr>
                <th rowSpan={2} className="ff-rank">順位</th>
                <th rowSpan={2} className="ff-team">チーム</th>
                {GROUPS.map(group=><th key={group.id} colSpan={FF_DEFS.filter(def=>def.group===group.id).length} className={`ff-group ff-group-${group.id}`}>{group.label}</th>)}
              </tr>
              <tr>
                {FF_DEFS.map(def=><th key={def.key} className={`ff-col${def.key==="efg"||def.key==="oppefg"||def.key==="netrtg"?" ff-group-start":""}`} aria-sort={sort.key===def.key?(sort.bestFirst===def.higherIsBetter?"descending":"ascending"):"none"}>
                  <button title={headerTitle(def.label)} onClick={()=>toggleSort(def.key)}>{def.label}<span className="export-hide">{sort.key===def.key?(sort.bestFirst===def.higherIsBetter?" ↓":" ↑"):" ↕"}</span></button>
                </th>)}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row,i)=><tr key={row.item.teamId}>
                <td className="ff-rank">{ranks[i]}</td>
                <td className="ff-team"><span className="team-name-cell"><TeamLogo teamId={row.item.teamId} size={20}/><ResponsiveTeamName teamId={row.item.teamId} name={row.item.teamName}/></span></td>
                {FF_DEFS.map(def=><td key={def.key} className={`ff-cell ff-l${row.levels[def.key]}${def.key==="efg"||def.key==="oppefg"||def.key==="netrtg"?" ff-group-start":""}`} data-level={row.levels[def.key]}>{ffText(def.key,row.item.row)}</td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
        <p className="figure-notes ff-note">{FF_NOTE}</p>
      </ExportTarget>
      {model.omitted.length>0&&<p className="figure-notes export-hide">対象試合がない、または値を確認できない{model.omitted.length}チームは表示していません。</p>}
      {!request.data?.divisions&&<p className="figure-notes export-hide">地区の情報を読み込めないため、地区不明として扱っています。</p>}
    </>}
  </section>;
}
