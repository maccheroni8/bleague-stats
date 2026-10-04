import { useMemo } from "react";
import type { GameType, TeamStintsFile } from "../../shared/types";
import { seasonGameTypeLabels, SEASON_GAME_TYPE_KEYS, type SeasonGameTypeFilter } from "../../shared/gameType";
import { fetchTeamStints } from "../lib/data";
import { composeLabels, gameTypeLabels, periodLabels } from "../lib/conditionLabels";
import { formatDecimal, formatSigned } from "../lib/format";
import { lineupSearchRow, maxPeriodOf, playerSecondsOf, searchLineup, type LineupSearchMode } from "../lib/lineupSearch";
import { buildPeriodRangeOptions, type PeriodRangeValue } from "../lib/periodRange";
import { usePageState } from "../lib/pageStateCache";
import { statDescription } from "../lib/statDescriptions";
import { useNarrow } from "../lib/teamLabel";
import { useJsonData } from "../lib/useJsonData";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { ConditionTitle } from "./ConditionTitle";
import { GlossaryNote } from "./GlossaryNote";
import { PeriodRangeToggle } from "./PeriodRangeToggle";

/** 選べる選手の人数の上限 */
const MAX_SELECTED = 5;

type Venue = "all" | "home" | "away";
const VENUE_LABELS: Record<Venue, string> = { all: "すべて", home: "ホーム", away: "アウェイ" };
const VENUE_KEYS: Venue[] = ["all", "home", "away"];
const MODE_LABELS: Record<LineupSearchMode, string> = { on: "Players On", off: "Players Off" };

interface Props {
  season: string;
  teamId: string;
  /** 選手IDから名前（このシーズンの選手一覧） */
  playerNameById: Map<string, string>;
  /** このチームの試合ログ（試合区分・ホーム/アウェイの絞り込みに使う） */
  games: { scheduleKey: string; gameType: GameType; isHome: boolean }[];
  /** 状態を保存するキー（ページ内のほかの状態と同じ形） */
  stateKey: (field: string) => string;
  /** スマホ幅では名字だけにする選手名 */
  playerLabel: (name: string) => string;
  /** このシーズンが実際のポゼッションの数え上げに対応しているか（2020-21以降） */
  supported: boolean;
}

/**
 * ラインナップ検索（チーム詳細）。選んだ選手（1〜5人）が全員コートにいた時間帯（Players On）、または全員ベンチにいた時間帯（Players Off）の成績を、
 * 出場区間ごとの数え上げ（team-stints）から計算する。DESIGN.md 207章
 */
export function LineupSearch({ season, teamId, playerNameById, games, stateKey, playerLabel, supported }: Props) {
  const narrow = useNarrow();
  const { data: stints, loading, error } = useJsonData<TeamStintsFile | null>(
    () => (supported ? fetchTeamStints(season, teamId) : Promise.resolve(null)),
    [season, teamId, supported],
  );
  const [selectedRaw, setSelected] = usePageState<string[]>(stateKey("lineupSearchSelected"), []);
  const [mode, setMode] = usePageState<LineupSearchMode>(stateKey("lineupSearchMode"), "on");
  const [gameType, setGameType] = usePageState<SeasonGameTypeFilter>(stateKey("lineupSearchGameType"), "regular");
  const [periodValue, setPeriodValue] = usePageState<PeriodRangeValue>(stateKey("lineupSearchPeriod"), "all");
  const [venue, setVenue] = usePageState<Venue>(stateKey("lineupSearchVenue"), "all");

  const fileValid = !!stints && stints.season === season && stints.teamId === teamId;
  const file = fileValid ? stints : null;

  // 選べる選手: このシーズンにこのチームで出場した選手。出場時間の多い順
  const candidates = useMemo(() => {
    if (!file) return [];
    const seconds = playerSecondsOf(file);
    return [...seconds.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [file]);
  const selected = selectedRaw.filter((id) => candidates.includes(id));

  const periodOptions = useMemo(() => (file ? buildPeriodRangeOptions(maxPeriodOf(file)) : buildPeriodRangeOptions(4)), [file]);
  const periodOption = periodOptions.find((o) => o.value === periodValue) ?? periodOptions[0]!;

  const gameInfo = useMemo(() => new Map(games.map((g) => [g.scheduleKey, g])), [games]);
  const row = useMemo(() => {
    if (!file || selected.length === 0) return null;
    const result = searchLineup(file, selected, mode, {
      includeGame: (key) => {
        const g = gameInfo.get(key);
        if (!g) return gameType === "both" && venue === "all";
        if (gameType !== "both" && g.gameType !== gameType) return false;
        if (venue === "home") return g.isHome;
        if (venue === "away") return !g.isHome;
        return true;
      },
      periods: periodOption.periods,
    });
    return lineupSearchRow(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, selected.join(","), mode, gameType, venue, periodOption, gameInfo]);

  const nameOf = (id: string) => playerNameById.get(id) ?? id;
  const toggle = (id: string) => {
    if (selected.includes(id)) setSelected(selected.filter((x) => x !== id));
    else if (selected.length < MAX_SELECTED) setSelected([...selected, id]);
  };
  // スマホ幅では、選んだ選手を上に固定する
  const ordered = narrow ? [...selected, ...candidates.filter((id) => !selected.includes(id))] : candidates;

  const conditions = composeLabels(
    `${season}シーズン`,
    gameTypeLabels(gameType, season),
    periodLabels(periodOption),
    venue !== "all" && VENUE_LABELS[venue],
    selected.length > 0 && `${MODE_LABELS[mode]}：${selected.map((id) => playerLabel(nameOf(id))).join("・")}`,
  );

  return (
    <>
      <ConditionTitle section title="ラインナップ検索" conditions={conditions} />
      {!supported ? (
        <p className="empty-message">このシーズンは実際のポゼッションを数えていないため、ラインナップ検索は使えません（2020-21以降のシーズンで使えます）</p>
      ) : loading && !file ? (
        <p className="loading">読み込み中...</p>
      ) : error || !file ? (
        <p className="empty-message">ラインナップ検索のデータがありません</p>
      ) : (
        <>
          <div className="lineup-search-controls">
            <div className="mode-toggle" role="group" aria-label="Players On / Players Off">
              {(["on", "off"] as LineupSearchMode[]).map((m) => (
                <button key={m} type="button" className={m === mode ? "active" : ""} onClick={() => setMode(m)}>
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            <div className="mode-toggle" role="group" aria-label="試合区分">
              {SEASON_GAME_TYPE_KEYS.map((k) => (
                <button key={k} type="button" className={k === gameType ? "active" : ""} onClick={() => setGameType(k)}>
                  {seasonGameTypeLabels(season)[k]}
                </button>
              ))}
            </div>
            <div className="lineup-search-scroll">
              <PeriodRangeToggle options={periodOptions} value={periodOption.value} onChange={setPeriodValue} />
            </div>
            <div className="mode-toggle" role="group" aria-label="ホーム／アウェイ">
              {VENUE_KEYS.map((v) => (
                <button key={v} type="button" className={v === venue ? "active" : ""} onClick={() => setVenue(v)}>
                  {VENUE_LABELS[v]}
                </button>
              ))}
            </div>
          </div>

          <p className="lineup-search-hint">
            選手を1〜{MAX_SELECTED}人選んでください（選択中 {selected.length}人）
            {selected.length > 0 && (
              <button type="button" className="lineup-search-clear" onClick={() => setSelected([])}>
                選択をクリア
              </button>
            )}
          </p>
          <div className="lineup-search-players">
            {ordered.map((id) => {
              const checked = selected.includes(id);
              const disabled = !checked && selected.length >= MAX_SELECTED;
              return (
                <label key={id} className={`lineup-search-player${checked ? " checked" : ""}${disabled ? " disabled" : ""}`}>
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => toggle(id)} />
                  <span>{playerLabel(nameOf(id))}</span>
                </label>
              );
            })}
          </div>

          {row === null ? (
            <p className="empty-message">選手を選ぶと、{MODE_LABELS[mode]}の成績を表示します</p>
          ) : row.games === 0 ? (
            <p className="empty-message">この条件に当てはまる時間帯がありません</p>
          ) : (
            <ResultView row={row} narrow={narrow} />
          )}
          <p className="rule-change-footnote">
            ※ Players Onは選んだ選手が全員コートにいる時間、Players Offは全員ベンチにいる時間です（一部だけが出ている時間はどちらにも入れません）。
            Players Offは、選んだ選手のうち誰かが出場した試合だけが対象です。平均は、その状態が実際に起きた試合の数で割ります。
          </p>
          <GlossaryNote anchor={GLOSSARY_ANCHORS.lineupSearch} label="ラインナップ検索" />
        </>
      )}
    </>
  );
}

type Row = ReturnType<typeof lineupSearchRow>;

const dec = (v: number | null) => (v === null ? "-" : formatDecimal(v));
const sgn = (v: number | null, digits = 1) => (v === null ? "-" : formatSigned(v, digits));

function items(row: Row): { label: string; desc: string; value: string }[] {
  return [
    { label: "試合数", desc: "試合数", value: String(row.games) },
    { label: "出場時間", desc: "出場時間", value: `${formatDecimal(row.totalMinutes)}分` },
    { label: "得点", desc: "得点", value: String(row.ownPoints) },
    { label: "失点", desc: "失点", value: String(row.oppPoints) },
    { label: "得失点", desc: "得失点", value: sgn(row.netPoints, 0) },
    { label: "平均出場時間", desc: "平均出場時間", value: row.avgMinutes === null ? "-" : `${formatDecimal(row.avgMinutes)}分` },
    { label: "平均得点", desc: "平均得点", value: dec(row.avgOwnPoints) },
    { label: "平均失点", desc: "平均失点", value: dec(row.avgOppPoints) },
    { label: "平均得失点", desc: "平均得失点", value: sgn(row.avgNetPoints) },
    { label: "ORtg", desc: "ラインナップORtg", value: dec(row.off) },
    { label: "DRtg", desc: "ラインナップDRtg", value: dec(row.def) },
    { label: "NetRtg", desc: "ラインナップNetRtg", value: sgn(row.net) },
  ];
}

function ResultView({ row, narrow }: { row: Row; narrow: boolean }) {
  const list = items(row);
  if (narrow) {
    return (
      <dl className="lineup-search-cards">
        {list.map((it) => (
          <div key={it.label} title={statDescription(it.desc)}>
            <dt>{it.label}</dt>
            <dd>{it.value}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <div className="table-scroll">
      <table className="sortable-table">
        <thead>
          <tr>
            {list.map((it) => (
              <th key={it.label} className="align-right" title={statDescription(it.desc)}>
                {it.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {list.map((it) => (
              <td key={it.label} className="align-right">
                {it.value}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
