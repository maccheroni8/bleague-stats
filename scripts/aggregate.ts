// data/{season}/games/*.json（生データ）から teams.json / players.json を再生成する。
// 生データを正とし、集計は都度作り直す（DESIGN.md 5章）。ティアAの基本＋一部アドバンスドスタッツが対象。
//
// 使い方:
//   npm run aggregate -- --season 2025-26                # B.PREMIER（従来通り、data/{season}/配下）
//   npm run aggregate -- --season 2025-26 --category one # B.ONE（data/{season}/one/配下。DESIGN.md 14章）

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { DATA_DIR, gamesDir, readAllGames, readJson, seasonDirName, writeJson } from "./lib/storage.ts";
import {
  eff,
  efgPct,
  estimatedPossessions,
  finalizePer,
  ftRate,
  individualOffRtg,
  offensiveRating,
  orbPct,
  pace,
  parsePlayTime,
  perConstants,
  safeDiv,
  tovPct,
  tsPct,
  uPer,
  usagePct,
  type OliverBoxStats,
  type PerLeagueTotals,
} from "../shared/formulas.ts";
import {
  computeOnCourtRatings,
  reconstructOnCourt,
  substitutionModelForSeason,
  type OnCourtReconstruction,
  type PlayerOnCourtRatings,
} from "../shared/onCourt.ts";
import { foreignCountInLineup } from "../shared/foreignOnCourt.ts";
import { computePointsOffTurnovers } from "../shared/pointsOffTurnovers.ts";
import { computeFastbreakPoints, computePointsInPaint, computeSecondChancePoints } from "../shared/playTypePoints.ts";
import { computeAssistedScoring, type AssistedScoringCounts } from "../shared/assistedScoring.ts";
import { buildShotEvents, paintSplitForShot } from "../shared/shotChart.ts";
import { TEAM_NAMES, teamDivisionForSeason } from "./lib/divisions.ts";
import { computePremierRace, premierChampion, type RaceTeamInput } from "./lib/playoffRace.ts";
import { seasonCoverage } from "./lib/seasonCoverage.ts";
import { isExhibitionGame } from "./lib/exhibitionGames.ts";
import { classifyGameType } from "./lib/gameType.ts";
import type {
  BoxscoreRow,
  Category,
  Division,
  DivisionHistoryFile,
  GameSummary,
  GameType,
  HeadToHeadRecord,
  HeadToHeadTeamRow,
  LineupAggregate,
  PlayByPlayEvent,
  PlayerGameLog,
  PlayerMasterEntry,
  PlayoffRaceFile,
  ScheduleFile,
  SeasonEntry,
  SeasonPositionsFile,
  StandingsSnapshot,
  StandingsTeamSnapshot,
  ShotTypeBreakdown,
  StoredGame,
  TeamForcedTurnovers,
  TeamGameLog,
  TeamLineupsFile,
  YahooGamePbp,
  YahooShotEvent,
  YahooTurnoverEvent,
} from "../shared/types.ts";
import { isMainModule } from "./lib/isMain.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;

/**
 * そのシーズンに実際の試合データ（games/配下に.json.gzが1件以上）があるか確認する。
 * data/{season}/ディレクトリ自体はscrape-schedule.tsが開幕前から日程だけ先行収集するため
 * シーズン開始前でも存在しうる（2026-08時点の2026-27シーズンで実際に発生）。ディレクトリの
 * 存在有無だけでseasons.jsonに載せると、試合が1件も無い「開幕前の次シーズン」が
 * 文字列ソートの末尾＝「最新シーズン」としてフロントエンドのデフォルト値解決
 * （src/App.tsxのAppShell）に誤って採用されてしまう（2026-08-18に発覚した不具合）
 */
function seasonHasGames(season: string): boolean {
  const dir = gamesDir(season);
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".json.gz"));
}

/**
 * 開幕前でも、scrape-schedule.tsが先行収集した日程（schedule.jsonのscheduleKeys/
 * upcomingGames）が1件以上あるか。日程ページでシーズン選択できるようにするため、
 * seasonHasGames()がfalseの開幕前シーズンでもこちらがtrueならseasonsFileに含める
 * （hasCompletedGames: falseとして。DESIGN.md参照）
 */
async function seasonHasSchedule(season: string): Promise<boolean> {
  const file = await readJson<ScheduleFile>(path.join(DATA_DIR, seasonDirName(season), "schedule.json"));
  if (!file) return false;
  return file.scheduleKeys.length > 0 || file.upcomingGames.length > 0;
}

/** data/{season}/yahoo/配下に実際に取得済みのYahoo PBPファイルが1件以上あるか（DESIGN.md参照） */
function seasonHasYahooPbp(season: string): boolean {
  const dir = path.join(DATA_DIR, season, "yahoo");
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => f.endsWith(".json.gz") && f !== "_validation-report.json.gz");
}

function emptyForcedTurnovers(): TeamForcedTurnovers {
  return {
    gamesWithData: 0,
    offensiveFoul: 0,
    violation24sec: 0,
    backcourtViolation: 0,
    violation5sec: 0,
    violation8sec: 0,
    otherDead: 0,
    live: 0,
  };
}

/**
 * Yahoo!スポーツplay-by-playのターンオーバーイベントを、相手に強制した種類別カウントの
 * バケットに分類する（scripts/lib/yahooPbp.tsのLIVE/DEAD_TURNOVER_SUBTYPESと同じ語彙、
 * TeamForcedTurnoversの5主要種別＋その他デッド/ライブに集約する。DESIGN.md参照。
 * 8秒バイオレーションは全2,274試合中265試合・288件確認済みで、実在するタグ）
 */
function classifyForcedTurnover(to: YahooTurnoverEvent): keyof Omit<TeamForcedTurnovers, "gamesWithData"> {
  if (to.ballType === "live") return "live";
  switch (to.subtypeRaw) {
    case "オフェンスファウル":
      return "offensiveFoul";
    case "24秒バイオレーション":
      return "violation24sec";
    case "バックコート":
      return "backcourtViolation";
    case "5秒バイオレーション":
    case "5秒チームバイオレーション":
      return "violation5sec";
    case "8秒バイオレーション":
      return "violation8sec";
    default:
      return "otherDead";
  }
}

/**
 * シーズン中の各試合について、取得済みのYahoo PBPデータ（data/{season}/yahoo/{scheduleKey}.json）
 * があれば読み込み、チーム単位でターンオーバーの種類別カウントを両方向で積算する
 * （Phase H6）。B.ONE等ではYahoo PBPデータ自体が存在しないため、呼び出し側で
 * category==="premier"の時のみ呼ぶ想定（未取得試合は静かにスキップし、gamesWithDataで
 * 実際にカバーできた試合数を残す）
 * - forced: 相手に強制した＝相手から奪ったターンオーバー（自チームのディフェンス成果）
 * - committed: 自チームが犯した＝相手に強制されたターンオーバー（自チームのオフェンス課題）
 */
async function buildForcedTurnoversByTeam(
  season: string,
  games: StoredGame[],
): Promise<{ forced: Map<string, TeamForcedTurnovers>; committed: Map<string, TeamForcedTurnovers> }> {
  const forced = new Map<string, TeamForcedTurnovers>();
  const committed = new Map<string, TeamForcedTurnovers>();
  const ensure = (byTeam: Map<string, TeamForcedTurnovers>, teamId: string): TeamForcedTurnovers => {
    let t = byTeam.get(teamId);
    if (!t) {
      t = emptyForcedTurnovers();
      byTeam.set(teamId, t);
    }
    return t;
  };
  // teams.jsonの他フィールド（totals等）と同じくレギュラーシーズンのみを対象にする
  // （processTeams()がgameType==="regular"のみ加算するのと同じ方針）
  const regularGames = games.filter((g) => classifyGameType(g.raw.Game.ConventionNameJ) === "regular");
  for (const game of regularGames) {
    const pbp = await readJson<YahooGamePbp>(path.join(DATA_DIR, season, "yahoo", `${game.scheduleKey}.json`));
    if (!pbp) continue;
    for (const byTeam of [forced, committed]) {
      ensure(byTeam, game.homeTeam.id).gamesWithData += 1;
      ensure(byTeam, game.awayTeam.id).gamesWithData += 1;
    }
    for (const to of pbp.turnovers) {
      // toの主体（teamId）はターンオーバーを犯した側＝相手にとっての「強制した」側は対戦相手の方
      const forcingTeamId = to.teamId === game.homeTeam.id ? game.awayTeam.id : game.homeTeam.id;
      const bucket = classifyForcedTurnover(to);
      ensure(forced, forcingTeamId)[bucket] += 1;
      ensure(committed, to.teamId)[bucket] += 1;
    }
  }
  return { forced, committed };
}

/** buildShotTypeBreakdownsの内部ヘルパー。1本のショットをキー（playerIdまたはteamId）単位の内訳に加算する */
function accumulateShotType(byKey: Map<string, ShotTypeBreakdown>, key: string, shot: YahooShotEvent): void {
  const breakdown = byKey.get(key) ?? {};
  const split = breakdown[shot.shotType] ?? {
    twoPoint: { made: 0, attempted: 0 },
    threePoint: { made: 0, attempted: 0 },
  };
  const counts = shot.shotValue === 3 ? split.threePoint : split.twoPoint;
  counts.attempted += 1;
  if (shot.made) counts.made += 1;
  breakdown[shot.shotType] = split;
  byKey.set(key, breakdown);
}

/**
 * シュートタイプ別の成功/試投カウントを選手ごと・チームごとにシーズン集計する（Yahoo!スポーツ
 * play-by-play由来、レギュラーシーズンのみ・取得済み試合のみ。DESIGN.md参照）。teams.jsonの
 * forcedTurnoversと同じく、B.ONE等（Yahoo PBPデータ自体が存在しない）では
 * category==="premier"の時のみ呼ぶ想定。チーム集計（byTeam）はplayer.jsonのshotTypesと同じ
 * データを選手単位ではなくteamId単位で合算したもの（TeamSummary.shotTypes用）
 */
async function buildShotTypeBreakdowns(
  season: string,
  games: StoredGame[],
): Promise<{ byPlayer: Map<string, ShotTypeBreakdown>; byTeam: Map<string, ShotTypeBreakdown> }> {
  const byPlayer = new Map<string, ShotTypeBreakdown>();
  const byTeam = new Map<string, ShotTypeBreakdown>();
  const regularGames = games.filter((g) => classifyGameType(g.raw.Game.ConventionNameJ) === "regular");
  for (const game of regularGames) {
    const pbp = await readJson<YahooGamePbp>(path.join(DATA_DIR, season, "yahoo", `${game.scheduleKey}.json`));
    if (!pbp) continue;
    for (const shot of pbp.shots) {
      if (!shot.shotType) continue;
      accumulateShotType(byTeam, shot.teamId, shot);
      if (shot.playerId) accumulateShotType(byPlayer, shot.playerId, shot);
    }
  }
  return { byPlayer, byTeam };
}

/**
 * data/配下に存在する、かつ実際の試合データ（または開幕前の先行収集済み日程）がある
 * シーズンディレクトリを走査してdata/seasons.jsonを再生成する。どのシーズンをaggregateしても
 * 全シーズン分を書き直す（冪等）ため、専用の実行手順は不要。
 *
 * 確定済み試合が1件も無い開幕前シーズンも、schedule.jsonに日程が先行登録されていれば
 * （scrape-schedule.tsの仕様。DESIGN.md参照）含める（日程ページでシーズン選択できるように
 * するため）。ただし`hasCompletedGames: false`として区別し、src/App.tsxの「?season=未指定時の
 * デフォルトシーズン」解決はこのフラグがtrueの最新シーズンを使う（23章のバグの再発防止）。
 */
async function regenerateSeasonsFile(): Promise<void> {
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
  const seasons: string[] = [];
  for (const season of candidates) {
    if (seasonHasGames(season) || (await seasonHasSchedule(season))) seasons.push(season);
  }
  const seasonsFile: SeasonEntry[] = seasons.map((season) => ({
    season,
    coverage: seasonCoverage(season),
    yahooPbp: seasonHasYahooPbp(season),
    hasCompletedGames: seasonHasGames(season),
  }));
  await writeJson(path.join(DATA_DIR, "seasons.json"), seasonsFile);
}

interface StatTotals {
  gamesPlayed: number;
  gamesStarted: number;
  min: number;
  pts: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  /** ファウルドローン（相手にファウルを誘発した回数）。EFF計算のFDに対応 */
  foulsDrawn: number;
  /** 被ブロック数。EFF計算のBSRに対応 */
  blockedAgainst: number;
  /**
   * 推定ポゼッション。生データのチーム行に公式POSS値がある試合（fullティア、2022-23シーズン
   * 以降）はその値を、無い試合（pbpNoShotChartティア、2022-23シーズンより前）は
   * gamePossession()でformulas.tsのestimatedPossessions()を試合単位で適用した推定値を、
   * それぞれ試合ごとに合算する（シーズン合計値に対して式を再適用すると比率項の非線形性で
   * 誤差が出るため、必ず試合単位で確定させた値を合算する方針を踏襲する）。
   * 個人行にはPOSSが存在しないため選手集計では常に0のまま
   */
  poss: number;
  /**
   * 個人+/-。生データのPLUSMINUS値をそのまま合算する（Bリーグ公式フィールド。DESIGN.md 2-2章で
   * フィールドの存在自体は確認済みだったが未活用だった。POSS等と同様、算出ロジックの
   * 再実装は不要）。チーム合計行（Category=3）にはPLUSMINUSが存在しないため
   * チーム集計では常に0のまま
   */
  plusMinus: number;
  /**
   * 出場した試合における「その試合のチーム得失点差」の合計（オンコート/オフコート純得失点の
   * 算出用アキュムレータ。個人+/-＝オンコート純得失点そのものなので、この値からplusMinusを
   * 引けばオフコート純得失点になる）。チーム合計行（Category=3）を集計する際は常に0を渡すため
   * チーム集計では使わない
   */
  teamNetSum: number;
  /**
   * テクニカルファウル数（EFF計算専用のアキュムレータ。formulas.tsのeff()参照）。
   * ボックススコアの`FOUL`（=pf）には既に含まれている値だが、公式EFFはテクニカルファウルを
   * 2倍の重みで減点しているため、追加で1回分ずつ加算する必要がある。`PlayByPlays`から
   * countTechnicalFouls()で個別にカウントする（DESIGN.md 14-6章、2026-08-16発見）
   */
  technicalFouls: number;
  /**
   * ベンチ得点（DESIGN.md 12章、2026-08-17実装）。当初はGeniusAPIの`Summaries`に直接
   * 含まれると想定していたが実際には無かったため、既存のボックススコア個人行
   * （Category=1・PeriodCategory=18）の`StartingFlg`と`Point`から、試合単位で
   * 「先発以外（StartingFlg!==1）の選手のPoint合計」を算出しシーズン合計する方式で導出する
   * （benchPointsForGame()参照）。個人集計では常に0のまま（チーム集計専用）
   */
  benchPoints: number;
  /**
   * スタメン得点（DESIGN.md 12章のBENCH PTSと対の指標、Phase H8）。benchPointsForGame()と
   * 同じ試合単位個人行から、先発（StartingFlg===1）のPointを合計する。個人集計では常に0のまま
   */
  starterPoints: number;
  /**
   * 日本人選手の得点（Phase H8）。既存のボックススコア「内訳集計」（日本人選手合計/
   * 外国籍+帰化+アジア特別枠合計、BoxscoreTable.tsx）と同じ選手マスタclassification突合を
   * 試合単位で適用しシーズン合計する。個人集計では常に0のまま
   */
  japanesePoints: number;
  /** 外国籍+帰化+アジア特別枠選手の得点（Phase H8）。japanesePointsと対になる集計 */
  internationalPoints: number;
  /**
   * 外国籍選手のみの得点（Batch 1）。internationalPointsは外国籍+帰化+アジア特別枠を
   * 合算した2分割版だが、これは帰化選手・アジア特別枠を含まない3分割版
   */
  foreignPoints: number;
  /** 帰化選手+アジア特別枠選手の得点（Batch 1）。foreignPointsと対になる集計 */
  naturalizedOrAsianPoints: number;
  /**
   * ペイント内での得点（Phase H10、得点構成の可視化用）。shared/playTypePoints.tsの
   * computePointsInPaint()（得点イベントのPlayTextタグ集計方式、全シーズン対応・ショット
   * チャート座標に依存しない）を試合単位でシーズン合計する。個人集計では常に0のまま。
   * ミッドレンジ得点はこの値と2P得点（(fgm-tpm)*2）の差分として導出するため、
   * 別途フィールドは持たない
   */
  paintPoints: number;
  /**
   * ダブルダブル/トリプルダブル数（PTS/REB/AST/STL/BLKの2桁到達部門数が2以上でDD、3以上でTD。
   * src/lib/boxscoreAggregate.tsのcomputeStatBadge()と同じ閾値をprocessPlayers()内で適用する。
   * チーム集計では意味を持たない値になる（チーム合計は常にほぼ全項目が2桁）ため、
   * processTeams()側では加算しない＝常に0のまま）
   */
  doubleDoubles: number;
  tripleDoubles: number;
}

function emptyTotals(): StatTotals {
  return {
    gamesPlayed: 0,
    gamesStarted: 0,
    min: 0,
    pts: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    foulsDrawn: 0,
    blockedAgainst: 0,
    poss: 0,
    plusMinus: 0,
    teamNetSum: 0,
    technicalFouls: 0,
    benchPoints: 0,
    starterPoints: 0,
    japanesePoints: 0,
    internationalPoints: 0,
    foreignPoints: 0,
    naturalizedOrAsianPoints: 0,
    paintPoints: 0,
    doubleDoubles: 0,
    tripleDoubles: 0,
  };
}

/**
 * PlayByPlaysからテクニカルファウルの発生回数を数える（EFF計算専用。formulas.tsのeff()参照）。
 * - 選手個人（ActionCD1=24）はPlayerID1で選手単位に集計する（個人EFFの補正に使う）
 * - チーム単位はActionCD1=20（HCテクニカル）・21（ベンチテクニカル）・24（選手個人テクニカル）
 *   の合計をTeamIDで集計する（チームEFFの補正に使う。20・21は選手に紐付かずCategory=2の
 *   チーム発生イベント行にのみ計上されるため、個人側には含めない。DESIGN.md 2-2章）
 */
function countTechnicalFouls(playByPlays: PlayByPlayEvent[]): {
  byPlayer: Map<string, number>;
  byTeam: Map<string, number>;
} {
  const byPlayer = new Map<string, number>();
  const byTeam = new Map<string, number>();
  for (const play of playByPlays) {
    if (play.ActionCD1 === 24 && play.PlayerID1) {
      byPlayer.set(play.PlayerID1, (byPlayer.get(play.PlayerID1) ?? 0) + 1);
    }
    if ((play.ActionCD1 === 20 || play.ActionCD1 === 21 || play.ActionCD1 === 24) && play.TeamID) {
      byTeam.set(play.TeamID, (byTeam.get(play.TeamID) ?? 0) + 1);
    }
  }
  return { byPlayer, byTeam };
}

interface MiscEventCounts {
  dunks: number;
  basketCounts: number;
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
}

const ZERO_MISC_EVENTS: MiscEventCounts = { dunks: 0, basketCounts: 0, unsportsmanlikeFouls: 0, disqualifyingFouls: 0 };

const DUNK_ACTION_CD1 = 4;
const BASKET_COUNT_ACTION_CD1 = 16;
const UNSPORTSMANLIKE_FOUL_ACTION_CD1 = 25;
const DISQUALIFYING_FOUL_ACTION_CD1 = 26;

/**
 * ダンク数・アンドワン（バスケットカウント）・アンスポーツマンファウル・ディスクォリファイング
 * ファウルを選手単位・チーム単位の両方で集計する（src/lib/boxscoreAggregate.tsの
 * buildMiscEventCounts()と同じロジック。DESIGN.md 15-6章参照。試合単位のPlayByPlaysから
 * 毎回集計する必要があるためバックエンド側にも同じロジックを移植した）。
 * チーム単位（byTeam）は2026-08-29、チーム版Miscタブ拡張のために追加した
 * （従来は個別関数countTeamDunks()でダンク数のみチーム集計していたが、同じPBPを二重に
 * 走査する無駄を避けるためこの関数に統合した）
 */
function buildMiscEventCounts(playByPlays: PlayByPlayEvent[]): { byPlayer: Map<string, MiscEventCounts>; byTeam: Map<string, MiscEventCounts> } {
  const byPlayer = new Map<string, MiscEventCounts>();
  const byTeam = new Map<string, MiscEventCounts>();
  const bump = (target: Map<string, MiscEventCounts>, id: string | null, key: keyof MiscEventCounts) => {
    if (!id) return;
    const entry = target.get(id) ?? { ...ZERO_MISC_EVENTS };
    entry[key] += 1;
    target.set(id, entry);
  };
  for (const ev of playByPlays) {
    let key: keyof MiscEventCounts | null = null;
    if (ev.ActionCD1 === DUNK_ACTION_CD1 && ev.PlayText.includes("ダンク")) {
      key = "dunks";
    } else if (ev.ActionCD1 === BASKET_COUNT_ACTION_CD1) {
      key = "basketCounts";
    } else if (ev.ActionCD1 === UNSPORTSMANLIKE_FOUL_ACTION_CD1) {
      key = "unsportsmanlikeFouls";
    } else if (ev.ActionCD1 === DISQUALIFYING_FOUL_ACTION_CD1) {
      key = "disqualifyingFouls";
    }
    if (!key) continue;
    bump(byPlayer, ev.PlayerID1, key);
    bump(byTeam, ev.TeamID, key);
  }
  return { byPlayer, byTeam };
}

interface OffensiveFoulCounts {
  offensiveFoulsCommitted: number;
  chargesDrawn: number;
}

const ZERO_OFFENSIVE_FOUL_COUNTS: OffensiveFoulCounts = { offensiveFoulsCommitted: 0, chargesDrawn: 0 };

const OFFENSIVE_FOUL_ACTION_CD1 = 23;
const FOUL_DRAWN_ACTION_CD1 = 15;
const MAX_CHARGE_PAIRING_FORWARD_STEPS = 3;

/**
 * オフェンスファウルを犯した回数・チャージを取った回数を選手単位で集計する
 * （src/lib/boxscoreAggregate.tsのbuildOffensiveFoulCounts()と同じロジック。
 * ActionCD1=23〔オフェンスファウル〕の直後・配列内3件以内に出現する相手チームの
 * ActionCD1=15〔ファウルドローン〕とペアリングし、その相手選手をチャージを取った選手とする）
 */
function buildOffensiveFoulCounts(playByPlays: PlayByPlayEvent[]): Map<string, OffensiveFoulCounts> {
  const byPlayer = new Map<string, OffensiveFoulCounts>();
  const bump = (playerId: string | null, key: keyof OffensiveFoulCounts) => {
    if (!playerId) return;
    const entry = byPlayer.get(playerId) ?? { ...ZERO_OFFENSIVE_FOUL_COUNTS };
    entry[key] += 1;
    byPlayer.set(playerId, entry);
  };
  for (let i = 0; i < playByPlays.length; i++) {
    const foulEvent = playByPlays[i];
    if (!foulEvent || foulEvent.ActionCD1 !== OFFENSIVE_FOUL_ACTION_CD1) continue;
    bump(foulEvent.PlayerID1, "offensiveFoulsCommitted");
    for (let j = i + 1; j < playByPlays.length && j <= i + MAX_CHARGE_PAIRING_FORWARD_STEPS; j++) {
      const candidate = playByPlays[j];
      if (!candidate) continue;
      if (candidate.ActionCD1 !== FOUL_DRAWN_ACTION_CD1) continue;
      if (candidate.TeamID && candidate.TeamID !== foulEvent.TeamID) {
        bump(candidate.PlayerID1, "chargesDrawn");
      }
      break;
    }
  }
  return byPlayer;
}

interface PaintSplitCounts {
  paint2m: number;
  paint2a: number;
  mid2m: number;
  mid2a: number;
}

const ZERO_PAINT_SPLIT: PaintSplitCounts = { paint2m: 0, paint2a: 0, mid2m: 0, mid2a: 0 };

/**
 * ショットチャートと同じX/Y座標ベースのゾーン分類（shared/shotChart.ts）で、選手ごと・
 * チームごとのペイント内外2P内訳を求める（src/lib/boxscoreAggregate.tsのbuildPaintSplitByPlayer()と
 * 同じロジック。チーム単位byTeamは2026-08-29、チーム版スコアリングタブ拡張のために追加）。
 * 呼び出し側でseasonCoverage()==="full"（2022-23シーズン以降）のみ呼ぶこと
 * （それ以前はX/Y自体が存在せずbuildShotEvents()が常に空配列を返す）
 */
function buildPaintSplitByPlayer(playByPlays: PlayByPlayEvent[]): { byPlayer: Map<string, PaintSplitCounts>; byTeam: Map<string, PaintSplitCounts> } {
  const byPlayer = new Map<string, PaintSplitCounts>();
  const byTeam = new Map<string, PaintSplitCounts>();
  for (const shot of buildShotEvents(playByPlays)) {
    const split = paintSplitForShot(shot);
    if (!split) continue;
    const entry = byPlayer.get(shot.playerId) ?? { ...ZERO_PAINT_SPLIT };
    const teamEntry = shot.teamId ? (byTeam.get(shot.teamId) ?? { ...ZERO_PAINT_SPLIT }) : null;
    if (split === "paint") {
      entry.paint2a += 1;
      if (teamEntry) teamEntry.paint2a += 1;
      if (shot.made) {
        entry.paint2m += 1;
        if (teamEntry) teamEntry.paint2m += 1;
      }
    } else {
      entry.mid2a += 1;
      if (teamEntry) teamEntry.mid2a += 1;
      if (shot.made) {
        entry.mid2m += 1;
        if (teamEntry) teamEntry.mid2m += 1;
      }
    }
    byPlayer.set(shot.playerId, entry);
    if (teamEntry && shot.teamId) byTeam.set(shot.teamId, teamEntry);
  }
  return { byPlayer, byTeam };
}

/**
 * 外国籍選手（外国籍/帰化選手/アジア特別枠の合算）同時出場人数別に、試合単位でチームごとの
 * 在コート秒数をバケット分けする（DESIGN.md参照）。onCourt.lineupStints
 * （reconstructOnCourtの戻り値、既に計算済みのものを再利用しPBP再走査は行わない）を、
 * 5人組のうち非日本人の人数（バケットキー。0〜5、上限クランプはしない）でバケット分けし、
 * チーム全体の在コート秒数として積算する（特定選手の出場時間には限定しない）。
 * classificationが不明（players-master.jsonに存在しない選手を含む）な5人組は、
 * どのバケットにも計上せず丸ごと除外する（推測しない方針。DESIGN.md 51章参照）。
 * 対象チームの全スティントが不明だった場合、そのチームはMapに含まれない。
 * ⚠️ 一部のlegacy取得試合（2016-17〜2019-20シーズン）でOTを`legacyPeriodScores()`が
 * 正しく検出できず（`Game.MaxPeriod`がOT試合でも4のまま報告されるケースを確認）、
 * `reconstructOnCourt`が終盤のスティントを`gameEnd`（レギュレーション終了時刻）で
 * 打ち切ってしまい、結果的に`endSec < startSec`という負の区間長を持つスティントが
 * 稀に発生することを確認した（既存のlineups集計・よく使われるラインナップにも
 * 影響しうる別件のバグ。ここでは深追いせず、本集計にだけ悪影響が出ないよう
 * 負の区間長を持つスティントは丸ごとスキップする）
 */
function computeForeignPlayerCourtSeconds(
  onCourt: OnCourtReconstruction,
  masterById: Map<string, PlayerMasterEntry>,
): Map<string, Map<number, number>> {
  const secondsByTeamBucket = new Map<string, Map<number, number>>();
  for (const stint of onCourt.lineupStints) {
    const duration = stint.endSec - stint.startSec;
    if (duration <= 0) continue;

    const foreignCount = foreignCountInLineup(stint.playerIds, (id) => masterById.get(id)?.classification);
    if (foreignCount === null) continue;

    let bucketSeconds = secondsByTeamBucket.get(stint.teamId);
    if (!bucketSeconds) {
      bucketSeconds = new Map();
      secondsByTeamBucket.set(stint.teamId, bucketSeconds);
    }
    bucketSeconds.set(foreignCount, (bucketSeconds.get(foreignCount) ?? 0) + duration);
  }
  return secondsByTeamBucket;
}

/**
 * 外国籍選手同時出場人数の試合単位代表値（DESIGN.md参照）。
 * computeForeignPlayerCourtSeconds()の結果から、チームごとに最も長い時間を占めた
 * バケットをその試合の代表値とする（呼び出し側は`.get(teamId)`がundefinedになることで
 * 「代表値なし」を扱う）
 */
function computeForeignPlayerCounts(secondsByTeamBucket: Map<string, Map<number, number>>): Map<string, number> {
  const result = new Map<string, number>();
  for (const [teamId, bucketSeconds] of secondsByTeamBucket) {
    let bestBucket = 0;
    let bestSeconds = -1;
    for (const [bucket, seconds] of bucketSeconds) {
      if (seconds > bestSeconds) {
        bestSeconds = seconds;
        bestBucket = bucket;
      }
    }
    result.set(teamId, bestBucket);
  }
  return result;
}

/**
 * ベンチ得点（DESIGN.md 12章）。試合全体の個人行（Category=1・PeriodCategory=18）のうち、
 * 指定チーム・先発以外（StartingFlg!==1）の選手のPointを合計する。単純合計のため
 * （POSSのような比率項を含む式と違い）試合単位で確定させる必要は無いが、他のチーム集計と
 * 同じ「試合単位で求めてからシーズン合計に積算する」方式に揃えている
 */
function benchPointsForGame(rows: BoxscoreRow[], teamId: string): number {
  return rows
    .filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.TeamID === teamId && r.StartingFlg !== 1)
    .reduce((sum, r) => sum + r.Point, 0);
}

/** スタメン得点（Phase H8）。benchPointsForGame()の先発版 */
function starterPointsForGame(rows: BoxscoreRow[], teamId: string): number {
  return rows
    .filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.TeamID === teamId && r.StartingFlg === 1)
    .reduce((sum, r) => sum + r.Point, 0);
}

/**
 * 国籍区分別得点（Phase H8。Batch 1で外国籍/帰化orアジア特別枠の3分割、Batch 5で
 * 帰化選手/アジア特別枠を分離した4分割に拡張）。BoxscoreTable.tsxの「内訳集計」と同じ
 * classification突合を試合単位で行う。classification未定義の選手はいずれにも計上しない
 * （51章で確立した「推測しない」方針を踏襲）
 */
function classificationPointsForGame(
  rows: BoxscoreRow[],
  teamId: string,
  masterById: Map<string, PlayerMasterEntry>,
): { japanese: number; foreign: number; naturalized: number; asianQuota: number } {
  let japanese = 0;
  let foreign = 0;
  let naturalized = 0;
  let asianQuota = 0;
  for (const r of rows) {
    if (r.Category !== 1 || r.PeriodCategory !== 18 || r.TeamID !== teamId) continue;
    const classification = masterById.get(r.PlayerID)?.classification;
    if (classification === "日本人") {
      japanese += r.Point;
    } else if (classification === "外国籍") {
      foreign += r.Point;
    } else if (classification === "帰化選手") {
      naturalized += r.Point;
    } else if (classification === "アジア特別枠") {
      asianQuota += r.Point;
    }
  }
  return { japanese, foreign, naturalized, asianQuota };
}

function addBoxscoreRow(
  totals: StatTotals,
  row: BoxscoreRow,
  countGame: boolean,
  teamNetForGame: number,
  reconstructedPlusMinus?: number,
  // チーム集計のみ、gamePossession()で試合単位で確定させた値を渡す（個人集計は常に未指定＝0のまま）
  possForGame?: number,
  // countTechnicalFouls()で試合単位に求めた値（個人はbyPlayer、チームはbyTeamの参照）。EFF補正専用
  technicalFoulsForRow = 0,
): void {
  if (countGame) {
    totals.gamesPlayed += 1;
    totals.teamNetSum += teamNetForGame;
  }
  if (row.StartingFlg === 1) totals.gamesStarted += 1;
  totals.min += parsePlayTime(row.PlayTime);
  totals.pts += row.Point;
  totals.oreb += row.RB_OFF;
  totals.dreb += row.RB_DEF;
  totals.reb += row.RB_TOT;
  totals.ast += row.AS;
  totals.stl += row.ST;
  totals.blk += row.BS;
  totals.tov += row.TO;
  totals.pf += row.FOUL;
  totals.technicalFouls += technicalFoulsForRow;
  totals.fgm += row.PT2M + row.PT3M;
  totals.fga += row.PT2A + row.PT3A;
  totals.tpm += row.PT3M;
  totals.tpa += row.PT3A;
  totals.ftm += row.FTM;
  totals.fta += row.FTA;
  totals.foulsDrawn += row.FOULON;
  totals.blockedAgainst += row.BSON;
  totals.poss += possForGame ?? row.POSS ?? 0;
  // 公式PLUSMINUSが無いシーズン（2016-17〜2021-22）はshared/onCourt.tsによる自前復元値を使う
  // （DESIGN.md 2-7章。信頼度が公式値より一段低い旨をフロントエンドで注記する）
  totals.plusMinus += row.PLUSMINUS ?? reconstructedPlusMinus ?? 0;
}

function buildStatBlock(totals: StatTotals, seasonStartYear: number) {
  const gp = totals.gamesPlayed || 1; // 0除算防止（gamesPlayed=0ならperGameは全て0になる）
  return {
    gamesPlayed: totals.gamesPlayed,
    gamesStarted: totals.gamesStarted,
    totals,
    perGame: {
      min: totals.min / gp,
      pts: totals.pts / gp,
      oreb: totals.oreb / gp,
      dreb: totals.dreb / gp,
      reb: totals.reb / gp,
      ast: totals.ast / gp,
      stl: totals.stl / gp,
      blk: totals.blk / gp,
      tov: totals.tov / gp,
      pf: totals.pf / gp,
      plusMinus: totals.plusMinus / gp,
    },
    shooting: {
      fgPct: safeDiv(totals.fgm, totals.fga),
      tpPct: safeDiv(totals.tpm, totals.tpa),
      ftPct: safeDiv(totals.ftm, totals.fta),
      pt2Pct: safeDiv(totals.fgm - totals.tpm, totals.fga - totals.tpa),
      efgPct: efgPct(totals.fgm, totals.tpm, totals.fga),
      tsPct: tsPct(totals.pts, totals.fga, totals.fta),
      ftRate: ftRate(totals.fta, totals.fga),
    },
    advanced: {
      eff: eff(seasonStartYear, totals, gp),
    },
  };
}

/**
 * シーズン合計のStatTotalsを、個人ORtg計算式（shared/formulas.tsのindividualOffRtg、
 * ボックススコア試合詳細ページの個人ORtgと同じDean Oliver方式）の入力形に変換する。
 * ボックススコア側のtoOliverBox()（src/lib/boxscoreAggregate.ts）と同じフィールド対応だが、
 * こちらは1試合分ではなくシーズン合計値を渡す
 */
function toOliverBoxFromTotals(totals: StatTotals): OliverBoxStats {
  return {
    min: totals.min,
    fgm: totals.fgm,
    fga: totals.fga,
    fg3m: totals.tpm,
    ftm: totals.ftm,
    fta: totals.fta,
    pts: totals.pts,
    ast: totals.ast,
    oreb: totals.oreb,
    dreb: totals.dreb,
    tov: totals.tov,
    stl: totals.stl,
    blk: totals.blk,
    pf: totals.pf,
  };
}

interface PlayerAccumulator {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  totals: StatTotals;
  gameLogs: PlayerGameLog[];
}

interface TeamAccumulator {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  totals: StatTotals;
  opponentTotals: StatTotals;
  gameLogs: TeamGameLog[];
  /** 自チーム外国籍選手同時出場人数別（0/1/2/3/4人以上）の在コート秒数の合算（Phase H9） */
  foreignPlayerCourtSeconds: [number, number, number, number, number];
}

interface LineupAccumulator {
  playerIds: string[];
  secondsPlayed: number;
  netPoints: number;
  ownPoints: number;
  oppPoints: number;
  games: Set<string>;
}

function pickTeamRow(rows: BoxscoreRow[], category: 1 | 3): BoxscoreRow[] {
  return rows.filter((r) => r.Category === category && r.PeriodCategory === 18);
}

/**
 * 1試合分のポゼッション数を確定する。公式POSS値がある試合（fullティア）はそれをそのまま使う。
 * 無い試合（pbpNoShotChartティア、2022-23シーズンより前）は、その試合のホーム/アウェイ
 * チーム行のボックススコア（FGA/FGM/FTA/OREB/DREB/TOV）からestimatedPossessions()
 * （公式のポゼッション推定式）で算出する。必ず試合単位で1つの値に確定させてから
 * シーズン合計に加算する（シーズン合計値に対して式を再適用すると比率項の非線形性で誤差が出るため）
 */
function gamePossession(homeRow: BoxscoreRow, awayRow: BoxscoreRow): number {
  if (homeRow.POSS !== undefined) return homeRow.POSS;
  const toPossessionTotals = (row: BoxscoreRow) => ({
    fga: row.PT2A + row.PT3A,
    fgm: row.PT2M + row.PT3M,
    fta: row.FTA,
    oreb: row.RB_OFF,
    dreb: row.RB_DEF,
    tov: row.TO,
  });
  return estimatedPossessions(toPossessionTotals(homeRow), toPossessionTotals(awayRow));
}

export async function aggregateSeason(season: string, category: Category = "premier"): Promise<void> {
  const seasonDir = seasonDirName(season, category);
  // シーズン対応版地区マスタ（data/division-history.json、scrape-division-history.tsが
  // bleague.jp/standings/から全シーズン分機械的に取得したもの）。standings-history.json・
  // head-to-head.jsonの地区別集計で使う（teamDivisionForSeason()参照）
  const divisionHistory = (await readJson<DivisionHistoryFile>(path.join(DATA_DIR, "division-history.json"))) ?? {
    premier: {},
    one: {},
  };
  const rawGames = await readAllGames(season, category);
  const allGames = rawGames.filter((g) => g.gameEndedFlg);
  const games = allGames.filter((g) => !isExhibitionGame(g.raw.Game.ConventionNameJ));
  const excludedCount = allGames.length - games.length;
  // players.json/teams.json・standings-history.json・head-to-head.jsonのデフォルト集計は
  // レギュラーシーズンのみとする（プレーオフ込みで合算すると選手スタッツが60試合超になる等の
  // バグの原因だった。2026-08-16）。プレーオフは除外せずgameLogsにgameType付きで残し、
  // フロントエンドのシチュエーション別フィルタ（src/lib/situational.ts）で任意に合算できるようにする
  const playoffCount = games.filter((g) => classifyGameType(g.raw.Game.ConventionNameJ) === "playoff").length;
  console.log(
    `[${season}] 集計対象: ${games.length}試合（終了済みのみ、レギュラー${games.length - playoffCount}／プレーオフ${playoffCount}）` +
      (excludedCount > 0 ? ` ／ オールスター等${excludedCount}試合を除外` : ""),
  );

  // 日程ページ（#/schedule）用。進行中（box scoreはあるがgameEndedFlgがまだfalse）の試合も
  // 含めるため、gameEndedFlgで絞り込む前のrawGamesを使う（exhibitionのみ除外）
  const scheduleGames = rawGames.filter((g) => !isExhibitionGame(g.raw.Game.ConventionNameJ));
  const gameSummaries = buildGameSummaries(scheduleGames);
  await writeJson(path.join(DATA_DIR, seasonDir, "games-summary.json"), gameSummaries);

  // EFFの計算式は年度で異なる（DESIGN.md 6章）。シーズン文字列("2025-26")から開始年を取り出す
  const seasonStartYear = Number(season.split("-")[0]);

  // 選手マスタ（シーズン非依存。scrape-roster.tsが生成）。未生成でも集計自体は動く
  const playersMaster = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const masterById = new Map(playersMaster.map((p) => [p.playerId, p]));
  // 当時のポジション（scrape-season-rosters.tsが構築。season→playerId→position）。B.PREMIERで
  // このシーズンのキーがあれば、マスタ（現在値1つ）ではなくこちらだけを使う。当時の一覧で空欄
  // だった選手はマスタの現在値で補完せず未定義のままにする。シーズンのキー自体が無い
  // （未アーカイブの進行中シーズン）場合、およびB.ONE等のB.PREMIER以外はマスタにフォールバックする
  const seasonPositionsFile = (await readJson<SeasonPositionsFile>(path.join(DATA_DIR, "season-positions.json"))) ?? {};
  const seasonPositions = category === "premier" ? seasonPositionsFile[season] : undefined;

  const players = new Map<string, PlayerAccumulator>();
  const teams = new Map<string, TeamAccumulator>();
  const teamLineups = new Map<string, Map<string, LineupAccumulator>>();

  const ensureTeam = (teamId: string, teamName: string): TeamAccumulator => {
    let team = teams.get(teamId);
    if (!team) {
      team = {
        teamId,
        teamName,
        wins: 0,
        losses: 0,
        totals: emptyTotals(),
        opponentTotals: emptyTotals(),
        gameLogs: [],
        foreignPlayerCourtSeconds: [0, 0, 0, 0, 0],
      };
      teams.set(teamId, team);
    }
    return team;
  };

  for (const game of games) {
    const gameType = classifyGameType(game.raw.Game.ConventionNameJ);
    const periods = game.quarterScores.home.length;
    const onCourt =
      game.raw.PlayByPlays.length > 0
        ? reconstructOnCourt(
            game.raw.PlayByPlays,
            game.raw.HomeBoxscores,
            game.raw.AwayBoxscores,
            game.homeTeam.id,
            game.awayTeam.id,
            periods,
            substitutionModelForSeason(game.season),
          )
        : null;
    const technicalFouls = countTechnicalFouls(game.raw.PlayByPlays);
    const foreignPlayerCourtSeconds = onCourt
      ? computeForeignPlayerCourtSeconds(onCourt, masterById)
      : new Map<string, Map<number, number>>();
    const foreignPlayerCounts = computeForeignPlayerCounts(foreignPlayerCourtSeconds);
    // 個人PACE用の在コート区間ポゼッション（DESIGN.md参照）。既存のPACE表示ポリシー
    // （17-4章）と同じくcoverage==="full"（2022-23シーズン以降）のみ算出する
    const onCourtRatingsByPlayer: Record<string, PlayerOnCourtRatings> =
      onCourt && seasonCoverage(game.season) === "full" ? computeOnCourtRatings(onCourt.intervals) : {};
    // シーズン集計ボックススコア（playerSeasonBoxscore.ts）でPTSOFFTO・DUNK・AND1・UFOUL・
    // DQFOUL・AST2M/AST3M/ASTFTM・PAINT2M/PAINT2A・MID2M/MID2Aを実数値表示するための追加集計。
    // いずれも試合単位の単純な合算値のため、ここで1回だけ計算しPlayerGameLogに永続化する
    const ptsOffTov = computePointsOffTurnovers(game.raw.PlayByPlays);
    // PT2IN/PTFB/PT2ND（row.PT2IN等の生フィールド）は「シュート成功本数」でありSummaries公式
    // フィールド（得点）とスケールが異なるため、ptsOffTovと同じPBPタグ集計方式で得点を算出する
    // （shared/playTypePoints.ts参照）
    const pitp = computePointsInPaint(game.raw.PlayByPlays);
    const fbps = computeFastbreakPoints(game.raw.PlayByPlays);
    const secondChance = computeSecondChancePoints(game.raw.PlayByPlays);
    const ptsOffTovByPlayer = ptsOffTov.byPlayer;
    const pitpByPlayer = pitp.byPlayer;
    const fbpsByPlayer = fbps.byPlayer;
    const secondChanceByPlayer = secondChance.byPlayer;
    const assistedScoring = computeAssistedScoring(game.raw.PlayByPlays);
    const miscEvents = buildMiscEventCounts(game.raw.PlayByPlays);
    const offensiveFoulCountsByPlayer = buildOffensiveFoulCounts(game.raw.PlayByPlays);
    const paintSplit =
      seasonCoverage(game.season) === "full"
        ? buildPaintSplitByPlayer(game.raw.PlayByPlays)
        : { byPlayer: new Map<string, PaintSplitCounts>(), byTeam: new Map<string, PaintSplitCounts>() };
    processPlayers(
      game,
      gameType,
      players,
      onCourt,
      technicalFouls.byPlayer,
      foreignPlayerCounts,
      ptsOffTovByPlayer,
      pitpByPlayer,
      fbpsByPlayer,
      secondChanceByPlayer,
      assistedScoring.byScorer,
      miscEvents.byPlayer,
      paintSplit.byPlayer,
      onCourtRatingsByPlayer,
      offensiveFoulCountsByPlayer,
    );
    processTeams(
      game,
      gameType,
      teams,
      ensureTeam,
      technicalFouls.byTeam,
      foreignPlayerCounts,
      foreignPlayerCourtSeconds,
      pitp.byTeam,
      fbps.byTeam,
      ptsOffTov.byTeam,
      secondChance.byTeam,
      miscEvents.byTeam,
      assistedScoring.byTeam,
      paintSplit.byTeam,
      masterById,
    );
    processLineups(game, teamLineups, onCourt);
  }

  // ターンオーバーの種類別カウント（相手に強制した／自チームが犯した、の両方向。Yahoo!スポーツ
  // play-by-play由来、2023-24シーズン以降・取得済み試合のみ。DESIGN.md参照）。B.ONE等では
  // Yahoo PBPデータ自体が存在しないため、premierカテゴリのみ計算する
  const { forced: forcedTurnoversByTeam, committed: turnoversCommittedByTeam } =
    category === "premier"
      ? await buildForcedTurnoversByTeam(season, games)
      : { forced: new Map<string, TeamForcedTurnovers>(), committed: new Map<string, TeamForcedTurnovers>() };
  // シュートタイプ別の成功/試投カウント（Yahoo!スポーツplay-by-play由来。選手別・チーム別を
  // 1回の走査で同時に集計する。DESIGN.md参照）
  const { byPlayer: shotTypesByPlayer, byTeam: shotTypesByTeam } =
    category === "premier"
      ? await buildShotTypeBreakdowns(season, games)
      : { byPlayer: new Map<string, ShotTypeBreakdown>(), byTeam: new Map<string, ShotTypeBreakdown>() };

  // PER（Hollinger方式、NBA/Basketball-Reference流。DESIGN.md参照）。
  // リーグ全体の合計値（自チーム視点のteams.totalsを全チーム分足し合わせたもの。相手チーム視点の
  // opponentTotalsを混ぜると二重集計になるため使わない）からfactor/VOP/DRBP・lgPaceを1回だけ求め、
  // 各選手のuPERを算出したあと、出場時間で加重平均したリーグ平均uPERを求めて15に正規化する
  const lgTotals: PerLeagueTotals = { ast: 0, fgm: 0, fga: 0, ftm: 0, fta: 0, pts: 0, oreb: 0, trb: 0, tov: 0, pf: 0 };
  let lgPoss = 0;
  let lgMin = 0;
  for (const team of teams.values()) {
    lgTotals.ast += team.totals.ast;
    lgTotals.fgm += team.totals.fgm;
    lgTotals.fga += team.totals.fga;
    lgTotals.ftm += team.totals.ftm;
    lgTotals.fta += team.totals.fta;
    lgTotals.pts += team.totals.pts;
    lgTotals.oreb += team.totals.oreb;
    lgTotals.trb += team.totals.reb;
    lgTotals.tov += team.totals.tov;
    lgTotals.pf += team.totals.pf;
    lgPoss += team.totals.poss;
    lgMin += team.totals.min;
  }
  const perConst = perConstants(lgTotals);
  const lgPace = pace(lgPoss, lgMin);

  const uPerByPlayer = new Map<string, number>();
  let sumWeightedUPer = 0;
  let sumMinForUPer = 0;
  for (const p of players.values()) {
    const team = teams.get(p.teamId);
    const teamAstFgRatio = team ? safeDiv(team.totals.ast, team.totals.fgm) : 0;
    const uPerValue = uPer({ ...p.totals, trb: p.totals.reb }, teamAstFgRatio, lgTotals, perConst);
    uPerByPlayer.set(p.playerId, uPerValue);
    sumWeightedUPer += uPerValue * p.totals.min;
    sumMinForUPer += p.totals.min;
  }
  const lgAvgUPer = safeDiv(sumWeightedUPer, sumMinForUPer);

  const playersJson = [...players.values()]
    .map((p) => {
      const statBlock = buildStatBlock(p.totals, seasonStartYear);
      // Usage%はチームの出場全体（シーズン合計）を基準に算出する。移籍選手は直近所属チームで近似する
      const team = teams.get(p.teamId);
      const usage = team ? usagePct(p.totals, team.totals) : 0;
      const teamPaceForPlayer = team ? pace(team.totals.poss, team.totals.min) : 0;
      const per =
        teamPaceForPlayer > 0
          ? finalizePer(uPerByPlayer.get(p.playerId) ?? 0, teamPaceForPlayer, lgPace, lgAvgUPer)
          : 0;
      // PPP = 個人ORtg（Dean Oliver方式、試合詳細ページの個人ORtgと同じindividualOffRtg()）/ 100。
      // シーズン合計値をそのまま渡す（移籍選手はUsage%と同様、直近所属チームで近似する）。
      // 出場時間4分未満（シーズン合計）ではindividualOffRtg()自体がundefinedを返す
      const individualSeasonOffRtg = team
        ? individualOffRtg(toOliverBoxFromTotals(p.totals), toOliverBoxFromTotals(team.totals), toOliverBoxFromTotals(team.opponentTotals))
        : undefined;
      const ppp = individualSeasonOffRtg !== undefined ? individualSeasonOffRtg / 100 : undefined;
      // 国籍・身長体重・生年月日・ポジションはplayers-master.jsonから突合（未登録選手は全て未定義のまま）
      const master = masterById.get(p.playerId);
      return {
        playerId: p.playerId,
        name: p.name,
        teamId: p.teamId,
        teamName: p.teamName,
        position: seasonPositions ? seasonPositions[p.playerId] : master?.position,
        nationality: master?.nationality,
        classification: master?.classification,
        heightCm: master?.heightCm,
        weightKg: master?.weightKg,
        birthDate: master?.birthDate,
        shotTypes: shotTypesByPlayer.get(p.playerId),
        ...statBlock,
        advanced: {
          eff: statBlock.advanced.eff,
          usagePct: usage,
          // オンコート純得失点＝個人+/-（PLUSMINUS）合計そのもの。オフコートはそこから
          // 「出場試合のチーム得失点差合計(teamNetSum)」を差し引いた残りとして導出する
          onCourtNet: p.totals.plusMinus,
          onCourtNetPerGame: statBlock.perGame.plusMinus,
          offCourtNet: p.totals.teamNetSum - p.totals.plusMinus,
          offCourtNetPerGame: (p.totals.teamNetSum - p.totals.plusMinus) / (p.totals.gamesPlayed || 1),
          per,
          ppp,
        },
      };
    })
    .sort((a, b) => b.perGame.pts - a.perGame.pts);

  for (const p of players.values()) {
    const gameLogs = [...p.gameLogs].sort((a, b) => a.date.localeCompare(b.date));
    await writeJson(path.join(DATA_DIR, seasonDir, "player-games", `${p.playerId}.json`), gameLogs);
  }

  const teamsJson = [...teams.values()]
    .map((t) => {
      const ownStats = buildStatBlock(t.totals, seasonStartYear);
      const oppStats = buildStatBlock(t.opponentTotals, seasonStartYear);
      // POSSはgamePossession()で試合単位で確定・合算済みの値（totals.poss）を使う。
      // 自チーム/相手チーム行に同じ値を加算しているため、opponentTotals.possも同じ値になる
      const poss = t.totals.poss;
      const offRtg = offensiveRating(t.totals.pts, poss);
      const defRtg = offensiveRating(t.opponentTotals.pts, poss);
      // 得点構成（Phase H10）: 3P/ペイント内/ミッドレンジ/FTの得点をシーズン合計値から算出する。
      // ミッドレンジ得点 = 2P得点(自チームtotals基準) − ペイント内得点。3項目の合計は
      // 常に2P得点に一致し、3P・FTと合わせるとtotals.ptsに一致する（内部整合性はDESIGN.md参照）
      const ownThreePoints = t.totals.tpm * 3;
      const ownTwoPoints = (t.totals.fgm - t.totals.tpm) * 2;
      const ownFtPoints = t.totals.ftm;
      const ownPaintPoints = t.totals.paintPoints;
      const ownMidRangePoints = ownTwoPoints - ownPaintPoints;
      const oppThreePoints = t.opponentTotals.tpm * 3;
      const oppTwoPoints = (t.opponentTotals.fgm - t.opponentTotals.tpm) * 2;
      const oppFtPoints = t.opponentTotals.ftm;
      const oppPaintPoints = t.opponentTotals.paintPoints;
      const oppMidRangePoints = oppTwoPoints - oppPaintPoints;
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        wins: t.wins,
        losses: t.losses,
        ...ownStats,
        advanced: {
          eff: ownStats.advanced.eff,
          poss,
          pace: pace(poss, t.totals.min),
          offRtg,
          defRtg,
          netRtg: offRtg - defRtg,
          orbPct: orbPct(t.totals.oreb, t.opponentTotals.dreb),
          opponentOrbPct: orbPct(t.opponentTotals.oreb, t.totals.dreb),
          tovPct: tovPct(t.totals.tov, t.totals.fga, t.totals.fta),
          opponentTovPct: tovPct(t.opponentTotals.tov, t.opponentTotals.fga, t.opponentTotals.fta),
          benchPointsPerGame: safeDiv(t.totals.benchPoints, ownStats.gamesPlayed),
          opponentBenchPointsPerGame: safeDiv(t.opponentTotals.benchPoints, ownStats.gamesPlayed),
          starterPointsPerGame: safeDiv(t.totals.starterPoints, ownStats.gamesPlayed),
          opponentStarterPointsPerGame: safeDiv(t.opponentTotals.starterPoints, ownStats.gamesPlayed),
          benchPointsSharePct: safeDiv(100 * t.totals.benchPoints, t.totals.pts),
          starterPointsSharePct: safeDiv(100 * t.totals.starterPoints, t.totals.pts),
          japanesePointsPerGame: safeDiv(t.totals.japanesePoints, ownStats.gamesPlayed),
          internationalPointsPerGame: safeDiv(t.totals.internationalPoints, ownStats.gamesPlayed),
          opponentJapanesePointsPerGame: safeDiv(t.opponentTotals.japanesePoints, ownStats.gamesPlayed),
          opponentInternationalPointsPerGame: safeDiv(t.opponentTotals.internationalPoints, ownStats.gamesPlayed),
          foreignPointsPerGame: safeDiv(t.totals.foreignPoints, ownStats.gamesPlayed),
          naturalizedOrAsianPointsPerGame: safeDiv(t.totals.naturalizedOrAsianPoints, ownStats.gamesPlayed),
          opponentForeignPointsPerGame: safeDiv(t.opponentTotals.foreignPoints, ownStats.gamesPlayed),
          opponentNaturalizedOrAsianPointsPerGame: safeDiv(t.opponentTotals.naturalizedOrAsianPoints, ownStats.gamesPlayed),
          japanesePointsSharePct: safeDiv(100 * t.totals.japanesePoints, t.totals.pts),
          foreignPointsSharePct: safeDiv(100 * t.totals.foreignPoints, t.totals.pts),
          naturalizedOrAsianPointsSharePct: safeDiv(100 * t.totals.naturalizedOrAsianPoints, t.totals.pts),
          opponentJapanesePointsSharePct: safeDiv(100 * t.opponentTotals.japanesePoints, t.opponentTotals.pts),
          opponentForeignPointsSharePct: safeDiv(100 * t.opponentTotals.foreignPoints, t.opponentTotals.pts),
          opponentNaturalizedOrAsianPointsSharePct: safeDiv(100 * t.opponentTotals.naturalizedOrAsianPoints, t.opponentTotals.pts),
          threePointPointsSharePct: safeDiv(100 * ownThreePoints, t.totals.pts),
          paintPointsSharePct: safeDiv(100 * ownPaintPoints, t.totals.pts),
          midRangePointsSharePct: safeDiv(100 * ownMidRangePoints, t.totals.pts),
          ftPointsSharePct: safeDiv(100 * ownFtPoints, t.totals.pts),
          opponentThreePointPointsSharePct: safeDiv(100 * oppThreePoints, t.opponentTotals.pts),
          opponentPaintPointsSharePct: safeDiv(100 * oppPaintPoints, t.opponentTotals.pts),
          opponentMidRangePointsSharePct: safeDiv(100 * oppMidRangePoints, t.opponentTotals.pts),
          opponentFtPointsSharePct: safeDiv(100 * oppFtPoints, t.opponentTotals.pts),
        },
        opponentPerGame: oppStats.perGame,
        opponentShooting: oppStats.shooting,
        netPerGame: Object.fromEntries(
          Object.entries(ownStats.perGame).map(([key, value]) => [
            key,
            value - oppStats.perGame[key as keyof typeof oppStats.perGame],
          ]),
        ),
        forcedTurnovers: forcedTurnoversByTeam.get(t.teamId),
        turnoversCommitted: turnoversCommittedByTeam.get(t.teamId),
        shotTypes: shotTypesByTeam.get(t.teamId),
        foreignPlayerCourtSeconds: t.foreignPlayerCourtSeconds,
      };
    })
    .sort((a, b) => b.wins - a.wins);

  for (const t of teams.values()) {
    const gameLogs = [...t.gameLogs].sort((a, b) => a.date.localeCompare(b.date));
    await writeJson(path.join(DATA_DIR, seasonDir, "team-games", `${t.teamId}.json`), gameLogs);
  }

  // 順位表・星取り表はプレーオフの結果に左右されないよう、レギュラーシーズンの試合のみで作る
  const regularGames = games.filter((g) => classifyGameType(g.raw.Game.ConventionNameJ) === "regular");
  const standingsHistory = buildStandingsHistory(regularGames, category, divisionHistory, season);
  await writeJson(path.join(DATA_DIR, seasonDir, "standings-history.json"), standingsHistory);

  const headToHead = buildHeadToHead(teams, category, divisionHistory, season);
  await writeJson(path.join(DATA_DIR, seasonDir, "head-to-head.json"), headToHead);

  // マジックナンバー・進出/敗退・年間優勝（B.PREMIERのみ。scripts/lib/playoffRace.ts、DESIGN.md参照）
  if (category === "premier") {
    const playoffRace = await buildPlayoffRace(season, seasonDir, games, standingsHistory, divisionHistory);
    await writeJson(path.join(DATA_DIR, seasonDir, "playoff-race.json"), playoffRace);
  }

  for (const [teamId, lineupMap] of teamLineups) {
    const team = teams.get(teamId);
    const teamPoss = team?.totals.poss ?? 0;
    const teamMin = team?.totals.min ?? 0;
    const lineups: LineupAggregate[] = [...lineupMap.entries()]
      .map(([lineupKey, acc]) => {
        // 推定Net Rating: スティント単位の実ポゼッション数は記録されていないため、
        // チームのシーズン平均「POSS / MIN(5人合計分)」からスティント時間分を按分推定する
        const estimatedPoss = teamMin > 0 ? (teamPoss * 5 * (acc.secondsPlayed / 60)) / teamMin : 0;
        return {
          lineupKey,
          playerIds: acc.playerIds,
          secondsPlayed: acc.secondsPlayed,
          netPoints: acc.netPoints,
          ownPoints: acc.ownPoints,
          oppPoints: acc.oppPoints,
          gamesPlayed: acc.games.size,
          estimatedNetRtg: safeDiv(100 * acc.netPoints, estimatedPoss),
          estimatedOffRtg: safeDiv(100 * acc.ownPoints, estimatedPoss),
          estimatedDefRtg: safeDiv(100 * acc.oppPoints, estimatedPoss),
        };
      })
      .sort((a, b) => b.secondsPlayed - a.secondsPlayed);
    const file: TeamLineupsFile = {
      teamId,
      teamName: team?.teamName ?? "",
      season,
      lineups,
    };
    await writeJson(path.join(DATA_DIR, seasonDir, "lineups", `${teamId}.json`), file);
  }

  await writeJson(path.join(DATA_DIR, seasonDir, "players.json"), playersJson);
  await writeJson(path.join(DATA_DIR, seasonDir, "teams.json"), teamsJson);
  await regenerateSeasonsFile();
  console.log(
    `保存完了: players.json(${playersJson.length}名) / teams.json(${teamsJson.length}チーム) / ` +
      `standings-history.json(${standingsHistory.length}日分) / head-to-head.json(${headToHead.length}チーム) / ` +
      `lineups/(${teamLineups.size}チーム) / games-summary.json(${gameSummaries.length}試合)`,
  );
}

/** 1試合分のラインナップスティント（shared/onCourt.ts）をチームごとに積算する */
function processLineups(
  game: StoredGame,
  teamLineups: Map<string, Map<string, LineupAccumulator>>,
  onCourt: OnCourtReconstruction | null,
): void {
  if (!onCourt) return;
  for (const stint of onCourt.lineupStints) {
    let lineupMap = teamLineups.get(stint.teamId);
    if (!lineupMap) {
      lineupMap = new Map();
      teamLineups.set(stint.teamId, lineupMap);
    }
    let acc = lineupMap.get(stint.lineupKey);
    if (!acc) {
      acc = { playerIds: stint.playerIds, secondsPlayed: 0, netPoints: 0, ownPoints: 0, oppPoints: 0, games: new Set() };
      lineupMap.set(stint.lineupKey, acc);
    }
    acc.secondsPlayed += stint.endSec - stint.startSec;
    acc.netPoints += stint.netPoints;
    acc.ownPoints += stint.ownPoints;
    acc.oppPoints += stint.oppPoints;
    acc.games.add(game.scheduleKey);
  }
}

function processPlayers(
  game: StoredGame,
  gameType: GameType,
  players: Map<string, PlayerAccumulator>,
  onCourt: OnCourtReconstruction | null,
  technicalFoulsByPlayer: Map<string, number>,
  foreignPlayerCounts: Map<string, number>,
  ptsOffTovByPlayer: Map<string, number>,
  pitpByPlayer: Map<string, number>,
  fbpsByPlayer: Map<string, number>,
  secondChanceByPlayer: Map<string, number>,
  assistedScoringByPlayer: Map<string, AssistedScoringCounts>,
  miscEventsByPlayer: Map<string, MiscEventCounts>,
  paintSplitByPlayer: Map<string, PaintSplitCounts>,
  onCourtRatingsByPlayer: Record<string, PlayerOnCourtRatings>,
  offensiveFoulCountsByPlayer: Map<string, OffensiveFoulCounts>,
): void {
  const rows = [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores];
  for (const row of pickTeamRow(rows, 1)) {
    if (!row.PlayerID) continue;
    let acc = players.get(row.PlayerID);
    if (!acc) {
      acc = {
        playerId: row.PlayerID,
        name: row.PlayerNameJ,
        teamId: row.TeamID ?? "",
        teamName: row.TeamNameJ,
        totals: emptyTotals(),
        gameLogs: [],
      };
      players.set(row.PlayerID, acc);
    }
    // 直近の試合のチーム所属で上書き（移籍対応。DESIGN.mdでは選手マスタでの厳密な履歴管理は未対応）
    acc.teamId = row.TeamID ?? acc.teamId;
    acc.teamName = row.TeamNameJ;
    const isHome = row.TeamID === game.homeTeam.id;
    const teamNetForGame = isHome ? game.homeScore - game.awayScore : game.awayScore - game.homeScore;
    // 公式PLUSMINUSが無いシーズンはshared/onCourt.tsの自前復元値をフォールバックとして使う
    const reconstructedPlusMinus = onCourt?.plusMinus[row.PlayerID];
    // players.jsonのシーズン集計（totals）はレギュラーシーズンのみ加算する。プレーオフの試合も
    // gameLogsには残すため、フロントエンドのシチュエーション別フィルタでは合算参照できる
    if (gameType === "regular") {
      // 出場判定はPlayingFlgではなくPlayTime基準（実データ検証でPlayingFlg=falseでも
      // 得点等が記録されている選手が見つかったため。DESIGN.md 2-2章の記述は誤りだった）
      const countGame = row.PlayTime !== "DNP";
      addBoxscoreRow(
        acc.totals,
        row,
        countGame,
        teamNetForGame,
        reconstructedPlusMinus,
        undefined,
        technicalFoulsByPlayer.get(row.PlayerID) ?? 0,
      );
      // ダブルダブル/トリプルダブル判定（src/lib/boxscoreAggregate.tsのcomputeStatBadge()と
      // 同じ閾値。PTS/REB/AST/STL/BLKのうち2桁到達部門数が2以上でDD、3以上でTD）
      if (countGame) {
        const doubleDigitCount = [row.Point, row.RB_TOT, row.AS, row.ST, row.BS].filter((v) => v >= 10).length;
        if (doubleDigitCount >= 2) acc.totals.doubleDoubles += 1;
        if (doubleDigitCount >= 3) acc.totals.tripleDoubles += 1;
      }
    }

    const opponent = isHome ? game.awayTeam : game.homeTeam;
    const win = isHome ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
    acc.gameLogs.push({
      scheduleKey: game.scheduleKey,
      date: game.date,
      opponentTeamId: opponent.id,
      opponentTeamName: opponent.name,
      isHome,
      win,
      isStarter: row.StartingFlg === 1,
      min: parsePlayTime(row.PlayTime),
      pts: row.Point,
      oreb: row.RB_OFF,
      dreb: row.RB_DEF,
      reb: row.RB_TOT,
      ast: row.AS,
      stl: row.ST,
      blk: row.BS,
      tov: row.TO,
      pf: row.FOUL,
      fgm: row.PT2M + row.PT3M,
      fga: row.PT2A + row.PT3A,
      tpm: row.PT3M,
      tpa: row.PT3A,
      ftm: row.FTM,
      fta: row.FTA,
      plusMinus: row.PLUSMINUS ?? reconstructedPlusMinus ?? 0,
      gameType,
      foulsDrawn: row.FOULON,
      blockedAgainst: row.BSON,
      technicalFouls: technicalFoulsByPlayer.get(row.PlayerID) ?? 0,
      pt2in: pitpByPlayer.get(row.PlayerID) ?? 0,
      ptfb: fbpsByPlayer.get(row.PlayerID) ?? 0,
      pt2nd: secondChanceByPlayer.get(row.PlayerID) ?? 0,
      foreignPlayerCount: foreignPlayerCounts.get(isHome ? game.homeTeam.id : game.awayTeam.id),
      opponentForeignPlayerCount: foreignPlayerCounts.get(opponent.id),
      ptsOffTov: ptsOffTovByPlayer.get(row.PlayerID) ?? 0,
      dunks: miscEventsByPlayer.get(row.PlayerID)?.dunks ?? 0,
      basketCounts: miscEventsByPlayer.get(row.PlayerID)?.basketCounts ?? 0,
      unsportsmanlikeFouls: miscEventsByPlayer.get(row.PlayerID)?.unsportsmanlikeFouls ?? 0,
      disqualifyingFouls: miscEventsByPlayer.get(row.PlayerID)?.disqualifyingFouls ?? 0,
      offensiveFoulsCommitted: offensiveFoulCountsByPlayer.get(row.PlayerID)?.offensiveFoulsCommitted ?? 0,
      chargesDrawn: offensiveFoulCountsByPlayer.get(row.PlayerID)?.chargesDrawn ?? 0,
      assisted2m: assistedScoringByPlayer.get(row.PlayerID)?.assisted2m ?? 0,
      assisted3m: assistedScoringByPlayer.get(row.PlayerID)?.assisted3m ?? 0,
      assistedFtm: assistedScoringByPlayer.get(row.PlayerID)?.assistedFtm ?? 0,
      paint2m: paintSplitByPlayer.get(row.PlayerID)?.paint2m ?? 0,
      paint2a: paintSplitByPlayer.get(row.PlayerID)?.paint2a ?? 0,
      mid2m: paintSplitByPlayer.get(row.PlayerID)?.mid2m ?? 0,
      mid2a: paintSplitByPlayer.get(row.PlayerID)?.mid2a ?? 0,
      onCourtOwnPoss: onCourtRatingsByPlayer[row.PlayerID]?.ownPoss ?? 0,
      onCourtOppPoss: onCourtRatingsByPlayer[row.PlayerID]?.oppPoss ?? 0,
      onCourtSeconds: onCourtRatingsByPlayer[row.PlayerID]?.onCourtSec ?? 0,
    });
  }
}

/** チーム行（Category=3）から試合ログ用のボックススコア詳細を抽出する。possはgamePossession()で試合単位で確定済みの値を渡す */
function teamGameLogStats(row: BoxscoreRow, poss: number) {
  return {
    min: parsePlayTime(row.PlayTime),
    oreb: row.RB_OFF,
    dreb: row.RB_DEF,
    reb: row.RB_TOT,
    ast: row.AS,
    stl: row.ST,
    blk: row.BS,
    tov: row.TO,
    pf: row.FOUL,
    fgm: row.PT2M + row.PT3M,
    fga: row.PT2A + row.PT3A,
    tpm: row.PT3M,
    tpa: row.PT3A,
    ftm: row.FTM,
    fta: row.FTA,
    foulsDrawn: row.FOULON,
    poss,
  };
}

/**
 * 相手チームのボックススコアから、個人DRtg（Dean Oliver方式）の「opponent」役として必要な
 * フィールドのみ抽出する（DESIGN.md参照。全項目はtoOliverBoxFromTotals()のopponent入力を
 * 参照）。ptsはopponentScoreで別途持つため含めない
 */
function opponentGameLogStats(row: BoxscoreRow) {
  return {
    opponentMin: parsePlayTime(row.PlayTime),
    opponentFgm: row.PT2M + row.PT3M,
    opponentFga: row.PT2A + row.PT3A,
    opponentFtm: row.FTM,
    opponentFta: row.FTA,
    opponentOreb: row.RB_OFF,
    opponentDreb: row.RB_DEF,
    opponentTov: row.TO,
    opponentTpm: row.PT3M,
    opponentTpa: row.PT3A,
    opponentAst: row.AS,
    opponentStl: row.ST,
    opponentBlk: row.BS,
    opponentPf: row.FOUL,
    opponentFoulsDrawn: row.FOULON,
  };
}

/**
 * Misc/スコアリングタブ拡張（2026-08-29）用の追加フィールドを、自チーム・相手チーム分まとめて
 * 組み立てる（home/away両方のgameLogs.push()で使う共通ヘルパー。DESIGN.md参照）
 */
function teamMiscExtraGameLogStats(
  ownId: string,
  opponentId: string,
  technicalFoulsByTeam: Map<string, number>,
  miscEventsByTeam: Map<string, MiscEventCounts>,
  assistedScoringByTeam: Map<string, AssistedScoringCounts>,
  paintSplitByTeam: Map<string, PaintSplitCounts>,
) {
  const ownMisc = miscEventsByTeam.get(ownId);
  const oppMisc = miscEventsByTeam.get(opponentId);
  const ownAssisted = assistedScoringByTeam.get(ownId);
  const oppAssisted = assistedScoringByTeam.get(opponentId);
  const ownPaint = paintSplitByTeam.get(ownId);
  const oppPaint = paintSplitByTeam.get(opponentId);
  return {
    technicalFouls: technicalFoulsByTeam.get(ownId) ?? 0,
    basketCounts: ownMisc?.basketCounts ?? 0,
    unsportsmanlikeFouls: ownMisc?.unsportsmanlikeFouls ?? 0,
    disqualifyingFouls: ownMisc?.disqualifyingFouls ?? 0,
    assisted2m: ownAssisted?.assisted2m ?? 0,
    assisted3m: ownAssisted?.assisted3m ?? 0,
    assistedFtm: ownAssisted?.assistedFtm ?? 0,
    paint2m: ownPaint?.paint2m ?? 0,
    paint2a: ownPaint?.paint2a ?? 0,
    mid2m: ownPaint?.mid2m ?? 0,
    mid2a: ownPaint?.mid2a ?? 0,
    opponentTechnicalFouls: technicalFoulsByTeam.get(opponentId) ?? 0,
    opponentBasketCounts: oppMisc?.basketCounts ?? 0,
    opponentUnsportsmanlikeFouls: oppMisc?.unsportsmanlikeFouls ?? 0,
    opponentDisqualifyingFouls: oppMisc?.disqualifyingFouls ?? 0,
    opponentAssisted2m: oppAssisted?.assisted2m ?? 0,
    opponentAssisted3m: oppAssisted?.assisted3m ?? 0,
    opponentAssistedFtm: oppAssisted?.assistedFtm ?? 0,
    opponentPaint2m: oppPaint?.paint2m ?? 0,
    opponentPaint2a: oppPaint?.paint2a ?? 0,
    opponentMid2m: oppPaint?.mid2m ?? 0,
    opponentMid2a: oppPaint?.mid2a ?? 0,
  };
}

function processTeams(
  game: StoredGame,
  gameType: GameType,
  teams: Map<string, TeamAccumulator>,
  ensureTeam: (teamId: string, teamName: string) => TeamAccumulator,
  technicalFoulsByTeam: Map<string, number>,
  foreignPlayerCounts: Map<string, number>,
  foreignPlayerCourtSeconds: Map<string, Map<number, number>>,
  pitpByTeam: Map<string, number>,
  fbpsByTeam: Map<string, number>,
  ptsOffTovByTeam: Map<string, number>,
  secondChanceByTeam: Map<string, number>,
  miscEventsByTeam: Map<string, MiscEventCounts>,
  assistedScoringByTeam: Map<string, AssistedScoringCounts>,
  paintSplitByTeam: Map<string, PaintSplitCounts>,
  masterById: Map<string, PlayerMasterEntry>,
): void {
  const homeRow = pickTeamRow(game.raw.HomeBoxscores, 3)[0];
  const awayRow = pickTeamRow(game.raw.AwayBoxscores, 3)[0];
  if (!homeRow || !awayRow) return;

  const home = ensureTeam(game.homeTeam.id, game.homeTeam.name);
  const away = ensureTeam(game.awayTeam.id, game.awayTeam.name);

  const homeWin = game.homeScore > game.awayScore;
  const awayWin = game.awayScore > game.homeScore;

  // この試合のポゼッション数を1つに確定させる（公式POSS値、無ければ推定値）。
  // 自チーム/相手チーム行のいずれに合算する場合も同じ値を使う
  const gamePoss = gamePossession(homeRow, awayRow);

  // teams.jsonのシーズン集計（totals・wins/losses）はレギュラーシーズンのみ加算する。
  // プレーオフの試合もgameLogsには残すため、フロントエンドのシチュエーション別フィルタでは
  // 合算参照できる
  // ベンチ得点・スタメン得点・国籍区分別得点（Batch 1・2、全チームスタッツ「スコアリング」
  // タブ等のシチュエーション別フィルタ再集計用にレギュラー/プレーオフ問わず必要なため
  // gameTypeゲートの外で算出する）
  const individualRows = [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores];
  const homeBench = benchPointsForGame(individualRows, game.homeTeam.id);
  const awayBench = benchPointsForGame(individualRows, game.awayTeam.id);
  const homeStarter = starterPointsForGame(individualRows, game.homeTeam.id);
  const awayStarter = starterPointsForGame(individualRows, game.awayTeam.id);
  const homeClassification = classificationPointsForGame(individualRows, game.homeTeam.id, masterById);
  const awayClassification = classificationPointsForGame(individualRows, game.awayTeam.id, masterById);

  if (gameType === "regular") {
    // opponentTotalsもgamesPlayedを数える（perGame算出の分母は「自チームの試合数」と一致させる必要がある）。
    // teamNetForGame（オンコート/オフコート算出用）は個人集計専用なのでチーム集計では常に0を渡す
    const homeTechnicalFouls = technicalFoulsByTeam.get(game.homeTeam.id) ?? 0;
    const awayTechnicalFouls = technicalFoulsByTeam.get(game.awayTeam.id) ?? 0;
    addBoxscoreRow(home.totals, homeRow, true, 0, undefined, gamePoss, homeTechnicalFouls);
    addBoxscoreRow(home.opponentTotals, awayRow, true, 0, undefined, gamePoss, awayTechnicalFouls);
    addBoxscoreRow(away.totals, awayRow, true, 0, undefined, gamePoss, awayTechnicalFouls);
    addBoxscoreRow(away.opponentTotals, homeRow, true, 0, undefined, gamePoss, homeTechnicalFouls);

    // ベンチ得点・スタメン得点・国籍区分別得点はaddBoxscoreRow経由のチーム行集計とは別に、
    // 個人行から直接算出する（Phase H8。opponentTotals側にも相手チームの視点で加算する）
    home.totals.benchPoints += homeBench;
    away.totals.benchPoints += awayBench;
    home.opponentTotals.benchPoints += awayBench;
    away.opponentTotals.benchPoints += homeBench;

    home.totals.starterPoints += homeStarter;
    away.totals.starterPoints += awayStarter;
    home.opponentTotals.starterPoints += awayStarter;
    away.opponentTotals.starterPoints += homeStarter;

    const homeNaturalizedOrAsian = homeClassification.naturalized + homeClassification.asianQuota;
    const awayNaturalizedOrAsian = awayClassification.naturalized + awayClassification.asianQuota;
    const homeInternational = homeClassification.foreign + homeNaturalizedOrAsian;
    const awayInternational = awayClassification.foreign + awayNaturalizedOrAsian;
    home.totals.japanesePoints += homeClassification.japanese;
    home.totals.internationalPoints += homeInternational;
    home.totals.foreignPoints += homeClassification.foreign;
    home.totals.naturalizedOrAsianPoints += homeNaturalizedOrAsian;
    away.totals.japanesePoints += awayClassification.japanese;
    away.totals.internationalPoints += awayInternational;
    away.totals.foreignPoints += awayClassification.foreign;
    away.totals.naturalizedOrAsianPoints += awayNaturalizedOrAsian;
    home.opponentTotals.japanesePoints += awayClassification.japanese;
    home.opponentTotals.internationalPoints += awayInternational;
    home.opponentTotals.foreignPoints += awayClassification.foreign;
    home.opponentTotals.naturalizedOrAsianPoints += awayNaturalizedOrAsian;
    away.opponentTotals.japanesePoints += homeClassification.japanese;
    away.opponentTotals.internationalPoints += homeInternational;
    away.opponentTotals.foreignPoints += homeClassification.foreign;
    away.opponentTotals.naturalizedOrAsianPoints += homeNaturalizedOrAsian;

    // ペイント内得点（Phase H10、得点構成の可視化用）。既存のpitpByTeam（PBPタグ集計）を
    // シーズン合計する。個人単位のPITP（processPlayers側）とは独立した集計
    const homePitpForSeason = pitpByTeam.get(game.homeTeam.id) ?? 0;
    const awayPitpForSeason = pitpByTeam.get(game.awayTeam.id) ?? 0;
    home.totals.paintPoints += homePitpForSeason;
    away.totals.paintPoints += awayPitpForSeason;
    home.opponentTotals.paintPoints += awayPitpForSeason;
    away.opponentTotals.paintPoints += homePitpForSeason;

    // 自チーム外国籍選手同時出場人数別の在コート秒数（Phase H9、DESIGN.md参照）。
    // バケットは0〜5（非日本人の人数）で出てくるが、4人を超える組み合わせは
    // 「4人」バケットにまとめる（2026-09-23に「3人以上」から3人/4人に分割。5人はオールスター戦の
    // アジアオールスターズでしか発生せず、オールスター戦は集計対象外のため実質的には4人ちょうど）
    const homeForeignBuckets = foreignPlayerCourtSeconds.get(game.homeTeam.id);
    if (homeForeignBuckets) {
      for (const [bucket, seconds] of homeForeignBuckets) {
        const clamped = Math.min(bucket, 4);
        home.foreignPlayerCourtSeconds[clamped] = home.foreignPlayerCourtSeconds[clamped]! + seconds;
      }
    }
    const awayForeignBuckets = foreignPlayerCourtSeconds.get(game.awayTeam.id);
    if (awayForeignBuckets) {
      for (const [bucket, seconds] of awayForeignBuckets) {
        const clamped = Math.min(bucket, 4);
        away.foreignPlayerCourtSeconds[clamped] = away.foreignPlayerCourtSeconds[clamped]! + seconds;
      }
    }

    if (homeWin) {
      home.wins += 1;
      away.losses += 1;
    } else if (awayWin) {
      away.wins += 1;
      home.losses += 1;
    }
  }

  const attendance = game.raw.Game.Attendance ?? undefined;

  home.gameLogs.push({
    scheduleKey: game.scheduleKey,
    date: game.date,
    opponentTeamId: game.awayTeam.id,
    opponentTeamName: game.awayTeam.name,
    isHome: true,
    teamScore: game.homeScore,
    opponentScore: game.awayScore,
    win: homeWin,
    gameType,
    foreignPlayerCount: foreignPlayerCounts.get(game.homeTeam.id),
    opponentForeignPlayerCount: foreignPlayerCounts.get(game.awayTeam.id),
    ...teamGameLogStats(homeRow, gamePoss),
    ...opponentGameLogStats(awayRow),
    pt2in: pitpByTeam.get(game.homeTeam.id) ?? 0,
    fb: fbpsByTeam.get(game.homeTeam.id) ?? 0,
    pt2nd: secondChanceByTeam.get(game.homeTeam.id) ?? 0,
    pft: ptsOffTovByTeam.get(game.homeTeam.id) ?? 0,
    dunks: miscEventsByTeam.get(game.homeTeam.id)?.dunks ?? 0,
    opponentPt2in: pitpByTeam.get(game.awayTeam.id) ?? 0,
    opponentFb: fbpsByTeam.get(game.awayTeam.id) ?? 0,
    opponentPt2nd: secondChanceByTeam.get(game.awayTeam.id) ?? 0,
    opponentPft: ptsOffTovByTeam.get(game.awayTeam.id) ?? 0,
    opponentDunks: miscEventsByTeam.get(game.awayTeam.id)?.dunks ?? 0,
    ...teamMiscExtraGameLogStats(
      game.homeTeam.id,
      game.awayTeam.id,
      technicalFoulsByTeam,
      miscEventsByTeam,
      assistedScoringByTeam,
      paintSplitByTeam,
    ),
    attendance,
    benchPoints: homeBench,
    starterPoints: homeStarter,
    japanesePoints: homeClassification.japanese,
    foreignPoints: homeClassification.foreign,
    naturalizedPoints: homeClassification.naturalized,
    asianQuotaPoints: homeClassification.asianQuota,
    naturalizedOrAsianPoints: homeClassification.naturalized + homeClassification.asianQuota,
    opponentJapanesePoints: awayClassification.japanese,
    opponentForeignPoints: awayClassification.foreign,
    opponentNaturalizedPoints: awayClassification.naturalized,
    opponentAsianQuotaPoints: awayClassification.asianQuota,
    opponentNaturalizedOrAsianPoints: awayClassification.naturalized + awayClassification.asianQuota,
  });
  away.gameLogs.push({
    scheduleKey: game.scheduleKey,
    date: game.date,
    opponentTeamId: game.homeTeam.id,
    opponentTeamName: game.homeTeam.name,
    isHome: false,
    teamScore: game.awayScore,
    opponentScore: game.homeScore,
    win: awayWin,
    foreignPlayerCount: foreignPlayerCounts.get(game.awayTeam.id),
    opponentForeignPlayerCount: foreignPlayerCounts.get(game.homeTeam.id),
    gameType,
    ...teamGameLogStats(awayRow, gamePoss),
    ...opponentGameLogStats(homeRow),
    pt2in: pitpByTeam.get(game.awayTeam.id) ?? 0,
    fb: fbpsByTeam.get(game.awayTeam.id) ?? 0,
    pt2nd: secondChanceByTeam.get(game.awayTeam.id) ?? 0,
    pft: ptsOffTovByTeam.get(game.awayTeam.id) ?? 0,
    dunks: miscEventsByTeam.get(game.awayTeam.id)?.dunks ?? 0,
    opponentPt2in: pitpByTeam.get(game.homeTeam.id) ?? 0,
    opponentFb: fbpsByTeam.get(game.homeTeam.id) ?? 0,
    opponentPt2nd: secondChanceByTeam.get(game.homeTeam.id) ?? 0,
    opponentPft: ptsOffTovByTeam.get(game.homeTeam.id) ?? 0,
    opponentDunks: miscEventsByTeam.get(game.homeTeam.id)?.dunks ?? 0,
    ...teamMiscExtraGameLogStats(
      game.awayTeam.id,
      game.homeTeam.id,
      technicalFoulsByTeam,
      miscEventsByTeam,
      assistedScoringByTeam,
      paintSplitByTeam,
    ),
    attendance,
    benchPoints: awayBench,
    starterPoints: awayStarter,
    japanesePoints: awayClassification.japanese,
    foreignPoints: awayClassification.foreign,
    naturalizedPoints: awayClassification.naturalized,
    asianQuotaPoints: awayClassification.asianQuota,
    naturalizedOrAsianPoints: awayClassification.naturalized + awayClassification.asianQuota,
    opponentJapanesePoints: homeClassification.japanese,
    opponentForeignPoints: homeClassification.foreign,
    opponentNaturalizedPoints: homeClassification.naturalized,
    opponentAsianQuotaPoints: homeClassification.asianQuota,
    opponentNaturalizedOrAsianPoints: homeClassification.naturalized + homeClassification.asianQuota,
  });
}

/** 日程ページ（#/schedule）用の1試合1行サマリを作る。日付→ScheduleKey順にソートする */
function buildGameSummaries(games: StoredGame[]): GameSummary[] {
  return [...games]
    .map((g) => ({
      scheduleKey: g.scheduleKey,
      date: g.date,
      homeTeamId: g.homeTeam.id,
      homeTeamName: g.homeTeam.name,
      awayTeamId: g.awayTeam.id,
      awayTeamName: g.awayTeam.name,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      gameEndedFlg: g.gameEndedFlg,
      gameType: classifyGameType(g.raw.Game.ConventionNameJ),
      venue: g.raw.Game.StadiumNameJ || undefined,
      attendance: g.raw.Game.Attendance ?? undefined,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
}

interface StandingsAccumulator {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

interface HeadToHeadTally {
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** チームID→対戦相手ID→直接対決成績。シーズンを日付順に走査しながら累積する */
type HeadToHeadTable = Map<string, Map<string, HeadToHeadTally>>;

function recordHeadToHeadResult(
  table: HeadToHeadTable,
  teamId: string,
  opponentId: string,
  win: boolean,
  pointsFor: number,
  pointsAgainst: number,
): void {
  let byOpponent = table.get(teamId);
  if (!byOpponent) {
    byOpponent = new Map();
    table.set(teamId, byOpponent);
  }
  let tally = byOpponent.get(opponentId);
  if (!tally) {
    tally = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    byOpponent.set(opponentId, tally);
  }
  if (win) tally.wins += 1;
  else tally.losses += 1;
  tally.pointsFor += pointsFor;
  tally.pointsAgainst += pointsAgainst;
}

interface StandingsCompareEntry {
  teamId: string;
  winPct: number;
  pointDiff: number;
  pointsFor: number;
  wins: number;
  losses: number;
}

/** 2026-27〜のB.PREMIERフォーマット（東西2地区・各地区上位3＋ワイルドカード2、全チーム60試合） */
const PREMIER_2026_FIRST_SEASON = "2026-27";
const PREMIER_2026_GAMES_PER_TEAM = 60;

/**
 * data/{season}/playoff-race.jsonを作る。2026-27〜はマジックナンバーと進出/敗退判定、それ以前の
 * シーズンは地区制・CS形式が毎年異なるため年間優勝のみ（club-honors.jsonのCS優勝から引く）
 */
async function buildPlayoffRace(
  season: string,
  seasonDir: string,
  games: StoredGame[],
  standingsHistory: StandingsSnapshot[],
  divisionHistory: DivisionHistoryFile,
): Promise<PlayoffRaceFile> {
  const latest = standingsHistory.at(-1);
  const asOf = latest?.date ?? null;

  if (season < PREMIER_2026_FIRST_SEASON) {
    const honors = (await readJson<Record<string, { competition: string; season: string }[]>>(
      path.join(DATA_DIR, "club-honors.json"),
    )) ?? {};
    const championId = Object.entries(honors).find(([, list]) =>
      list.some((h) => h.season === season && h.competition.includes("チャンピオンシップ優勝")),
    )?.[0];
    return {
      season,
      format: "legacy",
      asOf,
      teams: (latest?.teams ?? []).map((t) => ({
        teamId: t.teamId,
        teamName: t.teamName,
        division: t.division,
        wins: t.wins,
        losses: t.losses,
        remaining: 0,
        ...(t.teamId === championId ? { champion: true } : {}),
      })),
    };
  }

  const seasonDivisions = divisionHistory.premier?.[season] ?? {};
  const teamIds = Object.keys(seasonDivisions);
  const standingById = new Map((latest?.teams ?? []).map((t) => [t.teamId, t]));

  // 残り試合: 日程（upcomingGames）から、生データを取得済みの試合を除く。upcomingGamesは
  // 日程取得のタイミングによって消化済みの試合が残っていることがある
  const storedKeys = new Set(games.map((g) => g.scheduleKey));
  const schedule = await readJson<ScheduleFile>(path.join(DATA_DIR, seasonDir, "schedule.json"));
  const idByName = new Map<string, string>(Object.entries(TEAM_NAMES).map(([id, name]) => [name, id]));
  for (const g of games) {
    idByName.set(g.homeTeam.name, g.homeTeam.id);
    idByName.set(g.awayTeam.name, g.awayTeam.id);
  }
  const remaining = new Map<string, number>();
  const unknownNames = new Set<string>();
  for (const g of schedule?.upcomingGames ?? []) {
    if (storedKeys.has(g.scheduleKey)) continue;
    for (const name of [g.homeTeamName, g.awayTeamName]) {
      const id = idByName.get(name);
      if (!id) unknownNames.add(name);
      else remaining.set(id, (remaining.get(id) ?? 0) + 1);
    }
  }

  const inputs: RaceTeamInput[] = teamIds.map((teamId) => {
    const s = standingById.get(teamId);
    return {
      teamId,
      teamName: s?.teamName ?? TEAM_NAMES[teamId],
      division: seasonDivisions[teamId]!,
      wins: s?.wins ?? 0,
      losses: s?.losses ?? 0,
      remaining: remaining.get(teamId) ?? 0,
      divisionRank: s?.divisionRank,
      overallRank: s?.rank,
    };
  });

  // 日程が欠けていると残り試合を少なく見積もり、誤って確定を出してしまう。安全側に倒し、
  // 全チームの「勝ち＋負け＋残り」が規定の試合数に一致しない場合は判定を出さない
  let unavailableReason: string | undefined;
  if (unknownNames.size > 0) {
    unavailableReason = `日程のチーム名を特定できない: ${[...unknownNames].join("、")}`;
  } else {
    const mismatched = inputs.filter((t) => t.wins + t.losses + t.remaining !== PREMIER_2026_GAMES_PER_TEAM);
    if (teamIds.length === 0) unavailableReason = "地区データが無い";
    else if (mismatched.length > 0) {
      unavailableReason =
        `日程データが不完全（勝ち＋負け＋残りが${PREMIER_2026_GAMES_PER_TEAM}試合にならない: ` +
        mismatched.map((t) => `${TEAM_NAMES[t.teamId] ?? t.teamId}=${t.wins + t.losses + t.remaining}`).join("、") +
        "）";
    }
  }

  const championId = premierChampion(
    games
      .filter((g) => classifyGameType(g.raw.Game.ConventionNameJ) === "playoff" && g.gameEndedFlg)
      .map((g) => ({
        date: g.date,
        homeTeamId: g.homeTeam.id,
        awayTeamId: g.awayTeam.id,
        homeScore: g.homeScore,
        awayScore: g.awayScore,
      })),
  );

  if (unavailableReason) {
    console.warn(`[${season}] playoff-race: 進出/敗退判定を出さない（${unavailableReason}）`);
    return {
      season,
      format: "premier-2026",
      asOf,
      unavailableReason,
      teams: inputs.map((t) => ({
        teamId: t.teamId,
        teamName: t.teamName,
        division: t.division,
        wins: t.wins,
        losses: t.losses,
        remaining: t.remaining,
        ...(t.teamId === championId ? { champion: true } : {}),
      })),
    };
  }

  const race = computePremierRace(season, asOf, inputs);
  for (const t of race.teams) if (t.teamId === championId) t.champion = true;
  return race;
}

/**
 * 順位表（全体・地区内とも）が共有するタイブレーク判定。公式ルール（DESIGN.md参照）:
 * ①勝率 → ②直接対決の勝率 → ③直接対決の得失点差 → ④直接対決の1試合平均得点 →
 * ⑤シーズン全体の得失点差 → ⑥シーズン全体の1試合平均得点 → ⑦抽選。
 * ⑦のみ実装不可のため、teamId昇順の決定論的な順序で代用する。3クラブ以上の同率は、優劣が
 * ついたクラブを確定させて残りを②から判定し直す再帰方式（`resolveTiedGroupByHeadToHead`
 * 参照）。全体順位・地区内順位のどちらも必ずこの関数を経由させるため、この1箇所を直せば
 * 両方に反映される。
 */
function rankStandingsTeams<T extends StandingsCompareEntry>(teams: T[], headToHead: HeadToHeadTable): T[] {
  const byWinPctDesc = [...teams].sort((a, b) => b.winPct - a.winPct);
  const result: T[] = [];
  let i = 0;
  while (i < byWinPctDesc.length) {
    let j = i + 1;
    while (j < byWinPctDesc.length && byWinPctDesc[j]!.winPct === byWinPctDesc[i]!.winPct) {
      j += 1;
    }
    result.push(...resolveTiedGroupByHeadToHead(byWinPctDesc.slice(i, j), headToHead));
    i = j;
  }
  return result;
}

/**
 * 勝率が同率のグループを、公式タイブレーク（2026-27 B.PREMIERリーグ戦フォーマット、
 * bleague.jp/regulation/?tab=1。DESIGN.md参照）で並べ替える:
 * (1)当該クラブ間の直接対決の勝率 → (2)当該クラブ間の得失点差 → (3)当該クラブ間の1試合平均得点 →
 * (4)シーズン全体の得失点差 → (5)シーズン全体の1試合平均得点 → (6)抽選（実装不可のため
 * teamId昇順で代用する）。
 *
 * 3クラブ以上が同率の場合は公式ルールどおり再帰的に決める: ある基準で一部のクラブと他のクラブの
 * 間に優劣がついたら、その優劣関係を確定させ、優劣がつかなかったクラブ同士（部分グループ）で
 * **(1)から**改めて判定し直す（直接対決の成績も、その部分グループ内の対戦だけで数え直す）。
 *
 * 直接対決（(1)〜(3)）は、判定対象のグループ内の全ペアが最低1試合ずつ対戦済み（総当たりが
 * 揃っている）場合のみ適用する。シーズン序盤等で一部のペアがまだ対戦していない場合、その
 * 未対戦チームを「0勝（最下位）」として扱ってしまう（未対戦と0%勝率を混同する）のを避けるため、
 * 総当たりが揃っていなければ(1)〜(3)をスキップして(4)以降で判定する（本サイト独自の扱い。
 * 公式ルールは全日程終了後の最終順位を前提としている）。
 */
function resolveTiedGroupByHeadToHead<T extends StandingsCompareEntry>(
  group: T[],
  headToHead: HeadToHeadTable,
): T[] {
  if (group.length <= 1) return group;

  const idsInGroup = new Set(group.map((t) => t.teamId));
  const hasPlayedEveryOther = group.every((team) => {
    const opponents = headToHead.get(team.teamId);
    return group.every((other) => {
      if (other.teamId === team.teamId) return true;
      const tally = opponents?.get(other.teamId);
      return !!tally && tally.wins + tally.losses > 0;
    });
  });

  // (1)〜(3)は、このグループ内の対戦だけを集計する（再帰で部分グループになったら数え直す）
  const h2h = new Map<string, { winPct: number; pointDiff: number; avgPoints: number }>();
  if (hasPlayedEveryOther) {
    for (const team of group) {
      let wins = 0;
      let losses = 0;
      let pointsFor = 0;
      let pointsAgainst = 0;
      for (const [opponentId, tally] of headToHead.get(team.teamId) ?? []) {
        if (!idsInGroup.has(opponentId)) continue;
        wins += tally.wins;
        losses += tally.losses;
        pointsFor += tally.pointsFor;
        pointsAgainst += tally.pointsAgainst;
      }
      h2h.set(team.teamId, {
        winPct: safeDiv(wins, wins + losses),
        pointDiff: pointsFor - pointsAgainst,
        avgPoints: safeDiv(pointsFor, wins + losses),
      });
    }
  }

  const criteria: ((t: T) => number)[] = [
    ...(hasPlayedEveryOther
      ? [
          (t: T) => h2h.get(t.teamId)!.winPct,
          (t: T) => h2h.get(t.teamId)!.pointDiff,
          (t: T) => h2h.get(t.teamId)!.avgPoints,
        ]
      : []),
    (t: T) => t.pointDiff,
    (t: T) => safeDiv(t.pointsFor, t.wins + t.losses),
  ];

  for (const criterion of criteria) {
    const partitions = partitionByValueDesc(group, criterion);
    if (partitions.length > 1) {
      // 優劣がついた。各部分グループ（同値のクラブ同士）は(1)から判定し直す
      return partitions.flatMap((sub) => resolveTiedGroupByHeadToHead(sub, headToHead));
    }
  }

  // (6)抽選は実装不可のため、teamId昇順の決定論的な順序で代用する
  return [...group].sort((a, b) => a.teamId.localeCompare(b.teamId));
}

/** 値の降順に、同値（浮動小数点の誤差は許容）のチーム同士をまとめたグループの配列にする */
function partitionByValueDesc<T>(items: T[], valueOf: (item: T) => number): T[][] {
  const EPSILON = 1e-9;
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const groups: T[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(valueOf(last[0]!) - valueOf(item)) < EPSILON) last.push(item);
    else groups.push([item]);
  }
  return groups;
}

/**
 * シーズン全試合を日付順に走査し、日付ごとの各チームの累積成績スナップショットを作る。
 * 同率の順位付けは`rankStandingsTeams()`（公式タイブレークルール、DESIGN.md参照）に
 * 集約してある。全体順位・地区内順位のどちらもこの1関数を経由する。
 */
function buildStandingsHistory(
  games: StoredGame[],
  category: Category,
  divisionHistory: DivisionHistoryFile,
  season: string,
): StandingsSnapshot[] {
  const sorted = [...games].sort(
    (a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey),
  );
  const accumulators = new Map<string, StandingsAccumulator>();
  const headToHead: HeadToHeadTable = new Map();

  const ensure = (teamId: string, teamName: string): StandingsAccumulator => {
    let acc = accumulators.get(teamId);
    if (!acc) {
      acc = { teamId, teamName, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
      accumulators.set(teamId, acc);
    }
    acc.teamName = teamName;
    return acc;
  };

  const history: StandingsSnapshot[] = [];
  let i = 0;
  while (i < sorted.length) {
    const date = sorted[i]!.date;

    while (i < sorted.length && sorted[i]!.date === date) {
      const game = sorted[i]!;
      const home = ensure(game.homeTeam.id, game.homeTeam.name);
      const away = ensure(game.awayTeam.id, game.awayTeam.name);
      home.pointsFor += game.homeScore;
      home.pointsAgainst += game.awayScore;
      away.pointsFor += game.awayScore;
      away.pointsAgainst += game.homeScore;
      const homeWin = game.homeScore > game.awayScore;
      if (homeWin) {
        home.wins += 1;
        away.losses += 1;
      } else {
        away.wins += 1;
        home.losses += 1;
      }
      recordHeadToHeadResult(headToHead, home.teamId, away.teamId, homeWin, game.homeScore, game.awayScore);
      recordHeadToHeadResult(headToHead, away.teamId, home.teamId, !homeWin, game.awayScore, game.homeScore);
      i += 1;
    }

    const withStats = [...accumulators.values()].map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      wins: t.wins,
      losses: t.losses,
      winPct: safeDiv(t.wins, t.wins + t.losses),
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      pointDiff: t.pointsFor - t.pointsAgainst,
    }));
    const ranked = rankStandingsTeams(withStats, headToHead);

    const leader = ranked[0];
    const teams = ranked.map((t, idx) => ({
      ...t,
      rank: idx + 1,
      gamesBehind: leader ? (leader.wins - t.wins + (t.losses - leader.losses)) / 2 : 0,
    }));

    history.push({ date, teams: attachDivisionRanks(teams, category, divisionHistory, season, headToHead) });
  }

  return history;
}

/**
 * 全体ランキング済みのteamsに、地区（東/西）ごとの順位・地区首位とのゲーム差を付与する。
 * タイブレークは全体順位と全く同じ`rankStandingsTeams()`を地区内メンバーだけに適用する
 * （DESIGN.md参照）。divisionHistory（data/division-history.json、シーズン対応版マスタ）に
 * そのシーズンのデータが無いチーム（未取得の未来シーズン等）はdivision系が未定義のまま
 */
function attachDivisionRanks(
  teams: Omit<StandingsTeamSnapshot, "division" | "divisionRank" | "divisionGamesBehind">[],
  category: Category,
  divisionHistory: DivisionHistoryFile,
  season: string,
  headToHead: HeadToHeadTable,
): StandingsTeamSnapshot[] {
  const withDivision: StandingsTeamSnapshot[] = teams.map((t) => ({
    ...t,
    division: teamDivisionForSeason(divisionHistory, t.teamId, season, category),
  }));

  const byDivision = new Map<Division, StandingsTeamSnapshot[]>();
  for (const t of withDivision) {
    if (!t.division) continue;
    const list = byDivision.get(t.division) ?? [];
    list.push(t);
    byDivision.set(t.division, list);
  }

  for (const list of byDivision.values()) {
    const ranked = rankStandingsTeams(list, headToHead);
    const divLeader = ranked[0]!;
    ranked.forEach((t, idx) => {
      t.divisionRank = idx + 1;
      t.divisionGamesBehind = (divLeader.wins - t.wins + (t.losses - divLeader.losses)) / 2;
    });
  }

  return withDivision;
}

/**
 * チームごとのgameLogs（team-games/{teamId}.json相当）から、対戦相手ごとのペアワイズ成績
 * （W-L・合計得失点差）と、地区別（対東地区/対西地区）のまとめを作る（星取り表ページ用）。
 * 対戦していない相手はvsに含めない（フロントエンドでダッシュ/空欄表示にする）。
 *
 * ⚠️ vsEast/vsWestはB.PREMIERの東西2地区専用のフィールドのまま（B.ONEの5地区
 * （北/東/中/西/南）には未対応）。B.ONEでcategoryを渡してもteamDivisionForSeason()自体は
 * 正しい地区値（north/east/central/west/south）を返すが、この関数が集計するのは
 * division==="east"/"west"の2つのみのため、B.ONEの北/中/南地区との対戦成績はvsEast/vsWestに
 * 含まれず事実上欠落する（vs自体・overallには影響なし）。フロントエンドでB.ONEの地区別集計を
 * 表示する段になったら、5地区対応の汎用的な集計に拡張すること
 */
function buildHeadToHead(
  teams: Map<string, TeamAccumulator>,
  category: Category,
  divisionHistory: DivisionHistoryFile,
  season: string,
): HeadToHeadTeamRow[] {
  const withPct = (wins: number, losses: number) => ({ wins, losses, winPct: safeDiv(wins, wins + losses) });

  const rows = [...teams.values()].map((team) => {
    const vs = new Map<string, HeadToHeadRecord>();
    // 星取り表もプレーオフの結果に左右されないよう、レギュラーシーズンの試合のみ集計する
    for (const log of team.gameLogs.filter((l) => l.gameType === "regular")) {
      let rec = vs.get(log.opponentTeamId);
      if (!rec) {
        rec = { wins: 0, losses: 0, pointDiff: 0 };
        vs.set(log.opponentTeamId, rec);
      }
      if (log.win) rec.wins += 1;
      else rec.losses += 1;
      rec.pointDiff += log.teamScore - log.opponentScore;
    }

    let eastWins = 0;
    let eastLosses = 0;
    let westWins = 0;
    let westLosses = 0;
    for (const [opponentTeamId, rec] of vs) {
      const division = teamDivisionForSeason(divisionHistory, opponentTeamId, season, category);
      if (division === "east") {
        eastWins += rec.wins;
        eastLosses += rec.losses;
      } else if (division === "west") {
        westWins += rec.wins;
        westLosses += rec.losses;
      }
    }

    return {
      teamId: team.teamId,
      teamName: team.teamName,
      division: teamDivisionForSeason(divisionHistory, team.teamId, season, category),
      vs: Object.fromEntries(vs),
      overall: withPct(team.wins, team.losses),
      vsEast: withPct(eastWins, eastLosses),
      vsWest: withPct(westWins, westLosses),
    };
  });

  return rows.sort((a, b) => b.overall.wins - a.overall.wins);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error("使い方: aggregate.ts --season 2025-26 [--category one]");
    process.exitCode = 1;
    return;
  }
  const categoryIndex = args.indexOf("--category");
  const category: Category = categoryIndex !== -1 ? (args[categoryIndex + 1] as Category) : "premier";
  await aggregateSeason(season, category);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
