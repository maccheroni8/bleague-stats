import { useMemo } from "react";
import { foulSplitSeason, playerFoulRows, type PlayerFoulRow } from "../lib/figureFouls";
import { useActivePlayerIds } from "../lib/activePlayers";
import { isLastTeamRow } from "../lib/lastTeamRule";
import { currentSeason } from "../lib/season";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { PlayerNamePool } from "../components/PlayerNamePool";
import { ResponsivePlayerName } from "../components/ResponsivePlayerName";
import { LastTeamName } from "../components/LastTeamName";
import { FoulTable, foulsStatus, useFoulsScope, type FoulColumn } from "./FoulsFigure";
import type { FigureProps } from "./catalog";

type Col = FoulColumn<PlayerFoulRow>;
const TF_COLUMNS: Col[] = [
  { key: "tf", label: "TF", value: r => r.tf },
  { key: "tfTwice", label: "1試合で2回", value: r => r.tfTwice },
];
const UF_COLUMNS_OLD: Col[] = [
  { key: "uf", label: "UF", value: r => r.uf },
  { key: "ufTwice", label: "1試合で2回", value: r => r.ufTwice },
];
const UF_COLUMNS_NEW: Col[] = [
  { key: "flagrant", label: "フレグラント", value: r => r.flagrant },
  { key: "disruptive", label: "ディスラプティブ", value: r => r.disruptive },
  { key: "uf", label: "合計", value: r => r.uf },
  { key: "ufTwice", label: "1試合で2回", value: r => r.ufTwice },
];
const DQ_COLUMNS: Col[] = [{ key: "dq", label: "DQ", value: r => r.dq }];
const playerName = (r: PlayerFoulRow) => r.name;

export default function PlayerFoulsFigure({ season, category }: FigureProps) {
  const { scope, conditions, filterBar, request } = useFoulsScope(season, category, "figures:player-fouls");
  const rows = useMemo(() => request.data ? playerFoulRows(request.data, scope) : [], [request.data, scope.gameType, scope.range]);
  // 今季の表だけ、今の名簿（B.PREMIER か B.ONE）にいない選手を「最終所属：〜」にする（サイトの決まり。過去のシーズンの表はそのシーズンのチーム）
  const isCurrent = season === currentSeason();
  const active = useActivePlayerIds(isCurrent);
  const split = foulSplitSeason(season);
  const ufColumns = split ? UF_COLUMNS_NEW : UF_COLUMNS_OLD;
  const tables = [
    { id: "tf", title: "テクニカルファウル（選手）", label: "TF", file: "選手_テクニカルファウル", columns: TF_COLUMNS, main: TF_COLUMNS[0]!, sortParam: "fpt" },
    { id: "uf", title: "アンスポーツマンライクファウル系（選手）", label: "UF", file: "選手_アンスポーツマンライクファウル系", columns: ufColumns, main: ufColumns.find(c => c.key === "uf")!, sortParam: "fpu" },
    { id: "dq", title: "ディスクォリファイングファウル（選手）", label: "DQ", file: "選手_ディスクォリファイングファウル", columns: DQ_COLUMNS, main: DQ_COLUMNS[0]!, sortParam: "fpd" },
  ];
  const status = foulsStatus(request);
  return <section aria-label="ファウル（選手）" className="fouls-figure">
    {filterBar}
    {status ?? tables.map(t => {
      // 1回以上吹かれた選手だけ（0回の選手は載せない）
      const listed = rows.filter(r => t.main.value(r) > 0);
      const names = listed.map(r => r.name);
      return <PlayerNamePool key={`${t.id}:${split}`} names={names}>
        <FoulTable title={t.title} exportLabel={t.label} filename={t.file} season={season} conditions={conditions} gameType={scope.gameType}
          rows={listed} rowKey={r => r.playerId} rowName={playerName} columns={t.columns} mainKey={t.main.key} sortParam={t.sortParam} nameHeader="PLAYER" emptyText="この条件で吹かれた選手はいません。"
          renderName={r => <div className="fouls-who">
            <PlayerPhoto playerId={r.playerId} size={40} className="player-cell-photo" placeholder season={season} teamId={r.lastTeamId} />
            <span className="fouls-who-line">
              <ResponsivePlayerName name={r.name} among={names} />
              <span className="fouls-team"><LastTeamName teamId={r.lastTeamId} name={r.lastTeamName} last={isCurrent && isLastTeamRow(season, [r.playerId], active.ids, season)} /></span>
            </span>
          </div>} />
      </PlayerNamePool>;
    })}
  </section>;
}
