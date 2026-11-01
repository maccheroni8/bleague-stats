import { useMemo } from "react";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { RuleChangeFootnote } from "./RuleChangeFootnote";
import { StatHeaderLabel } from "./StatHeaderLabel";
import { TeamRecordShort } from "./TeamRecordShort";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "./BoxscoreTable";
import { composeLabels, displayModeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { displayModeAxis, gameTypeAxis } from "../lib/filterAxes";
import { formatWinPct } from "../lib/format";
import type { SeasonDisplayMode } from "../lib/playerSeasonBoxscore";
import { foulColumnsSplit } from "../lib/ruleChange";
import { statDescription } from "../lib/statDescriptions";
import { seasonPeriodCell, seasonPeriodFormatters } from "../lib/teamSeasonPeriod";
import { buildQuarterRows, quarterScoreCells } from "../lib/teamQuarterSplit";
import { useTeamPeriodSource } from "../lib/teamPeriodTotals";
import { OVERTIME_GAMES_NOTE, SHORT_GAMES_PERIOD_NOTE, MANUAL_BOXSCORE_PERIOD_NOTE, hasManualBoxscoreSeason, hasShortGameSeason } from "../lib/seasonPeriod";
import type { League } from "../lib/league";
import { safeDiv } from "../../shared/formulas";
import { filterByGameType, type SeasonGameTypeFilter } from "../../shared/gameType";
import type { TeamGameLog } from "../../shared/types";

/** 下の表で選べるカテゴリ（チームスタッツタブの表と同じ4つ） */
export const QUARTER_TAB_KEYS: readonly BoxscoreTabKey[] = ["traditional", "advanced", "misc", "scoring"];

const SCORE_COLUMNS: { key: keyof ReturnType<typeof quarterScoreCells>; label: string }[] = [
  { key: "pts", label: "得点" },
  { key: "oppPts", label: "失点" },
  { key: "diff", label: "得失点" },
  { key: "ortg", label: "ORtg" },
  { key: "drtg", label: "DRtg" },
  { key: "netRtg", label: "NetRtg" },
];

/**
 * チーム詳細の「Q別」タブ。選んだシーズンの 1Q〜4Q・前半・後半・延長を行にして、上に得点・失点・レーティング、下にチームスタッツと同じカテゴリの表を出す。
 * 値はチームスタッツタブで同じ区間を選んだときと同じ集計（teamSeasonPeriod.ts）
 */
export function TeamQuarterTab({
  teamId,
  teamName,
  season,
  league,
  logs,
  logsLoading,
  gameType,
  onGameTypeChange,
  displayMode,
  onDisplayModeChange,
  category,
  onCategoryChange,
  columns,
  enabled,
}: {
  teamId: string;
  teamName: string;
  season: string;
  league: League;
  logs: TeamGameLog[] | null;
  logsLoading: boolean;
  gameType: SeasonGameTypeFilter;
  onGameTypeChange: (v: SeasonGameTypeFilter) => void;
  displayMode: SeasonDisplayMode;
  onDisplayModeChange: (v: SeasonDisplayMode) => void;
  category: BoxscoreTabKey;
  onCategoryChange: (c: BoxscoreTabKey) => void;
  /** 下の表の列（チームスタッツタブのシーズン別成績と同じ列定義） */
  columns: { key: string; label: string }[];
  /** このタブが開いているときだけ索引を読む */
  enabled: boolean;
}) {
  const { source, loading: sourceLoading, retry } = useTeamPeriodSource(season, enabled, league);
  const scopedLogs = useMemo(() => filterByGameType(logs ?? [], gameType), [logs, gameType]);
  const rows = useMemo(() => buildQuarterRows(season, source, sourceLoading, scopedLogs), [season, source, sourceLoading, scopedLogs]);
  const foulSplit = foulColumnsSplit([season]);
  const formatters = useMemo(() => seasonPeriodFormatters(displayMode, "own", foulSplit), [displayMode, foulSplit]);

  const conditions = composeLabels(gameTypeLabels(gameType, season), displayModeLabels(displayMode));
  const axes = [gameTypeAxis(gameType, onGameTypeChange, season), displayModeAxis(displayMode, onDisplayModeChange)];
  const categoryLabel = BOXSCORE_TABS.find((t) => t.key === category)?.label ?? "";

  let body;
  if (logsLoading || !logs || sourceLoading) {
    body = <p className="loading">読み込み中...</p>;
  } else if (!source) {
    body = (
      <p className="empty-message">
        このシーズンのQ別の記録を読み込めませんでした。{" "}
        <button type="button" className="tab-button" onClick={retry}>
          再読み込み
        </button>
      </p>
    );
  } else if (scopedLogs.length === 0) {
    body = <p className="empty-message">該当する試合がありません</p>;
  } else {
    const otRow = rows.find((r) => r.value === "ot");
    body = (
      <>
        <div className="table-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="align-left">区間</th>
                <th className="align-right" title={statDescription("試合数")}>試合数</th>
                {SCORE_COLUMNS.map((c) => (
                  <th className="align-right" key={c.key} title={statDescription(c.label, "team")}>
                    <StatHeaderLabel label={c.label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cells = quarterScoreCells(r, displayMode);
                return (
                  <tr key={r.value}>
                    <td className="align-left">{r.label}</td>
                    <td className="align-right">{r.status === "ready" ? r.games.length : "-"}</td>
                    {SCORE_COLUMNS.map((c) => (
                      <td className="align-right" key={c.key}>
                        {cells[c.key]}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="tab-bar">
          {BOXSCORE_TABS.filter((t) => QUARTER_TAB_KEYS.includes(t.key)).map((t) => (
            <button key={t.key} className={`tab-button${category === t.key ? " active" : ""}`} onClick={() => onCategoryChange(t.key)} type="button">
              {t.label}
            </button>
          ))}
        </div>
        <ConditionTitle section title={`${season}シーズン Q別：${categoryLabel}`} conditions={conditions} />
        <div className="table-scroll">
          <table className="stats-table">
            <thead>
              <tr>
                <th className="align-left">区間</th>
                <th className="align-right" title={statDescription("試合数")}>試合数</th>
                <th className="align-right" title={statDescription("勝敗")}>勝敗</th>
                <th className="align-right" title={statDescription("勝率")}>勝率</th>
                {columns.map((c) => (
                  <th className="align-right" key={c.key} title={statDescription(c.label, "team")}>
                    <StatHeaderLabel label={c.label} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const ready = r.status === "ready";
                return (
                  <tr key={r.value}>
                    <td className="align-left">{r.label}</td>
                    <td className="align-right">{ready ? r.games.length : "-"}</td>
                    <td className="align-right">{ready ? <TeamRecordShort wins={r.wins} losses={r.losses} /> : "-"}</td>
                    <td className="align-right">{ready ? formatWinPct(safeDiv(r.wins, r.wins + r.losses)) : "-"}</td>
                    {columns.map((c) => (
                      <td className="align-right" key={c.key}>
                        {seasonPeriodCell(formatters, c.label, r, teamId, teamName)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {category === "misc" && <RuleChangeFootnote seasons={[season]} />}
        <p className="page-subtitle">{OVERTIME_GAMES_NOTE}延長のあった試合が無いときは「-」です。勝敗は試合の勝敗です。</p>
        <p className="page-subtitle">
          ORtg・DRtgは、得点（失点）と攻撃回数を区間ごとに足してから割った値で、攻撃回数はその区間の記録から推定した値です。NetRtgは丸める前のORtg−DRtgです。
        </p>
        {otRow?.status === "empty" && <p className="page-subtitle">この条件では延長のあった試合がありません。</p>}
        {hasShortGameSeason([season]) && <p className="page-subtitle">{SHORT_GAMES_PERIOD_NOTE}</p>}
        {hasManualBoxscoreSeason([season]) && <p className="page-subtitle">{MANUAL_BOXSCORE_PERIOD_NOTE}</p>}
      </>
    );
  }

  return (
    <div className="team-tab-panel">
      <ConditionTitle section title={`${season}シーズン Q別：得点・失点とレーティング`} conditions={conditions} />
      <FilterBar simple stateKey={`team:${teamId}:quarterFilter`} axes={axes} />
      {body}
    </div>
  );
}
