// シーズン成績のQ別・前後半を、ピリオド別の索引（player-period-index・team-period-index。DESIGN.md 225章）から組み立てる（DESIGN.md 256章の段階0）。
// 以前は試合の生データ（ランキングではそのシーズンの全試合、2025-26 で展開後約600MB）を読んで computeGamePeriodTotals で出していた。
// 索引の値は同じ関数（buildPlayerBoxscores・buildTeamTotalCounts・computeTeamRatings）で作ってあるので、1試合ごとの値（GamePeriodTotals）は生データから出した値と同じになる。
// 違うのは次の2点（256章）:
// - 延長（すべての延長の合計）を選べる。延長は「その選手が延長に出た試合」だけを数える（延長の区間の行がある試合。延長の無い試合・延長に出なかった試合は数えない）
// - 前後半5分の特別な試合（2016-17・2017-18のCS。4試合）は、Q別・前後半のどれにも入れない（225章の決定7。以前は前半に試合全体が入っていた）
// 1Q〜4Q・前半・後半は今までどおり、その試合に出場していれば、その区間に出ていなくても0として数える。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { leagueCacheKey, type League } from "./league";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GAME_FLAG_SHORT, ROW_FLAG_STARTER } from "../../shared/gameIndex";
import { ON_COURT_QUALITY_SHARES } from "../../shared/playerOnCourt";
import {
  PERIOD_ATOMS,
  PERIOD_ROW_FLAG_PLUS_MINUS,
  PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED,
  PLAYER_PERIOD_STAT_COLUMNS,
  PLAYER_PERIOD_ASSIST_POINTS_COLUMN,
  TEAM_PERIOD_COUNT_COLUMNS,
  type PeriodPossKey,
  type PlayerPeriodStatColumn,
  type TeamPeriodIndexFile,
} from "../../shared/periodIndex";
import type { PlayerGameLog, TeamSeasonRawTotals } from "../../shared/types";
import { teamShortName } from "../../shared/teamNames";
import { sumCountsList, type BoxscoreCounts } from "./boxscoreAggregate";
import { fetchTeamPeriodIndex } from "./data";
import type { PlayerGameIndexView, TeamGameIndexView } from "./gameIndex";
import { loadPlayerGameIndex, loadTeamGameIndex } from "./gameIndexLoad";
import { isSubsetPeriod, isSupportedPeriodIndex, PERIOD_ATOM_INDEXES, type GameRecordPeriod, type PlayerPeriodView } from "./periodIndex";
import { CLUTCH_PERIOD } from "../../shared/clutchTime";
import { loadPlayerPeriodIndex } from "./periodIndexLoad";
import type { PeriodRangeOption, PeriodRangeValue } from "./periodRange";
import {
  SEASON_BOX_PERIOD_OPTIONS,
  buildPeriodFilteredRawTotals,
  buildSeasonBoxscoreCtx,
  buildTeamSplitRows,
  type GamePeriodTotals,
  type SeasonBoxscoreCtx,
  type SeasonDisplayMode,
  type TeamSplitRow,
} from "./playerSeasonBoxscore";
import type { GameTeamInfo } from "./situational";

/** クラッチ（第4Q・延長の残り5:00以下で5点差以内。shared/clutchTime.ts。設計書373章）。periods は索引の仮のピリオド番号で、試合の生データにはこの番号のプレーは無い */
export const CLUTCH_PERIOD_OPTION: PeriodRangeOption = { value: "clutch", label: "クラッチ", periods: [CLUTCH_PERIOD] };

/** 延長のピリオド番号（第1延長が5）。生データを使う表（アシストの関係性など）が延長を絞り込むときに使う。10回の延長まで */
const OVERTIME_PERIOD_NUMBERS = Array.from({ length: 10 }, (_, i) => 5 + i);

/** シーズン成績の区間の選択肢: 試合・1Q〜4Q・前半・後半・延長（すべての延長の合計。第1延長・第2延長は分けない。256章の決定1） */
export const SEASON_PERIOD_OPTIONS: PeriodRangeOption[] = [
  ...SEASON_BOX_PERIOD_OPTIONS,
  { value: "ot", label: "延長", periods: OVERTIME_PERIOD_NUMBERS },
  CLUTCH_PERIOD_OPTION,
];

/**
 * クラッチを除いた選択肢。試合の生データ（プレーバイプレー・ショット）をピリオド番号で絞る表（ショットチャート・ラインナップの出場区間など）用。
 * クラッチはピリオド番号では絞れないので、索引から読む表だけで選べる（設計書373章）
 */
export const SEASON_PERIOD_OPTIONS_NO_CLUTCH: PeriodRangeOption[] = SEASON_PERIOD_OPTIONS.filter((o) => o.value !== "clutch");

export function seasonPeriodOption(value: PeriodRangeValue): PeriodRangeOption {
  return SEASON_PERIOD_OPTIONS.find((o) => o.value === value) ?? SEASON_PERIOD_OPTIONS[0]!;
}

/** 延長のランキングの掲載基準: 延長に出た試合の数（256章の決定4） */
export const OVERTIME_MIN_GAMES = 3;
export const OVERTIME_ELIGIBILITY_LABEL = `延長に出た試合が${OVERTIME_MIN_GAMES}試合以上`;
export const OVERTIME_ELIGIBILITY_REASON = `延長は、${OVERTIME_ELIGIBILITY_LABEL}の選手が対象です（出場率などの掲載基準は使いません）。`;
/** Shooting（スポーツナビの記録）はプレーバイプレーと結び付かず、クラッチの判定ができないので出さない（設計書373章。2段階目の候補） */
export const SHOOTING_CLUTCH_UNSUPPORTED_REASON = "Shooting（スポーツナビの記録）は、クラッチでは出せません（Q別・前後半・延長は選べます）。";
/** クラッチのランキングの掲載基準: クラッチに出た試合の数（延長と同じ数。設計書373章） */
export const CLUTCH_ELIGIBILITY_LABEL = `クラッチに出た試合が${OVERTIME_MIN_GAMES}試合以上`;
export const CLUTCH_ELIGIBILITY_REASON = `クラッチは、${CLUTCH_ELIGIBILITY_LABEL}の選手が対象です（出場率などの掲載基準は使いません）。`;
/** 延長・クラッチの掲載基準の表示（それ以外の区間は null） */
export function subsetEligibilityLabel(period: string): string | null {
  return period === "ot" ? OVERTIME_ELIGIBILITY_LABEL : period === "clutch" ? CLUTCH_ELIGIBILITY_LABEL : null;
}
export function subsetEligibilityReason(period: string): string | null {
  return period === "ot" ? OVERTIME_ELIGIBILITY_REASON : period === "clutch" ? CLUTCH_ELIGIBILITY_REASON : null;
}
/** 延長の平均の分母の説明（表の下の注記） */
export const OVERTIME_GAMES_NOTE = "延長は、延長に出た試合だけで割っています（すべての延長の合計）。";
/** 前後半5分の特別な試合の注記（2016-17・2017-18 のときだけ出す） */
export const SHORT_GAMES_PERIOD_NOTE = "前後半5分の特別な試合（チャンピオンシップ）は、クォーターが無いため、Q別・前後半には含めていません。";
export function hasShortGameSeason(seasons: readonly string[]): boolean {
  return seasons.some((s) => s === "2016-17" || s === "2017-18");
}

/** 公式にボックススコアが無く、試合合計だけを入れた試合（2017-18 の1810）の注記。区間の記録が無いので Q別・前後半には含めない */
export const MANUAL_BOXSCORE_PERIOD_NOTE =
  "2017-18の1試合（2018年1月1日 A東京-千葉）は、公式にボックススコアが無く試合合計だけを入れているため、Q別・前後半には含めていません。";
export function hasManualBoxscoreSeason(seasons: readonly string[]): boolean {
  return seasons.includes("2017-18");
}

/** 1シーズン分の索引（選手の1試合行・選手のピリオド別・チームの1試合行・チームのピリオド別）と、引くための表 */
export interface SeasonPeriodSource {
  season: string;
  player: PlayerGameIndexView;
  period: PlayerPeriodView;
  team: TeamGameIndexView;
  teamPeriod: TeamPeriodIndexFile;
  /** `${選手ID}|${scheduleKey}` → 選手の1試合行の番号 */
  rowByPlayerGame: Map<string, number>;
  /** scheduleKey → チームの1試合行の試合の番号（チームの行の位置は 番号×2＋〔ホーム 0／アウェイ 1〕） */
  teamGameNo: Map<string, number>;
  /** 前後半5分の特別な試合の scheduleKey */
  shortGames: Set<string>;
}

const sourceCache = new Map<string, Promise<SeasonPeriodSource | null>>();

/** 1シーズン分の索引を読む。どれかが無い・版や行数が合わないときは null（呼び出し側は読めなかったことを出す）。失敗は持たず、次の呼び出しでやり直す */
export function loadSeasonPeriodSource(season: string, league: League = "premier"): Promise<SeasonPeriodSource | null> {
  const key = leagueCacheKey(season, league);
  let p = sourceCache.get(key);
  if (!p) {
    p = (async () => {
      const [player, team, teamPeriod] = await Promise.all([loadPlayerGameIndex(season, league), loadTeamGameIndex(season, league), fetchTeamPeriodIndex(season, league)]);
      if (!player || !team || !teamPeriod || !isSupportedPeriodIndex(teamPeriod) || teamPeriod.indexRows !== team.size) return null;
      const period = await loadPlayerPeriodIndex(player, league);
      if (!period) return null;
      const { rows, games, players } = player.file;
      const rowByPlayerGame = new Map<string, number>();
      for (let i = 0; i < rows.player.length; i++) {
        rowByPlayerGame.set(`${players[rows.player[i]!]![0]}|${games.key[rows.game[i]!]}`, i);
      }
      const teamGameNo = new Map<string, number>();
      const shortGames = new Set<string>();
      team.file.games.key.forEach((key, i) => {
        teamGameNo.set(key, i);
        if ((team.file.games.flags[i]! & GAME_FLAG_SHORT) !== 0) shortGames.add(key);
      });
      return { season, player, period, team, teamPeriod, rowByPlayerGame, teamGameNo, shortGames };
    })();
    p.then((v) => v ?? sourceCache.delete(key), () => sourceCache.delete(key));
    sourceCache.set(key, p);
  }
  return p;
}

/** 0の BoxscoreCounts。sumCountsList([]) は boxscoreAggregate.ts の定数そのものを返すので、書き換えないよう必ず写しを作る */
function zeroCounts(): BoxscoreCounts {
  return { ...sumCountsList([]) };
}

/** 選手の索引の列の合計を、BoxscoreCounts（buildPeriodFilteredRawTotals が読む項目）に直す */
function playerCountsOf(sum: Record<PlayerPeriodStatColumn, number>, hasPlusMinus: boolean): BoxscoreCounts {
  return {
    ...zeroCounts(),
    minSec: sum.minSec,
    pts: sum.pts,
    pt2m: sum.fgm - sum.tpm,
    pt2a: sum.fga - sum.tpa,
    pt3m: sum.tpm,
    pt3a: sum.tpa,
    ftm: sum.ftm,
    fta: sum.fta,
    oreb: sum.oreb,
    dreb: sum.dreb,
    treb: sum.reb,
    ast: sum.ast,
    tov: sum.tov,
    stl: sum.stl,
    blk: sum.blk,
    bson: sum.blockedAgainst,
    foul: sum.pf,
    foulon: sum.foulsDrawn,
    plusMinus: sum.plusMinus,
    hasPlusMinus,
    pt2in: sum.pt2in,
    ptfb: sum.ptfb,
    pt2nd: sum.pt2nd,
    ptsOffTov: sum.ptsOffTov,
    dunks: sum.dunks,
    basketCounts: sum.basketCounts,
    technicalFouls: sum.technicalFouls,
    unsportsmanlikeFouls: sum.unsportsmanlikeFouls,
    disqualifyingFouls: sum.disqualifyingFouls,
    offensiveFoulsCommitted: sum.offensiveFoulsCommitted,
    chargesDrawn: sum.chargesDrawn,
    assisted2m: sum.assisted2m,
    assisted3m: sum.assisted3m,
    assistedFtm: sum.assistedFtm,
    paint2m: sum.paint2m,
    paint2a: sum.paint2a,
    nonPaint2m: sum.mid2m,
    nonPaint2a: sum.mid2a,
  };
}

/** チームの索引の行（位置 r）の、区間の値の合計。値の無い区間（-1）しかなければ null */
function teamCountsOf(file: TeamPeriodIndexFile, r: number, atoms: readonly number[]): BoxscoreCounts | null {
  const c = zeroCounts() as unknown as Record<string, number>;
  let found = false;
  for (const a of atoms) {
    const atom = PERIOD_ATOMS[a]!;
    const pts = file.rows.counts[`${atom}.pts`]?.[r];
    if (pts === undefined || pts < 0) continue;
    found = true;
    for (const col of TEAM_PERIOD_COUNT_COLUMNS) c[col] = (c[col] ?? 0) + (file.rows.counts[`${atom}.${col}`]?.[r] ?? 0);
  }
  return found ? (c as unknown as BoxscoreCounts) : null;
}

/**
 * 選手の1試合の、区間の値（自身・自チーム・相手・ポゼッション。computeGamePeriodTotals と同じ形）。
 * その試合に出場していない・特別な試合・延長に出ていない（延長のとき）は null（数えない）
 */
export function seasonPeriodTotalsOf(
  source: SeasonPeriodSource,
  playerId: string,
  scheduleKey: string,
  isHome: boolean,
  value: PeriodRangeValue,
): GamePeriodTotals | null {
  if (value === "all" || source.shortGames.has(scheduleKey)) return null;
  const atoms = PERIOD_ATOM_INDEXES[value as GameRecordPeriod];
  if (!atoms) return null;
  const i = source.rowByPlayerGame.get(`${playerId}|${scheduleKey}`);
  const g = source.teamGameNo.get(scheduleKey);
  if (i === undefined || g === undefined) return null;
  const sum = {} as Record<PlayerPeriodStatColumn, number>;
  for (const c of PLAYER_PERIOD_STAT_COLUMNS) sum[c] = 0;
  let found = false;
  let hasPlusMinus = false;
  // 出場中の割合の材料（372章から全シーズンの索引が持つ列。古い索引には無い。割合の品質ビットが立たない試合・値の無い行は持たせない）
  const oc = { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, fgAssists: 0 };
  let ocOk = source.period.file.rows.stats["ocQuality"] !== undefined;
  // ポイントクリエイトの材料（本人のアシストから生まれた得点。古い索引には無い。値が -1 の行はプレーバイプレーの無い試合。DESIGN.md 333章）
  const apColumn = source.period.file.rows.stats[PLAYER_PERIOD_ASSIST_POINTS_COLUMN];
  let apOk = apColumn !== undefined;
  let assistPoints = 0;
  const from = source.period.start[i]!;
  if (from !== -1) {
    const { stats, period: periods, flags } = source.period.file.rows;
    for (let k = from; k < source.period.end[i]!; k++) {
      if (!atoms.includes(periods[k]!)) continue;
      found = true;
      if (ocOk) {
        const q = stats["ocQuality"]![k]!;
        if (q < 0 || (q & ON_COURT_QUALITY_SHARES) === 0) ocOk = false;
        else {
          for (const key of ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta"] as const) oc[key] += stats[`ocOwn.${key}`]![k]!;
          oc.fgAssists += stats["fgAssists"]![k]!;
        }
      }
      if (apOk) {
        const v = apColumn![k]!;
        if (v < 0) apOk = false;
        else assistPoints += v;
      }
      const officialPm = (flags[k]! & (PERIOD_ROW_FLAG_PLUS_MINUS | PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED)) !== 0;
      if (officialPm) hasPlusMinus = true;
      // 公式の値（2022-23以降）か、復元の値（2016-17〜2021-22。PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED）のある行の plusMinus だけ足す
      for (const c of PLAYER_PERIOD_STAT_COLUMNS) if (c !== "plusMinus" || officialPm) sum[c] += stats[c][k]!;
    }
  }
  if (isSubsetPeriod(value) && !found) return null;
  // クラッチの被ファウルは「値なし」（画面は「-」。periodIndex.ts の periodGameAt と同じ。設計書373章）
  if (value === "clutch") sum.foulsDrawn = Number.NaN;
  const ownRow = g * 2 + (isHome ? 0 : 1);
  const oppRow = g * 2 + (isHome ? 1 : 0);
  const own = teamCountsOf(source.teamPeriod, ownRow, atoms);
  const opp = teamCountsOf(source.teamPeriod, oppRow, atoms);
  if (!own || !opp) return null;
  const poss = source.teamPeriod.rows.poss[value as PeriodPossKey]?.[ownRow] ?? 0;
  const isStarter = (source.player.file.rows.flags[i]! & ROW_FLAG_STARTER) !== 0;
  return {
    player: playerCountsOf(sum, hasPlusMinus),
    own,
    opp,
    poss: poss < 0 ? 0 : poss,
    isStarter,
    ...(ocOk && found ? { onCourt: oc } : {}),
    // 区間に記録の無い試合（その区間に出ていない）は 0 として数える（G と同じ試合）
    ...(apOk ? { assistPoints } : {}),
  };
}

/** 延長（クラッチ）に出た試合が基準以上の選手の選手ID（シーズン全体・試合区分を問わない） */
export function overtimeCandidates(source: SeasonPeriodSource, minGames: number, atom: "ot" | "clutch" = "ot"): Set<string> {
  const otAtom = PERIOD_ATOMS.indexOf(atom);
  const counts = new Map<number, number>();
  const { player: pv, period } = source;
  for (let i = 0; i < pv.size; i++) {
    const from = period.start[i]!;
    if (from === -1) continue;
    for (let k = from; k < period.end[i]!; k++) {
      if (period.file.rows.period[k] === otAtom) {
        const p = pv.file.rows.player[i]!;
        counts.set(p, (counts.get(p) ?? 0) + 1);
        break;
      }
    }
  }
  const ids = new Set<string>();
  for (const [p, n] of counts) if (n >= minGames) ids.add(pv.file.players[p]![0]);
  return ids;
}

const EMPTY_SOURCES: ReadonlyMap<string, SeasonPeriodSource | null> = new Map();

/**
 * 複数シーズンの索引を読む（Q別・前後半を選んでいるときだけ。enabled が false の間は読まない）。
 * sources はシーズン → 索引（読めなかったシーズンは null）。failedSeasons は読めなかったシーズン。retry() で読めなかったシーズンを読み直す
 */
export function useSeasonPeriodSources(
  seasons: readonly string[],
  enabled: boolean,
  league: League = "premier",
): { sources: ReadonlyMap<string, SeasonPeriodSource | null>; loading: boolean; failedSeasons: string[]; retry: () => void } {
  // 読み込んだ索引は、どのリーグのものかを添えて持つ（同じシーズンで B.PREMIER と B.ONE を切り替えても、別のリーグの索引を使わない）
  const [store, setStore] = useState<{ league: League; map: ReadonlyMap<string, SeasonPeriodSource | null> }>({ league, map: new Map() });
  const sources = store.league === league ? store.map : EMPTY_SOURCES;
  const [retryNonce, setRetryNonce] = useState(0);
  const requestedRef = useRef<{ league: League; seasons: Set<string> }>({ league, seasons: new Set() });
  const latestLeagueRef = useRef(league);
  latestLeagueRef.current = league;
  const key = seasons.join("|");
  useEffect(() => {
    if (!enabled) return;
    if (requestedRef.current.league !== league) requestedRef.current = { league, seasons: new Set() };
    const requested = requestedRef.current.seasons;
    const missing = seasons.filter((s) => !requested.has(s));
    if (missing.length === 0) return;
    for (const s of missing) requested.add(s);
    // 読み込みの途中で条件が変わっても、読めた分は捨てない（シーズンごとに持つので、ほかの条件の表とぶつからない。
    // 捨てると、要求済みのまま二度と読まれず「読み込み中」で止まる）。ただし、読み込み中にリーグが変わったときは、前のリーグの結果を捨てる
    void Promise.all(missing.map((s) => loadSeasonPeriodSource(s, league).then((v) => [s, v] as const, () => [s, null] as const))).then((loaded) => {
      if (latestLeagueRef.current !== league) return;
      setStore((prev) => {
        const next = new Map(prev.league === league ? prev.map : []);
        for (const [s, v] of loaded) next.set(s, v);
        return { league, map: next };
      });
      // 読めなかったシーズンは、retry() でもう一度読めるように要求済みから外す
      for (const [s, v] of loaded) if (!v) requested.delete(s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, retryNonce, league]);
  const loading = enabled && seasons.some((s) => !sources.has(s));
  const failedSeasons = useMemo(() => (enabled ? seasons.filter((s) => sources.has(s) && sources.get(s) === null) : []), [enabled, key, sources]); // eslint-disable-line react-hooks/exhaustive-deps
  const retry = useCallback(() => {
    setStore((prev) => ({ league: prev.league, map: new Map([...prev.map].filter(([, v]) => v !== null)) }));
    setRetryNonce((n) => n + 1);
  }, []);
  return { sources, loading, failedSeasons, retry };
}

/**
 * 1人の選手の、ある範囲の試合（logs）の区間の値から、シーズン成績の表の1行分（ctx）を作る。
 * 行の分け方（所属チーム別・対戦相手別など）は呼び出し側が決め、その1行に入る試合だけを渡す
 * （チーム詳細の選手スタッツ・個人詳細のシーズン別成績／シチュエーション別成績・選手詳細の対戦相手別で使い回す）。
 * 区間の値がある試合（延長は延長に出た試合）が1つも無いとき・索引が読めていないときは null（その行を出さない）
 */
export function buildPeriodCtxForLogs(
  logs: readonly PlayerGameLog[],
  playerId: string,
  period: PeriodRangeValue,
  source: SeasonPeriodSource | null | undefined,
  displayMode: SeasonDisplayMode,
  seasonStartYear: number,
): SeasonBoxscoreCtx | null {
  if (!source) return null;
  const contributions = logs
    .map((log) => seasonPeriodTotalsOf(source, playerId, log.scheduleKey, log.isHome, period))
    .filter((c): c is GamePeriodTotals => c !== null);
  if (contributions.length === 0) return null;
  const { raw, team } = buildPeriodFilteredRawTotals(contributions);
  return buildSeasonBoxscoreCtx(raw, team, displayMode, seasonStartYear);
}

/**
 * buildTeamSplitRowsForPeriod（playerSeasonBoxscore.ts。保存キーの対象なので変えない）の、索引版。
 * 「試合」のときは buildTeamSplitRows にそのまま任せ、区間のときは試合ごとに seasonPeriodTotalsOf の値を合算する。行の分け方（所属チームごと＋「複数チーム」）は同じ
 */
export function buildTeamSplitRowsFromPeriodSource(
  keyPrefix: string,
  logs: PlayerGameLog[],
  ownTeamByScheduleKey: Map<string, GameTeamInfo>,
  teamTotalsByTeamId: Map<string, TeamSeasonRawTotals>,
  displayMode: SeasonDisplayMode,
  seasonStartYear: number,
  playerId: string,
  period: PeriodRangeValue,
  source: SeasonPeriodSource | null | undefined,
): TeamSplitRow[] {
  if (period === "all") {
    return buildTeamSplitRows(keyPrefix, logs, ownTeamByScheduleKey, teamTotalsByTeamId, displayMode, seasonStartYear);
  }
  const played = logs.filter((g) => g.min > 0);
  if (played.length === 0 || !source) return [];

  // 延長は、延長に出た試合が無い行を出さない（行の試合数が0になるため）
  const byTeam = new Map<string, { teamName: string; logs: PlayerGameLog[] }>();
  for (const log of played) {
    const own = ownTeamByScheduleKey.get(log.scheduleKey);
    const id = own?.teamId ?? "unknown";
    let entry = byTeam.get(id);
    if (!entry) {
      entry = { teamName: own?.teamName ?? "", logs: [] };
      byTeam.set(id, entry);
    }
    entry.logs.push(log);
  }
  const labelFor = (id: string, teamName: string) => (id === "unknown" ? "-" : teamShortName(id, teamName));
  const ctxOf = (teamLogs: PlayerGameLog[]) => buildPeriodCtxForLogs(teamLogs, playerId, period, source, displayMode, seasonStartYear);
  const teamRows = [...byTeam].flatMap(([id, entry]) => {
    const ctx = ctxOf(entry.logs);
    if (!ctx) return [];
    return [{ key: `${keyPrefix}|${id}`, teamId: id === "unknown" ? null : id, teamLabel: labelFor(id, entry.teamName), ctx, logs: entry.logs, isCombined: false }];
  });
  if (byTeam.size === 1) return teamRows;
  const all = ctxOf(played);
  if (!all) return [];
  return [...teamRows, { key: `${keyPrefix}|combined`, teamId: null, teamLabel: "複数チーム", ctx: all, logs: played, isCombined: true }];
}

/** 複数の試合の区間の値を合算した raw（シーズン別成績の通算行など）。読めていないシーズンの試合は数えない */
export function periodRawTotalsFromSources(
  logs: { season: string; log: PlayerGameLog }[],
  playerId: string,
  period: PeriodRangeValue,
  sources: ReadonlyMap<string, SeasonPeriodSource | null>,
) {
  const contributions = logs
    .map(({ season, log }) => {
      const source = sources.get(season);
      return source ? seasonPeriodTotalsOf(source, playerId, log.scheduleKey, log.isHome, period) : null;
    })
    .filter((c): c is GamePeriodTotals => c !== null);
  return buildPeriodFilteredRawTotals(contributions);
}
