import { useMemo, useRef } from "react";
import type { TeamColors } from "../../shared/types";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchLeagueTeamRankings, fetchTeamHistory, fetchTeams } from "../lib/data";
import { gameTypeAxis, simpleSelectAxis, statItemAxis } from "../lib/filterAxes";
import { filterByGameType } from "../../shared/gameType";
import { useAllTeamGameLogs } from "../lib/teamRankingData";
import {
  TEAM_RECORD_MODE_LABELS,
  TEAM_RECORD_TOP_N,
  allTimeTeamRecordRows,
  formatTeamRecordValue,
  leagueTeamDisplayName,
  seasonTeamRecordRows,
  teamRecordLowerFirst,
  teamRecordItems,
  type TeamGameRecordRow,
  type TeamRecordGame,
  type TeamRecordMode,
} from "../lib/teamGameRecords";
import { TEAM_PCT_MIN_ATTEMPTS_NOTE } from "../lib/topRecords";
import { enumParam, stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, RECORDS_SCOPE_PARAM, type RecordsScope } from "../lib/urlFilterParams";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { useJsonData } from "../lib/useJsonData";
import { useNarrow } from "../lib/teamLabel";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { RankedList } from "./RankedList";
import { RecordValue } from "./RecordValue";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { TeamLogo } from "./TeamLogo";

/**
 * ランキング > チーム > 1試合記録（DESIGN.md 191章）。範囲「歴代」は全シーズン（data/league-team-rankings.json の上位20位）、
 * 「シーズン」はページで選んでいるシーズンの全クラブの試合ログから作る。記録の種類は、記録／ワースト／被記録。
 * 項目は1試合の記録（TEAM_RECORD_STATS）と、記録・ワーストのクォーター別・前後半別。試合区分はレギュラーシーズン／ポストシーズン／合算
 */

// 項目キーは「q1:mostPts」のようにコロンを含む
const STAT_PARAM = stringParam("stat", "pts", (v) => /^[\w%:]+$/.test(v));
export const RECORD_MODE_PARAM = enumParam<TeamRecordMode>("rmode", ["record", "worst", "against"], "record");
const PBP_NOTE = "公式のクォーター別スコアが欠けている試合のため、プレーバイプレーの得点から出した値です。";

/** チームの1試合記録のランキングの URL（チーム一覧の記録タブのカードから移るとき） */
export function teamGameRecordRankingUrl(opts: {
  scope: RecordsScope;
  gameType: SeasonGameTypeFilter;
  mode: TeamRecordMode;
  statKey: string;
  season?: string;
}): string {
  const p = new URLSearchParams();
  p.set("k", "game");
  RECORDS_SCOPE_PARAM.write(p, opts.scope);
  GAME_TYPE_PARAM.write(p, opts.gameType);
  RECORD_MODE_PARAM.write(p, opts.mode);
  p.set("stat", opts.statKey);
  if (opts.season) p.set("season", opts.season);
  return `/rankings?${p.toString()}`;
}

/** 名前の下の行: 日付（シーズン）・対戦相手（クォーター別・前後半別は区間のスコアも） */
function TeamGameRecordLine({ r }: { r: TeamGameRecordRow }) {
  const narrow = useNarrow();
  const date = narrow ? r.date.replace(/-/g, "/").slice(2) : r.date;
  return (
    <>
      <span className="record-date-nowrap">
        {date}（{r.season}）
      </span>
      {narrow ? " " : "　"}
      {r.isHome ? "vs" : "@"} <ResponsiveTeamName teamId={r.opponentTeamId} name={r.opponentTeamName} always />
      {r.ownPoints !== undefined && <span className="record-date-nowrap">　区間 {r.ownPoints}-{r.oppPoints}</span>}
    </>
  );
}

export function TeamGameRecordRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [scope] = useUrlState(RECORDS_SCOPE_PARAM, "allTime");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [mode, setMode] = useUrlState(RECORD_MODE_PARAM, "record");
  const [statParam, setStatKey] = useUrlState(STAT_PARAM, "pts");
  const allTime = scope === "allTime";

  const items = useMemo(() => teamRecordItems(mode), [mode]);
  const item = items.find((i) => i.key === statParam) ?? items[0]!;

  // 歴代: 集計ファイルと名称の履歴。シーズン: そのシーズンの全クラブの試合ログ（使わない範囲は読み込まない）
  const { data: rankings, loading: rankingsLoading } = useJsonData(
    () => (allTime ? fetchLeagueTeamRankings() : Promise.resolve(null)),
    [allTime],
  );
  const { data: history } = useJsonData(() => (allTime ? fetchTeamHistory() : Promise.resolve(null)), [allTime]);
  const { data: teams, loading: teamsLoading } = useJsonData(() => (allTime ? Promise.resolve(null) : fetchTeams(season)), [allTime, season]);
  const { gameLogsByTeam, loading: logsLoading } = useAllTeamGameLogs(season, allTime ? null : (teams ?? null));

  const games = useMemo<TeamRecordGame[]>(() => {
    if (allTime || !teams || !gameLogsByTeam) return [];
    const all = teams.flatMap((t) =>
      (gameLogsByTeam.get(t.teamId) ?? []).map((g) => ({ ...g, season, teamId: t.teamId, teamName: t.teamName })),
    );
    return filterByGameType(all, gameType);
  }, [allTime, teams, gameLogsByTeam, season, gameType]);

  const rows = useMemo<TeamGameRecordRow[]>(
    () =>
      allTime
        ? allTimeTeamRecordRows(rankings, history, mode, gameType, item.key, leagueTeamDisplayName)
        : seasonTeamRecordRows(games, mode, item.key),
    [allTime, rankings, history, mode, gameType, item.key, games],
  );
  const loading = allTime ? rankingsLoading : teamsLoading || logsLoading;

  const seasonForTitle = allTime ? null : season;
  const conditions = composeLabels(gameTypeLabels(gameType, seasonForTitle));
  const modeLabel = TEAM_RECORD_MODE_LABELS[mode];
  const title = allTime ? `歴代 チーム1試合${modeLabel}：${item.label}` : `${season}シーズン チーム1試合${modeLabel}：${item.label}`;
  const filename = buildExportFilename([`チーム1試合${modeLabel}`, allTime ? "歴代" : season, item.label, ...conditions]);
  const isPct = ["fgPct", "twoPct", "tpPct", "ftPct"].includes(item.key);
  const hasPbp = rows.some((r) => r.fromPbp);

  const modeAxis = simpleSelectAxis({
    id: "recordMode",
    label: "記録の種類",
    options: (Object.keys(TEAM_RECORD_MODE_LABELS) as TeamRecordMode[]).map((m) => ({ value: m, label: TEAM_RECORD_MODE_LABELS[m] })),
    value: mode,
    defaultValue: "record",
    onChange: (v) => setMode(v as TeamRecordMode),
  });

  return (
    <>
      <FilterBar simple stateKey="rankings:team:game" axes={[gameTypeAxis(gameType, setGameType, seasonForTitle), modeAxis]} />
      <FilterBar
        simple
        wide
        stateKey="rankings:team:game:stat"
        axes={[statItemAxis(items, item.key, setStatKey)]}
      />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-team">
            <ConditionTitle title={title} conditions={conditions} />
            <RankedList
              rows={rows}
              def={{
                key: item.key,
                label: item.label,
                value: (r) => r.value,
                format: (r) => formatTeamRecordValue(item.key, r.value),
                higherIsBetter: !teamRecordLowerFirst(mode, item.key),
              }}
              renderValue={(r) => (
                <>
                  <RecordValue
                    text={formatTeamRecordValue(item.key, r.value)}
                    fraction={r.made !== undefined && r.attempted !== undefined ? [r.made, r.attempted] : undefined}
                  />
                  {r.fromPbp && <span title={PBP_NOTE}>※</span>}
                </>
              )}
              tieKey={(r) => String(r.value)}
              rowKey={(r) => `${r.scheduleKey}-${r.teamId}`}
              name={(r) => <ResponsiveTeamName teamId={r.teamId} name={r.teamName} />}
              subLabel={(r) => <TeamGameRecordLine r={r} />}
              linkTo={(r) => `/teams/${r.teamId}?season=${r.season}`}
              subLinkTo={(r) => `/games/${r.scheduleKey}?season=${r.season}`}
              teamColor={(r) => teamColors?.[r.teamId]?.primary}
              avatar={(r) => <TeamLogo teamId={r.teamId} size={48} placeholder />}
              limit={TEAM_RECORD_TOP_N}
              unit="試合"
              sortable={false}
              statScope="team"
              compact
            />
            {isPct && <p className="rule-change-footnote">※ {TEAM_PCT_MIN_ATTEMPTS_NOTE}同じ率の中は試投数の多い試合から並べます。</p>}
            {hasPbp && <p className="rule-change-footnote">※ {PBP_NOTE}</p>}
            {mode === "against" && (
              <p className="rule-change-footnote">※ 被記録は、対戦相手がそのチーム相手に記録した値です。チーム名は、その値を記録された側のクラブです。</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
