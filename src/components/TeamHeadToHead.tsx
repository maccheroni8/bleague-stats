import { useMemo } from "react";
import { SeasonLink as Link } from "./SeasonLink";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { GlossaryNote } from "./GlossaryNote";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { StatHeaderLabel } from "./StatHeaderLabel";
import { BOX_CATEGORY_TABS, CATEGORY_LABELS, type BoxCategoryKey } from "../lib/categoryLabels";
import { composeLabels, gameTypeLabels, perspectiveLabels } from "../lib/conditionLabels";
import { fetchGameSummaries, fetchTeamGameLogs } from "../lib/data";
import { gameTypeAxis, perspectiveAxis, simpleSelectAxis } from "../lib/filterAxes";
import { formatDecimal, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { statDescription } from "../lib/statDescriptions";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  sumTeamGameLogs,
  type AllTeamsRow,
  type TeamPerspective,
} from "../lib/teamStatsColumns";
import { useJsonData } from "../lib/useJsonData";
import { enumParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, PERSPECTIVE_PARAM } from "../lib/urlFilterParams";
import { postseasonLabel } from "../../shared/gameType";
import { safeDiv } from "../../shared/formulas";
import type { SeasonEntry, TeamGameLog, TeamSummary } from "../../shared/types";
import type { Column } from "./SortableTable";

const OPPONENT_PARAM = {
  keys: ["vs"],
  read: (p: URLSearchParams) => p.get("vs") ?? undefined,
  write: (p: URLSearchParams, v: string) => {
    if (v !== "") p.set("vs", v);
  },
};
const CATEGORY_PARAM = enumParam<BoxCategoryKey>("hc", ["traditional", "advanced", "misc", "scoring"], "traditional", {
  traditional: "trad",
  advanced: "adv",
});

function StatTile({ label, value, rank }: { label: string; value: string; rank?: string }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {rank && <div className="rank">{rank}</div>}
    </div>
  );
}

interface OpponentOption {
  teamId: string;
  /** 一覧に出す名称（今のシーズンのクラブ名。対戦したことしか無いクラブは最後に対戦したときの名称） */
  name: string;
  played: boolean;
}

interface SeasonLogs {
  season: string;
  logs: TeamGameLog[];
  /** scheduleKey → 会場（日程の試合一覧 games-summary から） */
  venues: Map<string, string>;
}

/** 勝敗・ホーム／アウェイ別・平均得点失点 */
function summarize(logs: TeamGameLog[]) {
  const n = logs.length;
  const wins = logs.filter((g) => g.win).length;
  const home = logs.filter((g) => g.isHome);
  const away = logs.filter((g) => !g.isHome);
  const pts = logs.reduce((s, g) => s + g.teamScore, 0);
  const opp = logs.reduce((s, g) => s + g.opponentScore, 0);
  return {
    games: n,
    wins,
    losses: n - wins,
    homeWins: home.filter((g) => g.win).length,
    homeLosses: home.filter((g) => !g.win).length,
    awayWins: away.filter((g) => g.win).length,
    awayLosses: away.filter((g) => !g.win).length,
    avgPts: safeDiv(pts, n),
    avgOpp: safeDiv(opp, n),
    avgDiff: safeDiv(pts - opp, n),
  };
}

/**
 * チーム詳細の「対戦成績」タブ（DESIGN.md 185章）。相手のクラブを選ぶと、そのクラブとの通算の勝敗・ホーム／アウェイ別・平均得点失点、
 * シーズンごとの勝敗、試合ごとのスタッツ（全シーズン）を出す。値はチームの試合ログ（data/{season}/team-games/）から求める。
 * 名称が変わったクラブも内部のIDが同じなので1つの相手として通算し、表示は各シーズンの当時の名称。試合全体の記録のみ（Q別・前後半は無い）
 */
export function TeamHeadToHead({
  teamId,
  seasons,
  currentTeams,
  nextOpponentName,
}: {
  teamId: string;
  /** 収録済みのシーズン */
  seasons: SeasonEntry[];
  /** 今のシーズンのクラブ一覧（まだ対戦したことのないクラブも相手に選べるように） */
  currentTeams: TeamSummary[];
  /** 次に対戦する相手の名称（最初に選んでおく） */
  nextOpponentName: string | undefined;
}) {
  const seasonKeys = seasons.filter((s) => s.hasCompletedGames).map((s) => s.season);
  const seasonsKey = seasonKeys.join(",");
  const { data: seasonLogs, loading } = useJsonData<SeasonLogs[]>(
    () =>
      Promise.all(
        seasonKeys.map(async (season) => {
          let logs: TeamGameLog[] = [];
          try {
            logs = await fetchTeamGameLogs(season, teamId);
          } catch {
            // そのシーズンにこのクラブの試合ログが無い（リーグにいなかった）
          }
          const venues = new Map<string, string>();
          if (logs.length > 0) {
            try {
              for (const g of await fetchGameSummaries(season)) if (g.venue) venues.set(g.scheduleKey, g.venue);
            } catch {
              // 会場が読めなくても他の表示は続ける（会場は「-」）
            }
          }
          return { season, logs, venues };
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamId, seasonsKey],
  );

  const [opponentParam, setOpponent] = useUrlState(OPPONENT_PARAM, "");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [perspective, setPerspective] = useUrlState(PERSPECTIVE_PARAM, "own" as TeamPerspective);
  const [category, setCategory] = useUrlState(CATEGORY_PARAM, "traditional" as BoxCategoryKey);

  const options = useMemo<OpponentOption[]>(() => {
    const byId = new Map<string, OpponentOption>();
    // 過去に対戦したクラブ（新しいシーズンの名称を優先）
    for (const { logs } of [...(seasonLogs ?? [])].sort((a, b) => a.season.localeCompare(b.season))) {
      for (const g of logs) byId.set(g.opponentTeamId, { teamId: g.opponentTeamId, name: g.opponentTeamName, played: true });
    }
    // 今のシーズンのクラブ（今の名称で上書き。対戦したことがなくても選べる）
    for (const t of currentTeams) {
      if (t.teamId === teamId) continue;
      byId.set(t.teamId, { teamId: t.teamId, name: t.teamName, played: byId.get(t.teamId)?.played ?? false });
    }
    byId.delete(teamId);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }, [seasonLogs, currentTeams, teamId]);

  // 選んでいる相手。URLに無いときは、次に対戦する相手（無ければ最後に対戦した相手、それも無ければ先頭）
  const opponentId = useMemo(() => {
    if (opponentParam && options.some((o) => o.teamId === opponentParam)) return opponentParam;
    const next = nextOpponentName ? options.find((o) => o.name === nextOpponentName) : undefined;
    if (next) return next.teamId;
    const last = [...(seasonLogs ?? [])]
      .sort((a, b) => b.season.localeCompare(a.season))
      .flatMap((s) => [...s.logs].sort((x, y) => y.date.localeCompare(x.date)))[0];
    return last?.opponentTeamId ?? options[0]?.teamId ?? "";
  }, [opponentParam, options, nextOpponentName, seasonLogs]);
  const opponent = options.find((o) => o.teamId === opponentId);

  // 選んだ相手との試合（試合種別で絞る）。新しい試合が上
  const games = useMemo(() => {
    const out: (TeamGameLog & { season: string; venue?: string })[] = [];
    for (const { season, logs, venues } of seasonLogs ?? []) {
      for (const g of logs) {
        if (g.opponentTeamId !== opponentId) continue;
        if (g.gameType !== "regular" && g.gameType !== "playoff") continue;
        if (gameType !== "both" && g.gameType !== gameType) continue;
        out.push({ ...g, season, venue: venues.get(g.scheduleKey) });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.scheduleKey.localeCompare(a.scheduleKey));
  }, [seasonLogs, opponentId, gameType]);

  const total = useMemo(() => summarize(games), [games]);

  // シーズンごと（新しいシーズンが上）。「合算」のときは、レギュラーシーズンの行とポストシーズンの行を分ける
  const seasonRows = useMemo(() => {
    const rows: { key: string; label: string; opponentName: string; sum: ReturnType<typeof summarize> }[] = [];
    const bySeason = [...new Set(games.map((g) => g.season))].sort((a, b) => b.localeCompare(a));
    for (const season of bySeason) {
      for (const type of ["regular", "playoff"] as const) {
        const logs = games.filter((g) => g.season === season && g.gameType === type);
        if (logs.length === 0) continue;
        rows.push({
          key: `${season}:${type}`,
          label: type === "regular" ? season : `${season} ${postseasonLabel(season)}`,
          opponentName: logs[0]!.opponentTeamName,
          sum: summarize(logs),
        });
      }
    }
    return rows;
  }, [games]);

  const columns = useMemo<Column<AllTeamsRow>[]>(() => {
    // 1試合ごとは合計（modeを"total"）、平均の行は"perGame"。割合は合計から計算される（FG% ＝ FGMの合計 ÷ FGAの合計）
    const mode = "total" as const;
    return category === "traditional"
      ? buildTraditionalColumns(mode, perspective)
      : category === "advanced"
        ? buildAdvancedColumns(mode, perspective)
        : category === "misc"
          ? buildMiscColumns(mode, perspective)
          : buildScoringColumns(mode, perspective, true);
  }, [category, perspective]);
  const averageColumns = useMemo<Column<AllTeamsRow>[]>(() => {
    const mode = "perGame" as const;
    return category === "traditional"
      ? buildTraditionalColumns(mode, perspective)
      : category === "advanced"
        ? buildAdvancedColumns(mode, perspective)
        : category === "misc"
          ? buildMiscColumns(mode, perspective)
          : buildScoringColumns(mode, perspective, true);
  }, [category, perspective]);

  const rowOf = (logs: TeamGameLog[], name: string): AllTeamsRow => ({
    team: { teamId, teamName: name },
    gamesPlayed: logs.length,
    wins: logs.filter((g) => g.win).length,
    losses: logs.filter((g) => !g.win).length,
    totals: sumTeamGameLogs(logs),
  });
  const averageRow = useMemo(() => rowOf(games, ""), [games]); // eslint-disable-line react-hooks/exhaustive-deps

  const opponentAxis = simpleSelectAxis({
    id: "opponent",
    label: "対戦相手",
    options: options.map((o) => ({ value: o.teamId, label: o.played ? o.name : `${o.name}（対戦なし）` })),
    value: opponentId,
    defaultValue: opponentId,
    onChange: setOpponent,
  });
  const axes = [
    { ...opponentAxis, chip: false },
    gameTypeAxis(gameType, setGameType, null),
  ];

  const conditions = composeLabels(
    gameTypeLabels(gameType, null),
    perspectiveLabels(perspective),
    CATEGORY_LABELS[category],
  );

  if (loading || !seasonLogs) return <p className="loading">読み込み中...</p>;
  if (options.length === 0) return <p className="empty-message">対戦相手のデータがありません</p>;

  return (
    <div className="team-tab-panel">
      <FilterBar simple stateKey="team:headToHead" axes={axes} />

      {games.length === 0 ? (
        <p className="empty-message">
          {opponent ? `${opponent.name}との` : ""}該当する試合がありません
        </p>
      ) : (
        <>
          <ConditionTitle section title={`${opponent?.name ?? ""} との通算成績`} conditions={gameTypeLabels(gameType, null)} />
          <div className="stat-grid team-header-stat-grid">
            <StatTile label="通算" value={formatRecord(total.wins, total.losses)} rank={formatWinPct(safeDiv(total.wins, total.games))} />
            <StatTile label="ホーム" value={formatRecord(total.homeWins, total.homeLosses)} />
            <StatTile label="アウェイ" value={formatRecord(total.awayWins, total.awayLosses)} />
            <StatTile label="平均得点" value={formatDecimal(total.avgPts)} />
            <StatTile label="平均失点" value={formatDecimal(total.avgOpp)} />
            <StatTile label="平均得失点" value={formatSigned(total.avgDiff)} />
          </div>

          <ConditionTitle section title="シーズンごとの成績" conditions={gameTypeLabels(gameType, null)} />
          <div className="table-scroll">
            <table className="sortable-table">
              <thead>
                <tr>
                  <th className="align-left">シーズン</th>
                  <th className="align-left">相手</th>
                  <th className="align-right">勝敗</th>
                  <th className="align-right">ホーム</th>
                  <th className="align-right">アウェイ</th>
                  <th className="align-right" title={statDescription("平均得点")}>平均得点</th>
                  <th className="align-right" title={statDescription("平均失点")}>平均失点</th>
                  <th className="align-right" title={statDescription("平均得失点")}>平均得失点</th>
                </tr>
              </thead>
              <tbody>
                {seasonRows.map((r) => (
                  <tr key={r.key}>
                    <td className="align-left">{r.label}</td>
                    <td className="align-left">
                      <ResponsiveTeamName teamId={opponentId} name={r.opponentName} />
                    </td>
                    <td className="align-right">{formatRecord(r.sum.wins, r.sum.losses)}</td>
                    <td className="align-right">{formatRecord(r.sum.homeWins, r.sum.homeLosses)}</td>
                    <td className="align-right">{formatRecord(r.sum.awayWins, r.sum.awayLosses)}</td>
                    <td className="align-right">{formatDecimal(r.sum.avgPts)}</td>
                    <td className="align-right">{formatDecimal(r.sum.avgOpp)}</td>
                    <td className="align-right">{formatSigned(r.sum.avgDiff)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ConditionTitle section title="試合ごとのスタッツ" conditions={conditions} />
          {/* 視点は、この下の試合ごとの表と平均の行だけに効く（通算・シーズンごとの成績は常に自チーム基準） */}
          <FilterBar simple stateKey="team:headToHead:stats" axes={[perspectiveAxis(perspective, setPerspective)]} />
          <div className="tab-bar">
            {BOX_CATEGORY_TABS.map((t) => (
              <button
                key={t.key}
                className={`tab-button${category === t.key ? " active" : ""}`}
                onClick={() => setCategory(t.key)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="table-scroll">
            <table className="sortable-table schedule-table">
              <thead>
                <tr>
                  <th className="align-left">日付</th>
                  <th className="align-left">対戦相手</th>
                  <th className="align-left">会場</th>
                  <th className="align-right">結果</th>
                  {columns.map((col) => (
                    <th key={col.key} className="align-right" title={statDescription(col.label, "team")}>
                      <StatHeaderLabel label={col.label} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {games.map((g) => {
                  const row = rowOf([g], "");
                  return (
                    <tr key={g.scheduleKey} className="schedule-row status-final">
                      <td className="align-left">
                        <Link to={`/games/${g.scheduleKey}?season=${g.season}`} className="cell-link">
                          {g.date}
                        </Link>
                      </td>
                      <td className="align-left">
                        <Link to={`/games/${g.scheduleKey}?season=${g.season}`} className="cell-link">
                          {g.isHome ? "vs" : "@"} <ResponsiveTeamName teamId={opponentId} name={g.opponentTeamName} />
                          {g.gameType === "playoff" && <span className="playoff-badge">PO</span>}
                        </Link>
                      </td>
                      <td className="align-left">{g.venue ?? "-"}</td>
                      <td className="align-right">
                        <Link to={`/games/${g.scheduleKey}?season=${g.season}`} className="cell-link">
                          <span className={`result-badge ${g.win ? "win" : "loss"}`}>
                            {g.teamScore}-{g.opponentScore}
                          </span>
                        </Link>
                      </td>
                      {columns.map((col) => (
                        <td key={col.key} className="align-right">
                          {col.format ? col.format(row) : String(col.sortValue(row))}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                {/* 平均の行。割合の項目は、試合ごとの割合の平均ではなく合計から計算する（FG% ＝ FGMの合計 ÷ FGAの合計。DESIGN.md 185章） */}
                <tr className="schedule-row average-row">
                  <td className="align-left" colSpan={3}>
                    平均（{games.length}試合）
                  </td>
                  <td className="align-right">
                    <span className="result-badge">
                      {formatDecimal(total.avgPts)}-{formatDecimal(total.avgOpp)}
                    </span>
                  </td>
                  {averageColumns.map((col) => (
                    <td key={col.key} className="align-right">
                      {col.format ? col.format(averageRow) : String(col.sortValue(averageRow))}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
          <GlossaryNote
            anchor={GLOSSARY_ANCHORS.boxscoreColumns}
            label="対戦成績"
            scope="レギュラーシーズン・ポストシーズンの試合全体の記録です（試合種別は上部、視点は試合ごとのスタッツの表の上の切り替えと連動します）。"
          />
        </>
      )}
    </div>
  );
}
