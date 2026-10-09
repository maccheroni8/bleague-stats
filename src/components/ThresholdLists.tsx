import type { TeamColors } from "../../shared/types";
import { formatAgeOnDate } from "../../shared/gameAge";
import { formatPct } from "../lib/format";
import { GAME_RECORD_TIE_EXPAND_MAX } from "../lib/gameRecordQuery";
import { useNarrow } from "../lib/teamLabel";
import type { StreakGame, ThresholdAgeRow, ThresholdAgeWhich, ThresholdCountRow, ThresholdCountSort, ThresholdStreakRow } from "../lib/thresholdQuery";
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

/** 連続の開始・終了の試合1つ: 「開始 2017-04-29（2016-17） 新潟 @ 三遠　PTS 12」 */
function StreakGameLine({ label, g, ongoing }: { label: string; g: StreakGame; ongoing?: boolean }) {
  const narrow = useNarrow();
  const date = narrow ? g.date.replace(/-/g, "/").slice(2) : g.date;
  return (
    <span className="threshold-line">
      <span className="record-date-nowrap">
        {label} {date}（{g.season}）
      </span>
      {narrow ? " " : "　"}
      <ResponsiveTeamName teamId={g.teamId} name={g.teamName} always nowrap /> {g.isHome ? "vs" : "@"}{" "}
      <ResponsiveTeamName teamId={g.opponentTeamId} name={g.opponentTeamName} always nowrap />
      {g.detail && <span className="record-date-nowrap">　{g.detail}</span>}
      {ongoing && <span className="threshold-ongoing">継続中</span>}
    </span>
  );
}

export function ThresholdStreakList({ rows, ongoingOnly, teamColors }: { rows: ThresholdStreakRow[]; ongoingOnly: boolean; teamColors: Colors }) {
  return (
    <PlayerNamePool names={rows.map((e) => e.playerName)}>
      <RankedList
        rows={rows}
        def={{ key: `threshold:streak:${ongoingOnly ? "ongoing" : "best"}`, label: "連続", value: (e) => e.value, format: (e) => String(e.value), higherIsBetter: true }}
        tieKey={(e) => String(e.value)}
        rowKey={(e) => e.playerId}
        name={(e) => <ResponsivePlayerName name={e.playerName} playerId={e.playerId} season={e.end.season} />}
        subLabel={(e) => (
          <>
            <StreakGameLine label="開始" g={e.start} />
            <StreakGameLine label="終了" g={e.end} ongoing={e.ongoing} />
          </>
        )}
        linkTo={(e) => `/players/${e.playerId}?season=${e.end.season}`}
        teamColor={(e) => teamColors?.[e.teamId]?.primary}
        avatar={(e) => <PlayerPhoto playerId={e.playerId} size={56} className="player-cell-photo" placeholder />}
        limit={RANK_TOP_N}
        tieExpandMax={GAME_RECORD_TIE_EXPAND_MAX}
        unit="人"
        sortable={false}
        compact
      />
    </PlayerNamePool>
  );
}

/** 達成時の年齢の一覧: 値は「18歳269日」。名前の下に、達成した試合（日付・シーズン・対戦・しきい値の項目の値） */
export function ThresholdAgeList({ rows, which, teamColors }: { rows: ThresholdAgeRow[]; which: ThresholdAgeWhich; teamColors: Colors }) {
  const narrow = useNarrow();
  return (
    <PlayerNamePool names={rows.map((e) => e.playerName)}>
      <RankedList
        rows={rows}
        def={{
          key: `threshold:age:${which}`,
          label: "達成時の年齢",
          value: (e) => e.value,
          format: (e) => formatAgeOnDate(e.age),
          // 最年少は若い（小さい）方が上位、最年長は大きい方が上位
          higherIsBetter: which === "old",
        }}
        tieKey={(e) => String(e.value)}
        rowKey={(e) => e.playerId}
        name={(e) => <ResponsivePlayerName name={e.playerName} playerId={e.playerId} season={e.season} />}
        subLabel={(e) => (
          <>
            <span className="record-date-nowrap">
              {narrow ? e.date.replace(/-/g, "/").slice(2) : e.date}（{e.season}）
            </span>
            {narrow ? " " : "　"}
            <ResponsiveTeamName teamId={e.teamId} name={e.teamName} always nowrap /> {e.isHome ? "vs" : "@"}{" "}
            <ResponsiveTeamName teamId={e.opponentTeamId} name={e.opponentTeamName} always nowrap />
            {e.detail && <span className="record-date-nowrap">　{e.detail}</span>}
          </>
        )}
        linkTo={(e) => `/players/${e.playerId}?season=${e.season}`}
        subLinkTo={(e) => `/games/${e.scheduleKey}?season=${e.season}`}
        teamColor={(e) => teamColors?.[e.teamId]?.primary}
        avatar={(e) => <PlayerPhoto playerId={e.playerId} size={56} className="player-cell-photo" placeholder />}
        limit={RANK_TOP_N}
        tieExpandMax={GAME_RECORD_TIE_EXPAND_MAX}
        unit="人"
        sortable={false}
        compact
      />
    </PlayerNamePool>
  );
}
