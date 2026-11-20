import { useMemo, useRef, type ReactNode } from "react";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { FilterBar } from "./FilterBar";
import { RuleChangeFootnote } from "./RuleChangeFootnote";
import { SortableTable, type Column } from "./SortableTable";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { buildExportFilename, composeLabels, displayModeLabels, gameTypeLabels, perspectiveLabels } from "../lib/conditionLabels";
import { fetchGameSummaries, fetchTeamGameLogs } from "../lib/data";
import { displayModeAxis, gameTypeAxis, perspectiveAxis } from "../lib/filterAxes";
import type { League } from "../lib/league";
import { scoringCompositionColumns, periodColumns, standardColumns, type OpponentSplitRow } from "../lib/opponentSplit";
import { usePageState } from "../lib/pageStateCache";
import {
  buildPlayedSplit,
  formatWinPct,
  formatWinPctDiff,
  playedSplitStatColumns,
  tenuresByTeam,
  type PlayedSplitBlock,
} from "../lib/playedSplit";
import type { SeasonDisplayMode, SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { foulColumnsSplit } from "../lib/ruleChange";
import { buildGameTeamsByScheduleKey, resolveOwnTeam } from "../lib/situational";
import type { TeamPerspective } from "../lib/teamStatsColumns";
import { useJsonData } from "../lib/useJsonData";
import type { PlayerGameLog, TeamGameLog } from "../../shared/types";

type PlayedSplitCategory = "traditional" | "advanced" | "misc" | "scoring" | "scoringComposition" | "periods";

const NO_LOGS: PlayerGameLog[] = [];

const CATEGORY_KEYS: readonly PlayedSplitCategory[] = ["traditional", "advanced", "misc", "scoring", "scoringComposition", "periods"];

/**
 * 個人詳細の「出場有無」タブ。ページで選んでいるシーズンの、本人が所属していたチームの試合を「出場した試合」「出場しなかった試合」に分け、
 * チームのスタッツ（自チーム／opp／+/-）と、その差を並べる。「出場しなかった試合」は、そのチームでの在籍期間（1チームだけなら全試合）の試合。
 * シーズンの途中で移籍した選手は、チームごとに表を分ける。
 */
export function PlayerPlayedSplit({
  playerId,
  playerName,
  season,
  league,
  logs: logsProp,
  loading,
}: {
  playerId: string;
  playerName: string;
  season: string;
  league: League;
  /** ページで選んでいるシーズンの本人の試合ログ（試合種別で絞る前。出場時間0の行を含む）。無ければ読み込み中 */
  logs: PlayerGameLog[] | undefined;
  loading: boolean;
}) {
  // 選んだシーズンに本人の試合ログが無いとき（読み込みは終わっている）は空として扱う
  const logs = logsProp ?? (loading ? undefined : NO_LOGS);
  const pk = (s: string) => `player:${playerId}:played:${s}`;
  const [category, setCategory] = usePageState<PlayedSplitCategory>(pk("category"), "traditional");
  const [gameType, setGameType] = usePageState<SeasonGameTypeFilter>(pk("gameType"), "regular");
  const [perspective, setPerspective] = usePageState<TeamPerspective>(pk("perspective"), "own");
  const [displayMode, setDisplayMode] = usePageState<SeasonDisplayMode>(pk("displayMode"), "perGame");
  const exportRef = useRef<HTMLDivElement>(null);

  // 出場時間0の行も含めて自チームを引き、そのチームの試合ログを読む
  const { data: teamInfo, loading: teamLoading } = useJsonData(
    async () => {
      if (!logs) return null;
      const summaries = await fetchGameSummaries(season, league);
      const gameTeams = buildGameTeamsByScheduleKey(summaries);
      const ownTeamOf = (g: { scheduleKey: string; isHome: boolean }) => resolveOwnTeam(g, gameTeams);
      const teamIds = tenuresByTeam(logs, ownTeamOf).map((t) => t.teamId);
      const teamLogsByTeamId = new Map<string, TeamGameLog[]>();
      await Promise.all(
        teamIds.map(async (teamId) => {
          try {
            teamLogsByTeamId.set(teamId, await fetchTeamGameLogs(season, teamId, league));
          } catch {
            // 読めなかったチームは表を出さない
          }
        }),
      );
      return { ownTeamOf, teamLogsByTeamId };
    },
    [logs, season, league],
    { discardStale: true },
  );

  const ready = !loading && !!logs && !teamLoading && !!teamInfo;
  const blocks = useMemo<PlayedSplitBlock[]>(
    () => (ready && logs && teamInfo ? buildPlayedSplit({ logs, gameType, ownTeamOf: teamInfo.ownTeamOf, teamLogsByTeamId: teamInfo.teamLogsByTeamId }) : []),
    [ready, logs, teamInfo, gameType],
  );

  const foulSplit = foulColumnsSplit([season]);
  const ignoresDisplayMode = category === "scoringComposition";
  const statColumnsBase = useMemo<Column<OpponentSplitRow>[]>(() => {
    switch (category) {
      case "scoringComposition":
        return scoringCompositionColumns(perspective, { paintSupported: true });
      case "periods":
        return periodColumns(displayMode, perspective);
      default:
        return standardColumns(category, displayMode, perspective, { paintSupported: true, foulSplit });
    }
  }, [category, displayMode, perspective, foulSplit]);

  const categoryLabel = CATEGORY_LABELS[category];
  const heading = `${playerName} 出場有無：${categoryLabel}`;
  const conditions = composeLabels(
    gameTypeLabels(gameType, season),
    perspectiveLabels(perspective),
    !ignoresDisplayMode && displayModeLabels(displayMode),
  );
  const axes = [
    gameTypeAxis(gameType, setGameType, season),
    perspectiveAxis(perspective, setPerspective),
    displayModeAxis(displayMode, setDisplayMode, {
      disabledReason: ignoresDisplayMode ? `${categoryLabel}は割合の表で、平均/合計は連動しません。` : undefined,
    }),
  ];

  let body: ReactNode;
  let exportShown = false;
  if (!ready) {
    body = <p className="loading">読み込み中...</p>;
  } else if (blocks.length === 0) {
    body = <p className="empty-message">該当する試合がありません</p>;
  } else {
    exportShown = true;
    const baseDate = { kind: "season" as const, season, gameType };
    body = (
      <>
        <ExportImageButton targetRef={exportRef} filename={buildExportFilename([heading, ...conditions])} baseDate={baseDate} />
        <ExportTarget ref={exportRef} className="export-target-ps" baseDate={baseDate}>
          <ConditionTitle title={heading} conditions={conditions} exportScope={`${season}シーズン`} />
          {blocks.map((b) => (
            <PlayedSplitTable key={b.teamId} block={b} showTeam={blocks.length > 1} statColumnsBase={statColumnsBase} />
          ))}
          {category === "misc" && <RuleChangeFootnote seasons={[season]} />}
        </ExportTarget>
      </>
    );
  }

  return (
    <div className="player-tab-panel">
      {!exportShown && <ConditionTitle section title={heading} conditions={conditions} exportScope={`${season}シーズン`} />}
      <FilterBar simple stateKey={`player:${playerId}:playedFilter`} axes={axes} />
      <div className="tab-bar">
        {CATEGORY_KEYS.map((k) => (
          <button key={k} className={`tab-button${category === k ? " active" : ""}`} onClick={() => setCategory(k)} type="button">
            {CATEGORY_LABELS[k]}
          </button>
        ))}
      </div>
      {body}
    </div>
  );
}

function PlayedSplitTable({
  block,
  showTeam,
  statColumnsBase,
}: {
  block: PlayedSplitBlock;
  showTeam: boolean;
  statColumnsBase: Column<OpponentSplitRow>[];
}) {
  const columns = useMemo<Column<OpponentSplitRow>[]>(
    () => [
      { key: "label", label: "条件", align: "left", sortValue: () => 0, format: (r) => r.name },
      {
        key: "g",
        label: "G",
        sortValue: () => 0,
        format: (r) => (r.key === "diff" ? "-" : String(r.gamesPlayed)),
      },
      {
        key: "record",
        label: "勝敗",
        sortValue: () => 0,
        format: (r) => (r.key === "diff" ? "-" : `${r.wins}-${r.losses}`),
      },
      {
        key: "winpct",
        label: "勝率",
        sortValue: () => 0,
        format: (r) => (r.key === "diff" ? formatWinPctDiff(block.played, block.notPlayed) : formatWinPct(r.wins, r.losses)),
      },
      ...playedSplitStatColumns(statColumnsBase, block),
    ],
    [block, statColumnsBase],
  );
  return (
    <div className="played-split-block">
      {showTeam && <h3 className="played-split-team">{block.teamName}</h3>}
      <div className="table-scroll played-split-table">
        <SortableTable
          columns={columns}
          rows={[block.played]}
          pinnedRows={[block.notPlayed, block.diff]}
          rowKey={(r) => r.key}
          defaultSortKey="none"
          statScope="team"
        />
      </div>
    </div>
  );
}
