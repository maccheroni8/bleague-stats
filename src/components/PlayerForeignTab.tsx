import { useMemo, useRef, type ReactNode } from "react";
import { seasonRuleFor } from "../../shared/seasonRules";
import type { PlayerGameLog, TeamGameLog } from "../../shared/types";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { FilterBar } from "./FilterBar";
import { GlossaryNote } from "./GlossaryNote";
import { fetchPlayerForeign, fetchSeasonRules } from "../lib/data";
import { composeLabels, displayModeLabels, gameTypeLabels, buildExportFilename } from "../lib/conditionLabels";
import { displayModeAxis, gameTypeAxis, simpleSelectAxis } from "../lib/filterAxes";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { formatDecimal } from "../lib/format";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import type { League } from "../lib/league";
import { logsHaveOn4, on4Key, on4Supported } from "../lib/on4Core";
import { usePageState } from "../lib/pageStateCache";
import { PLAYER_FOREIGN_COUNTS, sumPlayerForeign, type PlayerForeignBucket } from "../lib/playerForeignCourt";
import type { SeasonDisplayMode, SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { foreignShareFromSeconds } from "../lib/shareCharts";
import { statDescription } from "../lib/statDescriptions";
import type { GameTeamInfo } from "../lib/situational";
import { useJsonData } from "../lib/useJsonData";

const ON4_NO_DATA_REASON = "このシーズンのデータには、on4が可能だった試合の判定がまだ入っていません。";
const ON4_UNAVAILABLE_REASON = "on4（外国籍・帰化・アジア特別枠が同時に4人）が可能なのは、B.PREMIER の2026-27シーズンだけです。";
const ON4_ONLY_LABEL = "on4が可能だった試合だけ";

interface BucketColumn {
  key: string;
  label: string;
  /** 自チームの視点だけ */
  ownOnly?: boolean;
  format: (b: PlayerForeignBucket, games: number, total: boolean) => string;
}

function perGame(v: number, games: number, total: boolean): string {
  return total ? String(v) : games > 0 ? formatDecimal(v / games) : "-";
}

function pct(made: number, att: number): string {
  return att > 0 ? formatDecimal((100 * made) / att) : "-";
}

const BUCKET_COLUMNS: BucketColumn[] = [
  { key: "pts", label: "PTS", format: (b, g, t) => perGame(b.events.pts, g, t) },
  { key: "fgPct", label: "FG%", format: (b) => pct(b.events.fgm, b.events.fga) },
  { key: "tpPct", label: "3P%", format: (b) => pct(b.events.tpm, b.events.tpa) },
  { key: "ftPct", label: "FT%", format: (b) => pct(b.events.ftm, b.events.fta) },
  { key: "reb", label: "TR", format: (b, g, t) => perGame(b.events.or + b.events.dr, g, t) },
  { key: "ast", label: "AST", format: (b, g, t) => perGame(b.events.ast, g, t) },
  { key: "tov", label: "TOV", format: (b, g, t) => perGame(b.events.tov, g, t) },
  { key: "ortg", label: "ORtg", ownOnly: true, format: (b) => (b.team && b.team.poss > 0 ? formatDecimal((100 * b.team.pts) / b.team.poss) : "-") },
  { key: "drtg", label: "DRtg", ownOnly: true, format: (b) => (b.team && b.team.oppPoss > 0 ? formatDecimal((100 * b.team.oppPts) / b.team.oppPoss) : "-") },
  {
    key: "netrtg",
    label: "NetRtg",
    ownOnly: true,
    format: (b) => (b.team && b.team.poss > 0 && b.team.oppPoss > 0 ? formatDecimal((100 * b.team.pts) / b.team.poss - (100 * b.team.oppPts) / b.team.oppPoss) : "-"),
  },
];

/**
 * 個人詳細の「On-Court Foreign」タブ。ページで選んでいるシーズンの、本人がコートにいたときの同時にコートにいた外国籍・帰化・アジア特別枠の人数（本人を含む）ごとの
 * 在コート時間と本人の成績。上の表はチーム全体の On-Court Foreign と同じ列（OC0〜・OC0%〜・平均人数）、下の表は人数ごとの本人の成績。
 */
export function PlayerForeignTab({
  playerId,
  playerName,
  season,
  league,
  logs,
  ownTeamByScheduleKey,
  teamLogsByTeamId,
  loading,
}: {
  playerId: string;
  playerName: string;
  season: string;
  league: League;
  logs: PlayerGameLog[] | undefined;
  ownTeamByScheduleKey: Map<string, GameTeamInfo> | undefined;
  /** チームごとの試合ログ（on4 が可能だった試合の判定を読む） */
  teamLogsByTeamId: Map<string, TeamGameLog[]> | undefined;
  loading: boolean;
}) {
  const pk = (s: string) => `player:${playerId}:oc:${s}`;
  const [gameType, setGameType] = usePageState<SeasonGameTypeFilter>(pk("gameType"), "regular");
  const [displayMode, setDisplayMode] = usePageState<SeasonDisplayMode>(pk("displayMode"), "perGame");
  const [side, setSide] = usePageState<"own" | "opp">(pk("side"), "own");
  const [storedGames, setGames] = usePageState<"all" | "on4">(pk("games"), "all");
  const exportRef = useRef<HTMLDivElement>(null);

  const { data: rules } = useJsonData(() => fetchSeasonRules(), []);
  const { data: file, loading: fileLoading } = useJsonData(() => fetchPlayerForeign(season, league), [season, league], { discardStale: true });
  const foreignMax = rules ? seasonRuleFor(rules, season, league)?.maxForeignOnCourt : undefined;
  const on4Ok = on4Supported(league, foreignMax);

  const games = useMemo(
    () =>
      (logs ?? []).map((g) => ({ scheduleKey: g.scheduleKey, teamId: ownTeamByScheduleKey?.get(g.scheduleKey)?.teamId, gameType: g.gameType as string })),
    [logs, ownTeamByScheduleKey],
  );
  const typeMatches = (t: string) => gameType === "both" || gameType === t;
  // on4 が可能だった試合（集計が試合ログに保存した判定を読む。古いデータには無い）
  const on4Feasible = useMemo(() => {
    const keys = new Set<string>();
    let has = false;
    for (const [teamId, logs] of teamLogsByTeamId ?? []) {
      if (logsHaveOn4(logs)) has = true;
      for (const g of logs) if (g.on4Possible === true) keys.add(on4Key(teamId, g.scheduleKey));
    }
    return { keys, has };
  }, [teamLogsByTeamId]);
  const on4Active = on4Ok && on4Feasible.has && storedGames === "on4";

  const totals = useMemo(() => {
    if (!file) return null;
    return sumPlayerForeign(
      file,
      playerId,
      games,
      side,
      (g) => typeMatches(g.gameType) && (!on4Active || (!!g.teamId && on4Feasible.keys.has(on4Key(g.teamId, g.scheduleKey)))),
    );
  }, [file, playerId, games, side, gameType, on4Active, on4Feasible]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = displayMode === "total";
  const heading = `${season}シーズン ${playerName} On-Court Foreign`;
  const conditions = composeLabels(
    displayModeLabels(displayMode),
    gameTypeLabels(gameType, season),
    side === "opp" ? "相手チームのコート上の人数" : [],
    on4Active ? ON4_ONLY_LABEL : [],
    "在コート時間ベース",
  );
  const axes = [
    gameTypeAxis(gameType, setGameType, season),
    simpleSelectAxis({
      id: "ocSide",
      label: "視点",
      options: [
        { value: "own", label: "自チーム" },
        { value: "opp", label: "opp" },
      ],
      value: side,
      defaultValue: "own",
      onChange: (v) => setSide(v as "own" | "opp"),
    }),
    displayModeAxis(displayMode, setDisplayMode),
    simpleSelectAxis({
      id: "ocGames",
      label: "対象の試合",
      options: [
        { value: "all", label: "すべての試合" },
        { value: "on4", label: "on4が可能だった試合だけ" },
      ],
      value: on4Ok ? storedGames : "all",
      defaultValue: "all",
      onChange: (v) => setGames(v as "all" | "on4"),
      disabledReason: !rules ? undefined : !on4Ok ? ON4_UNAVAILABLE_REASON : !on4Feasible.has && teamLogsByTeamId ? ON4_NO_DATA_REASON : undefined,
    }),
  ];

  let body: ReactNode;
  let exportShown = false;
  if (loading || fileLoading || !rules) {
    body = <p className="loading">読み込み中...</p>;
  } else if (!file) {
    body = <p className="empty-message">このシーズンのデータには対応していません</p>;
  } else if (!totals || totals.games === 0) {
    body = <p className="empty-message">該当する試合がありません</p>;
  } else {
    const counts = PLAYER_FOREIGN_COUNTS.filter((n) => foreignMax === undefined || n <= foreignMax || totals.buckets[n]!.seconds > 0);
    const share = foreignShareFromSeconds(
      totals.buckets.map((b) => b.seconds),
      totals.games,
    );
    const columns = BUCKET_COLUMNS.filter((c) => !c.ownOnly || side === "own");
    exportShown = true;
    body = (
      <>
        <ExportImageButton targetRef={exportRef} filename={buildExportFilename([heading, ...conditions])} baseDate={{ kind: "season", season, gameType }} />
        <ExportTarget ref={exportRef} className="export-target-oc" baseDate={{ kind: "season", season, gameType }}>
          <ConditionTitle title={heading} conditions={conditions} exportScope={`${season}シーズン`} />
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th className="align-right">G</th>
                  {counts.map((n) => (
                    <th className="align-right" key={`t${n}`}>{`OC${n}`}</th>
                  ))}
                  {counts.map((n) => (
                    <th className="align-right" key={`p${n}`}>{`OC${n}%`}</th>
                  ))}
                  <th className="align-right">平均人数</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="align-right">{totals.games}</td>
                  {counts.map((n) => (
                    <td className="align-right" key={`t${n}`}>
                      {formatMinutesFromSeconds(total ? share.seconds[n]! : share.secondsPerGame[n]!)}
                    </td>
                  ))}
                  {counts.map((n) => (
                    <td className="align-right" key={`p${n}`}>
                      {formatDecimal(share.pct[n]!)}
                    </td>
                  ))}
                  <td className="align-right">{share.average.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th className="align-left">人数</th>
                  <th className="align-right">MIN</th>
                  {columns.map((c) => (
                    <th className="align-right" key={c.key} title={statDescription(c.label)}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {counts.map((n) => {
                  const b = totals.buckets[n]!;
                  return (
                    <tr key={n}>
                      <td className="align-left">{`OC${n}`}</td>
                      <td className="align-right">{formatMinutesFromSeconds(total ? b.seconds : Math.round(b.seconds / totals.games))}</td>
                      {columns.map((c) => (
                        <td className="align-right" key={c.key}>
                          {b.seconds > 0 || b.events.pts > 0 ? c.format(b, totals.games, total) : "-"}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ExportTarget>
        <GlossaryNote anchor={GLOSSARY_ANCHORS.foreignCourt} label="在コート時間" scope="選んだ試合種別・対象の試合の合計の値です。" />
      </>
    );
  }

  return (
    <div className="player-tab-panel">
      {!exportShown && <ConditionTitle section title={heading} conditions={conditions} exportScope={`${season}シーズン`} />}
      <FilterBar simple stateKey={`player:${playerId}:ocFilter`} axes={axes} />
      {body}
    </div>
  );
}
