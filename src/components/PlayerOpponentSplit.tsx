import { useCallback, useMemo, type ReactNode } from "react";
import { SeasonLink as Link } from "./SeasonLink";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { OpponentSplitTable } from "./OpponentSplitTable";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { RuleChangeFootnote } from "./RuleChangeFootnote";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { composeLabels, displayModeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { displayModeAxis, gameTypeAxis, simpleSelectAxis } from "../lib/filterAxes";
import {
  PLAYER_OPPONENT_CATEGORIES,
  buildPlayerOpponentRows,
  playerScoringCompositionColumns,
  playerShootingColumns,
  playerShootingData,
  playerStandardColumns,
  type PlayerOpponentCategory,
  type PlayerOpponentRow,
} from "../lib/playerOpponentSplit";
import type { SeasonDisplayMode, SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { foulColumnsSplit } from "../lib/ruleChange";
import type { GameTeamInfo } from "../lib/situational";
import type { Column } from "./SortableTable";
import type { PlayerGameLog, TeamGameLog, YahooShotEvent } from "../../shared/types";

/** 個人詳細の「対戦相手別」タブ。選んだシーズンの、対戦相手ごとの成績を1行ずつ出し、一番下に「全体」（その条件のシーズン全体）を置く。
 * 値は個人詳細のシーズン別成績と同じ列・同じ数え方（出場した試合だけ）。シーズンの途中で移籍した選手は、所属の違う試合も相手ごとに1行にまとめる。
 * 相手の名前を押すと、その試合での自チームの対戦成績タブ（その相手）へ移る。区間（Q別など）は今は選べない */
export function PlayerOpponentSplit({
  playerId,
  season,
  seasonOptions,
  onSeasonChange,
  logs,
  ownTeamByScheduleKey,
  teamLogsByTeamId,
  loading,
  category,
  onCategoryChange,
  gameType,
  onGameTypeChange,
  displayMode,
  onDisplayModeChange,
  shotsByScheduleKey,
  shotsLoading,
  yahooSupported,
}: {
  playerId: string;
  /** 選んでいるシーズン */
  season: string;
  /** 選べるシーズン（その選手が出場したシーズン） */
  seasonOptions: string[];
  onSeasonChange: (season: string) => void;
  /** 選んだシーズンの試合ログ（試合種別で絞る前）。無ければ読み込み中 */
  logs: PlayerGameLog[] | undefined;
  /** 選んだシーズンの、試合ごとの自チームと、所属したチームごとの試合ログ。無ければ読み込み中 */
  ownTeamByScheduleKey: Map<string, GameTeamInfo> | undefined;
  teamLogsByTeamId: Map<string, TeamGameLog[]> | undefined;
  loading: boolean;
  category: PlayerOpponentCategory;
  onCategoryChange: (c: PlayerOpponentCategory) => void;
  gameType: SeasonGameTypeFilter;
  onGameTypeChange: (v: SeasonGameTypeFilter) => void;
  displayMode: SeasonDisplayMode;
  onDisplayModeChange: (v: SeasonDisplayMode) => void;
  /** 試合ごとの、この選手のシュート（スポーツナビの記録。選んだシーズンの Shooting を選んだときだけ読む） */
  shotsByScheduleKey: ReadonlyMap<string, YahooShotEvent[]> | undefined;
  shotsLoading: boolean;
  /** そのシーズンにスポーツナビの記録があるか */
  yahooSupported: boolean;
}) {
  const ready = !loading && !!logs && !!ownTeamByScheduleKey && !!teamLogsByTeamId;
  const { rows, total } = useMemo(
    () =>
      ready
        ? buildPlayerOpponentRows({ playerId, season, logs, gameType, displayMode, ownTeamByScheduleKey, teamLogsByTeamId })
        : { rows: [] as PlayerOpponentRow[], total: null },
    [ready, playerId, season, logs, gameType, displayMode, ownTeamByScheduleKey, teamLogsByTeamId],
  );
  const allRows = useMemo(() => (total ? [...rows, total] : rows), [rows, total]);
  const foulSplit = foulColumnsSplit([season]);
  const shootingData = useMemo(
    () => (category === "shooting" && shotsByScheduleKey ? playerShootingData(allRows, shotsByScheduleKey) : null),
    [category, allRows, shotsByScheduleKey],
  );

  const statColumns = useMemo<Column<PlayerOpponentRow>[]>(() => {
    switch (category) {
      case "traditional":
      case "advanced":
      case "misc":
      case "scoring":
        return playerStandardColumns(category, displayMode, foulSplit);
      case "scoringComposition":
        return playerScoringCompositionColumns();
      case "shooting":
        return shootingData ? playerShootingColumns(shootingData, displayMode) : [];
    }
  }, [category, displayMode, foulSplit, shootingData]);

  // 相手の名前: 押すと、その相手との試合でのいちばん新しい自チームの、対戦成績タブへ移る
  const renderName = useCallback(
    (r: PlayerOpponentRow): ReactNode => {
      const name = <ResponsiveTeamName teamId={r.opponentTeamId!} name={r.name} />;
      if (!r.latestTeamId) return name;
      return (
        <Link to={`/teams/${r.latestTeamId}?season=${season}&tab=h2h&vs=${r.opponentTeamId}`} className="opp-split-link">
          {name}
        </Link>
      );
    },
    [season],
  );

  const categoryLabel = CATEGORY_LABELS[category];
  const ignoresDisplayMode = category === "scoringComposition";
  const conditions = composeLabels(gameTypeLabels(gameType, season), !ignoresDisplayMode && displayModeLabels(displayMode));
  const axes = [
    simpleSelectAxis({
      id: "opponentSplitSeason",
      label: "シーズン",
      options: seasonOptions.map((s) => ({ value: s, label: `${s}シーズン` })),
      value: season,
      // どのシーズンも既定値扱い（対象を選ぶ軸で、変更強調の対象にしない）
      defaultValue: season,
      onChange: onSeasonChange,
    }),
    gameTypeAxis(gameType, onGameTypeChange, season),
    displayModeAxis(displayMode, onDisplayModeChange, {
      disabledReason: ignoresDisplayMode ? `${categoryLabel}は割合の表で、平均/合計は連動しません。` : undefined,
    }),
  ];

  let body: ReactNode;
  if (!ready) {
    body = <p className="loading">読み込み中...</p>;
  } else if (!total) {
    body = <p className="empty-message">該当する試合がありません</p>;
  } else if (category === "shooting" && !yahooSupported) {
    body = <p className="empty-message">このシーズンのデータには対応していません</p>;
  } else if (category === "shooting" && (shotsLoading || !shotsByScheduleKey)) {
    body = <p className="loading">読み込み中...</p>;
  } else if (category === "shooting" && (shootingData?.shotTypeKeys.length ?? 0) === 0) {
    body = <p className="empty-message">このシーズンのデータには対応していません</p>;
  } else {
    body = <OpponentSplitTable rows={rows} total={total} statColumns={statColumns} renderName={renderName} statScope="player" />;
  }

  return (
    <div className="player-tab-panel">
      <ConditionTitle section title={`${season}シーズン 対戦相手別：${categoryLabel}`} conditions={conditions} />
      <FilterBar simple stateKey={`player:${playerId}:opponentSplitFilter`} axes={axes} />
      <div className="tab-bar">
        {PLAYER_OPPONENT_CATEGORIES.map((t) => (
          <button key={t.key} className={`tab-button${category === t.key ? " active" : ""}`} onClick={() => onCategoryChange(t.key)} type="button">
            {t.label}
          </button>
        ))}
      </div>
      {body}
      {category === "misc" && total && <RuleChangeFootnote seasons={[season]} />}
      {total && (
        <p className="page-subtitle">
          出場した試合だけを数えています。シーズンの途中で移籍した選手は、所属の違う試合も相手ごとにまとめています。
        </p>
      )}
    </div>
  );
}
