import { useMemo, useRef, useState } from "react";
import { TeamRankScope, TeamRankText, rankTierClass, type TeamCellRank } from "./TeamRankScope";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton, type ExportChoice } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { FilterBar } from "./FilterBar";
import { RuleChangeFootnote } from "./RuleChangeFootnote";
import { StatHeaderLabel } from "./StatHeaderLabel";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "./BoxscoreTable";
import { buildExportFilename, composeLabels, displayModeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { displayModeAxis, gameTypeAxis } from "../lib/filterAxes";
import { formatWinPct } from "../lib/format";
import type { SeasonDisplayMode } from "../lib/playerSeasonBoxscore";
import { foulColumnsSplit } from "../lib/ruleChange";
import { waitForSaveRender } from "../lib/saveWait";
import { statDescription } from "../lib/statDescriptions";
import { seasonPeriodCell, seasonPeriodFormatters } from "../lib/teamSeasonPeriod";
import { buildQuarterRows, formatPeriodRecord, periodWinPct, quarterScoreCells } from "../lib/teamQuarterSplit";
import { useTeamPeriodSource } from "../lib/teamPeriodTotals";
import { OVERTIME_GAMES_NOTE, SHORT_GAMES_PERIOD_NOTE, MANUAL_BOXSCORE_PERIOD_NOTE, hasManualBoxscoreSeason, hasShortGameSeason } from "../lib/seasonPeriod";
import type { League } from "../lib/league";
import { filterByGameType, type SeasonGameTypeFilter } from "../../shared/gameType";
import type { TeamGameLog } from "../../shared/types";

/** 下の表で選べるカテゴリ（チームスタッツタブの表と同じ4つ） */
export const QUARTER_TAB_KEYS: readonly BoxscoreTabKey[] = ["traditional", "advanced", "misc", "scoring"];

const SCORE_COLUMNS: { key: keyof ReturnType<typeof quarterScoreCells>; label: string; rank: { key: string; label: string } }[] = [
  { key: "pts", label: "得点", rank: { key: "pts", label: "PTS" } },
  { key: "oppPts", label: "失点", rank: { key: "opppts", label: "opp PTS" } },
  { key: "diff", label: "得失点", rank: { key: "plusminus", label: "+/-" } },
  { key: "ortg", label: "ORtg", rank: { key: "ortg", label: "ORtg" } },
  { key: "drtg", label: "DRtg", rank: { key: "drtg", label: "DRtg" } },
  { key: "netRtg", label: "NetRtg", rank: { key: "netrtg", label: "NetRtg" } },
];

/**
 * チーム詳細の「Q別」タブ。選んだシーズンの 1Q〜4Q・前半・後半・延長を行にして、上に「Q別得失点」（得点・失点・レーティング）、
 * カテゴリの切り替え（下の表だけに効く）のあと、下に「スタッツ」（チームスタッツと同じカテゴリの表）を出す。
 * 値はチームスタッツタブで同じ区間を選んだときと同じ集計（teamSeasonPeriod.ts）。保存は2つの表を別々に、チェックで選ぶ（DESIGN.md 463章）
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
  // 数字の下の順位と、上位3位・下位3位の色（その区間・試合区分・平均／合計での、リーグの全チームの中の順位。DESIGN.md 406章）
  const [showRank, setShowRank] = useState(true);
  const categoryLabel = BOXSCORE_TABS.find((t) => t.key === category)?.label ?? "";

  // 保存（DESIGN.md 463章）: 「Q別得失点」と「スタッツ」（カテゴリごと）を別々に、チェックで選ぶ。1項目1枚。タイトルに表の名前、サブタイトルに条件、ファイル名にも表の名前
  const scoreRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);
  const originalCategory = useRef<BoxscoreTabKey | null>(null);
  const scoreTitle = `${season}シーズン ${teamName}　Q別得失点`;
  const statsTitle = `${season}シーズン ${teamName}　Q別スタッツ：${categoryLabel}`;
  const baseDate = { kind: "season", season, gameType } as const;
  const saveChoices: ExportChoice[] = [
    {
      key: "score",
      label: "Q別得失点",
      targetRef: scoreRef,
      filename: buildExportFilename([`${season}シーズン`, teamName, "Q別得失点", ...conditions]),
      baseDate,
    },
    ...BOXSCORE_TABS.filter((t) => QUARTER_TAB_KEYS.includes(t.key)).map(
      (t): ExportChoice => ({
        key: `stats:${t.key}`,
        label: `スタッツ：${t.label}`,
        targetRef: statsRef,
        filename: buildExportFilename([`${season}シーズン`, teamName, "Q別スタッツ", `${t.label}タブ`, ...conditions]),
        baseDate,
        activate: async () => {
          if (originalCategory.current === null) originalCategory.current = category;
          onCategoryChange(t.key);
          await waitForSaveRender(() => statsRef.current, `stats:${t.key}`);
        },
      }),
    ),
  ];
  const restoreCategory = () => {
    if (originalCategory.current !== null) onCategoryChange(originalCategory.current);
    originalCategory.current = null;
  };

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
    // 延長の注意書きは1つにまとめる。延長のあった試合が無いときだけ、その旨を添える
    const overtimeNote = `${OVERTIME_GAMES_NOTE}ORtg・DRtg・時間帯勝敗・時間帯勝率の数え方は用語集に書いてあります。${otRow?.status === "empty" ? "延長のあった試合はありません。" : ""}`;
    const periodNotes = (
      <>
        {hasShortGameSeason([season]) && <p className="page-subtitle">{SHORT_GAMES_PERIOD_NOTE}</p>}
        {hasManualBoxscoreSeason([season]) && <p className="page-subtitle">{MANUAL_BOXSCORE_PERIOD_NOTE}</p>}
      </>
    );
    body = (
      <>
        <ExportImageButton
          multi
          choicesLabel="保存する表"
          choices={saveChoices}
          defaultChoiceKey="score"
          defaultChoiceKeys={["score", `stats:${category}`]}
          restoreAfterSave={restoreCategory}
        />
        <ExportTarget ref={scoreRef} className="export-target-standings export-target-qscore" baseDate={baseDate}>
          <div data-save-key="score">
            <ConditionTitle title={scoreTitle} exportScope={`${season}シーズン`} conditions={conditions} />
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left">区間</th>
                    <th className="align-right" title={statDescription("G")}>G</th>
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
                      <TeamRankScope key={r.value} season={season} league={league} teamId={teamId} categories={["traditional", "advanced"]} mode={displayMode} perspective="own" period={r.value} gameType={gameType} enabled={showRank && r.status === "ready"}>
                        {(rankOf) => (
                          <tr>
                            <td className="align-left">{r.label}</td>
                            <td className="align-right">{r.status === "ready" ? r.games.length : "-"}</td>
                            {SCORE_COLUMNS.map((c) => {
                              const rank: TeamCellRank | undefined = cells[c.key] === "-" ? undefined : rankOf(c.rank);
                              return (
                                <td className={`align-right${rankTierClass(rank)}`} key={c.key}>
                                  {cells[c.key]}
                                  <TeamRankText rank={rank} />
                                </td>
                              );
                            })}
                          </tr>
                        )}
                      </TeamRankScope>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="page-subtitle export-only">{overtimeNote}</p>
          </div>
        </ExportTarget>

        <div className="tab-bar-with-toggle compare-category-bar">
          <div className="tab-bar">
            {BOXSCORE_TABS.filter((t) => QUARTER_TAB_KEYS.includes(t.key)).map((t) => (
              <button key={t.key} className={`tab-button${category === t.key ? " active" : ""}`} onClick={() => onCategoryChange(t.key)} type="button">
                {t.label}
              </button>
            ))}
          </div>
          <label className="compare-rank-toggle">
            <input type="checkbox" checked={showRank} onChange={(e) => setShowRank(e.target.checked)} /> 順位を表示
          </label>
        </div>
        <ExportTarget ref={statsRef} className="export-target-standings" baseDate={baseDate}>
          <div data-save-key={`stats:${category}`}>
            <ConditionTitle title={statsTitle} exportScope={`${season}シーズン`} conditions={conditions} />
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left">区間</th>
                    <th className="align-right" title={statDescription("時間帯勝敗")}>時間帯勝敗</th>
                    <th className="align-right" title={statDescription("時間帯勝率")}>時間帯勝率</th>
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
                      <TeamRankScope key={r.value} season={season} league={league} teamId={teamId} categories={category === "scoring" ? ["scoring", "misc"] : [category]} mode={displayMode} perspective="own" period={r.value} gameType={gameType} enabled={showRank && ready}>
                        {(rankOf) => (
                          <tr>
                            <td className="align-left">{r.label}</td>
                            <td className="align-right">{ready ? formatPeriodRecord(r) : "-"}</td>
                            <td className="align-right">{ready ? formatWinPct(periodWinPct(r) ?? 0) : "-"}</td>
                            {columns.map((c) => {
                              const text = seasonPeriodCell(formatters, c.label, r, teamId, teamName);
                              const rank = text === "-" ? undefined : rankOf(c);
                              return (
                                <td className={`align-right${rankTierClass(rank)}`} key={c.key}>
                                  {text}
                                  <TeamRankText rank={rank} />
                                </td>
                              );
                            })}
                          </tr>
                        )}
                      </TeamRankScope>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {category === "misc" && <RuleChangeFootnote seasons={[season]} />}
            <p className="page-subtitle">{overtimeNote}</p>
            {periodNotes}
          </div>
        </ExportTarget>
      </>
    );
  }

  return (
    <div className="team-tab-panel">
      <FilterBar simple stateKey={`team:${teamId}:quarterFilter`} axes={axes} />
      {body}
    </div>
  );
}
