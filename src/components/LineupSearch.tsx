import { useEffect, useMemo, useRef, useState } from "react";
import type { GameType, TeamStintsFile } from "../../shared/types";
import { seasonGameTypeLabels, SEASON_GAME_TYPE_KEYS, type SeasonGameTypeFilter } from "../../shared/gameType";
import { composeLabels, displayModeLabels, gameTypeLabels, periodLabels, perspectiveLabels } from "../lib/conditionLabels";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { formatDecimal, formatSigned } from "../lib/format";
import { formatMinutesColon, formatSignedMinutesColon } from "../lib/minutesFormat";
import {
  lineupSearchRow,
  masksOfCount,
  playerSecondsOf,
  searchLineupSplit,
  splitTotalsToResult,
  type LineupSearchRow,
  type LineupSplitResult,
  type LineupSplitTotals,
} from "../lib/lineupSearch";
import {
  formatLineupStat,
  lineupStatColumns,
  lineupStatValue,
  type LineupStatsMode,
  type LineupStatsTab,
} from "../lib/lineupSearchStats";
import { TEAM_PERSPECTIVE_LABELS, type TeamPerspective } from "../lib/teamStatsColumns";
import type { PeriodRangeValue } from "../lib/periodRange";
import { SEASON_PERIOD_OPTIONS_NO_CLUTCH } from "../lib/seasonPeriod";
import { usePageState } from "../lib/pageStateCache";
import { statDescription } from "../lib/statDescriptions";
import { useNarrow } from "../lib/teamLabel";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { ConditionTitle } from "./ConditionTitle";
import { GlossaryNote } from "./GlossaryNote";
import { PeriodRangeToggle } from "./PeriodRangeToggle";

/** 選べる選手の人数の上限 */
const MAX_SELECTED = 5;

type Venue = "all" | "home" | "away";
const VENUE_LABELS: Record<Venue, string> = { all: "すべて", home: "ホーム", away: "アウェイ" };
const VENUE_KEYS: Venue[] = ["all", "home", "away"];

/** 表のタブ。得失点（今までの12項目）・Traditional・Advanced */
type ResultTab = "rating" | LineupStatsTab;
const RESULT_TABS: { key: ResultTab; label: string }[] = [
  { key: "rating", label: "得失点・レーティング" },
  { key: "traditional", label: CATEGORY_LABELS.traditional },
  { key: "advanced", label: CATEGORY_LABELS.advanced },
];
const MODE_LABELS: Record<LineupStatsMode, string> = { perGame: "平均", total: "合計" };
const MODE_KEYS: LineupStatsMode[] = ["perGame", "total"];
const PERSPECTIVE_KEYS: TeamPerspective[] = ["own", "opp", "diff"];

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
  /** このシーズンが実際のポゼッションの数え上げに対応しているか（プレーバイプレーのあるシーズン。372章で 2016-17 から） */
  supported: boolean;
  /** このチームの出場区間ごとの数え上げ（親が読む。「よく使われるラインナップ」と共有する） */
  stints: TeamStintsFile | null;
  stintsLoading: boolean;
  stintsError: boolean;
}

/**
 * ラインナップ検索（チーム詳細）。選んだ選手（1〜5人）が全員コートにいた時間帯（Players On）と、全員ベンチにいた時間帯（Players Off）の成績を
 * 上下に並べ、差（On−Off）の行を付けて出す。出場区間ごとの数え上げ（team-stints）から計算する。DESIGN.md 207章
 */
export function LineupSearch({ season, teamId, playerNameById, games, stateKey, playerLabel, supported, stints, stintsLoading: loading, stintsError: error }: Props) {
  const narrow = useNarrow();
  const [selectedRaw, setSelected] = usePageState<string[]>(stateKey("lineupSearchSelected"), []);
  const [gameType, setGameType] = usePageState<SeasonGameTypeFilter>(stateKey("lineupSearchGameType"), "regular");
  const [periodValue, setPeriodValue] = usePageState<PeriodRangeValue>(stateKey("lineupSearchPeriod"), "all");
  const [venue, setVenue] = usePageState<Venue>(stateKey("lineupSearchVenue"), "all");
  const [resultTabRaw, setResultTab] = usePageState<ResultTab>(stateKey("lineupSearchTab"), "rating");
  const [statsMode, setStatsMode] = usePageState<LineupStatsMode>(stateKey("lineupSearchMode"), "perGame");
  const [perspective, setPerspective] = usePageState<TeamPerspective>(stateKey("lineupSearchPerspective"), "own");
  const resultTab: ResultTab = RESULT_TABS.some((t) => t.key === resultTabRaw) ? resultTabRaw : "rating";

  const fileValid = !!stints && stints.season === season && stints.teamId === teamId;
  const file = fileValid ? stints : null;

  // 選べる選手: このシーズンにこのチームで出場した選手。出場時間の多い順
  const candidates = useMemo(() => {
    if (!file) return [];
    const seconds = playerSecondsOf(file);
    return [...seconds.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  }, [file]);
  const selected = selectedRaw.filter((id) => candidates.includes(id));

  // 区間は1Q〜4Q・前半・後半・延長（すべての延長の合計。第1延長・第2延長は分けない。DESIGN.md 273章）
  // 出場区間（team-stints）はピリオドで絞るので、クラッチは選べない（設計書375章）
  const periodOptions = SEASON_PERIOD_OPTIONS_NO_CLUTCH;
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
    return searchLineupSplit(file, selected, options);
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
    resultTab !== "rating" && displayModeLabels(statsMode),
    resultTab !== "rating" && perspectiveLabels(perspective),
    selected.length > 0 && `選手：${selected.map((id) => playerLabel(nameOf(id))).join("・")}`,
  );

  return (
    <>
      <ConditionTitle section title="ラインナップ検索" conditions={conditions} />
      {!supported ? (
        <p className="empty-message">このシーズンは実際のポゼッションを数えていないため、ラインナップ検索は使えません</p>
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

          <div className="tab-bar-with-toggle compare-category-bar">
            <div className="tab-bar">
              {RESULT_TABS.map((t) => (
                <button key={t.key} type="button" className={`tab-button${resultTab === t.key ? " active" : ""}`} onClick={() => setResultTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {resultTab !== "rating" && (
            <div className="lineup-search-controls">
              <div className="mode-toggle" role="group" aria-label="平均／合計">
                {MODE_KEYS.map((k) => (
                  <button key={k} type="button" className={k === statsMode ? "active" : ""} onClick={() => setStatsMode(k)}>
                    {MODE_LABELS[k]}
                  </button>
                ))}
              </div>
              <div className="mode-toggle" role="group" aria-label="視点">
                {PERSPECTIVE_KEYS.map((k) => (
                  <button key={k} type="button" className={k === perspective ? "active" : ""} onClick={() => setPerspective(k)}>
                    {TEAM_PERSPECTIVE_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {result === null ? (
            <p className="empty-message">選手を選ぶと、選んだ選手のうち何人がコートにいたかごとの成績を表示します</p>
          ) : (
            <ResultView
              key={selected.join(",")}
              split={result}
              selected={selected}
              labelOf={(id) => playerLabel(nameOf(id))}
              narrow={narrow}
              tab={resultTab}
              mode={statsMode}
              perspective={perspective}
            />
          )}
          {selected.length <= 1 ? (
            <p className="rule-change-footnote">
              ※ Players Onは選んだ選手がコートにいる時間、Players Offはベンチにいる時間です。
              Players Offは、選んだ選手が出場した試合だけが対象です。平均は、その状態が実際に起きた試合の数で割ります。差は Players On − Players Off です。
            </p>
          ) : (
            <p className="rule-change-footnote">
              ※ 選んだ選手のうち何人がコートにいたかで時間を分けています（人数の行を押すと、出ていた選手の組み合わせごとの行が開きます）。
              選んだ選手のうち誰かが出場した試合だけが対象です。平均は、その状態が実際に起きた試合の数で割ります。差は 全員出場 − 全員ベンチ です。
            </p>
          )}
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
    return kind === "minutes" ? formatSignedMinutesColon(v) : formatSigned(v);
  }
  switch (kind) {
    case "int":
      return String(v);
    case "signedInt":
      return formatSigned(v, 0);
    case "minutes":
      return formatMinutesColon(v);
    case "dec":
      return formatDecimal(v);
    case "signed":
      return formatSigned(v);
  }
}

/** 表の1行（人数ごとの行、または開いた組み合わせの行） */
interface RowSpec {
  key: string;
  label: string;
  totals: LineupSplitTotals;
  /** 組み合わせの行（字下げ） */
  child: boolean;
  /** 押すと組み合わせが開く人数の行 */
  expandable: boolean;
  count: number;
}

function emptyLike(split: LineupSplitResult): LineupSplitTotals {
  const n = split.byCount[0]?.countKeys.length ?? 0;
  return { games: 0, seconds: 0, own: new Array<number>(n).fill(0), opp: new Array<number>(n).fill(0), countKeys: split.byCount[0]?.countKeys ?? [] };
}

/** 人数の行の名前。1人だけ選んだときは今までどおり Players On／Players Off */
function countLabel(size: number, count: number): string {
  if (size === 1) return count === 1 ? "Players On" : "Players Off";
  if (count === size) return `${count}人出場`;
  if (count === 0) return "0人出場（全員ベンチ）";
  return `${count}人出場（${size - count}人ベンチ）`;
}

function buildRows(split: LineupSplitResult, selected: string[], labelOf: (id: string) => string, expanded: Set<number>): RowSpec[] {
  const size = split.size;
  const rows: RowSpec[] = [];
  for (let c = size; c >= 0; c -= 1) {
    const expandable = size >= 2 && c > 0 && c < size;
    rows.push({ key: `c${c}`, label: countLabel(size, c), totals: split.byCount[c]!, child: false, expandable, count: c });
    if (expandable && expanded.has(c)) {
      for (const mask of masksOfCount(size, c)) {
        const names = selected.filter((_, i) => mask & (1 << i)).map(labelOf);
        rows.push({ key: `m${mask}`, label: names.join("・"), totals: split.byMask.get(mask) ?? emptyLike(split), child: true, expandable: false, count: c });
      }
    }
  }
  return rows;
}

function ResultView({
  split,
  selected,
  labelOf,
  narrow,
  tab,
  mode,
  perspective,
}: {
  split: LineupSplitResult;
  selected: string[];
  labelOf: (id: string) => string;
  narrow: boolean;
  tab: ResultTab;
  mode: LineupStatsMode;
  perspective: TeamPerspective;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  if (split.size === 0) return <p className="empty-message">この条件に当てはまる時間帯がありません</p>;
  const size = split.size;
  const full = split.byCount[size]!;
  const zero = split.byCount[0]!;
  const toggle = (c: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  const rows = buildRows(split, selected, labelOf, expanded);
  const allEmpty = split.byCount.every((t) => t.games === 0);
  const fullName = size === 1 ? "Players On" : "全員出場";
  const zeroName = size === 1 ? "Players Off" : "全員ベンチ";
  const emptyNote = allEmpty ? (
    <p className="empty-message">この条件に当てはまる時間帯がありません</p>
  ) : full.games === 0 ? (
    <p className="lineup-search-hint">
      {fullName}に当てはまる時間帯がありません（選んだ選手が全員そろってコートにいた時間が、この条件ではありません）
    </p>
  ) : zero.games === 0 ? (
    <p className="lineup-search-hint">{zeroName}に当てはまる時間帯がありません</p>
  ) : null;
  const diffLabel = size === 1 ? "差（On−Off）" : "差（全員出場−全員ベンチ）";

  // 得失点・レーティングのタブは今までの12項目
  if (tab === "rating") {
    const on = lineupSearchRow(splitTotalsToResult(full));
    const off = lineupSearchRow(splitTotalsToResult(zero));
    // その状態が起きていない（試合数0）行は「-」にし、差も出さない
    const cell = (row: LineupSearchRow, m: Metric) => (row.games === 0 ? "-" : format(m.kind, m.value(row), false));
    const diffCell = (m: Metric) => {
      if (on.games === 0 || off.games === 0) return "-";
      const a = m.value(on);
      const b = m.value(off);
      return a === null || b === null ? "-" : format(m.kind, a - b, true);
    };
    if (narrow && size === 1) {
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
              {rows.map((r) => {
                const row = lineupSearchRow(splitTotalsToResult(r.totals));
                return (
                  <tr key={r.key} className={r.child ? "lineup-search-child-row" : undefined}>
                    <RowHeader row={r} expanded={expanded.has(r.count)} onToggle={toggle} />
                    {METRICS.map((m) => (
                      <td key={m.label} className="align-right">
                        {cell(row, m)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="lineup-search-diff-row">
                <th className="align-left" scope="row">
                  {diffLabel}
                </th>
                {METRICS.map((m) => (
                  <td key={m.label} className="align-right">
                    {diffCell(m)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        {emptyNote}
      </>
    );
  }

  // Traditional・Advanced（全チームスタッツと同じ名前・並び・書き方。出場区間で数えられない項目は出さない）
  const cols = lineupStatColumns(tab);
  const statCell = (t: LineupSplitTotals, ci: number) => (t.games === 0 ? "-" : formatLineupStat(cols[ci]!, lineupStatValue(cols[ci]!, t, mode, perspective), mode, perspective));
  const statDiff = (ci: number) => {
    if (full.games === 0 || zero.games === 0) return "-";
    const a = lineupStatValue(cols[ci]!, full, mode, perspective);
    const b = lineupStatValue(cols[ci]!, zero, mode, perspective);
    return a === null || b === null ? "-" : formatLineupStat(cols[ci]!, a - b, mode, perspective, true);
  };
  return (
    <>
      <div className="table-scroll">
        <table className="sortable-table lineup-search-table">
          <thead>
            <tr>
              <th className="align-left" />
              {cols.map((c) => (
                <th key={c.key} className="align-right" title={statDescription(c.label)}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.child ? "lineup-search-child-row" : undefined}>
                <RowHeader row={r} expanded={expanded.has(r.count)} onToggle={toggle} />
                {cols.map((c, ci) => (
                  <td key={c.key} className="align-right">
                    {statCell(r.totals, ci)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="lineup-search-diff-row">
              <th className="align-left" scope="row">
                {diffLabel}
              </th>
              {cols.map((c, ci) => (
                <td key={c.key} className="align-right">
                  {statDiff(ci)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {emptyNote}
    </>
  );
}

function RowHeader({ row, expanded, onToggle }: { row: RowSpec; expanded: boolean; onToggle: (count: number) => void }) {
  if (row.expandable) {
    return (
      <th className="align-left" scope="row">
        <button type="button" className="lineup-search-expand" aria-expanded={expanded} onClick={() => onToggle(row.count)}>
          <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> {row.label}
        </button>
      </th>
    );
  }
  return (
    <th className={`align-left${row.child ? " lineup-search-child" : ""}`} scope="row">
      {row.label}
    </th>
  );
}
