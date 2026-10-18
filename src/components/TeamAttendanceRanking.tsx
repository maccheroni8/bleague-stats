import { useMemo, useRef } from "react";
import type { GameSummary, TeamColors } from "../../shared/types";
import { ATTENDANCE_LIMITED_SEASONS, attendanceRows, attendanceVenueOptions, type AttendanceDay, type AttendanceFilter, type AttendanceGame, type AttendanceRow } from "../lib/attendanceRanking";
import { baseDateOf } from "../lib/dataBaseDate";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchGameSummaries, fetchSeasons } from "../lib/data";
import { gameTypeAxis, simpleSelectAxis, statItemAxis, type FilterAxis } from "../lib/filterAxes";
import { isWeekdayGame } from "../lib/japaneseHolidays";
import { leagueTeamDisplayName } from "../lib/leagueTeamNames";
import { enumParam, stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { useJsonData } from "../lib/useJsonData";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { FilterBar } from "./FilterBar";
import { RankedList } from "./RankedList";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { TeamLogo } from "./TeamLogo";

/**
 * ランキング > チーム > 観客動員（DESIGN.md 270章）: クラブごとのホーム試合の来場者数。項目は1試合平均（既定）と合計。
 * 絞り込みは、範囲（シーズン／歴代）・試合区分（既定はレギュラーシーズン）・曜日（平日開催〔祝日を除く〕／土日祝開催）・会場。
 * 試合の一覧（games-summary）から画面で求める。0人（無観客）と来場者数の記録が無い試合は、平均・合計に入れない
 */

const ITEMS = [
  { key: "average", label: "1試合平均" },
  { key: "total", label: "合計" },
] as const;
const STAT_PARAM = stringParam("stat", "average", (v) => ITEMS.some((i) => i.key === v));
/** 範囲: この画面の既定はシーズン（ほかの種類の scope と同じ URL のキー） */
export const ATTENDANCE_SCOPE_PARAM = enumParam<"season" | "allTime">("scope", ["season", "allTime"], "season", { allTime: "all" });
const DAY_PARAM = enumParam<AttendanceDay>("day", ["all", "wkday", "wkend"], "all");
const VENUE_PARAM = stringParam("venue", "");
const DAY_LABELS: Record<AttendanceDay, string> = { all: "すべて", wkday: "平日開催（祝日を除く）", wkend: "土日祝開催" };

function formatPeople(n: number): string {
  return `${Math.round(n).toLocaleString()}人`;
}

/** 範囲のシーズンの試合の一覧（シーズン内の各試合に season を付ける）。読めないシーズンは飛ばす */
async function loadGames(allTime: boolean, season: string): Promise<AttendanceGame[]> {
  const seasons = allTime ? (await fetchSeasons()).map((s) => s.season) : [season];
  const lists = await Promise.all(
    seasons.map(async (s) => {
      try {
        return (await fetchGameSummaries(s)).map((g: GameSummary) => ({ ...g, season: s }));
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}

export function TeamAttendanceRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useUrlState(ATTENDANCE_SCOPE_PARAM, "season");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [day, setDay] = useUrlState(DAY_PARAM, "all");
  const [venueParam, setVenue] = useUrlState(VENUE_PARAM, "");
  const [statParam, setStatKey] = useUrlState(STAT_PARAM, "average");
  const allTime = scope === "allTime";
  const item = ITEMS.find((i) => i.key === statParam) ?? ITEMS[0]!;

  const { data: games, loading } = useJsonData(() => loadGames(allTime, season), [allTime, season]);

  const baseFilter: AttendanceFilter = { gameType, day, venue: "", isWeekday: isWeekdayGame };
  const venueOptions = useMemo(() => (games ? attendanceVenueOptions(games, baseFilter) : []), [games, gameType, day]); // eslint-disable-line react-hooks/exhaustive-deps
  // 選んだ会場が、今の範囲・条件に無いときは、絞り込みなしとして扱う
  const venue = venueOptions.some((v) => v.venue === venueParam) ? venueParam : "";
  const rows = useMemo<AttendanceRow[]>(
    () =>
      games
        ? attendanceRows(games, { ...baseFilter, venue }, (teamId, name) => (allTime ? leagueTeamDisplayName(teamId) : name))
        : [],
    [games, gameType, day, venue, allTime], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const seasonForTitle = allTime ? null : season;
  const conditions = composeLabels(
    gameTypeLabels(gameType, seasonForTitle),
    day !== "all" && DAY_LABELS[day],
    venue && venue,
  );
  const title = `${allTime ? "歴代" : `${season}シーズン`} チームのホーム観客動員 ${item.label}ランキング`;
  const filename = buildExportFilename(["チーム観客動員", allTime ? "歴代" : season, item.label, ...conditions]);

  const axes: FilterAxis[] = [
    simpleSelectAxis({
      id: "attendanceScope",
      label: "範囲",
      options: [
        { value: "season", label: `${season}シーズン` },
        { value: "allTime", label: "歴代" },
      ],
      value: scope,
      defaultValue: "season",
      onChange: (v) => setScope(v as "season" | "allTime"),
    }),
    gameTypeAxis(gameType, setGameType, seasonForTitle),
    simpleSelectAxis({
      id: "attendanceDay",
      label: "曜日",
      options: (Object.keys(DAY_LABELS) as AttendanceDay[]).map((d) => ({ value: d, label: DAY_LABELS[d] })),
      value: day,
      defaultValue: "all",
      onChange: (v) => setDay(v as AttendanceDay),
    }),
    simpleSelectAxis({
      id: "attendanceVenue",
      label: "会場",
      options: [{ value: "", label: "すべて" }, ...venueOptions.map((v) => ({ value: v.venue, label: `${v.venue}（${v.games}試合）` }))],
      value: venue,
      defaultValue: "",
      onChange: setVenue,
    }),
  ];

  const limitedSeasonIncluded = allTime || ATTENDANCE_LIMITED_SEASONS.includes(season);
  const rowKey = (r: AttendanceRow) => r.teamId;

  return (
    <>
      <FilterBar
        axes={axes}
        stateKey="rankings:team:attendance"
        onClearAll={() => {
          setScope("season");
          setGameType("regular");
          setDay("all");
          setVenue("");
        }}
      />
      <FilterBar simple wide stateKey="rankings:team:attendance:stat" axes={[statItemAxis([...ITEMS], item.key, setStatKey)]} />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : !games ? (
        <p className="empty-message">データがありません</p>
      ) : rows.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <>
          <ExportImageButton
            targetRef={exportRef}
            filename={filename}
            baseDate={baseDateOf(allTime, season, gameType)}
            ranking={{ media: "ロゴ", unit: "チーム", top: null }}
          />
          <ExportTarget ref={exportRef} className="export-target-compact export-target-rankings-team" baseDate={baseDateOf(allTime, season, gameType)}>
            <ConditionTitle title={title} conditions={conditions} />
            <RankedList
              rows={rows}
              def={{
                key: item.key,
                label: item.label,
                value: (r) => (item.key === "total" ? r.total : r.average),
                format: (r) => formatPeople(item.key === "total" ? r.total : r.average),
                higherIsBetter: true,
              }}
              tieKey={(r) => String(Math.round(item.key === "total" ? r.total : r.average))}
              rowKey={rowKey}
              name={(r) => <ResponsiveTeamName teamId={r.teamId} name={r.teamName} />}
              subLabel={(r) => `ホーム${r.games}試合・${item.key === "total" ? `平均 ${formatPeople(r.average)}` : `合計 ${formatPeople(r.total)}`}`}
              linkTo={(r) => `/teams/${r.teamId}${allTime ? "" : `?season=${season}`}`}
              teamColor={(r) => teamColors?.[r.teamId]?.primary}
              avatar={(r) => <TeamLogo teamId={r.teamId} size={48} placeholder />}
              sortable={false}
              statScope="team"
              exportKeepSub
              compact
            />
            <p className="rule-change-footnote">※ ホーム開催の試合の来場者数です。0人（無観客）と、来場者数の記録が無い試合は、平均・合計に入れていません。</p>
            {limitedSeasonIncluded && (
              <p className="rule-change-footnote">
                ※ {ATTENDANCE_LIMITED_SEASONS[0]}〜{ATTENDANCE_LIMITED_SEASONS[ATTENDANCE_LIMITED_SEASONS.length - 1]}は入場制限があったシーズンのため、来場者数が少なくなっています。中止の試合もあり、合計は試合数がそろっていません。
              </p>
            )}
            {gameType !== "regular" && (
              <p className="rule-change-footnote">※ ポストシーズンは、会場が自クラブのホームとは限りません（ファイナルなど。試合の一覧のホーム側のクラブとして数えます）。</p>
            )}
          </ExportTarget>
        </>
      )}
    </>
  );
}
