import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS } from "./categoryLabels";
import { fetchPlayerCareers, fetchPlayerGameLogs, fetchPlayers, fetchRegisteredPlayers, fetchTeams } from "./data";
import type { PlayerCareerCounts } from "../../shared/types";
import { useJsonData } from "./useJsonData";
import { PLAYER_STAT_DEFS } from "./statDefs";
import { foulColumnsSplit } from "./ruleChange";
import type { Column } from "../components/SortableTable";
import { filterGameLogs, isDefaultFilter, type SituationalFilter } from "./situational";
import {
  SEASON_ADVANCED_COLUMNS,
  SEASON_BOX_PERIOD_OPTIONS,
  SEASON_BOX_TABS,
  seasonBoxColumnsFor,
  SEASON_SCORING_COLUMNS,
  SEASON_TRADITIONAL_COLUMNS,
  EMPTY_TEAM_TOTALS,
  buildPeriodFilteredRawTotals,
  buildSeasonBoxscoreCtx,
  computeGamePeriodTotals,
  countDigits,
  countDoubleTripleDoubles,
  filterByGameType,
  sumPlayerGameLogs,
  sumTeamGameLogsFor,
  type GamePeriodTotals,
  type PlayerSeasonRawTotals,
  type SeasonBoxTabKey,
  type SeasonBoxscoreColumn,
  type SeasonBoxscoreCtx,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
  type TeamSeasonRawTotals,
} from "./playerSeasonBoxscore";
import { teamTotalsForTransferredPlayer } from "../../shared/transferredTeamTotals";
import { shotTypeEntityColumns, SHOT_TYPE_DISPLAY_ORDER } from "./shotTypeBreakdown";
import { useAllTeamGameLogs, useLeagueRawGames, useLeagueSituationalContext } from "./teamRankingData";
import { matchesPlayerGroupFilter, matchesPositionFilter, type PlayerGroupFilter } from "./classificationFilter";
import { EXTRA_ELIGIBILITY_RULES, filterEligiblePlayers } from "./playerRankingEligibility";
import { formatDecimal } from "./format";
import { ageForSeason } from "./age";
import { heightText, weightText } from "./profileMark";
import type { PlayerGameLog, PlayerSummary, TeamGameLog } from "../../shared/types";
import {
  activeStatConditionKeys,
  buildStatConditionItems,
  filterByStatConditions,
  hasActiveStatConditions,
  type StatConditionItemDef,
  type StatConditionsState,
} from "./statConditions";
import { CAREER_CONDITION_KEY_PREFIX, CAREER_ITEM_DEFS, playerCareerConditionDefs, playerProfileConditionDefs } from "./playerConditionItems";
import type { PeriodRangeValue } from "./periodRange";
import type { RankableStat } from "../components/RankedList";

export const PLAYER_RANK_TOP_N = 20;

/** ボックススコア列キー（SEASON_TRADITIONAL_COLUMNS等、小文字。例: "fgpct"）→掲載基準
 * （EXTRA_ELIGIBILITY_RULES、statDefs.ts由来のキャメルケース。例: "fgPct"）キーの対応 */
const BOX_KEY_TO_EXTRA_RULE_KEY: Record<string, string> = {
  fgpct: "fgPct",
  "2ppct": "twoPct",
  "3ppct": "tpPct",
  ftpct: "ftPct",
};
export function extraRuleKey(statKey: string): string {
  return BOX_KEY_TO_EXTRA_RULE_KEY[statKey] ?? statKey;
}

/** 選手ランキングのカテゴリ項目1つを表す最小限の型。valueがctx（未計算ならnull）を
 * 受け取れるようにし、SeasonBoxscoreColumn（PlayerGameLog取得が要る）とPLAYER_STAT_DEFS・
 * shotTypeEntityColumns（PlayerSummaryのみで完結、ctx不要）の両方をこの形に揃えて扱う */
export interface PlayerRankItem {
  key: string;
  label: string;
  higherIsBetter?: boolean;
  value: (p: PlayerSummary, ctx: SeasonBoxscoreCtx | null) => number;
  format: (p: PlayerSummary, ctx: SeasonBoxscoreCtx | null) => string;
}

/**
 * シチュエーション別フィルタ・レギュラー/プレーオフ選択が既定値のときだけ使う0コスト経路。
 * PlayerSummary.totals（シーズン合計、既に取得済み）からSeasonBoxscoreColumnが必要とする
 * PlayerSeasonRawTotalsを組み立てる。PlayByPlays由来の項目（PTSOFFTO・DUNK・被アシスト内訳・
 * ペイント/ミッドレンジ分割・在コート区間・テクニカルファウル等）はPlayerSummaryに存在しない
 * ため0で埋める（Misc/スコアリングカテゴリはこの経路を使わず常にPlayerGameLogを取得する。
 * PlayerRankingSection参照）
 */
export function rawTotalsFromPlayerSummary(p: PlayerSummary): PlayerSeasonRawTotals {
  const t = p.totals;
  return {
    gamesPlayed: t.gamesPlayed,
    gamesStarted: t.gamesStarted,
    min: t.min,
    pts: t.pts,
    fgm: t.fgm,
    fga: t.fga,
    tpm: t.tpm,
    tpa: t.tpa,
    ftm: t.ftm,
    fta: t.fta,
    oreb: t.oreb,
    dreb: t.dreb,
    reb: t.reb,
    ast: t.ast,
    tov: t.tov,
    stl: t.stl,
    blk: t.blk,
    pf: t.pf,
    foulsDrawn: t.foulsDrawn,
    blockedAgainst: t.blockedAgainst,
    technicalFouls: 0,
    pt2in: 0,
    ptfb: 0,
    pt2nd: 0,
    plusMinus: t.plusMinus,
    ptsOffTov: 0,
    dunks: 0,
    basketCounts: 0,
    unsportsmanlikeFouls: 0,
    disqualifyingFouls: 0,
    technicalFoulsCat1: 0,
    technicalFoulsCat2: 0,
    flagrantFouls: 0,
    disruptiveFouls: 0,
    offensiveFoulsCommitted: 0,
    chargesDrawn: 0,
    assisted2m: 0,
    assisted3m: 0,
    assistedFtm: 0,
    paint2m: 0,
    paint2a: 0,
    mid2m: 0,
    mid2a: 0,
    onCourtOwnPoss: 0,
    onCourtOppPoss: 0,
    onCourtSeconds: 0,
  };
}

/**
 * SeasonBoxscoreColumn（トラディショナル/アドバンスド/Misc/スコアリング共通の列定義、
 * 個人詳細ページ「シーズン別成績」・チーム詳細ページ「選手スタッツ」タブと同じ
 * src/lib/playerSeasonBoxscore.tsを再利用）をPlayerRankItemに変換する。
 * EFFのみ、0コスト経路だとtechnicalFoulsが常に0になり不正確になるため（rawTotalsFromPlayerSummary
 * 参照）、常にPlayerSummary.advanced.eff（バックエンドで正しく計算済みの値）を直接使う
 * （シチュエーション別フィルタ・レギュラー/プレーオフ選択の対象外。従来の実装と同じ扱い）
 */
/** 個人ランキングの平均/合計（DESIGN.md 179章）。30分換算は選べない */
export type PlayerRankMode = "perGame" | "total";

/** EFF（シーズンの値。シチュエーション別等の対象外）。平均は players.json の1試合平均、合計はそれ×出場試合数 */
function effValue(p: PlayerSummary, mode: PlayerRankMode): number {
  return mode === "total" ? p.advanced.eff * p.gamesPlayed : p.advanced.eff;
}

function effText(p: PlayerSummary, mode: PlayerRankMode): string {
  return formatDecimal(effValue(p, mode), countDigits(mode));
}

export function boxColumnItem(col: SeasonBoxscoreColumn, mode: PlayerRankMode): PlayerRankItem {
  if (col.key === "eff") {
    return {
      key: col.key,
      label: col.label,
      higherIsBetter: col.higherIsBetter,
      value: (p) => effValue(p, mode),
      format: (p) => effText(p, mode),
    };
  }
  return {
    key: col.key,
    label: col.label,
    higherIsBetter: col.higherIsBetter,
    value: (_p, ctx) => (ctx ? col.value(ctx, mode) : 0),
    format: (_p, ctx) => (ctx ? col.format(ctx, mode) : "-"),
  };
}

/**
 * 平均/合計で値が変わらない項目（割合・率・試合数）。これらとProfile・Careerでは、平均/合計の切り替えを無効にする（DESIGN.md 179章）。
 * 名前に pct を含む項目（FG%・TOV%・%PTS・PAINT2%・シューティングの 2P% 等）もここに入れる
 */
export const DDTD_PERIOD_REASON = (label: string) => `「${label}」は試合全体の記録でしか判定できないため、Q別・前後半を選んでいるときは対象外です。`;

const MODE_INVARIANT_KEYS: ReadonlySet<string> = new Set(["g", "gs", "asttov", "usg", "efg", "ts", "pps", "poss", "pace", "ortg", "drtg", "netrtg", "per", "ppp"]);

export function displayModeApplies(category: string, statKey: string): boolean {
  if (category === "profile" || category === "career") return false;
  return !MODE_INVARIANT_KEYS.has(statKey) && !statKey.startsWith("pct") && !statKey.endsWith("pct");
}

/** DD2・TD3（達成した試合数と出場試合数。ダブルダブル・トリプルダブルは試合全体で判定する。DESIGN.md 60-4・179章） */
export interface DoubleCounts {
  dd: number;
  td: number;
  games: number;
}

/** DD2・TD3 の項目。合計は回数、平均は達成率（達成した試合÷出場試合）に、達成した試合数と出場試合数を添える */
export function doubleItems(countsOf: (p: PlayerSummary) => DoubleCounts | undefined, mode: PlayerRankMode): PlayerRankItem[] {
  const defs = [
    { key: "dd2", label: "DD2", count: (c: DoubleCounts) => c.dd },
    { key: "td3", label: "TD3", count: (c: DoubleCounts) => c.td },
  ];
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    value: (p) => {
      const c = countsOf(p);
      if (!c) return 0;
      return mode === "total" ? d.count(c) : c.games > 0 ? d.count(c) / c.games : 0;
    },
    format: (p) => {
      const c = countsOf(p);
      if (!c) return "-";
      if (mode === "total") return `${d.count(c)}回`;
      const rate = c.games > 0 ? (100 * d.count(c)) / c.games : 0;
      return `${rate.toFixed(1)}%（${d.count(c)}/${c.games}）`;
    },
  }));
}

/** スタッツの条件で判定する DD2・TD3 の表示（平均は「45.0%」、合計は「27」） */
function doubleConditionText(c: DoubleCounts | undefined, count: number | undefined, mode: PlayerRankMode): string {
  if (!c || count === undefined) return "-";
  if (mode === "total") return String(count);
  return `${(c.games > 0 ? (100 * count) / c.games : 0).toFixed(1)}%`;
}

/** タブごとの列。ファウルの列は、2026-27以降のシーズン（foulSplit）ではTF1・TF2・FLAG・DISR、それ以前ではUFOUL・TF（DESIGN.md 16-8章） */
export function seasonBoxColumnsByTab(foulSplit: boolean): Record<SeasonBoxTabKey, SeasonBoxscoreColumn[]> {
  return {
    traditional: SEASON_TRADITIONAL_COLUMNS,
    advanced: SEASON_ADVANCED_COLUMNS,
    misc: seasonBoxColumnsFor("misc", foulSplit),
    scoring: SEASON_SCORING_COLUMNS,
  };
}

/** アドバンスドカテゴリのみ、SeasonBoxscoreColumnには無いPER・PPP（statDefs.ts、シーズン合計値の
 * みでフィルタ非対応）を追加する。ランキングページが従来から提供していた項目を引き続き
 * 使えるようにするための補完 */
export const EXTRA_ADVANCED_PLAYER_ITEMS: PlayerRankItem[] = PLAYER_STAT_DEFS.filter((d) => d.key === "per" || d.key === "ppp").map(
  (d) => ({
    key: d.key,
    label: d.label,
    higherIsBetter: d.higherIsBetter,
    value: (p: PlayerSummary) => d.value(p),
    format: (p: PlayerSummary) => d.format(p),
  }),
);

/**
 * 「プロフィール」カテゴリの項目（身長・体重・年齢）。値はPlayerSummaryのみで完結し（ctx不要）、
 * シチュエーション別フィルタ・レギュラー/プレーオフ・Q別/前後半の対象外。値が無い選手（マスタ未登録・
 * 生年月日欠損）は0扱いで下位に並べず、ランキングから除外する（rowsのuseMemo参照）。
 * 身長・体重はplayers.jsonの値
 * （終了したシーズンは当時の値。補った値には＊。DESIGN.md 148章）。年齢はageForSeason()
 * （そのシーズンの6月30日か今日（日本時間）の早い方の時点。DESIGN.md 172章）
 */
export function buildProfileItems(season: string): PlayerRankItem[] {
  return [
    {
      key: "height",
      label: "身長",
      value: (p) => p.heightCm ?? 0,
      format: (p) => heightText(p) ?? "-",
    },
    {
      key: "weight",
      label: "体重",
      value: (p) => p.weightKg ?? 0,
      format: (p) => weightText(p) ?? "-",
    },
    {
      key: "age",
      label: "年齢",
      value: (p) => (p.birthDate ? ageForSeason(p.birthDate, season) : 0),
      format: (p) => (p.birthDate ? `${ageForSeason(p.birthDate, season)}歳` : "-"),
    },
  ];
}

/**
 * 「キャリア」カテゴリの項目（DESIGN.md 145章）。値は data/player-careers.json の、選んだシーズンの終了時点までの累計
 * （Bリーグ 2016-17 以降、B1／B.PREMIER の記録だけ）。0 の選手はランキングに並べない（rows の useMemo 参照）。
 * 項目の一覧（CAREER_ITEM_DEFS）はスタッツの条件と共通（src/lib/playerConditionItems.ts）
 */
export function buildCareerItems(careerOf: (p: PlayerSummary) => PlayerCareerCounts | undefined): PlayerRankItem[] {
  return CAREER_ITEM_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    value: (p) => careerOf(p)?.[d.key] ?? 0,
    format: (p) => `${careerOf(p)?.[d.key] ?? 0}${d.unit}`,
  }));
}

export const CAREER_NOTE =
  "回数はBリーグ（2016-17シーズン）以降、B1（B.PREMIER）の記録から数えた、このシーズン終了時点までの累計です（進行中のシーズンは現時点まで）。対象はこのシーズンに登録していた選手です（出場の有無は問いません）";

/**
 * スタッツの条件に使うと、選手の試合ログの読み込みが要る項目（Misc・Scoringのカテゴリにだけある項目）。
 * G・GS・MIN等、複数のカテゴリにある項目はトラディショナル側の扱い（読み込み不要）
 */
export const PLAYER_CONDITION_KEYS_NEEDING_LOGS: ReadonlySet<string> = (() => {
  const seen = new Set<string>();
  const needs = new Set<string>();
  // ファウルの列は、どちらの列の出し方（UFOUL・TF／TF1・TF2・FLAG・DISR）でも読み込みが要る
  for (const foulSplit of [false, true]) {
    for (const tab of SEASON_BOX_TABS) {
      for (const col of seasonBoxColumnsByTab(foulSplit)[tab.key]) {
        if (seen.has(col.key)) continue;
        seen.add(col.key);
        if (tab.key === "misc" || tab.key === "scoring") needs.add(col.key);
      }
    }
  }
  return needs;
})();

/**
 * 選手ランキングのスタッツの条件に選べる項目（DESIGN.md 162章）。今のタブに限らず全カテゴリから選べる。
 * ボックススコアの項目はランキングと同じ1試合平均の値（Q別・シチュエーション別を選んでいればその値）。
 * EFF・PER・PPP・シューティング・プロフィール・キャリアは、ランキングの表示と同じシーズン通算の値
 */
export function buildPlayerConditionDefs(
  season: string,
  mode: PlayerRankMode,
  ctxOf: (p: PlayerSummary, mode: PlayerRankMode) => SeasonBoxscoreCtx | null,
  shootingPerGame: Column<PlayerSummary>[],
  shootingTotal: Column<PlayerSummary>[],
  careerOf: (p: PlayerSummary) => PlayerCareerCounts | undefined,
  doublesOf: (p: PlayerSummary) => DoubleCounts | undefined,
  ddtdOff: boolean,
): StatConditionItemDef<PlayerSummary>[] {
  // 判定は今の平均/合計の値（display）。displayOther は逆のほう（カウント系かの判定に使う。DESIGN.md 179章）
  const other: PlayerRankMode = mode === "total" ? "perGame" : "total";
  const defs: StatConditionItemDef<PlayerSummary>[] = [];
  const columnsByTab = seasonBoxColumnsByTab(foulColumnsSplit([season]));
  for (const tab of SEASON_BOX_TABS) {
    for (const col of columnsByTab[tab.key]) {
      if (col.key === "eff") {
        defs.push({ key: "eff", label: col.label, group: tab.label, display: (p) => effText(p, mode), displayOther: (p) => effText(p, other), seasonTotal: true });
        continue;
      }
      defs.push({
        key: col.key,
        label: col.label,
        group: tab.label,
        display: (p) => {
          const ctx = ctxOf(p, mode);
          return ctx ? col.format(ctx, mode) : "-";
        },
        displayOther: (p) => {
          const ctx = ctxOf(p, other);
          return ctx ? col.format(ctx, other) : "-";
        },
      });
    }
    if (tab.key === "traditional") {
      // Q別/前後半を選んでいるときは値なし（「-」）で、条件に当てはまる選手がいなくなる（DESIGN.md 180章）
      const dd = (p: PlayerSummary, m: PlayerRankMode) => (ddtdOff ? "-" : doubleConditionText(doublesOf(p), doublesOf(p)?.dd, m));
      const td = (p: PlayerSummary, m: PlayerRankMode) => (ddtdOff ? "-" : doubleConditionText(doublesOf(p), doublesOf(p)?.td, m));
      defs.push(
        { key: "dd2", label: "DD2", group: tab.label, display: (p) => dd(p, mode), displayOther: (p) => dd(p, other) },
        { key: "td3", label: "TD3", group: tab.label, display: (p) => td(p, mode), displayOther: (p) => td(p, other) },
      );
    }
    if (tab.key === "advanced") {
      for (const item of EXTRA_ADVANCED_PLAYER_ITEMS) {
        defs.push({ key: item.key, label: item.label, group: tab.label, display: (p) => item.format(p, null), seasonTotal: true });
      }
    }
  }
  const cellText = (c: Column<PlayerSummary>, p: PlayerSummary) => (c.format ? c.format(p) : String(c.sortValue(p)));
  const shootingShown = mode === "total" ? shootingTotal : shootingPerGame;
  const shootingOther = mode === "total" ? shootingPerGame : shootingTotal;
  shootingShown.forEach((c, i) => {
    const o = shootingOther[i];
    defs.push({
      key: c.key,
      label: c.label,
      group: CATEGORY_LABELS.shooting,
      display: (p) => cellText(c, p),
      displayOther: o ? (p) => cellText(o, p) : undefined,
      seasonTotal: true,
    });
  });
  // 出場0試合の選手（Profile の対象に入る。DESIGN.md 173章）は、スタッツの項目を値なし（「-」）とし、条件に当てはまらない扱いにする
  const noGames = (p: PlayerSummary) => p.gamesPlayed === 0;
  const statDefs = defs.map((d) => ({
    ...d,
    display: (p: PlayerSummary) => (noGames(p) ? "-" : d.display(p)),
    displayOther: d.displayOther ? (p: PlayerSummary) => (noGames(p) ? "-" : d.displayOther!(p)) : undefined,
  }));
  return [...statDefs, ...playerProfileConditionDefs(season), ...playerCareerConditionDefs(careerOf)];
}

// 公式の選手ページで身長・体重が載っていない選手は 0 で入っているので、0 も値なしとして並べない（DESIGN.md 173章）
export function profileItemHasValue(p: PlayerSummary, statKey: string): boolean {
  if (statKey === "weight") return !!p.weightKg;
  if (statKey === "age") return !!p.birthDate;
  return !!p.heightCm;
}

/** 選手ランキングのカテゴリ。チーム版・チーム詳細ページ「選手スタッツ」タブと同じ
 * トラディショナル/アドバンスド/Misc/スコアリング（SeasonBoxTabKey）に、シューティングを
 * 追加したもの */
export type PlayerRankCategory = SeasonBoxTabKey | "shooting" | "profile" | "career";

/** 個人ランキングの集計に渡す条件（URL の状態から決まる値）。前シーズン比較では、前季にも同じ形で渡す（DESIGN.md 218章） */
export interface PlayerRankingParams {
  category: PlayerRankCategory;
  statKey: string;
  gamesRatio: number;
  extraThreshold: number;
  /** 登録区分＋ルーキー。ルーキーを選べないシーズンでは、呼び出し側が "all" にして渡す */
  group: PlayerGroupFilter;
  /** そのシーズンのルーキーの選手ID（group が "rookie" のときだけ使う。読み込み前は null） */
  rookieIds: ReadonlySet<string> | null;
  positions: string[];
  filter: SituationalFilter;
  gameType: SeasonGameTypeFilter;
  displayMode: SeasonDisplayMode;
  period: PeriodRangeValue;
  statConditions: StatConditionsState;
}

/**
 * 選手ランキング（シーズン成績）の集計。シーズンを引数に取り、選んだ項目の「行・値の定義・スタッツの条件の項目」までを返す。
 * 今のシーズンの表と、前シーズン比較の前季（DESIGN.md 218章）で同じ処理を使うため、ページから切り出した。
 * enabled が false の間は何も読み込まない（前季は、比較をオンにしたときだけ読む）
 */
export function usePlayerSeasonRanking(
  season: string,
  params: PlayerRankingParams,
  opts: { enabled?: boolean; skipConditionItems?: boolean } = {},
) {
  const enabled = opts.enabled ?? true;
  const { category, statKey, gamesRatio, extraThreshold, group, rookieIds, positions, filter, gameType, displayMode, period, statConditions } = params;
  const rookieActive = group === "rookie";

  // シーズンを切り替えた直後は、読み込み中の間、前のシーズンのデータが残る（useJsonData）。別のシーズンのデータで集計しないよう、どのシーズンのデータかを添えて読み、今のシーズンと一致するときだけ使う
  const { data: playersData, loading: playersFetching, error: playersError } = useJsonData(
    () => (enabled ? fetchPlayers(season).then((list) => ({ season, list })) : Promise.resolve(null)),
    [season, enabled],
  );
  const { data: teamsData } = useJsonData(
    () => (enabled ? fetchTeams(season).then((list) => ({ season, list })) : Promise.resolve(null)),
    [season, enabled],
  );
  const players = playersData?.season === season ? playersData.list : null;
  const teams = teamsData?.season === season ? teamsData.list : null;
  const playersLoading = playersFetching || (enabled && !players && !playersError);
  // USG%・%-shareスタッツ・個人ORtg/DRtgの分母（チーム総計）用に、チーム版ランキングと共通の
  // フックで26チーム分のTeamGameLogを取得する
  const { gameLogsByTeam } = useAllTeamGameLogs(season, enabled ? teams : null);

  const filterActive = !isDefaultFilter(filter);
  const gameTypeActive = gameType !== "regular";
  const periodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === period) ?? SEASON_BOX_PERIOD_OPTIONS[0]!;
  const periodActive = periodOption.periods !== null;
  const conditionKeys = activeStatConditionKeys(statConditions);
  const conditionNeedsLogs = conditionKeys.some((k) => PLAYER_CONDITION_KEYS_NEEDING_LOGS.has(k));
  const conditionNeedsCareers = conditionKeys.some((k) => k.startsWith(CAREER_CONDITION_KEY_PREFIX));

  const { divisionHistory, opponentRecords, playerOwnTeamOf } = useLeagueSituationalContext(season, enabled);

  const [gameLogsState, setGameLogsByPlayer] = useState<{ season: string; map: Map<string, PlayerGameLog[]> } | null>(null);
  const gameLogsByPlayer = gameLogsState?.season === season ? gameLogsState.map : null;
  const [gameLogsLoading, setGameLogsLoading] = useState(false);
  const fetchedPlayerIdsRef = useRef<Set<string>>(new Set());
  // 読み込み中のまとまりの数と、いま対象のシーズン（古いシーズンの読み込みの結果を捨てるため）
  const inFlightLogsRef = useRef(0);
  const seasonLogsRef = useRef(season);

  // 「キャリア」カテゴリを開いたときだけ取得する
  const careersNeeded = enabled && (category === "career" || conditionNeedsCareers);
  const { data: careers, loading: careersLoading } = useJsonData(
    () => (careersNeeded ? fetchPlayerCareers() : Promise.resolve(null)),
    [careersNeeded],
  );
  const careerBySeason = careers?.seasons[season];
  // Profile・Career の対象に加える、試合に一度も名前が無い登録選手（DESIGN.md 173・175章）。どちらかを開いたときだけ取得する
  const registeredTarget = category === "profile" || category === "career";
  const { data: registeredPlayers, loading: registeredLoading } = useJsonData(
    () => (enabled && registeredTarget ? fetchRegisteredPlayers(season) : Promise.resolve(null)),
    [enabled, registeredTarget, season],
  );

  const eligible: PlayerSummary[] = useMemo(() => {
    if (!players || !teams) return [];
    // ルーキーの一覧を読み込むまでは空にする（全員分の試合ログを取りに行かないため）
    if (rookieActive && !rookieIds) return [];
    const positionSet = new Set(positions);
    // Profile・Career: 掲載基準（出場率）を使わず、そのシーズンに登録していた選手全員（出場の有無を問わない。DESIGN.md 173・175章）
    if (registeredTarget) {
      return [...players, ...(registeredPlayers ?? [])].filter(
        (p) => matchesPlayerGroupFilter(p, group, rookieIds) && matchesPositionFilter(p, positionSet),
      );
    }
    const base = filterEligiblePlayers(players, teams, gamesRatio, extraRuleKey(statKey), extraThreshold).filter(
      (p) => matchesPlayerGroupFilter(p, group, rookieIds) && matchesPositionFilter(p, positionSet),
    );
    return category === "shooting" ? base.filter((p) => !!p.shotTypes) : base;
  }, [players, teams, gamesRatio, statKey, extraThreshold, group, positions, rookieActive, rookieIds, category, registeredTarget, registeredPlayers]);

  // シーズンが変わったら取得済みキャッシュをリセットする
  useEffect(() => {
    seasonLogsRef.current = season;
    fetchedPlayerIdsRef.current = new Set();
    setGameLogsByPlayer(null);
  }, [season]);

  // シチュエーション別フィルタ・レギュラー/プレーオフ切替が既定値以外、Misc/スコアリング
  // カテゴリ選択時（PlayByPlays由来の項目のみでシーズン集計に存在しない）、またはQ別/前後半
  // トグル選択時（対象試合のscheduleKey一覧・isHomeを得るのにPlayerGameLogが要る）だけ、
  // 対象選手（掲載基準・国籍区分フィルタ通過後）分のPlayerGameLogを取得する
  // （PlayersListPage.tsxの「全選手スタッツ」タブと同じ遅延取得方針）。出場率スライダー等で
  // 対象選手が増えても、既に取得済みの選手は再取得せず差分だけ追加する
  // シューティング・プロフィール・キャリアのカテゴリでは試合種別・シチュエーション別・Q別/前後半が効かない。
  // そのカテゴリを開いているときにスタッツの条件でボックススコアの項目を使うと、絞り込みの無いシーズンの値で判定する
  const filtersApply = category !== "shooting" && category !== "profile" && category !== "career";
  const effFilter: SituationalFilter = filtersApply ? filter : { range: { kind: "all" } };
  const effGameType: SeasonGameTypeFilter = filtersApply ? gameType : "regular";
  const effPeriodActive = filtersApply && periodActive;
  const needsGameLogRecompute =
    (filtersApply && (filterActive || gameTypeActive || periodActive)) || category === "misc" || category === "scoring" || conditionNeedsLogs;
  useEffect(() => {
    if (!needsGameLogRecompute || eligible.length === 0) return;
    const missing = eligible.filter((p) => !fetchedPlayerIdsRef.current.has(p.playerId));
    if (missing.length === 0) return;
    const fetchSeason = season;
    inFlightLogsRef.current += 1;
    setGameLogsLoading(true);
    for (const p of missing) fetchedPlayerIdsRef.current.add(p.playerId);
    Promise.all(
      missing.map(async (p): Promise<readonly [string, PlayerGameLog[]]> => {
        try {
          return [p.playerId, await fetchPlayerGameLogs(fetchSeason, p.playerId)] as const;
        } catch {
          return [p.playerId, [] as PlayerGameLog[]] as const;
        }
      }),
    )
      .then((results) => {
        // 読み込み中に対象の選手が変わっても（シーズンを切り替えた直後は、選手一覧とチーム一覧が別々に読み込まれて対象が2回変わる）、
        // 読めた分は捨てない（取得済みとして記録しているので、捨てると二度と読まれず、その選手が順位から抜ける）。シーズンが変わったときだけ捨てる
        if (seasonLogsRef.current !== fetchSeason) return;
        setGameLogsByPlayer((prev) => {
          const next = new Map(prev?.season === fetchSeason ? prev.map : []);
          for (const [id, logs] of results) next.set(id, logs);
          return { season: fetchSeason, map: next };
        });
      })
      .finally(() => {
        inFlightLogsRef.current -= 1;
        if (inFlightLogsRef.current === 0) setGameLogsLoading(false);
      });
  }, [needsGameLogRecompute, eligible, season]);

  // USG%・%-shareスタッツ・個人ORtg/DRtgの分母（チーム総計）。gameLogsByTeamから選手側と
  // 同じシチュエーション別フィルタ・レギュラー/プレーオフ条件で組み立てる
  const teamScopes = useMemo<{ totals: Map<string, TeamSeasonRawTotals>; logs: Map<string, TeamGameLog[]> } | null>(() => {
    if (!gameLogsByTeam) return null;
    const totals = new Map<string, TeamSeasonRawTotals>();
    const scopedLogs = new Map<string, TeamGameLog[]>();
    for (const [teamId, logs] of gameLogsByTeam) {
      const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, () => teamId);
      const scoped = filterByGameType(situational, effGameType);
      scopedLogs.set(teamId, scoped);
      totals.set(teamId, sumTeamGameLogsFor(scoped, new Set(scoped.map((g) => g.scheduleKey))));
    }
    return { totals, logs: scopedLogs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameLogsByTeam, filtersApply, filter, gameType, opponentRecords, divisionHistory, season]);
  const teamTotalsByTeamId = teamScopes?.totals ?? null;
  // シーズンの途中で移籍した選手の分母は、条件の有無によらず、条件に当てはまる試合で所属していた各チームの所属期間の合計にする
  // （選手の最新の所属チームだけで割ると、条件に当てはまる試合の外のチームで割ってしまう。DESIGN.md 213・216章）。1チームだけの選手は、所属チームの合計

  // Q別/前後半選択時のみ、対象選手全員分の生データ（StoredGame）を一括取得する。
  // 「試合」選択時はrequestedScheduleKeysが常に空配列のため、useLeagueRawGamesは何も取得しない。
  // gameLogsByPlayerが揃っていない間（fetch中）は一旦空扱いにし、揃い次第再計算される
  const requestedScheduleKeys = useMemo(() => {
    if (!effPeriodActive || !gameLogsByPlayer) return [];
    const keys = new Set<string>();
    for (const p of eligible) {
      const logs = gameLogsByPlayer.get(p.playerId) ?? [];
      const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
      const scoped = filterByGameType(situational, effGameType);
      for (const g of scoped) keys.add(g.scheduleKey);
    }
    return [...keys];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effPeriodActive, gameLogsByPlayer, eligible, filtersApply, filter, gameType, opponentRecords, divisionHistory, season, playerOwnTeamOf]);
  const { gamesByScheduleKey, loading: rawGamesLoading, failedCount: rawGamesFailedCount, retry: retryRawGames } = useLeagueRawGames(season, requestedScheduleKeys);
  const periodDataReady = !effPeriodActive || requestedScheduleKeys.every((k) => gamesByScheduleKey.has(k));

  const seasonStartYear = Number(season.split("-")[0]);
  const ctxByPlayer = useMemo<Map<string, SeasonBoxscoreCtx> | null>(() => {
    if (!teamTotalsByTeamId) return null;
    if (needsGameLogRecompute && !gameLogsByPlayer) return null;
    if (effPeriodActive && !periodDataReady) return null;
    const map = new Map<string, SeasonBoxscoreCtx>();
    for (const p of eligible) {
      if (effPeriodActive) {
        // Q別/前後半: 試合単位で生データから組み立てる（team総計もこの選手が出場した試合の
        // 期間限定値。個人詳細ページのQ別/前後半トグルと同じ設計、DESIGN.md参照）
        const logs = gameLogsByPlayer!.get(p.playerId) ?? [];
        const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
        const scoped = filterByGameType(situational, effGameType);
        const contributions: GamePeriodTotals[] = [];
        for (const log of scoped) {
          const game = gamesByScheduleKey.get(log.scheduleKey);
          if (!game) continue;
          const c = computeGamePeriodTotals(game, log.isHome, p.playerId, periodOption);
          if (c) contributions.push(c);
        }
        const { raw, team } = buildPeriodFilteredRawTotals(contributions);
        map.set(p.playerId, buildSeasonBoxscoreCtx(raw, team, "perGame", seasonStartYear));
        continue;
      }
      let team = teamTotalsByTeamId.get(p.teamId) ?? EMPTY_TEAM_TOTALS;
      if (needsGameLogRecompute) {
        const logs = gameLogsByPlayer!.get(p.playerId) ?? [];
        const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
        const scoped = filterByGameType(situational, effGameType);
        if (teamScopes && playerOwnTeamOf) {
          team = teamTotalsForTransferredPlayer(logs, scoped, playerOwnTeamOf, teamScopes.logs) ?? team;
        }
        map.set(p.playerId, buildSeasonBoxscoreCtx(sumPlayerGameLogs(scoped), team, "perGame", seasonStartYear));
      } else {
        // 試合ログを読まない経路（条件なし）。移籍した選手の分母は、集計済みの値（players.json の transferredTeamTotals）を使う
        map.set(p.playerId, buildSeasonBoxscoreCtx(rawTotalsFromPlayerSummary(p), p.transferredTeamTotals ?? team, "perGame", seasonStartYear));
      }
    }
    return map;
  }, [
    teamTotalsByTeamId,
    teamScopes,
    needsGameLogRecompute,
    gameLogsByPlayer,
    eligible,
    filtersApply,
    filter,
    gameType,
    opponentRecords,
    divisionHistory,
    season,
    playerOwnTeamOf,
    seasonStartYear,
    effPeriodActive,
    periodDataReady,
    periodOption,
    gamesByScheduleKey,
  ]);

  // 試合の条件（地区・勝敗・会場など）で絞っているときは、行に出すクラブを「条件に当てはまる試合で所属していたクラブ。複数あれば、その中の最新のクラブ」にする
  // （シーズンの途中で移籍した選手の行に、条件に当てはまらない最新のクラブが出ないように。DESIGN.md 213章）。条件を付けていないときは、選手の最新の所属のまま
  const conditionedClubByPlayer = useMemo<Map<string, { teamId: string; teamName: string }> | null>(() => {
    if (!filtersApply || !filterActive || !gameLogsByPlayer || !teams || !playerOwnTeamOf) return null;
    const teamNameById = new Map(teams.map((t) => [t.teamId, t.teamName]));
    const map = new Map<string, { teamId: string; teamName: string }>();
    for (const p of eligible) {
      const logs = gameLogsByPlayer.get(p.playerId) ?? [];
      const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
      const scoped = filterByGameType(situational, effGameType);
      let latest: PlayerGameLog | null = null;
      for (const g of scoped) {
        if (!latest || g.date > latest.date || (g.date === latest.date && Number(g.scheduleKey) > Number(latest.scheduleKey))) latest = g;
      }
      const teamId = latest ? playerOwnTeamOf({ scheduleKey: latest.scheduleKey, isHome: latest.isHome }) : undefined;
      const teamName = teamId ? teamNameById.get(teamId) : undefined;
      if (teamId && teamName) map.set(p.playerId, { teamId, teamName });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersApply, filterActive, gameLogsByPlayer, teams, playerOwnTeamOf, eligible, filter, gameType, opponentRecords, divisionHistory, season]);
  const clubOf = (p: PlayerSummary): { teamId: string; teamName: string } => conditionedClubByPlayer?.get(p.playerId) ?? { teamId: p.teamId, teamName: p.teamName };

  // DD2・TD3 の回数と出場試合数（DESIGN.md 179章）。試合ログを読んでいるとき（シチュエーション別・レギュラー/ポストシーズン等）は
  // 絞り込んだ試合（出場した試合）から数え、読んでいないときは players.json のシーズンの値（レギュラーシーズン）を使う。
  // Q別/前後半を選んでも、達成は試合全体で判定する（DESIGN.md 60-4）
  const doublesByPlayer = useMemo(() => {
    const map = new Map<string, DoubleCounts>();
    for (const p of eligible) {
      if (needsGameLogRecompute && gameLogsByPlayer) {
        const logs = gameLogsByPlayer.get(p.playerId) ?? [];
        const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
        const played = filterByGameType(situational, effGameType).filter((g) => g.min > 0);
        const { dd, td } = countDoubleTripleDoubles(played);
        map.set(p.playerId, { dd, td, games: played.length });
      } else {
        map.set(p.playerId, { dd: p.totals.doubleDoubles, td: p.totals.tripleDoubles, games: p.gamesPlayed });
      }
    }
    return map;
    // effFilter・effGameType は filter・gameType・filtersApply から決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, needsGameLogRecompute, gameLogsByPlayer, filtersApply, filter, gameType, opponentRecords, divisionHistory, season, playerOwnTeamOf]);

  // 平均/合計（DESIGN.md 179章）。割合の項目・Profile・Career では切り替えを無効にし、平均として扱う。
  // ctxByPlayer は1試合平均の値なので、合計のときはシーズン合計の値の ctx を作り直す
  // DD2・TD3 は試合全体の記録でしか判定できないため、Q別/前後半を選んでいるときは対象外にする（DESIGN.md 180章）
  const ddtdPeriodOff = effPeriodActive && (statKey === "dd2" || statKey === "td3");
  const modeApplies = displayModeApplies(category, statKey) && !ddtdPeriodOff;
  const rankMode: PlayerRankMode = modeApplies && displayMode === "total" ? "total" : "perGame";
  const totalCtxByPlayer = useMemo(() => {
    if (!ctxByPlayer) return null;
    const map = new Map<string, SeasonBoxscoreCtx>();
    for (const [id, c] of ctxByPlayer) map.set(id, buildSeasonBoxscoreCtx(c.raw, c.team, "total", c.seasonStartYear));
    return map;
  }, [ctxByPlayer]);
  const ctxFor = (p: PlayerSummary, mode: PlayerRankMode) => (mode === "total" ? totalCtxByPlayer : ctxByPlayer)?.get(p.playerId) ?? null;

  // シチュエーション別フィルタで対象試合が0件になった選手は、"0"のまま下位に並べず除外する
  // （旧situationalByPlayerが null を返していたときと同じ扱い）。シューティングカテゴリは
  // 常にシーズン集計（掲載基準通過者全員）をそのまま表示する
  const rows: PlayerSummary[] = useMemo(() => {
    if (category === "profile") return eligible.filter((p) => profileItemHasValue(p, statKey));
    if (category === "career") return eligible.filter((p) => (careerBySeason?.[p.playerId]?.[statKey as keyof PlayerCareerCounts] ?? 0) > 0);
    if (category === "shooting" || !ctxByPlayer) return eligible;
    const played = eligible.filter((p) => (ctxByPlayer.get(p.playerId)?.raw.gamesPlayed ?? 0) > 0);
    // DD2・TD3 は0回（0%）の選手を並べない（平均・合計とも。DESIGN.md 179章）
    if (statKey === "dd2" || statKey === "td3") {
      return played.filter((p) => {
        const c = doublesByPlayer.get(p.playerId);
        return !!c && (statKey === "dd2" ? c.dd : c.td) > 0;
      });
    }
    return played;
  }, [eligible, ctxByPlayer, category, statKey, careerBySeason, doublesByPlayer]);

  const shootingColumns = useMemo(
    () => shotTypeEntityColumns(SHOT_TYPE_DISPLAY_ORDER, (p: PlayerSummary) => p.shotTypes, "perGame", (p) => p.gamesPlayed),
    [],
  );
  const shootingColumnsTotal = useMemo(
    () => shotTypeEntityColumns(SHOT_TYPE_DISPLAY_ORDER, (p: PlayerSummary) => p.shotTypes, "total", (p) => p.gamesPlayed),
    [],
  );
  const currentItems: PlayerRankItem[] = useMemo(() => {
    if (category === "shooting") {
      return (rankMode === "total" ? shootingColumnsTotal : shootingColumns).map((c) => ({
        key: c.key,
        label: c.label,
        higherIsBetter: c.higherIsBetter,
        value: (p: PlayerSummary) => Number(c.sortValue(p)),
        format: (p: PlayerSummary) => (c.format ? c.format(p) : String(c.sortValue(p))),
      }));
    }
    if (category === "profile") return buildProfileItems(season);
    if (category === "career") return buildCareerItems((p) => careerBySeason?.[p.playerId]);
    const items = seasonBoxColumnsByTab(foulColumnsSplit([season]))[category].map((col) => boxColumnItem(col, rankMode));
    if (category === "traditional") return [...items, ...doubleItems((p) => doublesByPlayer.get(p.playerId), rankMode)];
    return category === "advanced" ? [...items, ...EXTRA_ADVANCED_PLAYER_ITEMS] : items;
  }, [category, shootingColumns, shootingColumnsTotal, season, careerBySeason, rankMode, doublesByPlayer]);

  // スタッツの条件（DESIGN.md 162章）。今のタブに限らず全カテゴリの項目で、ランキングに出す行を絞り込む
  const conditionItems = useMemo(
    () =>
      opts.skipConditionItems
        ? []
        : buildStatConditionItems(
            buildPlayerConditionDefs(
              season,
              rankMode,
              (p, mode) => (mode === "total" ? totalCtxByPlayer : ctxByPlayer)?.get(p.playerId) ?? null,
              shootingColumns,
              shootingColumnsTotal,
              (p) => careers?.seasons[season]?.[p.playerId],
              (p) => doublesByPlayer.get(p.playerId),
              effPeriodActive,
            ),
            eligible,
            rankMode,
          ),
    [opts.skipConditionItems, season, rankMode, ctxByPlayer, totalCtxByPlayer, shootingColumns, shootingColumnsTotal, careers, eligible, doublesByPlayer, effPeriodActive],
  );
  const conditionActive = hasActiveStatConditions(statConditions, conditionItems);
  const shownRows = useMemo(
    () => (conditionActive ? filterByStatConditions(rows, statConditions, conditionItems) : rows),
    [conditionActive, rows, statConditions, conditionItems],
  );

  const selectedItem = currentItems.find((i) => i.key === statKey) ?? currentItems[0]!;
  const rankDef: RankableStat<PlayerSummary> = {
    key: selectedItem.key,
    label: selectedItem.label,
    higherIsBetter: selectedItem.higherIsBetter,
    value: (p) => selectedItem.value(p, ctxFor(p, rankMode)),
    format: (p) => selectedItem.format(p, ctxFor(p, rankMode)),
  };

  const waiting =
    !enabled ||
    (needsGameLogRecompute && (gameLogsLoading || !gameLogsByPlayer)) ||
    !teamTotalsByTeamId ||
    !ctxByPlayer ||
    (effPeriodActive && (rawGamesLoading || !periodDataReady)) ||
    (careersNeeded && (careersLoading || !careers)) ||
    (registeredTarget && (registeredLoading || !registeredPlayers));

  return {
    players,
    playersLoading,
    playersError,
    teams,
    eligible,
    rows,
    shownRows,
    selectedItem,
    currentItems,
    rankDef,
    rankMode,
    modeApplies,
    ddtdPeriodOff,
    effPeriodActive,
    periodActive,
    filterActive,
    gameTypeActive,
    periodOption,
    needsGameLogRecompute,
    conditionItems,
    conditionActive,
    conditionKeys,
    clubOf,
    registeredTarget,
    registeredPlayers,
    divisionHistory,
    opponentRecords,
    waiting,
    rawGamesFailedCount: effPeriodActive && !rawGamesLoading ? rawGamesFailedCount : 0,
    retryRawGames,
  };
}
