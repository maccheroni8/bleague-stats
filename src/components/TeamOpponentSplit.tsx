import { useCallback, useMemo, type ReactNode } from "react";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { ResultOnlyNote } from "./ResultOnlyNote";
import { RuleChangeFootnote } from "./RuleChangeFootnote";
import { OpponentSplitTable } from "./OpponentSplitTable";
import type { Column } from "./SortableTable";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { composeLabels, gameTypeLabels, perspectiveLabels, displayModeLabels } from "../lib/conditionLabels";
import { displayModeAxis, gameTypeAxis, perspectiveAxis } from "../lib/filterAxes";
import { foulColumnsSplit } from "../lib/ruleChange";
import {
  OPPONENT_SPLIT_CATEGORIES,
  buildOpponentSplitRows,
  categoryDisabledPerspectives,
  categoryNeedsYahoo,
  forcedTurnoverColumns,
  foreignColumns,
  foreignSplitData,
  pbpsOf,
  periodColumns,
  scoringCompositionColumns,
  shootingColumns,
  shootingSplitData,
  standardColumns,
  sumForcedTurnovers,
  type OpponentSplitCategory,
  type OpponentSplitRow,
} from "../lib/opponentSplit";
import type { SeasonDisplayMode } from "../lib/playerSeasonBoxscore";
import { logsHaveForeignSeconds } from "../lib/teamForeignCourt";
import type { TeamPerspective } from "../lib/teamStatsColumns";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { filterByGameType } from "../../shared/gameType";
import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";
import type { TeamForcedTurnovers, TeamGameLog, YahooGamePbp } from "../../shared/types";

/** 平均／合計が効かないカテゴリ（割合の表） */
function categoryIgnoresDisplayMode(category: OpponentSplitCategory): boolean {
  return category === "foreignPlayers" || category === "scoringComposition";
}

/**
 * チーム詳細の「対戦相手別」タブ。選んだシーズンの、対戦相手ごとの成績を1行ずつ出し、一番下に「全体」（その条件のシーズン全体）を置く。
 * 値は全チームスタッツ・対戦成績タブと同じ列（opponentSplit.ts）。相手の名前を押すと、対戦成績タブ（その相手）へ移る。
 * 試合区分（レギュラー／ポストシーズン／合算）で絞り込む。区間（Q別など）は今は選べない（行の元になる試合ログを区間の値に差し替える形で足せる）
 */
export function TeamOpponentSplit({
  teamId,
  season,
  logs,
  logsLoading,
  category,
  onCategoryChange,
  gameType,
  onGameTypeChange,
  perspective,
  onPerspectiveChange,
  displayMode,
  onDisplayModeChange,
  yahooPbp,
  yahooSupported,
  yahooReady,
  resultOnlyGames,
  onSelectOpponent,
}: {
  teamId: string;
  season: string;
  /** そのシーズンのこのチームの試合ログ */
  logs: TeamGameLog[] | null;
  logsLoading: boolean;
  category: OpponentSplitCategory;
  onCategoryChange: (c: OpponentSplitCategory) => void;
  gameType: SeasonGameTypeFilter;
  onGameTypeChange: (v: SeasonGameTypeFilter) => void;
  perspective: TeamPerspective;
  onPerspectiveChange: (v: TeamPerspective) => void;
  displayMode: SeasonDisplayMode;
  onDisplayModeChange: (v: SeasonDisplayMode) => void;
  /** スポーツナビの記録（試合ログの試合ごと。チームスタッツと同じ取得を使い回す） */
  yahooPbp: ReadonlyMap<string, YahooGamePbp>;
  /** そのシーズンにスポーツナビの記録があるか */
  yahooSupported: boolean;
  /** スポーツナビの記録の取得が終わったか */
  yahooReady: boolean;
  resultOnlyGames: ResultOnlyGameEntry[] | undefined;
  onSelectOpponent: (opponentTeamId: string) => void;
}) {
  const disabledPerspectives = categoryDisabledPerspectives(category);
  // 選べない視点が選ばれていたら自チームに戻す（カテゴリを切り替えたとき）
  const effectivePerspective: TeamPerspective = disabledPerspectives.includes(perspective) ? "own" : perspective;

  const scopedLogs = useMemo(() => filterByGameType(logs ?? [], gameType), [logs, gameType]);
  const { rows, total } = useMemo(() => buildOpponentSplitRows(teamId, scopedLogs), [teamId, scopedLogs]);
  const allRows = useMemo(() => [...rows, total], [rows, total]);

  // ペイント内外はプレーバイプレーの公式の区分で数えるので全シーズンで出せる（全チームスタッツと同じ）
  const paintSupported = true;
  const foulSplit = foulColumnsSplit([season]);
  const foreignSupported = logsHaveForeignSeconds(logs ?? []);
  const needsYahoo = categoryNeedsYahoo(category);

  const foreignData = useMemo(
    () => (category === "foreignPlayers" ? foreignSplitData(allRows, effectivePerspective === "opp" ? "opp" : "own") : null),
    [category, allRows, effectivePerspective],
  );
  const forcedData = useMemo(() => {
    if (category !== "forcedTurnovers") return null;
    const map = new Map<string, { forced: TeamForcedTurnovers; committed: TeamForcedTurnovers }>();
    for (const r of allRows) map.set(r.key, sumForcedTurnovers(pbpsOf(r.logs, yahooPbp), teamId));
    return map;
  }, [category, allRows, yahooPbp, teamId]);
  const shootingData = useMemo(
    () => (category === "shooting" ? shootingSplitData(allRows, yahooPbp, teamId, effectivePerspective === "opp" ? "opp" : "own") : null),
    [category, allRows, yahooPbp, teamId, effectivePerspective],
  );

  const statColumns = useMemo<Column<OpponentSplitRow>[]>(() => {
    switch (category) {
      case "traditional":
      case "advanced":
      case "misc":
      case "scoring":
        return standardColumns(category, displayMode, effectivePerspective, { paintSupported, foulSplit });
      case "scoringComposition":
        return scoringCompositionColumns(effectivePerspective, { paintSupported });
      case "periods":
        return periodColumns(displayMode, effectivePerspective);
      case "foreignPlayers":
        return foreignData ? foreignColumns(foreignData) : [];
      case "forcedTurnovers":
        return forcedData ? forcedTurnoverColumns(forcedData, displayMode, effectivePerspective) : [];
      case "shooting":
        return shootingData ? shootingColumns(shootingData, displayMode) : [];
    }
  }, [category, displayMode, effectivePerspective, paintSupported, foulSplit, foreignData, forcedData, shootingData]);

  const renderName = useCallback(
    (r: OpponentSplitRow) => (
      <button type="button" className="opp-split-link" onClick={() => onSelectOpponent(r.opponentTeamId!)}>
        <ResponsiveTeamName teamId={r.opponentTeamId!} name={r.name} />
      </button>
    ),
    [onSelectOpponent],
  );

  const categoryLabel = CATEGORY_LABELS[category];
  const conditions = composeLabels(
    gameTypeLabels(gameType, season),
    perspectiveLabels(effectivePerspective),
    !categoryIgnoresDisplayMode(category) && displayModeLabels(displayMode),
  );

  const axes = [
    gameTypeAxis(gameType, onGameTypeChange, season),
    perspectiveAxis(effectivePerspective, onPerspectiveChange, {
      disabledValues: disabledPerspectives,
      disabledReason:
        category === "foreignPlayers"
          ? `${CATEGORY_LABELS.foreignPlayers}の「+/-」は選べません。`
          : category === "shooting"
            ? `${CATEGORY_LABELS.shooting}の「+/-」は選べません。`
            : undefined,
    }),
    displayModeAxis(displayMode, onDisplayModeChange, {
      disabledReason: categoryIgnoresDisplayMode(category) ? `${categoryLabel}は割合の表で、平均/合計は連動しません。` : undefined,
    }),
  ];

  let body: ReactNode;
  if (logsLoading || !logs) {
    body = <p className="loading">読み込み中...</p>;
  } else if (scopedLogs.length === 0) {
    body = <p className="empty-message">該当する試合がありません</p>;
  } else if (needsYahoo && !yahooSupported) {
    body = <p className="empty-message">このシーズンのデータには対応していません</p>;
  } else if (needsYahoo && !yahooReady) {
    body = <p className="loading">読み込み中...</p>;
  } else if (category === "foreignPlayers" && (!foreignSupported || (foreignData?.counts.length ?? 0) === 0)) {
    body = <p className="empty-message">このシーズンのデータには対応していません</p>;
  } else if (category === "shooting" && (shootingData?.shotTypeKeys.length ?? 0) === 0) {
    body = <p className="empty-message">このシーズンのデータには対応していません</p>;
  } else {
    body = (
      <OpponentSplitTable rows={rows} total={total} statColumns={statColumns} renderName={renderName} statScope="team" />
    );
  }

  return (
    <div className="team-tab-panel">
      <ConditionTitle section title={`${season}シーズン 対戦相手別：${categoryLabel}`} conditions={conditions} />
      <FilterBar simple stateKey={`team:${teamId}:opponentSplitFilter`} axes={axes} />
      <div className="tab-bar">
        {OPPONENT_SPLIT_CATEGORIES.map((t) => (
          <button key={t.key} className={`tab-button${category === t.key ? " active" : ""}`} onClick={() => onCategoryChange(t.key)} type="button">
            {t.label}
          </button>
        ))}
      </div>
      {body}
      {category === "misc" && scopedLogs.length > 0 && <RuleChangeFootnote seasons={[season]} />}
      {category === "forcedTurnovers" && yahooSupported && scopedLogs.length > 0 && (
        <p className="page-subtitle">
          視点は、自チーム＝相手から奪った件数／opp＝自チームが相手に強制された件数／+/-＝その差です。平均は、スポーツナビの記録があった試合の数で割っています。
        </p>
      )}
      {category === "shooting" && yahooSupported && scopedLogs.length > 0 && (
        <p className="page-subtitle">シュートの種類別の記録は、スポーツナビの記録がある試合だけです。</p>
      )}
      <ResultOnlyNote games={resultOnlyGames} teamId={teamId} variant="stats" />
    </div>
  );
}
