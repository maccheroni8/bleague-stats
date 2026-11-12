import { useMemo, type ReactNode } from "react";
import { SeasonLink as RouterLink } from "./SeasonLink";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { OnCourtShareNote } from "./OnCourtShareNote";
import { PeriodIndexFailure } from "./PeriodIndexFailure";
import { RuleChangeFootnote } from "./RuleChangeFootnote";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { composeLabels, displayModeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { displayModeAxis, gameTypeAxis } from "../lib/filterAxes";
import { seasonBoxColumnsWithFtrPpp } from "../lib/pppColumn";
import type { League } from "../lib/league";
import { PLAYER_QUARTER_CATEGORY_KEYS, buildPlayerQuarterRows } from "../lib/playerQuarterSplit";
import type { SeasonBoxTabKey, SeasonDisplayMode, SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { foulColumnsSplit } from "../lib/ruleChange";
import {
  MANUAL_BOXSCORE_PERIOD_NOTE,
  OVERTIME_GAMES_NOTE,
  SHORT_GAMES_PERIOD_NOTE,
  hasManualBoxscoreSeason,
  hasShortGameSeason,
  useSeasonPeriodSources,
} from "../lib/seasonPeriod";
import { statDescription } from "../lib/statDescriptions";
import type { GameTeamInfo } from "../lib/situational";
import type { PlayerGameLog, TeamGameLog } from "../../shared/types";

/**
 * 個人詳細の「Q別」タブ。ページで選んでいるシーズンの 1Q〜4Q・前半・後半・延長を行にして、チーム詳細のQ別タブの下の表と同じ作り（見出し → 選択 → 表）で出す。
 * 値は、個人詳細のシチュエーション別成績・シーズン別成績で同じ区間を選んだときと同じ集計（ピリオド別の索引の合算）。
 * G は、その区間の値がある試合の数（延長は延長に出た試合）で、平均はその数で割る。
 * 移籍した選手は、区間ごとに「所属チームごとの行＋複数チームの合計行」を出す（シーズン別成績と同じ）
 */
export function PlayerQuarterTab({
  playerId,
  season,
  league,
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
}: {
  playerId: string;
  season: string;
  league: League;
  /** そのシーズンの試合ログ（試合種別で絞る前）。無ければ、その選手はこのシーズンに出場していない */
  logs: PlayerGameLog[] | undefined;
  ownTeamByScheduleKey: Map<string, GameTeamInfo> | undefined;
  teamLogsByTeamId: Map<string, TeamGameLog[]> | undefined;
  loading: boolean;
  category: SeasonBoxTabKey;
  onCategoryChange: (c: SeasonBoxTabKey) => void;
  gameType: SeasonGameTypeFilter;
  onGameTypeChange: (v: SeasonGameTypeFilter) => void;
  displayMode: SeasonDisplayMode;
  onDisplayModeChange: (v: SeasonDisplayMode) => void;
}) {
  const seasons = useMemo(() => [season], [season]);
  const periodSources = useSeasonPeriodSources(seasons, true, league);
  const source = periodSources.sources.get(season) ?? null;
  const ready = !loading && !!logs && !!ownTeamByScheduleKey && !!teamLogsByTeamId;

  const { rows, empty } = useMemo(
    () =>
      ready && source
        ? buildPlayerQuarterRows({ playerId, season, logs, gameType, displayMode, ownTeamByScheduleKey, teamLogsByTeamId, source })
        : { rows: [], empty: [] },
    [ready, source, playerId, season, logs, gameType, displayMode, ownTeamByScheduleKey, teamLogsByTeamId],
  );

  const foulSplit = foulColumnsSplit([season]);
  const columns = useMemo(() => seasonBoxColumnsWithFtrPpp(category, foulSplit), [category, foulSplit]);
  const categoryLabel = CATEGORY_LABELS[category];
  const conditions = composeLabels(gameTypeLabels(gameType, season), displayModeLabels(displayMode));
  const axes = [gameTypeAxis(gameType, onGameTypeChange, season), displayModeAxis(displayMode, onDisplayModeChange)];

  // 注記用: 区間ごとに、複数チームの合計行があればそれ、なければ1チームの行を、全区間分足す
  const shareNoteRow = useMemo(() => {
    const combinedPeriods = new Set(rows.filter((r) => r.isCombined).map((r) => r.periodValue));
    const counted = rows.filter((r) => r.isCombined || !combinedPeriods.has(r.periodValue));
    return {
      season,
      gamesPlayed: counted.reduce((a, r) => a + r.ctx.raw.gamesPlayed, 0),
      ocGames: counted.reduce((a, r) => a + r.ctx.raw.ocGames, 0),
    };
  }, [rows, season]);

  // 区間の順に、値のある行と値の無い区間（「-」の行）を並べる
  const lines = useMemo(() => {
    const order = ["q1", "q2", "q3", "q4", "h1", "h2", "ot", "clutch"];
    const all: ({ kind: "row"; row: (typeof rows)[number] } | { kind: "empty"; value: string; label: string })[] = [
      ...rows.map((row) => ({ kind: "row" as const, row })),
      ...empty.map((e) => ({ kind: "empty" as const, value: e.periodValue, label: e.periodLabel })),
    ];
    const keyOf = (l: (typeof all)[number]) => order.indexOf(l.kind === "row" ? l.row.periodValue : l.value);
    return all.map((l, i) => [l, i] as const).sort((a, b) => keyOf(a[0]) - keyOf(b[0]) || a[1] - b[1]).map(([l]) => l);
  }, [rows, empty]);

  let body: ReactNode;
  if (!ready || (periodSources.loading && !source)) {
    body = <p className="loading">読み込み中...</p>;
  } else if (!source) {
    body = <PeriodIndexFailure onRetry={periodSources.retry} target="Q別の表" />;
  } else if (rows.length === 0 && empty.length === 0) {
    body = <p className="empty-message">該当する試合がありません</p>;
  } else {
    body = (
      <div className="table-scroll player-sticky-2 player-sticky-season">
        <table className="stats-table">
          <thead>
            <tr>
              <th className="align-left">区間</th>
              <th className="align-left">チーム</th>
              {columns.map((c) => (
                <th className="align-right" key={c.key} title={statDescription(c.label)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) =>
              l.kind === "row" ? (
                <tr key={l.row.key} className={l.row.isCombined ? "season-team-total-row" : undefined}>
                  <td className="align-left">{l.row.firstOfPeriod ? l.row.periodLabel : ""}</td>
                  <td className="align-left">
                    {l.row.teamId ? (
                      <RouterLink to={`/teams/${l.row.teamId}?season=${season}&league=${league}`} className="cell-link">
                        {l.row.teamLabel}
                      </RouterLink>
                    ) : (
                      l.row.teamLabel
                    )}
                  </td>
                  {columns.map((c) => (
                    <td className="align-right" key={c.key}>
                      {c.format(l.row.ctx, displayMode)}
                    </td>
                  ))}
                </tr>
              ) : (
                <tr key={`empty|${l.value}`}>
                  <td className="align-left">{l.label}</td>
                  <td className="align-left" />
                  {columns.map((c) => (
                    <td className="align-right" key={c.key}>
                      -
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    );
  }

  const showNotes = ready && !!source && (rows.length > 0 || empty.length > 0);
  return (
    <div className="player-tab-panel">
      <ConditionTitle section title={`${season}シーズン Q別：${categoryLabel}`} conditions={conditions} />
      <FilterBar simple stateKey={`player:${playerId}:quarterFilter`} axes={axes} />
      <div className="tab-bar">
        {PLAYER_QUARTER_CATEGORY_KEYS.map((key) => (
          <button key={key} className={`tab-button${category === key ? " active" : ""}`} onClick={() => onCategoryChange(key)} type="button">
            {CATEGORY_LABELS[key]}
          </button>
        ))}
      </div>
      {body}
      {showNotes && category === "misc" && <RuleChangeFootnote seasons={[season]} />}
      {showNotes && <OnCourtShareNote tab={category} rows={[shareNoteRow]} />}
      {showNotes && (
        <p className="page-subtitle">
          {OVERTIME_GAMES_NOTE}延長に出た試合が無いときは「-」です。出場した試合だけを数えています。
          {rows.some((r) => r.isCombined) ? "シーズンの途中で移籍した選手は、区間ごとに所属チームごとの行と、複数チームの合計の行を出しています。" : ""}
        </p>
      )}
      {showNotes && gameType !== "regular" && hasShortGameSeason([season]) && <p className="page-subtitle">{SHORT_GAMES_PERIOD_NOTE}</p>}
      {showNotes && gameType !== "playoff" && hasManualBoxscoreSeason([season]) && <p className="page-subtitle">{MANUAL_BOXSCORE_PERIOD_NOTE}</p>}
    </div>
  );
}
