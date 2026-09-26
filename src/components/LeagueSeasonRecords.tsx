import { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { filterByGameType, type SeasonGameTypeFilter } from "../../shared/gameType";
import { teamShortName } from "../../shared/teamNames";
import { TEAM_RECORD_STATS, type TeamRecordValueDef } from "../../shared/teamRecords";
import type { TeamGameLog } from "../../shared/types";
import { formatPct } from "../lib/format";
import { gameTypeAxis, simpleSelectAxis } from "../lib/filterAxes";
import { fetchSeasons, fetchTeams } from "../lib/data";
import { usePageState } from "../lib/pageStateCache";
import { useAllTeamGameLogs } from "../lib/teamRankingData";
import { computeTopRecordEntries, type TopRecordEntry } from "../lib/topRecords";
import { useJsonData } from "../lib/useJsonData";
import { composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { ClubPeriodRecords } from "./TeamPeriodRecords";

/**
 * チーム全体「記録」タブの範囲「シーズン」: 選んだシーズン・試合区分の中の、全クラブの1試合の記録。
 * チーム詳細「クラブレコード」と同じ項目（shared/teamRecords.ts）とクォーター別レコードを、クラブ単位ではなくリーグ全体の試合から出す。
 * 値は各クラブの試合ログ（team-games）からその場で求めるため、取り込みで試合ログが更新されれば、進行中のシーズンもそのまま新しい記録になる
 */

/** 試合ログに、記録したチームとシーズンを足したもの。1試合につき両チームの2件がある */
export type LeagueRecordGame = TeamGameLog & { season: string; teamId: string; teamName: string };

type RecordMode = "record" | "worst";

const PCT_KEYS = new Set(["fgPct", "twoPct", "tpPct", "ftPct"]);

/** 同じ記録が20件を超えたら、それより後ろは「ほか◯試合」にまとめる */
const COLLAPSED_ROWS = 20;

function formatValue(key: string, v: number): string {
  return PCT_KEYS.has(key) ? formatPct(v) : v.toLocaleString();
}

/** ワーストの向き。少ない方が良い項目（失点・ターンオーバー・ファウル）のワーストは最大、それ以外は最小 */
function lowerFirst(def: TeamRecordValueDef, mode: RecordMode): boolean {
  const lowerIsBetter = def.lowerIsBetter ?? false;
  return mode === "record" ? lowerIsBetter : !lowerIsBetter;
}

/** 記録/ワーストで出す項目。ワーストは、成功率（試投の少ない試合で極端な値になる）と逆転（負け/勝ちの試合にしかない）を除く */
export function leagueRecordDefs(mode: RecordMode): TeamRecordValueDef[] {
  return mode === "record" ? TEAM_RECORD_STATS : TEAM_RECORD_STATS.filter((d) => d.worstEligible !== false);
}

function GameLine({ g }: { g: LeagueRecordGame }) {
  return (
    <RouterLink to={`/games/${g.scheduleKey}?season=${g.season}`} className="career-high-game-link">
      {g.date}　<ResponsiveTeamName teamId={g.teamId} name={g.teamName} always /> {g.isHome ? "vs" : "@"}{" "}
      <ResponsiveTeamName teamId={g.opponentTeamId} name={g.opponentTeamName} always />
    </RouterLink>
  );
}

function LeagueRecordCard({
  def,
  entries,
  open,
  onToggle,
  showAll,
  onToggleShowAll,
}: {
  def: TeamRecordValueDef;
  entries: TopRecordEntry<LeagueRecordGame>[];
  open: boolean;
  onToggle: () => void;
  showAll: boolean;
  onToggleShowAll: () => void;
}) {
  const first = entries[0]!;
  const ties = entries.filter((e) => e.rank === 1).length;
  const visible = showAll ? entries : entries.slice(0, COLLAPSED_ROWS);
  const hidden = entries.length - visible.length;
  return (
    // 開いたカードは行いっぱいに広げる（上位の試合にチーム名と相手が並び、狭いカードでは折り返しが多くなるため）
    <div className={`career-high-card${open ? " league-record-card-open" : ""}`}>
      <button type="button" className="career-high-label career-high-label-clickable" onClick={onToggle} aria-expanded={open}>
        {def.label}
        {open ? " ▲" : " ▼"}
      </button>
      <div className="career-high-value">{formatValue(def.key, first.value)}</div>
      <GameLine g={first.game} />
      {ties > 1 && (
        <button type="button" className="career-high-others-toggle" onClick={onToggle}>
          {open ? "閉じる" : `ほか${ties - 1}試合`}
        </button>
      )}
      {open && (
        <>
          <table className="career-top-n-table">
            <tbody>
              {visible.map((e) => (
                <tr key={`${e.game.scheduleKey}-${e.game.teamId}`}>
                  <td>{e.rank}</td>
                  <td>{formatValue(def.key, e.value)}</td>
                  <td>
                    <GameLine g={e.game} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length > COLLAPSED_ROWS && (
            <button type="button" className="career-high-others-toggle" onClick={onToggleShowAll}>
              {showAll ? `上位${COLLAPSED_ROWS}件のみ表示` : `ほか${hidden}試合（すべて表示）`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function LeagueSeasonRecords({ defaultSeason }: { defaultSeason: string }) {
  const [season, setSeason] = usePageState<string>("teams:records:season:season", defaultSeason);
  const [gameType, setGameType] = usePageState<SeasonGameTypeFilter>("teams:records:season:gameType", "regular");
  const [mode, setMode] = usePageState<RecordMode>("teams:records:season:mode", "record");
  // 開いているカード（上位10件）と、20件を超えた分を開いているカード
  const [openKeys, setOpenKeys] = usePageState<Set<string>>("teams:records:season:open", () => new Set());
  const [showAllKeys, setShowAllKeys] = usePageState<Set<string>>("teams:records:season:showAll", () => new Set());
  const toggle = (setter: typeof setOpenKeys, key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: teams, loading: teamsLoading } = useJsonData(() => fetchTeams(season), [season]);
  const { gameLogsByTeam, loading: logsLoading } = useAllTeamGameLogs(season, teams);

  const games = useMemo<LeagueRecordGame[]>(() => {
    if (!teams || !gameLogsByTeam) return [];
    const all = teams.flatMap((t) =>
      (gameLogsByTeam.get(t.teamId) ?? []).map((g) => ({ ...g, season, teamId: t.teamId, teamName: t.teamName })),
    );
    return filterByGameType(all, gameType);
  }, [teams, gameLogsByTeam, season, gameType]);

  const records = useMemo(
    () =>
      leagueRecordDefs(mode)
        .map((def) => {
          const pool = def.filter ? games.filter(def.filter) : games;
          return { def, entries: computeTopRecordEntries(pool, def.value, lowerFirst(def, mode)) };
        })
        .filter((r) => r.entries.length > 0),
    [games, mode],
  );

  const seasonOptions = [...(seasons ?? [])]
    .map((s) => s.season)
    .sort((a, b) => b.localeCompare(a))
    .map((s) => ({ value: s, label: `${s}シーズン` }));
  const loading = teamsLoading || logsLoading;

  return (
    <div>
      <FilterBar
        simple
        stateKey="teams:records:season"
        axes={[
          simpleSelectAxis({
            id: "recordsSeason",
            label: "シーズン",
            options: seasonOptions.length > 0 ? seasonOptions : [{ value: season, label: `${season}シーズン` }],
            value: season,
            defaultValue: defaultSeason,
            onChange: (v) => {
              setSeason(v);
              setOpenKeys(new Set());
              setShowAllKeys(new Set());
            },
          }),
          gameTypeAxis(gameType, setGameType, season),
        ]}
      />
      <div className="mode-toggle period-range-toggle">
        {(["record", "worst"] as const).map((m) => (
          <button
            key={m}
            type="button"
            className={mode === m ? "active" : ""}
            onClick={() => {
              setMode(m);
              setOpenKeys(new Set());
              setShowAllKeys(new Set());
            }}
          >
            {m === "record" ? "記録" : "ワースト"}
          </button>
        ))}
      </div>
      <ConditionTitle
        title={`${season}シーズンの${mode === "record" ? "記録" : "ワースト"}`}
        conditions={composeLabels(gameTypeLabels(gameType, season))}
      />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : games.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <>
          <h3 className="career-highs-subheading">1試合の{mode === "record" ? "記録" : "ワースト"}</h3>
          <div className="career-highs-grid">
            {records.map(({ def, entries }) => (
              <LeagueRecordCard
                key={def.key}
                def={def}
                entries={entries}
                open={openKeys.has(def.key)}
                onToggle={() => toggle(setOpenKeys, def.key)}
                showAll={showAllKeys.has(def.key)}
                onToggleShowAll={() => toggle(setShowAllKeys, def.key)}
              />
            ))}
          </div>
          <p className="page-subtitle">
            そのシーズンの全クラブの試合の中での1試合の記録です。項目名を押すと上位10位（同じ記録はすべて）を表示します。
            {mode === "worst" && "成功率と逆転の項目は、ワーストの対象外です。"}
            PITP/FBPS/2ND PTS/PTSOFFTOはプレーバイプレーのタグから数えた得点、ホーム来場者数はホーム開催の試合だけが対象です。
          </p>

          <h3 className="career-highs-subheading">クォーター別レコード</h3>
          <ClubPeriodRecords
            games={games}
            stateKey="teams:records:season:period"
            mode={mode}
            teamLabel={(g) => teamShortName(g.teamId, g.teamName)}
          />
          <p className="page-subtitle">
            1Q〜4Q・前半（1Q＋2Q）・後半（3Q＋4Q）の1試合の記録です。延長戦の得点は含めません。
            ※は公式のクォーター別スコアが欠けている試合で、プレーバイプレーの得点から出した値です。
          </p>
          <p className="page-subtitle">試合結果を取り込むたびに、そのシーズンの記録も新しくなります。</p>
        </>
      )}
    </div>
  );
}
