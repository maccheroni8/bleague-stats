import { useMemo } from "react";
import { foulSplitSeason, teamFoulRows, type TeamFoulRow } from "../lib/figureFouls";
import { TeamLogo } from "../components/TeamLogo";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { FoulTable, foulsStatus, useFoulsScope, type FoulColumn } from "./FoulsFigure";
import type { FigureProps } from "./catalog";

type Col = FoulColumn<TeamFoulRow>;
const TF_COLUMNS: Col[] = [
  { key: "tf", label: "合計", value: r => r.tf },
  { key: "tfCoach", label: "コーチ", value: r => r.tfCoach },
  { key: "tfBench", label: "ベンチ", value: r => r.tfBench },
  { key: "tfPlayer", label: "選手", value: r => r.tfPlayer },
];
const UF_COLUMNS_OLD: Col[] = [{ key: "uf", label: "UF", value: r => r.uf }];
const UF_COLUMNS_NEW: Col[] = [
  { key: "flagrant", label: "フレグラント", value: r => r.flagrant },
  { key: "disruptive", label: "ディスラプティブ", value: r => r.disruptive },
  { key: "uf", label: "合計", value: r => r.uf },
];
const DQ_COLUMNS: Col[] = [{ key: "dq", label: "DQ", value: r => r.dq }];
const teamName = (r: TeamFoulRow) => r.teamName;

export default function TeamFoulsFigure({ season, category }: FigureProps) {
  const { scope, conditions, filterBar, request } = useFoulsScope(season, category, "figures:team-fouls");
  const rows = useMemo(() => request.data ? teamFoulRows(request.data, scope) : [], [request.data, scope.gameType, scope.range]);
  const split = foulSplitSeason(season);
  // 初めの並びは主な数（合計・UF・DQ）の多い順。表の列の並びは指定どおり（2026-27 からは フレグラント／ディスラプティブ／合計）
  const tables = [
    { id: "tf", title: "テクニカルファウル（チーム）", label: "TF", file: "チーム_テクニカルファウル", columns: TF_COLUMNS, mainKey: "tf", sortParam: "fst" },
    { id: "uf", title: "アンスポーツマンライクファウル系（チーム）", label: "UF", file: "チーム_アンスポーツマンライクファウル系", columns: split ? UF_COLUMNS_NEW : UF_COLUMNS_OLD, mainKey: "uf", sortParam: "fsu" },
    { id: "dq", title: "ディスクォリファイングファウル（チーム）", label: "DQ", file: "チーム_ディスクォリファイングファウル", columns: DQ_COLUMNS, mainKey: "dq", sortParam: "fsd" },
  ];
  const status = foulsStatus(request);
  return <section aria-label="ファウル（チーム）" className="fouls-figure">
    {filterBar}
    {status ?? (rows.length === 0 ? <p className="empty-message">この条件で表示できるチームがありません。</p> : tables.map(t =>
      <FoulTable key={`${t.id}:${split}`} title={t.title} exportLabel={t.label} filename={t.file} season={season} conditions={conditions} gameType={scope.gameType}
        rows={rows} rowKey={r => r.teamId} rowName={teamName} columns={t.columns} mainKey={t.mainKey} sortParam={t.sortParam} nameHeader="TEAM" average emptyText="この条件で表示できるチームがありません。"
        renderName={r => <span className="fouls-team-line"><TeamLogo teamId={r.teamId} size={24} /><ResponsiveTeamName teamId={r.teamId} name={r.teamName} nowrap /></span>} />))}
  </section>;
}
