import { useEffect, useMemo, useRef, useState } from "react";
import type { GameType, TeamStintsFile } from "../../shared/types";
import { seasonGameTypeLabels, SEASON_GAME_TYPE_KEYS, type SeasonGameTypeFilter } from "../../shared/gameType";
import { fetchTeamStints } from "../lib/data";
import { composeLabels, gameTypeLabels, periodLabels } from "../lib/conditionLabels";
import { formatDecimal, formatSigned } from "../lib/format";
import { lineupSearchRow, maxPeriodOf, playerSecondsOf, searchLineup, type LineupSearchRow } from "../lib/lineupSearch";
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
 * ラインナップ検索（チーム詳細）。選んだ選手（1〜5人）が全員コートにいた時間帯（Players On）と、全員ベンチにいた時間帯（Players Off）の成績を
 * 上下に並べ、差（On−Off）の行を付けて出す。出場区間ごとの数え上げ（team-stints）から計算する。DESIGN.md 207章
 */
export function LineupSearch({ season, teamId, playerNameById, games, stateKey, playerLabel, supported }: Props) {
  const narrow = useNarrow();
  const { data: stints, loading, error } = useJsonData<TeamStintsFile | null>(
    () => (supported ? fetchTeamStints(season, teamId) : Promise.resolve(null)),
    [season, teamId, supported],
  );
  const [selectedRaw, setSelected] = usePageState<string[]>(stateKey("lineupSearchSelected"), []);
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
  const result = useMemo(() => {
    if (!file || selected.length === 0) return null;
    const options = {
      includeGame: (key: string) => {
        const g = gameInfo.get(key);
        if (!g) return gameType === "both" && venue === "all";
        if (gameType !== "both" && g.gameType !== gameType) return false;
        if (venue === "home") return g.isHome;
        if (venue === "away") return !g.isHome;
        return true;
      },
      periods: periodOption.periods,
    };
    return { on: lineupSearchRow(searchLineup(file, selected, "on", options)), off: lineupSearchRow(searchLineup(file, selected, "off", options)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, selected.join(","), gameType, venue, periodOption, gameInfo]);

  const nameOf = (id: string) => playerNameById.get(id) ?? id;
  const toggle = (id: string) => {
    if (selected.includes(id)) setSelected(selected.filter((x) => x !== id));
    else if (selected.length < MAX_SELECTED) setSelected([...selected, id]);
  };

  const conditions = composeLabels(
    `${season}シーズン`,
    gameTypeLabels(gameType, season),
    periodLabels(periodOption),
    venue !== "all" && VENUE_LABELS[venue],
    selected.length > 0 && `選手：${selected.map((id) => playerLabel(nameOf(id))).join("・")}`,
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

          <PlayerDropdown
            candidates={candidates}
            selected={selected}
            labelOf={(id) => playerLabel(nameOf(id))}
            onToggle={toggle}
            onClear={() => setSelected([])}
          />

          {result === null ? (
            <p className="empty-message">選手を選ぶと、Players On（全員コートにいる時間）とPlayers Off（全員ベンチにいる時間）の成績を表示します</p>
          ) : (
            <ResultView on={result.on} off={result.off} narrow={narrow} />
          )}
          <p className="rule-change-footnote">
            ※ Players Onは選んだ選手が全員コートにいる時間、Players Offは全員ベンチにいる時間です（一部だけが出ている時間はどちらにも入れません）。
            Players Offは、選んだ選手のうち誰かが出場した試合だけが対象です。平均は、その状態が実際に起きた試合の数で割ります。差は Players On − Players Off です。
          </p>
          <GlossaryNote anchor={GLOSSARY_ANCHORS.lineupSearch} label="ラインナップ検索" />
        </>
      )}
    </>
  );
}

/** 選手を複数選ぶプルダウン。選んだ選手は、プルダウンの外にも並べて表示し、そこから外せる */
function PlayerDropdown({
  candidates,
  selected,
  labelOf,
  onToggle,
  onClear,
}: {
  candidates: string[];
  selected: string[];
  labelOf: (id: string) => string;
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="lineup-search-select">
      <div className="lineup-search-dropdown" ref={rootRef}>
        <button type="button" className="lineup-search-dropdown-button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          選手を選ぶ（{selected.length}／{MAX_SELECTED}人）<span aria-hidden="true">▾</span>
        </button>
        {open && (
          <div className="lineup-search-dropdown-panel" role="listbox" aria-multiselectable="true">
            {candidates.map((id) => {
              const checked = selected.includes(id);
              const disabled = !checked && selected.length >= MAX_SELECTED;
              return (
                <label key={id} className={`lineup-search-option${checked ? " checked" : ""}${disabled ? " disabled" : ""}`}>
                  <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onToggle(id)} />
                  <span>{labelOf(id)}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <div className="lineup-search-chips">
        {selected.length === 0 ? (
          <span className="lineup-search-hint">選手を1〜{MAX_SELECTED}人選んでください</span>
        ) : (
          <>
            {selected.map((id) => (
              <span key={id} className="lineup-search-chip">
                {labelOf(id)}
                <button type="button" aria-label={`${labelOf(id)}を外す`} onClick={() => onToggle(id)}>
                  ×
                </button>
              </span>
            ))}
            <button type="button" className="lineup-search-clear" onClick={onClear}>
              すべて外す
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type Kind = "int" | "signedInt" | "minutes" | "dec" | "signed";
interface Metric {
  label: string;
  desc: string;
  kind: Kind;
  value: (r: LineupSearchRow) => number | null;
}

const METRICS: Metric[] = [
  { label: "試合数", desc: "試合数", kind: "int", value: (r) => r.games },
  { label: "出場時間", desc: "出場時間", kind: "minutes", value: (r) => r.totalMinutes },
  { label: "得点", desc: "得点", kind: "int", value: (r) => r.ownPoints },
  { label: "失点", desc: "失点", kind: "int", value: (r) => r.oppPoints },
  { label: "得失点", desc: "得失点", kind: "signedInt", value: (r) => r.netPoints },
  { label: "平均出場時間", desc: "平均出場時間", kind: "minutes", value: (r) => r.avgMinutes },
  { label: "平均得点", desc: "平均得点", kind: "dec", value: (r) => r.avgOwnPoints },
  { label: "平均失点", desc: "平均失点", kind: "dec", value: (r) => r.avgOppPoints },
  { label: "平均得失点", desc: "平均得失点", kind: "signed", value: (r) => r.avgNetPoints },
  { label: "ORtg", desc: "ラインナップORtg", kind: "dec", value: (r) => r.off },
  { label: "DRtg", desc: "ラインナップDRtg", kind: "dec", value: (r) => r.def },
  { label: "NetRtg", desc: "ラインナップNetRtg", kind: "signed", value: (r) => r.net },
];

function format(kind: Kind, v: number | null, diff: boolean): string {
  if (v === null) return "-";
  if (diff) {
    if (kind === "int" || kind === "signedInt") return formatSigned(v, 0);
    return kind === "minutes" ? `${formatSigned(v)}分` : formatSigned(v);
  }
  switch (kind) {
    case "int":
      return String(v);
    case "signedInt":
      return formatSigned(v, 0);
    case "minutes":
      return `${formatDecimal(v)}分`;
    case "dec":
      return formatDecimal(v);
    case "signed":
      return formatSigned(v);
  }
}

function ResultView({ on, off, narrow }: { on: LineupSearchRow; off: LineupSearchRow; narrow: boolean }) {
  // On・Offのどちらかが起きていない（試合数0）ときは、その行を「-」にし、差も出さない
  const cell = (row: LineupSearchRow, m: Metric) => (row.games === 0 ? "-" : format(m.kind, m.value(row), false));
  const diffCell = (m: Metric) => {
    if (on.games === 0 || off.games === 0) return "-";
    const a = m.value(on);
    const b = m.value(off);
    return a === null || b === null ? "-" : format(m.kind, a - b, true);
  };
  const emptyNote =
    on.games === 0 && off.games === 0 ? (
      <p className="empty-message">この条件に当てはまる時間帯がありません</p>
    ) : on.games === 0 ? (
      <p className="lineup-search-hint">Players Onに当てはまる時間帯がありません（選んだ選手が全員そろってコートにいた時間が、この条件ではありません）</p>
    ) : off.games === 0 ? (
      <p className="lineup-search-hint">Players Offに当てはまる時間帯がありません</p>
    ) : null;

  if (narrow) {
    return (
      <>
        <table className="lineup-search-compare">
          <thead>
            <tr>
              <th className="align-left">項目</th>
              <th className="align-right">On</th>
              <th className="align-right">Off</th>
              <th className="align-right">差</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => (
              <tr key={m.label}>
                <th className="align-left" scope="row" title={statDescription(m.desc)}>
                  {m.label}
                </th>
                <td className="align-right">{cell(on, m)}</td>
                <td className="align-right">{cell(off, m)}</td>
                <td className="align-right lineup-search-diff">{diffCell(m)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {emptyNote}
      </>
    );
  }
  return (
    <>
      <div className="table-scroll">
        <table className="sortable-table lineup-search-table">
          <thead>
            <tr>
              <th className="align-left" />
              {METRICS.map((m) => (
                <th key={m.label} className="align-right" title={statDescription(m.desc)}>
                  {m.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="align-left" scope="row">Players On</th>
              {METRICS.map((m) => (
                <td key={m.label} className="align-right">{cell(on, m)}</td>
              ))}
            </tr>
            <tr>
              <th className="align-left" scope="row">Players Off</th>
              {METRICS.map((m) => (
                <td key={m.label} className="align-right">{cell(off, m)}</td>
              ))}
            </tr>
            <tr className="lineup-search-diff-row">
              <th className="align-left" scope="row">差（On−Off）</th>
              {METRICS.map((m) => (
                <td key={m.label} className="align-right">{diffCell(m)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {emptyNote}
    </>
  );
}
