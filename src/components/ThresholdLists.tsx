import type { TeamColors } from "../../shared/types";
import { formatPct } from "../lib/format";
import { GAME_RECORD_TIE_EXPAND_MAX } from "../lib/gameRecordQuery";
import type { ThresholdCountRow, ThresholdCountSort } from "../lib/thresholdQuery";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerPhoto } from "./PlayerPhoto";
import { RankedList } from "./RankedList";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/** 達成記録の一覧（DESIGN.md 223章）。達成試合数・連続記録・達成時の年齢の3つで共通の見た目（写真・名前・値・名前の下の行） */
const RANK_TOP_N = 20;

type Colors = Record<string, TeamColors> | undefined;

function CountLine({ r, sort, allTime }: { r: ThresholdCountRow; sort: ThresholdCountSort; allTime: boolean }) {
  const span = r.firstSeason === r.lastSeason ? r.lastSeason : `${r.firstSeason}〜${r.lastSeason}`;
  return (
    <>
      <span className="record-date-nowrap">
        {sort === "count" ? `出場${r.games}試合・達成率${formatPct(r.rate)}` : `${r.count}試合／出場${r.games}試合`}
      </span>
      {"　"}
      <ResponsiveTeamName teamId={r.teamId} name={r.teamName} always nowrap />
      {allTime && <span className="record-date-nowrap">　{span}</span>}
    </>
  );
}

export function ThresholdCountList({
  rows,
  sort,
  allTime,
  teamColors,
}: {
  rows: ThresholdCountRow[];
  sort: ThresholdCountSort;
  allTime: boolean;
  teamColors: Colors;
}) {
  return (
    <PlayerNamePool names={rows.map((e) => e.playerName)}>
      <RankedList
        rows={rows}
        def={{
          key: `threshold:count:${sort}`,
          label: sort === "count" ? "達成試合数" : "達成率",
          value: (e) => e.value,
          format: (e) => (sort === "count" ? String(e.count) : formatPct(e.rate)),
          higherIsBetter: true,
        }}
        tieKey={(e) => String(e.value)}
        rowKey={(e) => e.playerId}
        name={(e) => <ResponsivePlayerName name={e.playerName} playerId={e.playerId} season={allTime ? undefined : e.lastSeason} />}
        subLabel={(e) => <CountLine r={e} sort={sort} allTime={allTime} />}
        linkTo={(e) => `/players/${e.playerId}?season=${e.lastSeason}`}
        teamColor={(e) => teamColors?.[e.teamId]?.primary}
        avatar={(e) => <PlayerPhoto playerId={e.playerId} size={56} className="player-cell-photo" placeholder />}
        limit={RANK_TOP_N}
        tieExpandMax={GAME_RECORD_TIE_EXPAND_MAX}
        sortable={false}
        compact
      />
    </PlayerNamePool>
  );
}
