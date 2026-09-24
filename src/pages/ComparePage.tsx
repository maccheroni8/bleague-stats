import { useMemo, useRef, type ReactNode } from "react";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { useMediaQuery } from "../lib/useMediaQuery";
import { surnameOf } from "../lib/playerSurname";
import { Link, useSearchParams } from "react-router-dom";
import { fetchDivisionHistory, fetchPlayers, fetchSeasons, fetchTeamColors, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import type { PlayerSummary, SeasonEntry, TeamColors, TeamSummary } from "../../shared/types";
import { ExportImageButton } from "../components/ExportImageButton";
import { ExternalLinkIcon } from "../components/ExternalLinkIcon";
import { ConditionTitle } from "../components/ConditionTitle";
import { RuleChangeFootnote } from "../components/RuleChangeFootnote";
import { CompareSlotFilter } from "../components/CompareSlotFilter";
import { FilterBar } from "../components/FilterBar";
import { perspectiveAxis } from "../lib/filterAxes";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "../components/BoxscoreTable";
import {
  buildExportFilename,
  composeLabels,
  displayModeLabels,
  gameTypeLabels,
  joinLabels,
  perspectiveLabels,
  situationalFilterLabels,
} from "../lib/conditionLabels";
import {
  seasonBoxCompareDefs,
  teamCompareDefs,
  type CompareColumnData,
  type TeamCompareColumnData,
} from "../lib/compareShared";
import { SEASON_GAME_TYPE_KEYS, type SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import type { SituationalFilter } from "../lib/situational";
import { TEAM_PERSPECTIVE_LABELS, type TeamPerspective } from "../lib/teamStatsColumns";
import {
  usePlayerCompareSlot,
  useTeamCompareSlot,
  type PlayerSlotData,
  type SlotStatus,
  type TeamSlotData,
} from "../lib/useCompareSlotData";
import type { DivisionHistoryFile } from "../../shared/types";
import { useSeasonKeyedData } from "../lib/useSeasonKeyedData";
import { filterPlayersByGamesPlayedRatio } from "../lib/statDefs";

type Mode = "team" | "player";
// スロットは3つ固定（各ビューのフック呼び出しも3つ固定）
const SLOT_INDEXES = [0, 1, 2] as const;

const DEFAULT_FILTER: SituationalFilter = { range: { kind: "all" } };

interface SlotValue {
  id: string;
  season: string;
  filter: SituationalFilter;
  /** レギュラー/プレーオフ/合算。詳細ページの比較タブは全スロット共通だが、このページでは
   * 「スロット1はレギュラー、スロット2はプレーオフ」のような比較ができるようスロットごとに持つ */
  gameType: SeasonGameTypeFilter;
}

export interface ComparisonRow<T> {
  item: T;
  season: string;
}

/**
 * ComparisonTableのdefsが実際に使うフィールドだけを持つ最小限の型。StatDef<T>は
 * 用語集用の付随情報（formulaText/source/category等）を必須で持つため、そのまま比較表の
 * defs型にすると呼び出し側（例: 個人詳細ページの「比較」タブ、シチュエーション別フィルタの
 * 結果を比較する用途でPlayerSummary以外の型を渡す）が本来不要なダミー値を埋める羽目になる。
 * StatDef<T>はこの型より情報が多いだけなので、そのまま代入できる（構造的部分型）
 */
export interface ComparisonStatDef<T> {
  key: string;
  label: string;
  value: (row: T) => number;
  format: (row: T) => string;
  higherIsBetter?: boolean;
}

// --- URLパラメータ ---
// スロットは "id@season"（?t0=703@2018-19 等。paramが無ければ「そのスロットは未上書き＝ページの
// デフォルトシーズン＋デフォルトIDを使う」）、そのスロットのシチュエーション別フィルタは
// JSON（?tf0=...、無指定＝シーズン全体）、そのスロットの
// レギュラー・プレーオフ・合算は tg0/pg0（無指定＝レギュラー）、共通の軸は cat（カテゴリタブ）/
// v（自チーム・opp・+/-、チーム版のみ）で持つ。共有・リロードで再現できる
function parseSlotParam(raw: string | null): { id: string; season: string } | null {
  if (raw === null) return null;
  const at = raw.indexOf("@");
  if (at === -1) return { id: "", season: "" };
  return { id: raw.slice(0, at), season: raw.slice(at + 1) };
}

function encodeSlotParam(id: string, season: string): string {
  return `${id}@${season}`;
}

/** 壊れた/手書きのJSONでもページを落とさない。rangeが不正なら「シーズン全体」に戻す */
function parseFilterParam(raw: string | null): SituationalFilter {
  if (!raw) return DEFAULT_FILTER;
  try {
    const parsed = JSON.parse(raw) as SituationalFilter;
    const kind = parsed?.range?.kind;
    if (kind !== "all" && kind !== "recent" && kind !== "dateRange") return DEFAULT_FILTER;
    const { includePlayoffs: _ignored, ...rest } = parsed;
    void _ignored;
    // 月が単月（month: n）だった時代に共有されたURLの互換: 複数選択（months）に読み替える
    const legacyMonth = (rest as { month?: unknown }).month;
    if (typeof legacyMonth === "number" && !rest.months?.length) {
      const { month: _legacy, ...others } = rest as SituationalFilter & { month?: number };
      void _legacy;
      return { ...others, months: [legacyMonth] };
    }
    return rest;
  } catch {
    return DEFAULT_FILTER;
  }
}

function encodeFilterParam(filter: SituationalFilter): string | null {
  const { includePlayoffs: _ignored, ...rest } = filter;
  void _ignored;
  const json = JSON.stringify(rest);
  return json === JSON.stringify(DEFAULT_FILTER) ? null : json;
}

function parseEnumParam<T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

const CATEGORY_KEYS = BOXSCORE_TABS.map((t) => t.key);
const GAME_TYPE_KEYS = SEASON_GAME_TYPE_KEYS;
const PERSPECTIVE_KEYS = Object.keys(TEAM_PERSPECTIVE_LABELS) as TeamPerspective[];

/** スロットのフィルタは参照が変わるたびに集計をやり直す（60試合分の再計算）ため、URL上の文字列が
 * 同じ間は同じオブジェクトを返す */
function useParsedSlot(rawSlot: string | null, rawFilter: string | null, rawGameType: string | null) {
  return useMemo(
    () => ({
      base: parseSlotParam(rawSlot),
      filter: parseFilterParam(rawFilter),
      gameType: parseEnumParam(rawGameType, GAME_TYPE_KEYS, "regular"),
    }),
    [rawSlot, rawFilter, rawGameType],
  );
}

/**
 * 初期表示（URLでスロットが未指定のとき）の既定の比較対象。配列の先頭2件のような無意味な並びではなく、
 * チームは「そのシーズンの勝率上位2チーム」、選手は「所属チーム試合数の85%以上に出場した選手のうち
 * 1試合平均得点の上位2名」（ランキングページの掲載基準と同じ出場率の足切り）にする。
 * どちらもページ読み込み時に既に取得済みのteams.json/players.jsonだけで算出でき、追加の通信は無い
 */
const winRate = (t: TeamSummary) => (t.wins + t.losses > 0 ? t.wins / (t.wins + t.losses) : 0);

function defaultTeamIds(teams: TeamSummary[] | null | undefined): string[] {
  return [...(teams ?? [])]
    .sort(
      (a, b) =>
        winRate(b) - winRate(a) || b.wins - a.wins || b.netPerGame.pts - a.netPerGame.pts || a.teamId.localeCompare(b.teamId),
    )
    .map((t) => t.teamId);
}

function defaultPlayerIds(players: PlayerSummary[] | null | undefined, teams: TeamSummary[] | null | undefined): string[] {
  if (!players || !teams) return [];
  return filterPlayersByGamesPlayedRatio(players, teams)
    .sort((a, b) => b.perGame.pts - a.perGame.pts || a.playerId.localeCompare(b.playerId))
    .map((p) => p.playerId);
}

interface ComparisonTableProps<T> {
  rows: ComparisonRow<T>[];
  defs: ComparisonStatDef<T>[];
  rowKey: (row: T) => string;
  name: (row: T) => ReactNode;
  linkTo: (row: T) => string;
  /** 指定時、名前の直後にBリーグ公式サイトへの外部リンクアイコンを表示する（選手比較のみ） */
  externalLinkTo?: (row: T) => string | undefined;
  teamColor?: (row: T) => string | undefined;
  /** 指定時、シーズンタグの下に補足（そのスロットのシチュエーション・試合数等）を表示する */
  subLabel?: (row: T) => string | undefined;
  emptyMessage?: string;
}

export function ComparisonTable<T>({
  rows,
  defs,
  rowKey,
  name,
  linkTo,
  externalLinkTo,
  teamColor,
  subLabel,
  emptyMessage = "比較する項目を選んでください",
}: ComparisonTableProps<T>) {
  if (rows.length === 0) {
    return <p className="empty-message">{emptyMessage}</p>;
  }
  return (
    <div className="table-scroll">
      <table className="sortable-table compare-table">
        <thead>
          <tr>
            <th className="align-left">項目</th>
            {rows.map(({ item, season }) => {
              const accent = teamColor?.(item);
              const sub = subLabel?.(item);
              return (
                <th
                  key={rowKey(item)}
                  className={`align-right${externalLinkTo?.(item) ? " has-external-link" : ""}`}
                  style={accent ? { borderTopColor: accent } : undefined}
                >
                  <Link to={`${linkTo(item)}?season=${season}`} className="cell-link">
                    {name(item)}
                  </Link>
                  {externalLinkTo?.(item) && (
                    <ExternalLinkIcon href={externalLinkTo(item)!} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
                  )}
                  <span className="compare-season-tag">{season}</span>
                  {sub && <span className="compare-season-tag compare-condition-tag">{sub}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {defs.map((def) => {
            const values = rows.map(({ item }) => def.value(item));
            const best = def.higherIsBetter === false ? Math.min(...values) : Math.max(...values);
            return (
              <tr key={def.key}>
                <td className="align-left">{def.label}</td>
                {rows.map(({ item }, i) => (
                  <td
                    key={rowKey(item)}
                    className={`align-right${rows.length > 1 && values[i] === best ? " compare-best" : ""}`}
                  >
                    {def.format(item)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- スロット1つ分のUI（チーム版・個人版で共通） ---

interface EntityOption {
  value: string;
  label: string;
}

interface SlotCardProps {
  slot: SlotValue;
  /** 「詳細フィルタ」の開閉状態のキー（スロットごとに一意） */
  stateKey: string;
  /** 対象selectのラベル（チーム/選手） */
  entityLabel: string;
  seasonOptions: SeasonEntry[];
  entityOptions: EntityOption[];
  entityLoaded: boolean;
  /** 選択中のエンティティがそのシーズンに実在するか（falseなら何も取得されない） */
  entityValid: boolean;
  data: Pick<TeamSlotData, "status" | "error" | "boundary" | "opponentWinRateSupported" | "ownTeamDivisionSupported" | "gamesCount" | "pendingGames">;
  onSeason: (season: string) => void;
  onEntity: (id: string) => void;
  onFilter: (filter: SituationalFilter) => void;
  onGameType: (gameType: SeasonGameTypeFilter) => void;
}

const STATUS_TEXT: Partial<Record<SlotStatus, (d: SlotCardProps["data"]) => string>> = {
  loading: () => "データ取得中...",
  fetching: (d) => `試合データ取得中（残り${d.pendingGames}/${d.gamesCount}試合）`,
  empty: () => "この条件に合う試合がありません",
  ready: (d) => `${d.gamesCount}試合で集計`,
};

function CompareSlotCard({
  slot,
  stateKey,
  entityLabel,
  seasonOptions,
  entityOptions,
  entityLoaded,
  entityValid,
  data,
  onSeason,
  onEntity,
  onFilter,
  onGameType,
}: SlotCardProps) {
  const statusText = data.status === "error" ? (data.error ?? "取得に失敗しました") : STATUS_TEXT[data.status]?.(data);
  return (
    <div className="player-compare-slot">
      <CompareSlotFilter
        stateKey={stateKey}
        selects={[
          {
            id: "season",
            label: "シーズン",
            value: slot.season,
            options: seasonOptions.map((s) => ({ value: s.season, label: `${s.season}シーズン` })),
            onChange: onSeason,
          },
          {
            id: "entity",
            label: entityLabel,
            value: entityValid ? slot.id : "",
            options: [{ value: "", label: "未選択" }, ...entityOptions],
            onChange: onEntity,
          },
        ]}
        enabled={entityValid}
        disabledNote="選択すると、このスロットのデータだけを取得します"
        filter={slot.filter}
        onFilter={onFilter}
        gameType={{ value: slot.gameType, onChange: onGameType, season: slot.season || null }}
        boundary={data.boundary}
        opponentWinRateSupported={data.opponentWinRateSupported}
        ownTeamDivisionSupported={data.ownTeamDivisionSupported}
      />
      {entityLoaded && entityOptions.length === 0 && <p className="compare-slot-note">このシーズンのデータがありません</p>}
      {entityValid && statusText && <p className={`compare-slot-status status-${data.status}`}>{statusText}</p>}
    </div>
  );
}

/** 比較表の列見出し・タイトルに出す、そのスロットの条件ラベル（シーズン以外の絞り込み部分） */
function slotConditionLabel(slot: SlotValue, data: Pick<TeamSlotData, "boundary">): string {
  return joinLabels(composeLabels(gameTypeLabels(slot.gameType, slot.season || null), situationalFilterLabels(slot.filter, { boundary: data.boundary })));
}

function categoryLabel(cat: BoxscoreTabKey): string {
  return BOXSCORE_TABS.find((t) => t.key === cat)?.label ?? cat;
}

interface ViewCommonProps {
  slots: SlotValue[];
  seasonOptions: SeasonEntry[];
  seasons: SeasonEntry[] | null;
  teamColors: Record<string, TeamColors> | null;
  divisionHistory: DivisionHistoryFile | null;
  cat: BoxscoreTabKey;
  onUpdateSlot: (index: number, next: Partial<SlotValue>) => void;
}

// --- チーム比較 ---

type TeamPageRow = TeamCompareColumnData & { teamId: string; season: string; subLabel: string };

function TeamCompareView({
  slots,
  seasonOptions,
  seasons,
  teamColors,
  divisionHistory,
  cat,
  perspective,
  teamsBySeason,
  onUpdateSlot,
}: ViewCommonProps & { perspective: TeamPerspective; teamsBySeason: Map<string, TeamSummary[] | null> | null }) {
  const exportRef = useRef<HTMLDivElement>(null);

  const lists = slots.map((s) => teamsBySeason?.get(s.season) ?? null);
  const valid = slots.map((s, i) => !!s.id && !!lists[i]?.some((t) => t.teamId === s.id));
  // スロットごとに独立して（そのスロットが選択されて初めて）取得する。3つのフックは固定数の呼び出し
  const slotData: TeamSlotData[] = [
    useTeamCompareSlot({ teamId: slots[0]!.id, season: slots[0]!.season, filter: slots[0]!.filter, gameType: slots[0]!.gameType, active: valid[0]!, divisionHistory, seasons }),
    useTeamCompareSlot({ teamId: slots[1]!.id, season: slots[1]!.season, filter: slots[1]!.filter, gameType: slots[1]!.gameType, active: valid[1]!, divisionHistory, seasons }),
    useTeamCompareSlot({ teamId: slots[2]!.id, season: slots[2]!.season, filter: slots[2]!.filter, gameType: slots[2]!.gameType, active: valid[2]!, divisionHistory, seasons }),
  ];

  const rows: ComparisonRow<TeamPageRow>[] = [];
  const descriptions: string[] = [];
  slots.forEach((slot, i) => {
    const data = slotData[i]!;
    const team = lists[i]?.find((t) => t.teamId === slot.id);
    if (!team || data.status !== "ready" || !data.boxTotals) return;
    const cond = slotConditionLabel(slot, data);
    rows.push({
      item: {
        key: `slot${i}`,
        label: team.teamName,
        teamId: team.teamId,
        season: slot.season,
        boxTotals: data.boxTotals,
        subLabel: `${cond}（${data.gamesCount}試合）`,
      },
      season: slot.season,
    });
    descriptions.push(`${team.teamName}（${slot.season}・${cond}）`);
  });

  const conditions = composeLabels(
    categoryLabel(cat),
    perspectiveLabels(perspective),
    displayModeLabels("perGame"),
    "試合全体",
  );
  const title = rows.length > 0 ? `チーム比較：${descriptions.join(" vs ")}` : "チーム比較";
  const filename = buildExportFilename(["比較", "チーム", ...descriptions, ...conditions]);
  const anyBusy = slotData.some((d) => d.status === "loading" || d.status === "fetching");
  const defs = useMemo(() => teamCompareDefs(cat, perspective), [cat, perspective]);

  return (
    <>
      <div className="player-compare-slots">
        {SLOT_INDEXES.map((i) => (
          <CompareSlotCard
            key={i}
            slot={slots[i]!}
            stateKey={`compare:team:slot${i}`}
            entityLabel="チーム"
            seasonOptions={seasonOptions}
            entityOptions={(lists[i] ?? []).map((t) => ({ value: t.teamId, label: t.teamName }))}
            entityLoaded={lists[i] !== null && lists[i] !== undefined}
            entityValid={valid[i]!}
            data={slotData[i]!}
            onSeason={(season) => onUpdateSlot(i, { season, filter: DEFAULT_FILTER })}
            onGameType={(gameType) => onUpdateSlot(i, { gameType })}
            onEntity={(id) => onUpdateSlot(i, { id })}
            onFilter={(filter) => onUpdateSlot(i, { filter })}
          />
        ))}
      </div>
      <ExportImageButton targetRef={exportRef} filename={filename} />
      <div ref={exportRef} className="export-target">
        {rows.length > 0 && <ConditionTitle title={title} conditions={conditions} />}
        <ComparisonTable
          rows={rows}
          defs={defs}
          rowKey={(r) => r.key}
          name={(r) => <ResponsiveTeamName teamId={r.teamId} name={r.label} />}
          linkTo={(r) => `/teams/${r.teamId}`}
          teamColor={(r) => teamColors?.[r.teamId]?.primary}
          subLabel={(r) => r.subLabel}
          emptyMessage={anyBusy ? "データ取得中..." : "比較するチームを選んでください"}
        />
      </div>
      {cat === "misc" && <RuleChangeFootnote seasons={rows.map((r) => r.season)} />}
      <p className="page-subtitle">
        各列は詳細ページの「日程結果」「比較」タブと同じボックススコア列定義を、スロットごとの条件で絞り込んだ試合の1試合あたり平均値として算出しています
      </p>
    </>
  );
}

// --- 個人比較 ---

type PlayerPageRow = CompareColumnData & { playerId: string; teamId: string | null; season: string; subLabel: string };

function PlayerCompareView({
  slots,
  seasonOptions,
  teamColors,
  divisionHistory,
  cat,
  playersBySeason,
  onUpdateSlot,
}: ViewCommonProps & { playersBySeason: Map<string, PlayerSummary[] | null> | null }) {
  const exportRef = useRef<HTMLDivElement>(null);

  const lists = slots.map((s) => playersBySeason?.get(s.season) ?? null);
  const valid = slots.map((s, i) => !!s.id && !!lists[i]?.some((p) => p.playerId === s.id));
  const slotData: PlayerSlotData[] = [
    usePlayerCompareSlot({ playerId: slots[0]!.id, season: slots[0]!.season, filter: slots[0]!.filter, gameType: slots[0]!.gameType, active: valid[0]!, divisionHistory }),
    usePlayerCompareSlot({ playerId: slots[1]!.id, season: slots[1]!.season, filter: slots[1]!.filter, gameType: slots[1]!.gameType, active: valid[1]!, divisionHistory }),
    usePlayerCompareSlot({ playerId: slots[2]!.id, season: slots[2]!.season, filter: slots[2]!.filter, gameType: slots[2]!.gameType, active: valid[2]!, divisionHistory }),
  ];

  const rows: ComparisonRow<PlayerPageRow>[] = [];
  const descriptions: string[] = [];
  slots.forEach((slot, i) => {
    const data = slotData[i]!;
    const player = lists[i]?.find((p) => p.playerId === slot.id);
    if (!player || data.status !== "ready" || !data.ctx) return;
    const cond = slotConditionLabel(slot, data);
    rows.push({
      item: {
        key: `slot${i}`,
        label: player.name,
        playerId: player.playerId,
        teamId: data.latestTeamId ?? player.teamId,
        season: slot.season,
        ctx: data.ctx,
        subLabel: `${cond}（${data.gamesCount}試合）`,
      },
      season: slot.season,
    });
    descriptions.push(`${player.name}（${slot.season}・${cond}）`);
  });

  const conditions = composeLabels(categoryLabel(cat), displayModeLabels("perGame"), "試合全体");
  const title = rows.length > 0 ? `個人比較：${descriptions.join(" vs ")}` : "個人比較";
  const filename = buildExportFilename(["比較", "個人", ...descriptions, ...conditions]);
  const anyBusy = slotData.some((d) => d.status === "loading");
  const defs = useMemo(() => seasonBoxCompareDefs(cat), [cat]);

  return (
    <>
      <div className="player-compare-slots">
        {SLOT_INDEXES.map((i) => (
          <CompareSlotCard
            key={i}
            slot={slots[i]!}
            stateKey={`compare:player:slot${i}`}
            entityLabel="選手"
            seasonOptions={seasonOptions}
            entityOptions={(lists[i] ?? []).map((p) => ({ value: p.playerId, label: `${p.name}（${p.teamName}）` }))}
            entityLoaded={lists[i] !== null && lists[i] !== undefined}
            entityValid={valid[i]!}
            data={slotData[i]!}
            onSeason={(season) => onUpdateSlot(i, { season, filter: DEFAULT_FILTER })}
            onGameType={(gameType) => onUpdateSlot(i, { gameType })}
            onEntity={(id) => onUpdateSlot(i, { id })}
            onFilter={(filter) => onUpdateSlot(i, { filter })}
          />
        ))}
      </div>
      <ExportImageButton targetRef={exportRef} filename={filename} />
      <div ref={exportRef} className="export-target">
        {rows.length > 0 && <ConditionTitle title={title} conditions={conditions} />}
        <ComparisonTable
          rows={rows}
          defs={defs}
          rowKey={(r) => r.key}
          name={(r) => <ResponsivePlayerName name={r.label} />}
          linkTo={(r) => `/players/${r.playerId}`}
          teamColor={(r) => (r.teamId ? teamColors?.[r.teamId]?.primary : undefined)}
          subLabel={(r) => r.subLabel}
          emptyMessage={anyBusy ? "データ取得中..." : "比較する選手を選んでください"}
        />
      </div>
      {cat === "misc" && <RuleChangeFootnote seasons={rows.map((r) => r.season)} />}
      <p className="page-subtitle">
        各列は個人詳細ページの「シーズン別成績」「比較」タブと同じ列定義を、スロットごとの条件で絞り込んだ試合の1試合あたり平均値として算出しています。
        シーズン内に移籍した選手は所属チームを合算して集計します
      </p>
    </>
  );
}

export function ComparePage({ season }: { season: string }) {
  const [searchParams, setSearchParams] = useSearchParams();

  const mode: Mode = searchParams.get("cmp") === "player" ? "player" : "team";
  const cat = parseEnumParam(searchParams.get("cat"), CATEGORY_KEYS, "traditional");
  const perspective = parseEnumParam(searchParams.get("v"), PERSPECTIVE_KEYS, "own");

  const { data: seasons, loading: seasonsLoading } = useJsonData(() => fetchSeasons(), []);
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);

  const t0 = useParsedSlot(searchParams.get("t0"), searchParams.get("tf0"), searchParams.get("tg0"));
  const t1 = useParsedSlot(searchParams.get("t1"), searchParams.get("tf1"), searchParams.get("tg1"));
  const t2 = useParsedSlot(searchParams.get("t2"), searchParams.get("tf2"), searchParams.get("tg2"));
  const p0 = useParsedSlot(searchParams.get("p0"), searchParams.get("pf0"), searchParams.get("pg0"));
  const p1 = useParsedSlot(searchParams.get("p1"), searchParams.get("pf1"), searchParams.get("pg1"));
  const p2 = useParsedSlot(searchParams.get("p2"), searchParams.get("pf2"), searchParams.get("pg2"));
  const rawTeamSlots = [t0, t1, t2];
  const rawPlayerSlots = [p0, p1, p2];
  const teamSeasons = rawTeamSlots.map((s) => s.base?.season || season);
  const playerSeasons = rawPlayerSlots.map((s) => s.base?.season || season);

  const { dataBySeason: teamsBySeason } = useSeasonKeyedData(teamSeasons, fetchTeams);
  const { dataBySeason: playersBySeason } = useSeasonKeyedData(playerSeasons, fetchPlayers);
  // 個人のデフォルト（出場率の足切り）に所属チームの試合数が要る。個人モードのときだけ取得する
  const { dataBySeason: teamsForPlayerDefaults } = useSeasonKeyedData(mode === "player" ? playerSeasons : [], fetchTeams);

  // 未上書き（paramが無い）スロットは、ページのシーズンの勝率上位/得点上位（defaultTeamIds/defaultPlayerIds）を
  // 先頭2スロットのデフォルトにする。3つ目は空のまま（選んだスロットの分だけ取得するため）
  const resolveSlots = (raw: typeof rawTeamSlots, defaultIdsBySeason: (slotSeason: string) => string[]): SlotValue[] =>
    raw.map((r, i) => {
      const slotSeason = r.base?.season || season;
      if (r.base !== null) return { id: r.base.id, season: slotSeason, filter: r.filter, gameType: r.gameType };
      return { id: (i < 2 ? defaultIdsBySeason(slotSeason)[i] : undefined) ?? "", season: slotSeason, filter: r.filter, gameType: r.gameType };
    });
  const resolvedTeamSlots = resolveSlots(rawTeamSlots, (s) => defaultTeamIds(teamsBySeason?.get(s)));
  const resolvedPlayerSlots = resolveSlots(rawPlayerSlots, (s) =>
    defaultPlayerIds(playersBySeason?.get(s), teamsForPlayerDefaults?.get(s)),
  );

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      mutate(params);
      return params;
    });
  };

  const makeUpdateSlot = (kind: "t" | "p", current: SlotValue[]) => (index: number, next: Partial<SlotValue>) => {
    const merged = { ...current[index]!, ...next };
    updateParams((params) => {
      params.set(`${kind}${index}`, encodeSlotParam(merged.id, merged.season));
      const encoded = encodeFilterParam(merged.filter);
      if (encoded === null) params.delete(`${kind}f${index}`);
      else params.set(`${kind}f${index}`, encoded);
      if (merged.gameType === "regular") params.delete(`${kind}g${index}`);
      else params.set(`${kind}g${index}`, merged.gameType);
    });
  };

  const setMode = (next: Mode) =>
    updateParams((params) => {
      if (next === "team") params.delete("cmp");
      else params.set("cmp", "player");
    });

  const setOrDelete = (key: string, value: string, fallback: string) =>
    updateParams((params) => {
      if (value === fallback) params.delete(key);
      else params.set(key, value);
    });

  // 開幕前で試合が無いシーズンは選択肢から外す（チーム試合ログが無く取得エラーになるため）
  const seasonOptions = [...(seasons ?? [])].filter((s) => s.hasCompletedGames).reverse();
  const activeSlots = mode === "team" ? resolvedTeamSlots : resolvedPlayerSlots;
  const usedSeasons = new Set(activeSlots.filter((s) => s.id).map((s) => s.season));
  const seasonsMatch = usedSeasons.size <= 1;

  const common = {
    seasonOptions,
    seasons: seasons ?? null,
    teamColors: teamColors ?? null,
    divisionHistory: divisionHistory ?? null,
    cat,
  };

  return (
    <div className="compare-page" data-design="v2">
      <h1>比較</h1>
      <p className="page-subtitle">
        最大3件まで選んで比較（項目ごとに異なるシーズン・条件も選択可能。選んだスロットの分だけデータを取得します）
        {!seasonsMatch && <span className="compare-mixed-note"> ※シーズンが異なる項目を比較しています</span>}
      </p>

      <div className="mode-toggle">
        <button className={mode === "team" ? "active" : ""} onClick={() => setMode("team")}>
          チーム
        </button>
        <button className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>
          個人
        </button>
      </div>
      {mode === "team" && (
        <FilterBar
          simple
          stateKey="compare:common"
          axes={[perspectiveAxis(perspective, (v) => setOrDelete("v", v, "own"))]}
        />
      )}
      <div className="tab-bar">
        {BOXSCORE_TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-button${cat === t.key ? " active" : ""}`}
            onClick={() => setOrDelete("cat", t.key, "traditional")}
            type="button"
          >
            {t.label}
          </button>
        ))}
      </div>

      {seasonsLoading || !seasons ? (
        <p className="loading">読み込み中...</p>
      ) : mode === "team" ? (
        <TeamCompareView
          {...common}
          slots={resolvedTeamSlots}
          perspective={perspective}
          teamsBySeason={teamsBySeason}
          onUpdateSlot={makeUpdateSlot("t", resolvedTeamSlots)}
        />
      ) : (
        <PlayerCompareView
          {...common}
          slots={resolvedPlayerSlots}
          playersBySeason={playersBySeason}
          onUpdateSlot={makeUpdateSlot("p", resolvedPlayerSlots)}
        />
      )}
    </div>
  );
}

/** 比較の表の列見出し（選手名）: スマホ幅（560px以下）は名字のみ（試合詳細・個人詳細と同じ）。フルネームは title に残す */
function ResponsivePlayerName({ name }: { name: string }) {
  const narrow = useMediaQuery("(max-width: 560px)");
  return narrow ? <span title={name}>{surnameOf(name)}</span> : <>{name}</>;
}
