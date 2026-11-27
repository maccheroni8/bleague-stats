import { PageTitleRow } from "../components/HeaderActions";
import { NameText } from "../components/NameText";
import { useMemo, useRef, useState, type MutableRefObject } from "react";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "../components/GlossaryNote";
import { LEAGUE_COLOR, LEAGUE_SLOT_NOTE, LEAGUE_TEAM_ID, LEAGUE_TEAM_NAME } from "../lib/leagueAverage";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { useMediaQuery } from "../lib/useMediaQuery";
import { surnameOf } from "../lib/playerSurname";
import { distinctTeamColors } from "../lib/teamColorPairs";
import { useSearchParams } from "react-router-dom";
import { isLeagueSeason, useLeague, type League } from "../lib/league";
import { fetchDivisionHistory, fetchPlayers, fetchSchedule, fetchSeasons, fetchTeamColors, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import type { PlayerSummary, SeasonEntry, TeamColors, TeamSummary } from "../../shared/types";
import { ExportImageButton, type ExportChoice, type ExportAllChoice } from "../components/ExportImageButton";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { RuleChangeFootnote } from "../components/RuleChangeFootnote";
import { foulColumnsSplit } from "../lib/ruleChange";
import { CompareCategoryBar } from "../components/CompareCategoryBar";
import { ComparisonTable, type ComparisonRow, type ComparisonStatDef } from "../components/ComparisonTable";
import { CompareSlotFilter } from "../components/CompareSlotFilter";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "../components/BoxscoreTable";
import {
  buildExportFilename,
  composeLabels,
  displayModeLabels,
  gameTypeLabels,
  joinLabels,
  perspectiveLabels,
  periodLabels,
  situationalFilterLabels,
  teamClassLabels,
} from "../lib/conditionLabels";
import type { PeriodRangeValue } from "../lib/periodRange";
import { SEASON_PERIOD_OPTIONS, seasonPeriodOption } from "../lib/seasonPeriod";
import { CLASSIFICATION_PARAM } from "../lib/classificationParam";
import { isClassUnavailableStat } from "../lib/teamSeasonRanking";
import {
  teamCompareDefs,
  type CompareColumnData,
  type TeamCompareColumnData,
  type TeamCompareOverride,
} from "../lib/compareShared";
import { SEASON_DISPLAY_MODE_LABELS, SEASON_GAME_TYPE_KEYS, type SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import type { SituationalFilter } from "../lib/situational";
import { TEAM_PERSPECTIVE_LABELS, type AllTeamsRow, type TeamPerspective } from "../lib/teamStatsColumns";
import {
  usePlayerCompareSlot,
  useTeamCompareSlot,
  type PlayerSlotData,
  type SlotStatus,
  type TeamSlotData,
} from "../lib/useCompareSlotData";
import type { Division, DivisionHistoryFile } from "../../shared/types";
import { opponentDivisionChoices } from "../lib/divisionGroups";
import { useSeasonKeyedData } from "../lib/useSeasonKeyedData";
import { usePickerSources, usePlayerPickerGroups, type PickerSources } from "../lib/usePlayerPickerGroups";
import { pickerEntryKey, pickerPlayerIdOf } from "../lib/playerPickerOrder";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import type { BaseDateSpec } from "../lib/dataBaseDate";
import { filterPlayersByGamesPlayedRatio } from "../lib/statDefs";
import { useTeamLabel } from "../lib/teamLabel";
import { resultOnlyCompareNote } from "../lib/resultOnlyGames";
import { isDefaultFilter } from "../lib/situational";
import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";
import { seasonsScope } from "../lib/exportHeading";
import { useTeamSeasonRanking, type TeamRankingParams } from "../lib/teamSeasonRanking";
import { DEFAULT_STAT_CONDITIONS } from "../lib/statConditions";
import { matchRankColumn, rankText, teamRankOf } from "../lib/compareRank";
import { usePlayerCompareRanks } from "../lib/playerCompareRank";
import { rankDirectionOf } from "../lib/rankDirection";
import {
  PLAYER_COMPARE_TAB_KEYS,
  isBoxTab,
  playerCompareDefs,
  playerCompareTabs,
  tabIgnoresFilters,
  usePlayerCompareExtra,
  type PlayerCompareTabKey,
} from "../lib/playerCompareExtra";
import { CATEGORY_LABELS } from "../lib/categoryLabels";

type Mode = "team" | "player";

/** 保存画像の条件の行から外すラベル（平均・合計など表示方法の名前。画面の条件の行には残す） */
const COMPARE_EXPORT_OMIT_LABELS: readonly string[] = Object.values(SEASON_DISPLAY_MODE_LABELS);

/**
 * 比較の大見出し（「長崎ヴェルカ vs 宇都宮ブレックス」）。同じ名前が並ぶとき（同じチームの別シーズン等）だけ、シーズンを添えて区別する
 * （シーズン・条件そのものは列見出しの下に出す。DESIGN.md 239章）
 */
function versusTitle(entries: { name: string; season: string }[]): string {
  const count = new Map<string, number>();
  for (const e of entries) count.set(e.name, (count.get(e.name) ?? 0) + 1);
  return entries.map((e) => ((count.get(e.name) ?? 0) > 1 ? `${e.name}（${e.season}）` : e.name)).join(" vs ");
}

/** 比較の保存画像の基準日: 比べている枠のシーズン・試合区分ごとの基準日のうち、最も新しい日 */
function compareBaseDate(slots: { season: string; gameType: SeasonGameTypeFilter }[]): BaseDateSpec {
  return { kind: "latest", slots: slots.map((s) => ({ season: s.season, gameType: s.gameType })) };
}

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
  /** Q別・前後半・延長・クラッチ（"all"＝試合全体） */
  period: PeriodRangeValue;
  /** 登録区分（チームのスロットだけ。"all"＝全選手。選手のスロットは常に "all"） */
  cls: string;
}

// --- URLパラメータ ---
// スロットは "id@season"（?t0=703@2018-19 等。paramが無ければ「そのスロットは未上書き＝ページの
// デフォルトシーズン＋デフォルトIDを使う」）、そのスロットのシチュエーション別フィルタは
// JSON（?tf0=...、無指定＝シーズン全体）、そのスロットの
// レギュラー・プレーオフ・合算は tg0/pg0（無指定＝レギュラー）、Q別・前後半・延長・クラッチは tq0/pq0（無指定＝試合全体）、
// チームの登録区分は tc0（無指定＝全選手。ランキングの cls と同じ書き方）、共通の軸は cat（カテゴリタブ）/
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
const TEAM_TABS: { key: PlayerCompareTabKey; label: string }[] = BOXSCORE_TABS;
const GAME_TYPE_KEYS = SEASON_GAME_TYPE_KEYS;
const PERSPECTIVE_KEYS = Object.keys(TEAM_PERSPECTIVE_LABELS) as TeamPerspective[];

/** スロットのフィルタは参照が変わるたびに集計をやり直す（60試合分の再計算）ため、URL上の文字列が
 * 同じ間は同じオブジェクトを返す */
const PERIOD_KEYS = SEASON_PERIOD_OPTIONS.map((o) => o.value) as PeriodRangeValue[];

/** URL の登録区分（cls）。区分として読めない文字・ルーキーは「全選手」に戻す */
function parseClassParam(raw: string | null): string {
  if (!raw) return "all";
  return CLASSIFICATION_PARAM.read(new URLSearchParams({ cls: raw })) ?? "all";
}

/** 登録区分 → URL の書き方（ランキングの cls と同じ。cls=intl・cls=jp,foreign など） */
function encodeClassParam(cls: string): string | null {
  const p = new URLSearchParams();
  CLASSIFICATION_PARAM.write(p, cls as "all");
  return p.get("cls");
}

function useParsedSlot(rawSlot: string | null, rawFilter: string | null, rawGameType: string | null, rawPeriod: string | null = null, rawClass: string | null = null) {
  return useMemo(
    () => ({
      base: parseSlotParam(rawSlot),
      filter: parseFilterParam(rawFilter),
      gameType: parseEnumParam(rawGameType, GAME_TYPE_KEYS, "regular"),
      period: parseEnumParam(rawPeriod, PERIOD_KEYS, "all"),
      cls: parseClassParam(rawClass),
    }),
    [rawSlot, rawFilter, rawGameType, rawPeriod, rawClass],
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
  /** 対象selectの選択中の値。省略時は選んでいるID（選手の一覧は、チームごとの選択肢の値で渡す） */
  entityValue?: string;
  data: Pick<TeamSlotData, "status" | "error" | "boundary" | "opponentWinRateSupported" | "opponentLatestWinRateSupported" | "ownTeamDivisionSupported" | "gamesCount" | "pendingGames">;
  /** 「対戦地区」の「対◯地区」の選択肢（スロットのシーズンにある地区） */
  opponentDivisions?: Division[];
  onSeason: (season: string) => void;
  onEntity: (id: string) => void;
  onFilter: (filter: SituationalFilter) => void;
  onGameType: (gameType: SeasonGameTypeFilter) => void;
  onPeriod: (period: PeriodRangeValue) => void;
  /** チームのスロットだけ渡す（選手は区分が決まっているので出さない） */
  onClass?: (cls: string) => void;
  onClear: () => void;
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
  entityValue,
  data,
  opponentDivisions,
  onSeason,
  onEntity,
  onFilter,
  onGameType,
  onPeriod,
  onClass,
  onClear,
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
            value: entityValue ?? (entityValid ? slot.id : ""),
            options: [{ value: "", label: "未選択" }, ...entityOptions],
            onChange: onEntity,
          },
        ]}
        enabled={entityValid}
        disabledNote="選択すると、このスロットのデータだけを取得します"
        filter={slot.filter}
        onFilter={onFilter}
        gameType={{ value: slot.gameType, onChange: onGameType, season: slot.season || null }}
        period={{ value: slot.period, onChange: onPeriod }}
        classification={onClass ? { value: slot.cls, onChange: onClass, season: slot.season || null } : undefined}
        onClear={onClear}
        boundary={data.boundary}
        opponentWinRateSupported={data.opponentWinRateSupported}
        opponentLatestWinRateSupported={data.opponentLatestWinRateSupported}
        ownTeamDivisionSupported={data.ownTeamDivisionSupported}
        opponentDivisions={opponentDivisions}
        {...(slot.id === LEAGUE_TEAM_ID ? { situationalDisabledNote: LEAGUE_SLOT_NOTE } : {})}
      />
      {entityLoaded && entityOptions.length === 0 && <p className="compare-slot-note">このシーズンのデータがありません</p>}
      {entityValid && statusText && <p className={`compare-slot-status status-${data.status}`}>{statusText}</p>}
    </div>
  );
}

/** 比較表の列見出し・タイトルに出す、そのスロットの条件ラベル（シーズン以外の絞り込み部分） */
function slotConditionLabel(slot: SlotValue, data: Pick<TeamSlotData, "boundary">, perspective: TeamPerspective = "own"): string {
  return joinLabels(
    composeLabels(
      gameTypeLabels(slot.gameType, slot.season || null),
      slot.period === "all" ? [] : periodLabels(seasonPeriodOption(slot.period)),
      teamClassLabels(slot.cls as "all", perspective),
      situationalFilterLabels(slot.filter, { boundary: data.boundary }),
    ),
  );
}

function categoryLabel(cat: PlayerCompareTabKey): string {
  return (CATEGORY_LABELS as Record<string, string>)[cat] ?? cat;
}

/** 見出しの下の条件の行・ファイル名に入れるタブ名。カテゴリ名（Traditional 等）をそのまま出す（4枚まとめて保存したとき、どの1枚か分かるように。1120の指示で「タブ」の語は付けない） */
function tabConditionLabel(cat: PlayerCompareTabKey): string {
  return categoryLabel(cat);
}

interface ViewCommonProps {
  slots: SlotValue[];
  seasonOptions: SeasonEntry[];
  seasons: SeasonEntry[] | null;
  /** 見ているリーグ。比較はこのリーグの中どうしだけ（スロットのシーズンも、このリーグのシーズンだけ） */
  league: League;
  teamColors: Record<string, TeamColors> | null;
  divisionHistory: DivisionHistoryFile | null;
  cat: PlayerCompareTabKey;
  onCat: (key: PlayerCompareTabKey) => void;
  onUpdateSlot: (index: number, next: Partial<SlotValue>) => void;
  /** 値の下に順位を出すか（既定は出す。URL rk=0 で出さない） */
  showRank: boolean;
  onShowRank: (v: boolean) => void;
  /** 保存の窓で選んだタブに画面を切り替え、描き直し（順位の読み込みを含む）が終わったら終わる */
  activateTab: (tab: PlayerCompareTabKey) => Promise<void>;
  /** 画面が今どのタブで、保存できる状態か（各ビューが描くたびに書く） */
  saveCtl: MutableRefObject<{ cat: PlayerCompareTabKey; ready: boolean }>;
}

/** 保存の窓の「保存する内容」（タブ4つ＋4枚まとめて）。どのタブも同じ画像の型で、見出しの下の条件の行・ファイル名にタブ名が入る */
function saveAllChoice(tabs: { key: PlayerCompareTabKey }[]): ExportAllChoice {
  return { label: `${tabs.length}枚まとめて`, keys: tabs.map((t) => t.key) };
}
function tabSaveChoices(
  tabs: { key: PlayerCompareTabKey; label: string }[],
  exportRef: ExportChoice["targetRef"],
  filenameFor: (tab: PlayerCompareTabKey) => string,
  baseDate: BaseDateSpec,
  activateTab: (tab: PlayerCompareTabKey) => Promise<void>,
): ExportChoice[] {
  return tabs.map((t) => ({ key: t.key, label: t.label, targetRef: exportRef, filename: filenameFor(t.key), baseDate, activate: () => activateTab(t.key) }));
}

// --- チーム比較 ---

type TeamPageRow = TeamCompareColumnData & { teamId: string; season: string; subLabel: string };

function TeamCompareView({
  slots,
  seasonOptions,
  seasons,
  league,
  teamColors,
  divisionHistory,
  cat: catProp,
  onCat,
  perspective,
  onPerspective,
  teamsBySeason,
  resultOnlyBySeason,
  onUpdateSlot,
  showRank,
  onShowRank,
  activateTab,
  saveCtl,
}: ViewCommonProps & {
  perspective: TeamPerspective;
  onPerspective: (v: TeamPerspective) => void;
  teamsBySeason: Map<string, TeamSummary[] | null> | null;
  /** シーズンごとの結果だけの試合（228章。G の勝敗の横の「※」の説明用） */
  resultOnlyBySeason: Map<string, ResultOnlyGameEntry[] | null> | null;
}) {
  const teamLabel = useTeamLabel();
  const exportRef = useRef<HTMLDivElement>(null);
  // チームの比較のタブは Traditional〜Scoring の4つ（Shooting・Profile・Career は個人だけ）
  const cat: BoxscoreTabKey = isBoxTab(catProp) ? catProp : "traditional";

  const lists = slots.map((s) => teamsBySeason?.get(s.season) ?? null);
  // 「リーグ平均」（DESIGN.md 149章）もチームと同じ枠で選べる（シーズン・試合種別は選べる。シチュエーションの絞り込みは無し）
  const valid = slots.map((s, i) => !!s.id && (s.id === LEAGUE_TEAM_ID ? !!lists[i] : !!lists[i]?.some((t) => t.teamId === s.id)));
  // スロットごとに独立して（そのスロットが選択されて初めて）取得する。3つのフックは固定数の呼び出し
  // Q別・前後半・延長・クラッチ、または登録区分を選んだスロットは、値も順位もランキング（チーム・シーズン成績）と同じ集計から出す（試合の生データは読まない）
  const overridden = slots.map((s, i) => valid[i]! && s.id !== LEAGUE_TEAM_ID && (s.period !== "all" || s.cls !== "all"));
  const slotData: TeamSlotData[] = [
    useTeamCompareSlot({ teamId: slots[0]!.id, season: slots[0]!.season, filter: slots[0]!.filter, gameType: slots[0]!.gameType, active: valid[0]!, divisionHistory, seasons, skipBox: overridden[0], league }),
    useTeamCompareSlot({ teamId: slots[1]!.id, season: slots[1]!.season, filter: slots[1]!.filter, gameType: slots[1]!.gameType, active: valid[1]!, divisionHistory, seasons, skipBox: overridden[1], league }),
    useTeamCompareSlot({ teamId: slots[2]!.id, season: slots[2]!.season, filter: slots[2]!.filter, gameType: slots[2]!.gameType, active: valid[2]!, divisionHistory, seasons, skipBox: overridden[2], league }),
  ];

  // 順位: ランキング（チーム・シーズン成績）と同じ計算（useTeamSeasonRanking）を、スロットの条件（シーズン・試合区分・絞り込み）で全チームに掛ける。リーグ平均には付けない
  // 比較の Scoring には、ランキングでは Misc にある項目（PAINT2M・MID2% など）も並ぶので、そのときは Misc の表からも探す
  // フックの呼び出し数を変えないため、2つ目は Scoring 以外では何も読まない（enabled=false）
  // Advanced・Misc・Scoring の表に並ぶ PTS は Traditional の PTS と同じ値なので、その順位は Traditional の表から探す
  const rankCategories: [BoxscoreTabKey, BoxscoreTabKey, boolean][] = [[cat, cat, true], [cat === "scoring" ? "misc" : "traditional", cat, cat !== "traditional"]];
  const rankSources = rankCategories.map(([category, , active]) =>
    SLOT_INDEXES.map((i) => {
      const slot = slots[i]!;
      const params: TeamRankingParams = {
        category,
        statKey: "",
        displayMode: "perGame",
        gameType: slot.gameType,
        perspective,
        filter: slot.filter,
        turnoverDirection: "forced",
        period: slot.period,
        statConditions: DEFAULT_STAT_CONDITIONS,
        classFilter: slot.cls,
      };
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return useTeamSeasonRanking(slot.season, params, { enabled: active && (showRank || overridden[i]!) && valid[i]! && slot.id !== LEAGUE_TEAM_ID, skipConditionItems: true, league, foulIndex: category === "misc" });
    }),
  );
  const teamRankOfDef = (def: ComparisonStatDef<TeamPageRow>, item: TeamPageRow): string | undefined => {
    if (!showRank || item.isLeague) return undefined;
    const i = Number(item.key.slice(4));
    for (const source of rankSources) {
      const r = source[i];
      if (!r || r.gameLogsLoading || !r.gameLogsByTeam) continue;
      const col = matchRankColumn(r.columns, def);
      if (!col) continue;
      if (overrides[i]?.override?.unavailable(col.key)) return undefined;
      const rank = teamRankOf(r.boxRows, col, perspective, item.teamId);
      return rank === null ? undefined : rankText(rank);
    }
    return undefined;
  };

  // 値をランキングと同じ集計から出すスロットの、そのチームの行・列と読み込みの様子
  const overrideOf = (i: number): { status: SlotStatus; error: string | null; override: TeamCompareOverride | null; row: AllTeamsRow | null } | null => {
    if (!overridden[i]) return null;
    const src = rankSources[0]![i]!;
    const slot = slots[i]!;
    if (src.classUnreadable || src.rawGamesFailedCount > 0 || src.classPeriodMissing || src.teamsError) {
      return { status: "error", error: src.classPeriodMissing ? "この区分のQ別の記録がありません" : "この条件の記録を読み込めませんでした", override: null, row: null };
    }
    if (src.teamsLoading || src.gameLogsLoading || !src.gameLogsByTeam || src.classLoading || src.rawGamesLoading) return { status: "loading", error: null, override: null, row: null };
    const row = src.boxRows.find((r) => r.team.teamId === slot.id) ?? null;
    if (!row || row.gamesPlayed === 0) return { status: "empty", error: null, override: null, row: null };
    const classOn = slot.cls !== "all";
    const columns = [...src.columns, ...(rankSources[1]![i]!.columns ?? [])];
    return {
      status: "ready",
      error: null,
      row,
      override: { row, columns, unavailable: (key) => classOn && (perspective === "diff" || isClassUnavailableStat(key)) },
    };
  };
  const overrides = SLOT_INDEXES.map((i) => overrideOf(i));
  const cardData = (i: number): TeamSlotData => {
    const o = overrides[i];
    const d = slotData[i]!;
    return o ? { ...d, status: o.status, error: o.error, gamesCount: o.row?.gamesPlayed ?? 0, pendingGames: 0 } : d;
  };

  const rows: ComparisonRow<TeamPageRow>[] = [];
  const descriptions: string[] = [];
  slots.forEach((slot, i) => {
    const ov = overrides[i];
    const data = cardData(i);
    const isLeague = slot.id === LEAGUE_TEAM_ID;
    const team = isLeague ? { teamId: LEAGUE_TEAM_ID, teamName: LEAGUE_TEAM_NAME } : lists[i]?.find((t) => t.teamId === slot.id);
    if (!team || data.status !== "ready" || (!ov && !data.boxTotals)) return;
    const cond = isLeague ? joinLabels(gameTypeLabels(slot.gameType, slot.season || null)) : slotConditionLabel(slot, data, perspective);
    rows.push({
      item: {
        key: `slot${i}`,
        label: team.teamName,
        teamId: team.teamId,
        season: slot.season,
        boxTotals: data.boxTotals ?? ({} as NonNullable<typeof data.boxTotals>),
        gamesCount: data.gamesCount,
        record: ov?.row ? { wins: ov.row.wins, losses: ov.row.losses } : (data.record ?? undefined),
        override: ov?.override ?? undefined,
        resultOnlyNote: isLeague || ov
          ? undefined
          : resultOnlyCompareNote(resultOnlyBySeason?.get(slot.season), team.teamId, slot.gameType, data.record ?? undefined, isDefaultFilter(slot.filter)),
        logTotals: data.logTotals,
        isLeague,
        paintLeagueComplete: data.paintLeagueComplete,
        subLabel: `${cond}（${data.gamesCount}試合）`,
      },
      season: slot.season,
    });
    descriptions.push(`${team.teamName}（${slot.season}・${cond}）`);
  });

  // 区間・登録区分は、比べているスロットで同じときだけ条件の行に出す（違うときは列ごとの下の行に出る）
  const shown = rows.map((r) => slots[Number(r.item.key.slice(4))]!);
  const samePeriod = shown.every((x) => x.period === shown[0]!.period);
  const sameClass = shown.every((x) => x.cls === shown[0]!.cls);
  const conditions = composeLabels(
    tabConditionLabel(cat),
    perspectiveLabels(perspective),
    displayModeLabels("perGame"),
    samePeriod ? periodLabels(seasonPeriodOption(shown[0]?.period ?? "all")) : [],
    sameClass && shown[0] ? teamClassLabels(shown[0].cls as "all", perspective) : [],
  );
  // 大見出しは「長崎ヴェルカ vs 宇都宮ブレックス」だけ。シーズン・条件は列見出しの下に出す（同じ名前が並ぶときだけシーズンを添える）
  const title = rows.length > 0 ? versusTitle(rows.map((r) => ({ name: r.item.label, season: r.season }))) : "チーム比較";
  const filenameFor = (tab: PlayerCompareTabKey) => // ファイル名は長いと途中で切れるので、タブ名は先頭に近い位置に置く（4枚が同じ名前にならないように）
    buildExportFilename(["比較", "チーム", tabConditionLabel(tab), ...descriptions, ...composeLabels(perspectiveLabels(perspective), displayModeLabels("perGame"), samePeriod ? periodLabels(seasonPeriodOption(shown[0]?.period ?? "all")) : [])]);
  const anyBusy = SLOT_INDEXES.some((i) => cardData(i).status === "loading" || cardData(i).status === "fetching");
  // 保存の窓がタブを切り替えたとき、描き直し（全チームの順位の材料の読み込み）が終わったか
  saveCtl.current = {
    cat,
    ready:
      !anyBusy &&
      (!showRank ||
        SLOT_INDEXES.every((i) => {
          if (!valid[i] || slots[i]!.id === LEAGUE_TEAM_ID) return true;
          const r = rankSources[0]![i]!;
          if (overridden[i] && overrides[i]?.status === "loading") return false;
          return !!r.gameLogsByTeam && !r.gameLogsLoading;
        })),
  };
  // 比べるシーズンがすべて2026-27以降なら、ファウルの列をTF1・TF2・FLAG・DISRにする（DESIGN.md 16-8章）
  const foulSplit = foulColumnsSplit(rows.map((r) => r.season));
  const defs = useMemo(() => teamCompareDefs(cat, perspective, foulSplit), [cat, perspective, foulSplit]);

  // 並んだチームの色が近いときは、2つ目以降をサブカラーにする（同じチームの別シーズンも。src/lib/teamColorPairs.ts。DESIGN.md 156章）
  const slotColors = distinctTeamColors(
    rows.map((r) => (r.item.isLeague ? { primary: LEAGUE_COLOR } : (teamColors?.[r.item.teamId] ?? {}))),
  );
  const slotColorByKey = new Map(rows.map((r, i) => [r.item.key, slotColors[i]]));

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
            entityOptions={
              lists[i] ? [{ value: LEAGUE_TEAM_ID, label: LEAGUE_TEAM_NAME }, ...lists[i]!.map((t) => ({ value: t.teamId, label: teamLabel(t.teamId, t.teamName) }))] : []
            }
            entityLoaded={lists[i] !== null && lists[i] !== undefined}
            entityValid={valid[i]!}
            data={cardData(i)}
            opponentDivisions={opponentDivisionChoices(divisionHistory, slots[i]!.season, league)}
            onSeason={(season) => onUpdateSlot(i, { season, filter: DEFAULT_FILTER })}
            onGameType={(gameType) => onUpdateSlot(i, { gameType })}
            onPeriod={(period) => onUpdateSlot(i, { period })}
            onClass={(cls) => onUpdateSlot(i, { cls })}
            onClear={() => onUpdateSlot(i, { filter: DEFAULT_FILTER, gameType: "regular", period: "all", cls: "all" })}
            onEntity={(id) => onUpdateSlot(i, { id })}
            onFilter={(filter) => onUpdateSlot(i, { filter })}
          />
        ))}
      </div>
      <CompareCategoryBar category={cat} onCategory={onCat} perspective={perspective} onPerspective={onPerspective} />
      <ExportImageButton
        choices={tabSaveChoices(TEAM_TABS, exportRef, filenameFor, compareBaseDate(slots.filter((_, i) => valid[i])), activateTab)}
        defaultChoiceKey={cat}
        allChoice={saveAllChoice(TEAM_TABS)}
        restoreAfterSave={() => onCat(cat)}
        choicesLabel="保存する内容"
      />
      <ExportTarget
        ref={exportRef}
        className={`export-target-versus export-versus-${Math.max(1, rows.length)}`}
        baseDate={compareBaseDate(slots.filter((_, i) => valid[i]))}
      >
        {rows.length > 0 && <ConditionTitle
            title={title}
            conditions={conditions}
            exportScope={seasonsScope(rows.map((r) => r.season))}
            exportNameHidden
            exportOmitLabels={COMPARE_EXPORT_OMIT_LABELS}
          />}
        <ComparisonTable
          statScope="team"
          rows={rows}
          defs={defs}
          rowKey={(r) => r.key}
          name={(r) => (r.isLeague ? r.label : <ResponsiveTeamName teamId={r.teamId} name={r.label} />)}
          linkTo={(r) => (r.isLeague ? undefined : `/teams/${r.teamId}`)}
          teamColor={(r) => slotColorByKey.get(r.key)}
          subLabel={(r) => r.subLabel}
          avatar={(r) => (r.isLeague ? null : <TeamLogo teamId={r.teamId} size={64} />)}
          jaNames
          rankOf={teamRankOfDef}
          emptyMessage={anyBusy ? "データ取得中..." : "比較するチームを選んでください"}
        />
      </ExportTarget>
      {cat === "misc" && <RuleChangeFootnote seasons={rows.map((r) => r.season)} />}
      <GlossaryNote anchor={GLOSSARY_ANCHORS.boxscoreColumns} label="比較" scope="スロットごとの条件で絞り込んだ試合の1試合平均です。" />
    </>
  );
}

// --- 個人比較 ---

type PlayerPageRow = CompareColumnData & { playerId: string; teamId: string | null; teamName?: string; season: string; subLabel: string };

function PlayerCompareView({
  slots,
  seasonOptions,
  league,
  teamColors,
  divisionHistory,
  cat,
  onCat,
  playersBySeason,
  pickerSources,
  onUpdateSlot,
  showRank,
  onShowRank,
  activateTab,
  saveCtl,
}: ViewCommonProps & { playersBySeason: Map<string, PlayerSummary[] | null> | null; pickerSources: PickerSources }) {
  const teamLabel = useTeamLabel();
  const exportRef = useRef<HTMLDivElement>(null);

  const lists = slots.map((s) => playersBySeason?.get(s.season) ?? null);
  const valid = slots.map((s, i) => !!s.id && !!lists[i]?.some((p) => p.playerId === s.id));
  // 選手の選択肢は、チームごと（東→西、順位表の順）・出場時間の長い順にまとめる（DESIGN.md 281章）。移籍した選手は出場したチームそれぞれの下に出るので、
  // 選んだチームはスロットごとに覚える（同じ選手でも、どのチームの下で選んだかを選択中の表示に使う）
  const [pickedTeam, setPickedTeam] = useState<Record<number, string>>({});
  const pickerGroups = [
    usePlayerPickerGroups(slots[0]!.season, slots[0]!.gameType, playersBySeason?.get(slots[0]!.season) ?? null, pickerSources, league),
    usePlayerPickerGroups(slots[1]!.season, slots[1]!.gameType, playersBySeason?.get(slots[1]!.season) ?? null, pickerSources, league),
    usePlayerPickerGroups(slots[2]!.season, slots[2]!.gameType, playersBySeason?.get(slots[2]!.season) ?? null, pickerSources, league),
  ];
  const slotData: PlayerSlotData[] = [
    usePlayerCompareSlot({ playerId: slots[0]!.id, season: slots[0]!.season, filter: slots[0]!.filter, gameType: slots[0]!.gameType, active: valid[0]!, divisionHistory, period: slots[0]!.period, league }),
    usePlayerCompareSlot({ playerId: slots[1]!.id, season: slots[1]!.season, filter: slots[1]!.filter, gameType: slots[1]!.gameType, active: valid[1]!, divisionHistory, period: slots[1]!.period, league }),
    usePlayerCompareSlot({ playerId: slots[2]!.id, season: slots[2]!.season, filter: slots[2]!.filter, gameType: slots[2]!.gameType, active: valid[2]!, divisionHistory, period: slots[2]!.period, league }),
  ];

  // 順位: ランキング（個人・シーズン成績）と同じ決め方。条件なしのレギュラーシーズンの枠だけ（絞り込み・プレーオフ・合算の枠はランキングに同じ条件の表が無いので出さない）。20位以内だけ
  // 絞り込み（試合区分・シチュエーション・区間）を掛けた枠。PER・Shooting はシーズン全体の値なので「-」にし、Profile・Career は絞り込みに関係なく出す
  const slotFiltered = slots.map((s) => s.gameType !== "regular" || s.period !== "all" || !isDefaultFilter(s.filter));
  const extras = SLOT_INDEXES.map((i) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    usePlayerCompareExtra({ season: slots[i]!.season, league, playerId: slots[i]!.id, active: valid[i]!, needCareer: cat === "career" }),
  );
  const rankEnabled = SLOT_INDEXES.map((i) => showRank && valid[i]! && (cat === "profile" || cat === "career" || !slotFiltered[i]!));
  const rankLabels = SLOT_INDEXES.map((i) => {
    const slot = slots[i]!;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return usePlayerCompareRanks({
      season: slot.season,
      league,
      tab: cat,
      playerId: slot.id,
      enabled: rankEnabled[i]!,
      neutral: (key) => rankDirectionOf(key) === "neutral",
    });
  });
  const playerRankOfDef = (def: ComparisonStatDef<PlayerPageRow>, item: PlayerPageRow): string | undefined => {
    if (!showRank) return undefined;
    return rankLabels[Number(item.key.slice(4))]?.get(def.key);
  };

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
        teamName: player.teamName,
        season: slot.season,
        ctx: data.ctx,
        record: data.record ?? undefined,
        ddtd: data.ddtd ?? undefined,
        summary: extras[i]!.summary,
        career: extras[i]!.career,
        filtered: slotFiltered[i]!,
        subLabel: `${cond}（${data.gamesCount}試合）`,
      },
      season: slot.season,
    });
    descriptions.push(`${player.name}（${slot.season}・${cond}）`);
  });

  const shownPeriods = rows.map((r) => slots[Number(r.item.key.slice(4))]!.period);
  const samePeriod = shownPeriods.every((x) => x === shownPeriods[0]);
  const periodLabel = samePeriod ? periodLabels(seasonPeriodOption(shownPeriods[0] ?? "all")) : [];
  const conditions = composeLabels(tabConditionLabel(cat), displayModeLabels("perGame"), periodLabel);
  const title = rows.length > 0 ? versusTitle(rows.map((r) => ({ name: r.item.label, season: r.season }))) : "個人比較";
  const filenameFor = (tab: PlayerCompareTabKey) => buildExportFilename(["比較", "個人", tabConditionLabel(tab), ...descriptions, ...composeLabels(displayModeLabels("perGame"), periodLabel)]);
  const anyBusy = slotData.some((d) => d.status === "loading");
  // 保存の窓がタブを切り替えたとき、描き直し（順位の材料の読み込み）が終わったか。順位を出さない枠（絞り込みなど）は待たない
  saveCtl.current = { cat, ready: !anyBusy && extras.every((x) => x.ready) && SLOT_INDEXES.every((i) => !rankEnabled[i] || rankLabels[i] !== null) };
  const foulSplit = foulColumnsSplit(rows.map((r) => r.season));
  const defs = useMemo(() => playerCompareDefs(cat, foulSplit), [cat, foulSplit]);
  const playerTabs = playerCompareTabs(league);
  const filterIgnoredNote = tabIgnoresFilters(cat) && cat !== "profile" && cat !== "career" && slotFiltered.some((f, i) => f && valid[i]);

  // 選手の所属チームの色が近いとき（同じチームを含む）は、2つ目以降をサブカラーにする（DESIGN.md 156章）
  const slotColors = distinctTeamColors(rows.map((r) => (r.item.teamId ? (teamColors?.[r.item.teamId] ?? {}) : {})));
  const slotColorByKey = new Map(rows.map((r, i) => [r.item.key, slotColors[i]]));

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
            entityOptions={pickerGroups[i]!.flatMap((g) =>
              g.entries.map((e) => ({ value: e.key, label: e.name, group: teamLabel(g.teamId, g.teamName) })),
            )}
            entityValue={
              valid[i]!
                ? (pickerGroups[i]!.flatMap((g) => g.entries).find((e) => e.key === pickerEntryKey(slots[i]!.id, pickedTeam[i] ?? ""))?.key ??
                  pickerGroups[i]!.flatMap((g) => g.entries).find((e) => e.playerId === slots[i]!.id)?.key ??
                  "")
                : ""
            }
            entityLoaded={lists[i] !== null && lists[i] !== undefined}
            entityValid={valid[i]!}
            data={slotData[i]!}
            opponentDivisions={opponentDivisionChoices(divisionHistory, slots[i]!.season, league)}
            onSeason={(season) => onUpdateSlot(i, { season, filter: DEFAULT_FILTER })}
            onGameType={(gameType) => onUpdateSlot(i, { gameType })}
            onPeriod={(period) => onUpdateSlot(i, { period })}
            onClear={() => onUpdateSlot(i, { filter: DEFAULT_FILTER, gameType: "regular", period: "all" })}
            onEntity={(key) => {
              setPickedTeam((prev) => ({ ...prev, [i]: key.slice(pickerPlayerIdOf(key).length + 1) }));
              onUpdateSlot(i, { id: pickerPlayerIdOf(key) });
            }}
            onFilter={(filter) => onUpdateSlot(i, { filter })}
          />
        ))}
      </div>
      <CompareCategoryBar tabs={playerTabs} category={cat} onCategory={onCat} />
      <ExportImageButton
        choices={tabSaveChoices(playerTabs, exportRef, filenameFor, compareBaseDate(slots.filter((_, i) => valid[i])), activateTab)}
        defaultChoiceKey={cat}
        allChoice={saveAllChoice(playerTabs)}
        restoreAfterSave={() => onCat(cat)}
        choicesLabel="保存する内容"
      />
      <ExportTarget
        ref={exportRef}
        className={`export-target-versus export-versus-${Math.max(1, rows.length)}`}
        baseDate={compareBaseDate(slots.filter((_, i) => valid[i]))}
      >
        {rows.length > 0 && <ConditionTitle
            title={title}
            conditions={conditions}
            exportScope={seasonsScope(rows.map((r) => r.season))}
            exportNameHidden
            exportOmitLabels={COMPARE_EXPORT_OMIT_LABELS}
          />}
        <ComparisonTable
          rows={rows}
          defs={defs}
          rowKey={(r) => r.key}
          name={(r) => <ResponsivePlayerName name={r.label} />}
          linkTo={(r) => `/players/${r.playerId}`}
          teamColor={(r) => slotColorByKey.get(r.key)}
          subLabel={(r) => r.subLabel}
          avatar={(r) => <PlayerPhoto playerId={r.playerId} size={72} className="compare-photo" placeholder season={r.season} teamId={r.teamId} />}
          caption={(r) => r.teamName}
          captionTeamId={(r) => r.teamId ?? undefined}
          jaNames
          rankOf={playerRankOfDef}
          emptyMessage={anyBusy ? "データ取得中..." : "比較する選手を選んでください"}
        />
      </ExportTarget>
      {cat === "misc" && <RuleChangeFootnote seasons={rows.map((r) => r.season)} />}
      {filterIgnoredNote && <p className="page-subtitle">この表の項目は、試合区分・シチュエーション・区間の絞り込みを掛けられないため、絞り込みのある枠は「-」です（シーズン全体の記録）。</p>}
      <GlossaryNote anchor={GLOSSARY_ANCHORS.boxscoreColumns} label="比較" scope="スロットごとの条件で絞り込んだ試合の1試合平均です（移籍した選手は所属チームを合算）。" />
    </>
  );
}

/** そのシーズンの結果だけの試合の一覧（古い日程ファイルには無いので空）。取得に失敗しても比較は止めない（説明の「※」が出ないだけ） */
const fetchResultOnlyGamesFor = (league: League) => async (season: string): Promise<ResultOnlyGameEntry[]> => {
  try {
    return (await fetchSchedule(season, league)).resultOnlyGames ?? [];
  } catch {
    return [];
  }
};

export function ComparePage({ season }: { season: string }) {
  const league = useLeague();
  const [searchParams, setSearchParams] = useSearchParams();

  const mode: Mode = searchParams.get("cmp") === "player" ? "player" : "team";
  const rawCat = parseEnumParam<PlayerCompareTabKey>(searchParams.get("cat"), PLAYER_COMPARE_TAB_KEYS, "traditional");
  // チームは4つのタブだけ。個人は、見ているリーグにあるタブだけ（B.ONE は Shooting・Career が無い）
  const cat: PlayerCompareTabKey = mode === "team" ? (isBoxTab(rawCat) ? rawCat : "traditional") : playerCompareTabs(league).some((t) => t.key === rawCat) ? rawCat : "traditional";
  const perspective = parseEnumParam(searchParams.get("v"), PERSPECTIVE_KEYS, "own");

  const { data: seasons, loading: seasonsLoading } = useJsonData(() => fetchSeasons(), []);
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);

  const t0 = useParsedSlot(searchParams.get("t0"), searchParams.get("tf0"), searchParams.get("tg0"), searchParams.get("tq0"), searchParams.get("tc0"));
  const t1 = useParsedSlot(searchParams.get("t1"), searchParams.get("tf1"), searchParams.get("tg1"), searchParams.get("tq1"), searchParams.get("tc1"));
  const t2 = useParsedSlot(searchParams.get("t2"), searchParams.get("tf2"), searchParams.get("tg2"), searchParams.get("tq2"), searchParams.get("tc2"));
  const p0 = useParsedSlot(searchParams.get("p0"), searchParams.get("pf0"), searchParams.get("pg0"), searchParams.get("pq0"));
  const p1 = useParsedSlot(searchParams.get("p1"), searchParams.get("pf1"), searchParams.get("pg1"), searchParams.get("pq1"));
  const p2 = useParsedSlot(searchParams.get("p2"), searchParams.get("pf2"), searchParams.get("pg2"), searchParams.get("pq2"));
  const rawTeamSlots = [t0, t1, t2];
  const rawPlayerSlots = [p0, p1, p2];
  // URL のスロットのシーズンが、見ているリーグに無いとき（B.PREMIER のシーズンのリンクで B.ONE を開いたなど）は、ページのシーズンにする。比較は同じリーグの中どうしだけ
  const slotSeasonOf = (s: { base: { season: string } | null }) => (s.base?.season && isLeagueSeason(league, s.base.season, seasons) ? s.base.season : season);
  const teamSeasons = rawTeamSlots.map(slotSeasonOf);
  const playerSeasons = rawPlayerSlots.map(slotSeasonOf);

  const { dataBySeason: teamsBySeason } = useSeasonKeyedData(teamSeasons, (s) => fetchTeams(s, league), league);
  // 選手の一覧は個人比較のときだけ読む（チーム比較では使わない。個人に切り替えたとき読む）
  const { dataBySeason: playersBySeason } = useSeasonKeyedData(mode === "player" ? playerSeasons : [], (s) => fetchPlayers(s, league), league);
  // 選手の選択肢（チームごとの並び）に要る順位表・出場時間。個人比較のときだけ読む
  const pickerSources = usePickerSources(mode === "player" ? playerSeasons : [], league);
  // 結果だけの試合（G の勝敗の横の「※」の説明用）。チーム比較のときだけ、選んだシーズン分の日程を読む
  const { dataBySeason: resultOnlyBySeason } = useSeasonKeyedData(mode === "team" ? teamSeasons : [], fetchResultOnlyGamesFor(league), league);
  // 個人のデフォルト（出場率の足切り）に所属チームの試合数が要る。個人モードのときだけ取得する
  const { dataBySeason: teamsForPlayerDefaults } = useSeasonKeyedData(mode === "player" ? playerSeasons : [], (s) => fetchTeams(s, league), league);

  // 未上書き（paramが無い）スロットは、ページのシーズンの勝率上位/得点上位（defaultTeamIds/defaultPlayerIds）を
  // 先頭2スロットのデフォルトにする。3つ目は空のまま（選んだスロットの分だけ取得するため）
  const resolveSlots = (raw: typeof rawTeamSlots, defaultIdsBySeason: (slotSeason: string) => string[]): SlotValue[] =>
    raw.map((r, i) => {
      const slotSeason = slotSeasonOf(r);
      if (r.base !== null) return { id: r.base.id, season: slotSeason, filter: r.filter, gameType: r.gameType, period: r.period, cls: r.cls };
      return { id: (i < 2 ? defaultIdsBySeason(slotSeason)[i] : undefined) ?? "", season: slotSeason, filter: r.filter, gameType: r.gameType, period: r.period, cls: r.cls };
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
      if (merged.period === "all") params.delete(`${kind}q${index}`);
      else params.set(`${kind}q${index}`, merged.period);
      const encodedClass = kind === "p" ? null : encodeClassParam(merged.cls);
      if (encodedClass === null) params.delete(`${kind}c${index}`);
      else params.set(`${kind}c${index}`, encodedClass);
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
  const seasonOptions = [...(seasons ?? [])].filter((s) => s.hasCompletedGames && isLeagueSeason(league, s.season, seasons)).reverse();
  const activeSlots = mode === "team" ? resolvedTeamSlots : resolvedPlayerSlots;
  const usedSeasons = new Set(activeSlots.filter((s) => s.id).map((s) => s.season));
  const seasonsMatch = usedSeasons.size <= 1;

  // 保存の窓で別のタブを選んだとき、画面をそのタブに切り替えて描き直しが終わるのを待つ（窓の後ろで切り替わる。保存が終わったら元のタブに戻す）
  const saveCtl = useRef<{ cat: PlayerCompareTabKey; ready: boolean }>({ cat, ready: false });
  const activateTab = async (tab: PlayerCompareTabKey): Promise<void> => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    if (saveCtl.current.cat !== tab) setOrDelete("cat", tab, "traditional");
    await wait(100);
    for (let waited = 0; waited < 60_000 && !(saveCtl.current.cat === tab && saveCtl.current.ready); waited += 100) await wait(100);
    // 描き直しが画面に出るのを待つ（読み込みが終わらないまま上限に来たときも、そのまま保存する）
    // （画面が隠れているとアニメーションの描き直しが止まるので、時間でも抜ける）
    await Promise.race([new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))), wait(400)]);
  };

  const common = {
    seasonOptions,
    seasons: seasons ?? null,
    league,
    teamColors: teamColors ?? null,
    divisionHistory: divisionHistory ?? null,
    cat,
    onCat: (key: PlayerCompareTabKey) => setOrDelete("cat", key, "traditional"),
    activateTab,
    saveCtl,
    showRank: searchParams.get("rk") !== "0",
    onShowRank: (v: boolean) => setOrDelete("rk", v ? "1" : "0", "1"),
  };

  return (
    <div className="compare-page" data-design="v2">
      <PageTitleRow>比較</PageTitleRow>
      <p className="page-subtitle">
        最大3件まで選んで比較（項目ごとに異なるシーズン・条件も選択可能。選んだスロットの分だけデータを取得します）
        {!seasonsMatch && <span className="compare-mixed-note"> ※シーズンが異なる項目を比較しています</span>}
      </p>

      <div className="compare-mode-row">
        <div className="mode-toggle">
          <button className={mode === "team" ? "active" : ""} onClick={() => setMode("team")}>
            チーム
          </button>
          <button className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>
            個人
          </button>
        </div>
        {/* 値の下の順位の表示・非表示（チーム・個人どちらでも同じ場所。画像の保存にも効く） */}
        <label className="compare-rank-toggle">
          <input type="checkbox" checked={common.showRank} onChange={(e) => common.onShowRank(e.target.checked)} /> 順位を表示
        </label>
      </div>
      {seasonsLoading || !seasons ? (
        <p className="loading">読み込み中...</p>
      ) : mode === "team" ? (
        <TeamCompareView
          key={league}
          {...common}
          slots={resolvedTeamSlots}
          perspective={perspective}
          onPerspective={(v) => setOrDelete("v", v, "own")}
          teamsBySeason={teamsBySeason}
          resultOnlyBySeason={resultOnlyBySeason}
          onUpdateSlot={makeUpdateSlot("t", resolvedTeamSlots)}
        />
      ) : (
        <PlayerCompareView
          key={league}
          {...common}
          slots={resolvedPlayerSlots}
          playersBySeason={playersBySeason}
          pickerSources={pickerSources}
          onUpdateSlot={makeUpdateSlot("p", resolvedPlayerSlots)}
        />
      )}
    </div>
  );
}

/** 比較の表の列見出し（選手名）: スマホ幅（560px以下）は名字のみ（試合詳細・個人詳細と同じ）。フルネームは title に残す */
function ResponsivePlayerName({ name }: { name: string }) {
  const narrow = useMediaQuery("(max-width: 560px)");
  return narrow ? <span title={name}><NameText name={surnameOf(name)} /></span> : <NameText name={name} />;
}
