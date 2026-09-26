import { Link as RouterLink } from "react-router-dom";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { PLAYER_GAME_RECORD_STATS, type PlayerGameRecordDef } from "../../shared/playerGameRecords";
import { PLAYER_PCT_MIN_ATTEMPTS_NOTE } from "../lib/topRecords";
import type { PlayerGameRecordEntry } from "../../shared/types";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchPlayerGameRecords, fetchSeasons } from "../lib/data";
import { gameTypeAxis, simpleSelectAxis } from "../lib/filterAxes";
import { formatPct, formatSigned } from "../lib/format";
import { usePageState } from "../lib/pageStateCache";
import { useJsonData } from "../lib/useJsonData";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/**
 * 選手一覧「記録」タブの範囲「シーズン」: 選んだシーズン・試合区分の中の、選手の1試合の記録（DESIGN.md 159章）。
 * 値は日次の集計が書き出した上位（data/{season}/player-game-records.json）で、画面は全選手の試合ログを読まない。
 * 見た目はチーム全体「記録」のシーズンと同じカード
 */

/** 同じ記録が20件を超えたら、それより後ろは「ほか◯試合」にまとめる */
const COLLAPSED_ROWS = 20;

function formatValue(def: PlayerGameRecordDef, v: number): string {
  switch (def.kind) {
    case "minutes":
      return formatMinutesFromSeconds(Math.round(v * 60));
    case "pct":
      return formatPct(v);
    case "ratio":
      return v.toFixed(1);
    case "signed":
      return formatSigned(v, 0);
    default:
      return Number.isInteger(v) ? String(v) : v.toFixed(0);
  }
}

function EntryLine({ e, season }: { e: PlayerGameRecordEntry; season: string }) {
  return (
    <>
      {/* 記録した選手は太字にして、対戦相手と区別する */}
      <RouterLink to={`/players/${e.playerId}?season=${season}`} className="career-high-game-link record-team">
        <ResponsivePlayerName name={e.playerName} />
      </RouterLink>{" "}
      <RouterLink to={`/games/${e.scheduleKey}?season=${season}`} className="career-high-game-link">
        {e.date}
        {"　"}
        <ResponsiveTeamName teamId={e.teamId} name={e.teamName} always /> {e.isHome ? "vs" : "@"}{" "}
        <ResponsiveTeamName teamId={e.opponentTeamId} name={e.opponentTeamName} always />
      </RouterLink>
    </>
  );
}

function PlayerRecordCard({
  def,
  entries,
  season,
  open,
  onToggle,
  showAll,
  onToggleShowAll,
}: {
  def: PlayerGameRecordDef;
  entries: PlayerGameRecordEntry[];
  season: string;
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
    <div className={`career-high-card${open ? " league-record-card-open" : ""}`}>
      <button type="button" className="career-high-label career-high-label-clickable" onClick={onToggle} aria-expanded={open}>
        {def.label}
        {open ? " ▲" : " ▼"}
      </button>
      <div className="career-high-value">{formatValue(def, first.value)}</div>
      <EntryLine e={first} season={season} />
      {ties > 1 && (
        <button type="button" className="career-high-others-toggle" onClick={onToggle}>
          {open ? "閉じる" : `ほか${ties - 1}試合`}
        </button>
      )}
      {open && (
        <>
          <table className="career-top-n-table player-record-top-table">
            <tbody>
              {visible.map((e) => (
                <tr key={`${e.scheduleKey}-${e.playerId}`}>
                  <td>{e.rank}</td>
                  <td>{formatValue(def, e.value)}</td>
                  <td>
                    <EntryLine e={e} season={season} />
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

export function PlayerSeasonRecords({ defaultSeason }: { defaultSeason: string }) {
  const [season, setSeason] = usePageState<string>("players:records:season:season", defaultSeason);
  const [gameType, setGameType] = usePageState<SeasonGameTypeFilter>("players:records:season:gameType", "regular");
  const [openKeys, setOpenKeys] = usePageState<Set<string>>("players:records:season:open", () => new Set());
  const [showAllKeys, setShowAllKeys] = usePageState<Set<string>>("players:records:season:showAll", () => new Set());
  const toggle = (setter: typeof setOpenKeys, key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: file, loading } = useJsonData(() => fetchPlayerGameRecords(season), [season]);
  const table = file?.byGameType[gameType] ?? {};
  const records = PLAYER_GAME_RECORD_STATS.flatMap((def) => {
    const entries = table[def.key];
    return entries && entries.length > 0 ? [{ def, entries }] : [];
  });
  const names = records.flatMap((r) => r.entries.map((e) => e.playerName));

  const seasonOptions = [...(seasons ?? [])]
    .map((s) => s.season)
    .sort((a, b) => b.localeCompare(a))
    .map((s) => ({ value: s, label: `${s}シーズン` }));

  return (
    <div>
      <FilterBar
        simple
        stateKey="players:records:season"
        axes={[
          simpleSelectAxis({
            id: "playerRecordsSeason",
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
      <ConditionTitle title={`${season}シーズンの記録`} conditions={composeLabels(gameTypeLabels(gameType, season))} />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : records.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <PlayerNamePool names={names}>
          <h3 className="career-highs-subheading">1試合の記録</h3>
          <div className="career-highs-grid">
            {records.map(({ def, entries }) => (
              <PlayerRecordCard
                key={def.key}
                def={def}
                entries={entries}
                season={season}
                open={openKeys.has(def.key)}
                onToggle={() => toggle(setOpenKeys, def.key)}
                showAll={showAllKeys.has(def.key)}
                onToggleShowAll={() => toggle(setShowAllKeys, def.key)}
              />
            ))}
          </div>
          <p className="page-subtitle">
            そのシーズンの全選手の出場した試合の中での1試合の記録です。項目名を押すと上位10位（同じ記録はすべて）を表示します。
            項目は個人詳細のキャリアハイと同じですが、少ない方が良い項目（TOV・F・UFOUL・TF）は出していません。
            {PLAYER_PCT_MIN_ATTEMPTS_NOTE}
            毎日1回、前日までの試合を取り込んだあとに作り直します。
          </p>
        </PlayerNamePool>
      )}
    </div>
  );
}
