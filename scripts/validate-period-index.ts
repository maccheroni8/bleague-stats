// ピリオド別の索引（data/{season}/player-period-index.json.gz・team-period-index.json.gz。DESIGN.md 225章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（導出データを作ったあと、`npm run build:data` のあとに実行する）:
//  1. 形の確認: 版・結び付け先の行数・(row, period) の昇順と重複なし・前後半5分の特別な試合に行が無い・延長の行は延長のあった試合だけ・
//     試合に出た選手（出場が数秒だけの1件を除く）はすべて、どれかの区間の行を持つ・+/- の旗は2022-23以降だけ
//  2. 区間の合計 = 試合全体: 1Q〜4Q＋延長の合計が、1試合行の索引の値（出場時間は±2秒まで）と、試合全体を同じ関数で出した全項目の値に、全行一致する
//  3. 前半・後半: 直接（ピリオド1・2／3・4）出した値が、1Q+2Q／3Q+4Q の合計と全行一致する
//  4. シーズン成績のQ別・前後半との一致: シーズン成績のQ別が使う関数（computeGamePeriodTotals と buildPeriodFilteredRawTotals）の結果と、この索引の値から
//     同じ形（GamePeriodTotals）に組み立てて同じ関数に通した結果が、全選手・6区間（1Q〜4Q・前半・後半）で全項目一致する（前後半5分の特別な試合は、索引が行を持たないので除く）。
//     チームの合計（自チーム・相手・ポゼッション）も同じ
//  5. チームの表: 自チームの値が試合全体の合計と一致する、区間の得点が公式のクォーター別スコアと一致する、延長の無い試合の延長・特別な試合の1Q〜4Qが -1
//  6. 選手の得点の合計と、チームの区間の得点: 一致する（公式の記録の食い違いが既知の7区間〔2016-17の7試合〕あり、一覧と過不足なく一致。2020-21 の試合5858の2区間は、
//     2026-10-17 から手で補う選手〔shared/boxscoreNameFills.ts〕を集計にも当てたので一致する）
//  9. チームの追加の列（256章の段階1）: 区間（1Q〜4Q＋延長）の合計が、チームの試合ログ（team-games）の同じ項目と全試合で一致する。人数別の在コート秒数（oc0〜oc4）の
//     区間の合計が、試合ログの foreignCourtSeconds と一致し（無い試合はすべての区間で -1）、試合ログの自チーム・相手の値が、相手の試合ログと食い違わない。
//     レギュラーシーズンの試合ログの合計が teams.json の foreignPlayerCourtSeconds（On-Court Foreign）と一致する。2016-17〜2019-20 の延長の秒数の合計が延長の長さになる
// 10. 人数別の得点・失点・攻撃回数（256章の段階3の作り直しの回）: 試合全体（all）の秒数＝試合ログ、区間の合計＝試合全体（特別な試合を除く）、
//     チームのシーズンの合計＝よく使われるラインナップを人数ごとに足した値、攻撃回数は 2020-21 以降だけ
//  7. 感度: 値を1か所壊すと食い違いとして検出される
//  8. 読む側（1試合記録の集計 queryPlayerGameRecords に区間を渡した結果）: 全区間（1Q〜4Q・前半・後半・延長）×すべての個数の項目の1位（値と同率の行数）が、試合の生データから別に数えた最大値と一致する。
//     勝った試合・3PM 3以上の条件つきの前半の得点の1位も一致する。画面の確認に使う3つの例（1Qの最多得点・前半の最多3P・延長の最多得点。データが増えると変わるので、値を出力するだけ）
//
// 使い方: npm run validate:period-index [-- --season 2025-26]（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { isManualBoxscoreKey } from "./lib/manualBoxscores.ts";
import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import {
  PERIOD_ATOMS,
  PERIOD_INDEX_VERSION,
  PERIOD_POSS_KEYS,
  PERIOD_ROW_FLAG_PLUS_MINUS,
  PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED,
  PLAYER_PERIOD_STAT_COLUMNS,
  TEAM_PERIOD_COUNT_COLUMNS,
  TEAM_PERIOD_EXTRA_COLUMNS,
  TEAM_PERIOD_FOREIGN_COLUMNS,
  TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS,
  TEAM_PERIOD_WHOLE_GAME_KEY,
  type PeriodAtom,
  type PeriodPossKey,
  type PlayerPeriodIndexFile,
  type PlayerPeriodStatColumn,
  type TeamPeriodIndexFile,
} from "../shared/periodIndex.ts";
import { GAME_FLAG_SHORT, PLAYER_INDEX_STAT_COLUMNS, ROW_FLAG_HOME, ROW_FLAG_STARTER, type PlayerGameIndexFile, type TeamGameIndexFile } from "../shared/gameIndex.ts";
import { gamePeriodScores, overtimeCount } from "../shared/gamePeriods.ts";
import type { PlayerSummary, SeasonRules, StoredGame, TeamGameLog, TeamLineupsFile, TeamSummary } from "../shared/types.ts";
import { foreignCountBucket } from "../src/lib/gameLineups";
import { foreignCountInLineup } from "../shared/foreignOnCourt.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS } from "../src/lib/gameRecordConditions";
import { PLAYER_STAT_CONDITION_ITEMS, playerQueryStats, queryPlayerGameRecords } from "../src/lib/gameRecordQuery";
import { viewPlayerGameIndex } from "../src/lib/gameIndex";
import { PERIOD_ATOM_INDEXES, viewPlayerPeriodIndex, type GameRecordPeriod, type PlayerPeriodView } from "../src/lib/periodIndex";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions";
import { buildPlayerBoxscores, buildTeamTotalCounts, sumCounts, type BoxscoreCounts } from "../src/lib/boxscoreAggregate";
import { buildPeriodRangeOptions, type PeriodRangeOption } from "../src/lib/periodRange";
import {
  SEASON_BOX_PERIOD_OPTIONS,
  buildPeriodFilteredRawTotals,
  computeGamePeriodTotals,
  computeGameTeamPeriodTotals,
  type GamePeriodTotals,
  reconstructedPlusMinusOf,
} from "../src/lib/playerSeasonBoxscore";

const args = process.argv.slice(2);
const onlySeason = args.includes("--season") ? args[args.indexOf("--season") + 1] : undefined;
const SEASONS = ["2016-17", "2017-18", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"].filter((s) => !onlySeason || s === onlySeason);

let failures = 0;
const checks = { ok: 0, ng: 0 };
/** 感度の確認で、わざと壊した索引の判定を数えるとき（結果を出力せず、NG の数だけ数える） */
let capture: { ng: number } | null = null;
function ok(name: string, cond: boolean, detail = ""): void {
  if (capture) {
    if (!cond) capture.ng += 1;
    return;
  }
  console.log(`${cond ? "ok" : "NG"} ${name}${cond ? "" : ` ${detail}`}`);
  if (cond) checks.ok += 1;
  else {
    checks.ng += 1;
    failures += 1;
  }
}

/**
 * 選手の得点の合計がチームの区間の得点と合わない（公式の記録の食い違い）区間。「シーズン|試合|区間」→ チームの得点 − 選手の合計。
 * 2016-17の7試合（選手に付けていない得点2点ずつ）。調査済み（DESIGN.md 225章）。2020-21 の5858（第1Q 6点・第4Q 3点。選手IDの無い三河 #22 の得点）は、
 * 2026-10-17 から手で補う選手（shared/boxscoreNameFills.ts。集計の入口 readAllGames が当てる）でセドリック・シモンズに付くので、食い違いが無くなった（256章）。
 * 区間の合計 = 試合全体の判定とは別で、試合全体の選手の合計も同じ（公式の選手の行をそのまま足している）
 */
const KNOWN_PLAYER_POINTS_GAPS = new Map<string, number>([
  ["2016-17|149|q1", 2],
  ["2016-17|182|q2", 2],
  ["2016-17|19|q2", 2],
  ["2016-17|215|q1", 2],
  ["2016-17|331|q3", 2],
  ["2016-17|341|q1", 2],
  ["2016-17|85|q2", 2],
]);

/** 試合の生データから別に数えた、区間×項目の最大値と、その値の行数（読む側の確認用。8） */
const RAW_COUNT_STATS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "stl", "blk", "blockedAgainst", "foulsDrawn", "pt2in", "ptfb", "pt2nd", "ptsOffTov", "dunks", "basketCounts", "minSec"] as const;
const RAW_PERIODS: GameRecordPeriod[] = ["q1", "q2", "q3", "q4", "h1", "h2", "ot"];
const rawMax = new Map<string, { max: number; count: number }>();
function bump(acc: Map<string, { max: number; count: number }>, key: string, v: number): void {
  const cur = acc.get(key);
  if (!cur || v > cur.max) acc.set(key, { max: v, count: 1 });
  else if (v === cur.max) cur.count += 1;
}
/** 条件つき（前半・勝った試合・3PM 3以上）の得点の最大値 */
const rawCondMax = new Map<string, { max: number; count: number }>();

const ATOM_OPTION_VALUES = ["q1", "q2", "q3", "q4", "ot"] as const;

function optionOf(game: StoredGame, value: string): PeriodRangeOption | null {
  return buildPeriodRangeOptions(4 + overtimeCount(game)).find((o) => o.value === value) ?? null;
}

/** BoxscoreCounts → 索引の列の値（検証用に、作成側とは別に書いた対応） */
function statsOf(c: BoxscoreCounts): Record<PlayerPeriodStatColumn, number> {
  return {
    minSec: c.minSec,
    pts: c.pts,
    fgm: c.pt2m + c.pt3m,
    fga: c.pt2a + c.pt3a,
    tpm: c.pt3m,
    tpa: c.pt3a,
    ftm: c.ftm,
    fta: c.fta,
    oreb: c.oreb,
    dreb: c.dreb,
    reb: c.treb,
    ast: c.ast,
    tov: c.tov,
    stl: c.stl,
    blk: c.blk,
    blockedAgainst: c.bson,
    foulsDrawn: c.foulon,
    plusMinus: c.hasPlusMinus ? c.plusMinus : 0,
    pt2in: c.pt2in,
    ptfb: c.ptfb,
    pt2nd: c.pt2nd,
    ptsOffTov: c.ptsOffTov,
    dunks: c.dunks,
    basketCounts: c.basketCounts,
    pf: c.foul,
    technicalFouls: c.technicalFouls,
    unsportsmanlikeFouls: c.unsportsmanlikeFouls,
    disqualifyingFouls: c.disqualifyingFouls,
    offensiveFoulsCommitted: c.offensiveFoulsCommitted,
    chargesDrawn: c.chargesDrawn,
    assisted2m: c.assisted2m,
    assisted3m: c.assisted3m,
    assistedFtm: c.assistedFtm,
    paint2m: c.paint2m,
    paint2a: c.paint2a,
    mid2m: c.nonPaint2m,
    mid2a: c.nonPaint2a,
  };
}

/** 索引の値から BoxscoreCounts を組み立てる（シーズン成績のQ別の関数に通すため） */
function countsFromStats(s: Record<PlayerPeriodStatColumn, number>, hasPlusMinus: boolean): BoxscoreCounts {
  return {
    ...sumCounts([]),
    minSec: s.minSec,
    pts: s.pts,
    pt2m: s.fgm - s.tpm,
    pt2a: s.fga - s.tpa,
    pt3m: s.tpm,
    pt3a: s.tpa,
    ftm: s.ftm,
    fta: s.fta,
    oreb: s.oreb,
    dreb: s.dreb,
    treb: s.reb,
    ast: s.ast,
    tov: s.tov,
    stl: s.stl,
    blk: s.blk,
    bson: s.blockedAgainst,
    foul: s.pf,
    foulon: s.foulsDrawn,
    plusMinus: s.plusMinus,
    hasPlusMinus,
    pt2in: s.pt2in,
    ptfb: s.ptfb,
    pt2nd: s.pt2nd,
    ptsOffTov: s.ptsOffTov,
    dunks: s.dunks,
    basketCounts: s.basketCounts,
    technicalFouls: s.technicalFouls,
    unsportsmanlikeFouls: s.unsportsmanlikeFouls,
    disqualifyingFouls: s.disqualifyingFouls,
    offensiveFoulsCommitted: s.offensiveFoulsCommitted,
    chargesDrawn: s.chargesDrawn,
    assisted2m: s.assisted2m,
    assisted3m: s.assisted3m,
    assistedFtm: s.assistedFtm,
    paint2m: s.paint2m,
    paint2a: s.paint2a,
    nonPaint2m: s.mid2m,
    nonPaint2a: s.mid2a,
  };
}

function zeroStats(): Record<PlayerPeriodStatColumn, number> {
  return Object.fromEntries(PLAYER_PERIOD_STAT_COLUMNS.map((c) => [c, 0])) as Record<PlayerPeriodStatColumn, number>;
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/** オブジェクトの数の項目を、すべて比べる。食い違いの項目名を返す（無ければ null） */
function diffObjects(a: object, b: object): string | null {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const va = x[k];
    const vb = y[k];
    if (typeof va === "number" || typeof vb === "number") {
      if (!sameNumber(Number(va ?? 0), Number(vb ?? 0))) return `${k}: ${String(va)} / ${String(vb)}`;
    }
  }
  return null;
}

interface SeasonData {
  season: string;
  playerIndex: PlayerGameIndexFile;
  teamIndex: TeamGameIndexFile;
  player: PlayerPeriodIndexFile;
  team: TeamPeriodIndexFile;
}

async function load(season: string): Promise<SeasonData | null> {
  const dir = path.join(DATA_DIR, season);
  const [playerIndex, teamIndex, player, team] = await Promise.all([
    readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json")),
    readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json")),
    readJson<PlayerPeriodIndexFile>(path.join(dir, "player-period-index.json")),
    readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json")),
  ]);
  if (!playerIndex || !teamIndex || !player || !team) return null;
  return { season, playerIndex, teamIndex, player, team };
}

/** 主索引の行ごとに、区間の行の範囲 [start, end) を引く */
function rowRanges(d: SeasonData): { start: Int32Array; end: Int32Array } {
  const n = d.playerIndex.rows.player.length;
  const start = new Int32Array(n).fill(-1);
  const end = new Int32Array(n).fill(-1);
  const { row } = d.player.rows;
  for (let i = 0; i < row.length; i++) {
    const r = row[i]!;
    if (start[r] === -1) start[r] = i;
    end[r] = i + 1;
  }
  return { start, end };
}

function periodStats(d: SeasonData, i: number): Record<PlayerPeriodStatColumn, number> {
  const out = zeroStats();
  for (const c of PLAYER_PERIOD_STAT_COLUMNS) out[c] = d.player.rows.stats[c][i]!;
  // +/- は、公式の値か復元の値（PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED。2016-17〜2021-22）の旗のある行だけ（画面の読み方と同じ）
  if ((d.player.rows.flags[i]! & (PERIOD_ROW_FLAG_PLUS_MINUS | PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED)) === 0) out.plusMinus = 0;
  return out;
}

/** 1. 形の確認 */
function checkShape(d: SeasonData): void {
  const { season, player, team, playerIndex, teamIndex } = d;
  const label = `${season} 形`;
  ok(`${label}: 版・結び付け先の行数`, player.version === PERIOD_INDEX_VERSION && team.version === PERIOD_INDEX_VERSION && player.indexRows === playerIndex.rows.player.length && team.indexRows === teamIndex.games.key.length * 2,
    `${player.indexRows}/${playerIndex.rows.player.length} ${team.indexRows}/${teamIndex.games.key.length * 2}`);
  const { row, period, flags } = player.rows;
  let sorted = true;
  for (let i = 1; i < row.length; i++) if (row[i]! < row[i - 1]! || (row[i] === row[i - 1] && period[i]! <= period[i - 1]!)) sorted = false;
  ok(`${label}: (row, period) の昇順・重複なし`, sorted);
  const lengthsOk = PLAYER_PERIOD_STAT_COLUMNS.every((c) => player.rows.stats[c].length === row.length) && period.length === row.length && flags.length === row.length;
  ok(`${label}: 列の長さがそろう`, lengthsOk);
  const gamesTable = playerIndex.games;
  let shortRows = 0;
  let otNoOt = 0;
  let badPeriod = 0;
  for (let i = 0; i < row.length; i++) {
    const g = playerIndex.rows.game[row[i]!]!;
    if ((gamesTable.flags[g]! & GAME_FLAG_SHORT) !== 0) shortRows += 1;
    if (period[i]! < 0 || period[i]! >= PERIOD_ATOMS.length) badPeriod += 1;
    else if (PERIOD_ATOMS[period[i]!] === "ot" && gamesTable.overtimes[g]! === 0) otNoOt += 1;
  }
  ok(`${label}: 前後半5分の特別な試合の行が無い・区間の番号・延長の行は延長のあった試合だけ`, shortRows === 0 && badPeriod === 0 && otNoOt === 0, `${shortRows} ${badPeriod} ${otNoOt}`);
  // 試合に出た選手はすべて、どれかの区間の行を持つ（出場が数秒だけの1件を除く）
  const { start } = rowRanges(d);
  let missing = 0;
  let tiny = 0;
  for (let r = 0; r < playerIndex.rows.player.length; r++) {
    if (start[r] !== -1) continue;
    const g = playerIndex.rows.game[r]!;
    if ((gamesTable.flags[g]! & GAME_FLAG_SHORT) !== 0) continue;
    if (isManualBoxscoreKey(playerIndex.games.key[g]!)) continue; // 合計だけの手入力の試合
    if (playerIndex.rows.stats.minSec[r]! <= 2 && PLAYER_INDEX_STAT_COLUMNS.every((c) => c === "minSec" || playerIndex.rows.stats[c][r]! === 0)) tiny += 1;
    else missing += 1;
  }
  ok(`${label}: 試合に出た選手が区間の行を持つ（出場が数秒だけで記録の無い ${tiny} 行を除く）`, missing === 0, `${missing}`);
  // +/- の旗
  const withPm = flags.filter((f) => (f & PERIOD_ROW_FLAG_PLUS_MINUS) !== 0).length;
  const expectNone = season < "2022-23";
  ok(`${label}: 公式の +/- の旗（${withPm}/${flags.length}行）`, expectNone ? withPm === 0 : withPm / Math.max(1, flags.length) > 0.99, `${withPm}`);
  // チームの表: -1 の位置
  let teamBad = 0;
  for (let g = 0; g < gamesTable.key.length; g++) {
    const short = (gamesTable.flags[g]! & GAME_FLAG_SHORT) !== 0;
    const hasOt = gamesTable.overtimes[g]! > 0;
    const noPeriods = isManualBoxscoreKey(gamesTable.key[g]!); // ピリオド別の行が無い手入力の試合は、全区間が -1（別の検査: ピリオド別の選手行が無い試合）
    for (const side of [0, 1]) {
      const t = g * 2 + side;
      for (const a of PERIOD_ATOMS) {
        const expectValue = !noPeriods && (a === "ot" ? hasOt : !short);
        const got = team.rows.counts[`${a}.pts`]![t]! !== -1;
        if (got !== expectValue) teamBad += 1;
      }
      for (const k of PERIOD_POSS_KEYS) {
        const expectValue = !noPeriods && (k === "ot" ? hasOt : !short);
        if ((team.rows.poss[k][t]! !== -1) !== expectValue) teamBad += 1;
      }
    }
  }
  ok(`${label}: チームの表の値なし（特別な試合の1Q〜4Q・前半・後半、延長の無い試合の延長が -1）`, teamBad === 0, `${teamBad}`);
}

/** 2・3・4・5・6 を、試合の生データから */
async function checkValues(d: SeasonData, allGames: StoredGame[]): Promise<void> {
  const { season, playerIndex, teamIndex, player, team } = d;
  const label = season;
  const gameNumber = new Map(playerIndex.games.key.map((k, i) => [k, i]));
  const teamGameNumber = new Map(teamIndex.games.key.map((k, i) => [k, i]));
  const rowOf = new Map<string, number>();
  for (let i = 0; i < playerIndex.rows.player.length; i++) rowOf.set(`${playerIndex.players[playerIndex.rows.player[i]!]![0]}|${playerIndex.games.key[playerIndex.rows.game[i]!]}`, i);
  const { start, end } = rowRanges(d);

  let rowsChecked = 0;
  let sumNg = 0;
  let sumFirst = "";
  let minOff = 0;
  let minMaxDiff = 0;
  let indexNg = 0;
  let indexFirst = "";
  let halfNg = 0;
  let halfFirst = "";
  let gapMismatch = 0;
  const gapSeen = new Set<string>();
  let teamAllNg = 0;
  let noPeriodGames = 0;
  let foulChecked = 0;
  let foulNg = 0;
  let foulFirst = "";
  let noPeriodNg = 0;
  let teamQuarterNg = 0;
  let teamQuarterFirst = "";
  let possNg = 0;
  let nSeasonContrib = 0;
  const seasonOptions = SEASON_BOX_PERIOD_OPTIONS.filter((o) => o.periods !== null);
  // シーズン成績のQ別の比較: (区間, 選手) ごとに、2つの経路の GamePeriodTotals を集める
  const season1 = new Map<string, GamePeriodTotals[]>();
  const season2 = new Map<string, GamePeriodTotals[]>();
  let realFnChecked = 0;
  let realFnNg = 0;
  let realFnFirst = "";

  for (const game of allGames) {
    const key = String(game.scheduleKey);
    // ピリオド別の選手行が無い試合（合計だけの手入力の試合。275章）は、チームの区間の値がすべて -1（無い）で、区間の集計に入らない
    if (!game.raw.HomeBoxscores.concat(game.raw.AwayBoxscores).some((r) => r.Category === 1 && r.PeriodCategory >= 1 && r.PeriodCategory <= 4)) {
      noPeriodGames += 1;
      const rowsOfGame = [teamGameNumber.get(key)! * 2, teamGameNumber.get(key)! * 2 + 1];
      for (const r of rowsOfGame) {
        for (const a of PERIOD_ATOMS) for (const c of TEAM_PERIOD_COUNT_COLUMNS) if (team.rows.counts[`${a}.${c}`]![r] !== -1) noPeriodNg += 1;
        for (const k of PERIOD_POSS_KEYS) if (team.rows.poss[k][r] !== -1) noPeriodNg += 1;
      }
      continue;
    }
    const g = gameNumber.get(key)!;
    const tg = teamGameNumber.get(key)!;
    const short = (playerIndex.games.flags[g]! & GAME_FLAG_SHORT) !== 0;
    const sides = [game.raw.HomeBoxscores, game.raw.AwayBoxscores];
    const allOpt = optionOf(game, "all");
    const periodScores = gamePeriodScores(game);

    for (const side of [0, 1] as const) {
      const ownRows = sides[side]!;
      const oppRows = sides[1 - side]!;
      // 試合全体と、区間ごとの、同じ関数の結果
      // 公式の +/- が無いシーズン（2016-17〜2021-22）は、画面と同じ復元の Q別 +/-（reconstructedPlusMinusOf）を重ねて比べる（DESIGN.md 304章）
      const withRecon = (list: ReturnType<typeof buildPlayerBoxscores>, opt: PeriodRangeOption | undefined) =>
        list.map((p) => {
          if (p.counts.hasPlusMinus || p.dnp) return p;
          const pm = reconstructedPlusMinusOf(game, side === 0, p.playerId, opt);
          return pm === null ? p : { ...p, counts: { ...p.counts, plusMinus: pm, hasPlusMinus: true } };
        });
      const whole = new Map(withRecon(buildPlayerBoxscores(ownRows, allOpt ?? undefined, game.raw.PlayByPlays, []), undefined).map((p) => [p.playerId, p]));
      const direct = new Map<string, Map<string, ReturnType<typeof buildPlayerBoxscores>[number]>>();
      for (const v of [...ATOM_OPTION_VALUES, "h1", "h2"]) {
        const opt = optionOf(game, v);
        if (opt && !(short && v !== "ot")) direct.set(v, new Map(withRecon(buildPlayerBoxscores(ownRows, opt, game.raw.PlayByPlays, []), opt).map((p) => [p.playerId, p])));
      }

      // チームの表（自チーム）
      const tr = tg * 2 + side;
      const ownAll = buildTeamTotalCounts(ownRows, allOpt ?? undefined);
      if (!short) {
        // OFF FOUL・CHARGE（275章 段階3）: 区間の合計 = 試合全体の選手の合計（buildPlayerBoxscores を足した値）
        for (const [col, key2] of [["offFouls", "offensiveFoulsCommitted"], ["charges", "chargesDrawn"]] as const) {
          const sumIdx = PERIOD_ATOMS.reduce((s2, a2) => s2 + Math.max(0, team.rows.counts[`${a2}.${col}`]![tr]!), 0);
          const sumWhole = [...whole.values()].reduce((s2, p) => s2 + p.counts[key2], 0);
          foulChecked += 1;
          if (sumIdx !== sumWhole) {
            foulNg += 1;
            if (!foulFirst) foulFirst = `${season} ${key} ${side} ${col} ${sumIdx}/${sumWhole}`;
          }
        }
        for (const c of TEAM_PERIOD_COUNT_COLUMNS) {
          const sum = PERIOD_ATOMS.reduce((s, a) => s + Math.max(0, team.rows.counts[`${a}.${c}`]![tr]!), 0);
          const expect = Number((ownAll as unknown as Record<string, unknown>)[c] ?? 0);
          if (c === "minSec" ? Math.abs(sum - expect) > 2 : sum !== expect) teamAllNg += 1;
        }
        // 区間の得点が公式のクォーター別スコアと一致（クォーター別スコアが4ピリオドそろっている試合）
        const qs = side === 0 ? periodScores.home : periodScores.away;
        PERIOD_ATOMS.forEach((a, ai) => {
          const got = team.rows.counts[`${a}.pts`]![tr]!;
          const expect = a === "ot" ? (qs.length > 4 ? qs.slice(4).reduce((x, y) => x + y, 0) : null) : (qs[ai] ?? null);
          if (expect === null || got === -1) return;
          if (got !== expect) {
            teamQuarterNg += 1;
            if (!teamQuarterFirst) teamQuarterFirst = `${season} ${key} ${a} ${got}/${expect}`;
          }
        });
        // 前半・後半のポゼッションは、直接出した値と一致する
        for (const k of ["h1", "h2"] as const) {
          const opt = optionOf(game, k)!;
          const direct2 = computeGameTeamPeriodTotals(game, side === 0, opt).poss;
          if (!sameNumber(team.rows.poss[k][tr]!, direct2)) possNg += 1;
        }
      }

      // 選手
      for (const p of whole.values()) {
        if (p.dnp) continue;
        const r = rowOf.get(`${p.playerId}|${key}`);
        if (r === undefined) continue;
        rowsChecked += 1;
        const gameStats = statsOf(p.counts);
        // 区間の行を集める
        const byAtom: (Record<PlayerPeriodStatColumn, number> | null)[] = PERIOD_ATOMS.map(() => null);
        const pmFlags: boolean[] = PERIOD_ATOMS.map(() => false);
        if (start[r]! !== -1) {
          for (let i = start[r]!; i < end[r]!; i++) {
            byAtom[player.rows.period[i]!] = periodStats(d, i);
            pmFlags[player.rows.period[i]!] = (player.rows.flags[i]! & (PERIOD_ROW_FLAG_PLUS_MINUS | PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED)) !== 0;
          }
        }
        // 8. 読む側の確認用に、区間ごとの最大値を別に数える（試合の生データから直接。短い試合は区間の行が無い）
        if (!short && !capture) {
          const win = (side === 0 ? game.homeScore > game.awayScore : game.awayScore > game.homeScore);
          for (const pv of RAW_PERIODS) {
            const dp = direct.get(pv)?.get(p.playerId);
            if (!dp) continue;
            const st = statsOf(dp.counts);
            if (!PLAYER_PERIOD_STAT_COLUMNS.some((c) => c !== "plusMinus" && st[c] !== 0)) continue;
            for (const stat of RAW_COUNT_STATS) bump(rawMax, `${pv}|${stat}`, st[stat]);
            if (pv === "h1" && win && st.tpm >= 3) bump(rawCondMax, "h1|pts|win&tpm>=3", st.pts);
          }
        }
        // 2. 合計 = 試合全体（短い試合を除く）
        if (!short) {
          const sum = zeroStats();
          byAtom.forEach((b) => {
            if (b) for (const c of PLAYER_PERIOD_STAT_COLUMNS) sum[c] += b[c];
          });
          const pmAvailable = pmFlags.some((f) => f);
          for (const c of PLAYER_PERIOD_STAT_COLUMNS) {
            if (c === "minSec") {
              const diff = Math.abs(sum.minSec - gameStats.minSec);
              if (diff > 0) minOff += 1;
              minMaxDiff = Math.max(minMaxDiff, diff);
              continue;
            }
            if (c === "plusMinus" && !pmAvailable) continue;
            if (sum[c] !== gameStats[c]) {
              sumNg += 1;
              if (!sumFirst) sumFirst = `${season} ${key} ${p.playerId} ${c} ${sum[c]}/${gameStats[c]}`;
            }
          }
          // 1試合行の索引の値との一致
          for (const c of PLAYER_INDEX_STAT_COLUMNS) {
            if (!(PLAYER_PERIOD_STAT_COLUMNS as readonly string[]).includes(c) || c === "plusMinus" || c === "minSec") continue;
            const col = c as PlayerPeriodStatColumn;
            if (sum[col] !== (playerIndex.rows.stats as Record<string, number[]>)[c]![r]!) {
              indexNg += 1;
              if (!indexFirst) indexFirst = `${season} ${key} ${p.playerId} ${c}`;
            }
          }
          if (Math.abs(sum.minSec - playerIndex.rows.stats.minSec[r]!) > 2) indexNg += 1;
        }
        // 3. 前半・後半は直接出した値と一致する
        if (!short) {
          for (const [hv, atoms] of [["h1", [0, 1]], ["h2", [2, 3]]] as const) {
            const dp = direct.get(hv)!.get(p.playerId);
            const expect = dp ? statsOf(dp.counts) : zeroStats();
            const sum = zeroStats();
            for (const ai of atoms) if (byAtom[ai]) for (const c of PLAYER_PERIOD_STAT_COLUMNS) sum[c] += byAtom[ai]![c];
            for (const c of PLAYER_PERIOD_STAT_COLUMNS) {
              if (c === "plusMinus" && !pmFlags[atoms[0]] && !pmFlags[atoms[1]]) continue;
              if (sum[c] !== expect[c]) {
                halfNg += 1;
                if (!halfFirst) halfFirst = `${season} ${key} ${p.playerId} ${hv} ${c} ${sum[c]}/${expect[c]}`;
              }
            }
          }
          // 6. 選手の得点の合計と、チームの区間の得点
        }
        // 4. シーズン成績のQ別と同じ関数に通す（前後半5分の特別な試合は除く）
        if (!short) {
          const isStarter = (playerIndex.rows.flags[r]! & ROW_FLAG_STARTER) !== 0;
          for (const opt of seasonOptions) {
            const sOpt = optionOf(game, opt.value)!;
            const key2 = `${opt.value}|${p.playerId}`;
            // 経路1: 試合の生データから（シーズン成績のQ別がやっていることと同じ。computeGamePeriodTotals の中身の2関数）
            const teamTotals = computeGameTeamPeriodTotals(game, side === 0, sOpt);
            const playerCounts = direct.get(opt.value)!.get(p.playerId)?.counts;
            if (!playerCounts) throw new Error(`${season} ${key} ${p.playerId}: 区間の選手が見つかりません`);
            const c1: GamePeriodTotals = { player: playerCounts, own: teamTotals.own, opp: teamTotals.opp, poss: teamTotals.poss, isStarter: p.startingFlg === 1 };
            (season1.get(key2) ?? season1.set(key2, []).get(key2)!).push(c1);
            // 経路2: ピリオド別の索引から（選手は区間の行の合計、チームは自チーム・相手の行・ポゼッション）
            const atoms = opt.value === "h1" ? [0, 1] : opt.value === "h2" ? [2, 3] : [ATOM_OPTION_VALUES.indexOf(opt.value as (typeof ATOM_OPTION_VALUES)[number])];
            const sum = zeroStats();
            let pm = false;
            for (const ai of atoms) {
              if (byAtom[ai]) for (const c of PLAYER_PERIOD_STAT_COLUMNS) sum[c] += byAtom[ai]![c];
              pm = pm || pmFlags[ai]!;
            }
            const teamCountsAt = (row: number): BoxscoreCounts => {
              const out = { ...sumCounts([]) } as unknown as Record<string, number>;
              for (const c of TEAM_PERIOD_COUNT_COLUMNS) out[c] = atoms.reduce((s, ai) => s + team.rows.counts[`${PERIOD_ATOMS[ai]}.${c}`]![row]!, 0);
              return out as unknown as BoxscoreCounts;
            };
            const c2: GamePeriodTotals = {
              player: countsFromStats(sum, pm),
              own: teamCountsAt(tg * 2 + side),
              opp: teamCountsAt(tg * 2 + (1 - side)),
              poss: team.rows.poss[opt.value as PeriodPossKey][tg * 2 + side]!,
              isStarter,
            };
            (season2.get(key2) ?? season2.set(key2, []).get(key2)!).push(c2);
            nSeasonContrib += 1;
          }
        }
      }
      // 6. 選手の得点の合計 vs チームの区間の得点
      if (!short) {
        PERIOD_ATOMS.forEach((a, ai) => {
          const t = team.rows.counts[`${a}.pts`]![tr]!;
          if (t === -1) return;
          let sum = 0;
          for (const p of whole.values()) {
            const r = rowOf.get(`${p.playerId}|${key}`);
            if (r === undefined || start[r]! === -1) continue;
            for (let i = start[r]!; i < end[r]!; i++) if (player.rows.period[i] === ai) sum += player.rows.stats.pts[i]!;
          }
          // 同じチームの選手は、そのチームの行だけを足す（whole は自チームの選手のみ）
          if (sum !== t) {
            const id = `${season}|${key}|${a}`;
            gapSeen.add(id);
            if (KNOWN_PLAYER_POINTS_GAPS.get(id) !== t - sum) gapMismatch += 1;
          }
        });
      }
    }

    // 実際の computeGamePeriodTotals で標本の確認（2026-27は全試合、ほかは10試合に1試合）
    if (!short && (season === "2026-27" || Number(key) % 10 === 0)) {
      const sideRows = [game.raw.HomeBoxscores, game.raw.AwayBoxscores];
      for (const side of [0, 1] as const) {
        for (const pid of new Set(sideRows[side]!.filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.PlayTime !== "DNP").map((r) => r.PlayerID))) {
          if (!rowOf.has(`${pid}|${key}`)) continue;
          for (const opt of seasonOptions) {
            const sOpt = optionOf(game, opt.value)!;
            const real = computeGamePeriodTotals(game, side === 0, pid, sOpt);
            realFnChecked += 1;
            const direct1 = buildPlayerBoxscores(sideRows[side]!, sOpt, game.raw.PlayByPlays, []).find((p) => p.playerId === pid);
            const reconPm = direct1 && !direct1.counts.hasPlusMinus ? reconstructedPlusMinusOf(game, side === 0, pid, sOpt) : null;
            if (direct1 && reconPm !== null) direct1.counts = { ...direct1.counts, plusMinus: reconPm, hasPlusMinus: true };
            const teamSide = computeGameTeamPeriodTotals(game, side === 0, sOpt);
            if (!real || !direct1 || diffObjects(real.player, direct1.counts) !== null || diffObjects(real.own, teamSide.own) !== null || diffObjects(real.opp, teamSide.opp) !== null || !sameNumber(real.poss, teamSide.poss)) {
              realFnNg += 1;
              if (!realFnFirst) realFnFirst = `${season} ${key} ${pid} ${opt.value}`;
            }
          }
        }
      }
    }
  }

  ok(`${label} 区間の合計 = 試合全体（${rowsChecked}行・${PLAYER_PERIOD_STAT_COLUMNS.length}項目）。出場時間のずれは${minOff}行・最大${minMaxDiff}秒（許容2秒）`, sumNg === 0 && minMaxDiff <= 2, `${sumNg} ${sumFirst}`);
  ok(`${label} 区間の合計 = 1試合行の索引の値`, indexNg === 0, `${indexNg} ${indexFirst}`);
  ok(`${label} 前半・後半 = 直接出した値（1Q+2Q／3Q+4Q）`, halfNg === 0, `${halfNg} ${halfFirst}`);
  ok(`${label} OFF FOUL・CHARGE の区間の合計 = 試合全体の選手の合計（${foulChecked}件）`, foulNg === 0, `${foulNg} ${foulFirst}`);
  ok(`${label} ピリオド別の選手行が無い試合（${noPeriodGames}試合）のチームの区間の値はすべて -1（区間の集計に入らない）`, noPeriodNg === 0, `${noPeriodNg}`);
  ok(`${label} チームの区間の合計 = 試合全体、前半・後半のポゼッション = 直接出した値`, teamAllNg === 0 && possNg === 0, `${teamAllNg} ${possNg}`);
  ok(`${label} チームの区間の得点 = 公式のクォーター別スコア`, teamQuarterNg === 0, `${teamQuarterNg} ${teamQuarterFirst}`);
  const knownHere = [...KNOWN_PLAYER_POINTS_GAPS.keys()].filter((id) => id.startsWith(`${season}|`)).length;
  ok(`${label} 選手の得点の合計 = チームの区間の得点（公式の記録の食い違いの区間 ${gapSeen.size}件は、既知の一覧と過不足なく一致）`, gapMismatch === 0 && gapSeen.size === knownHere, `${gapMismatch} ${gapSeen.size}/${knownHere}`);
  ok(`${label} computeGamePeriodTotals の標本（${realFnChecked}件）が、区間の選手の値と一致`, realFnNg === 0, `${realFnNg} ${realFnFirst}`);

  // 4. シーズン成績のQ別の関数に通した結果の比較
  let seasonNg = 0;
  let seasonFirst = "";
  let compared = 0;
  const keys1 = new Set(season1.keys());
  if (keys1.size !== season2.size) {
    seasonNg += 1;
    seasonFirst = `組の数 ${keys1.size}/${season2.size}`;
  }
  for (const [k, list1] of season1) {
    const list2 = season2.get(k);
    if (!list2 || list1.length !== list2.length) {
      seasonNg += 1;
      seasonFirst ||= `${k} 試合数`;
      continue;
    }
    const a = buildPeriodFilteredRawTotals(list1);
    const b = buildPeriodFilteredRawTotals(list2);
    const d1 = diffObjects(a.raw, b.raw);
    const d2 = diffObjects(a.team, b.team);
    compared += 1;
    if (d1 || d2) {
      seasonNg += 1;
      seasonFirst ||= `${k} ${d1 ?? ""} ${d2 ?? ""}`;
    }
  }
  ok(`${label} シーズン成績のQ別（buildPeriodFilteredRawTotals）の結果と全項目一致（${compared}組＝6区間×選手。試合ごとの貢献 ${nSeasonContrib}件）`, seasonNg === 0, `${seasonNg} ${seasonFirst}`);
}

/** 8. 読む側: 1試合記録の集計に区間を渡した結果 */
async function checkQuery(): Promise<void> {
  const mains = new Map<string, ReturnType<typeof viewPlayerGameIndex>>();
  const periods = new Map<string, PlayerPeriodView>();
  for (const season of SEASONS) {
    const d = await load(season);
    if (!d) continue;
    const main = viewPlayerGameIndex(d.playerIndex);
    mains.set(season, main);
    const pv = viewPlayerPeriodIndex(d.player, main);
    ok(`${season} 読む側: ピリオド別の索引が1試合行の索引に結び付く`, pv !== null);
    if (pv) periods.set(season, pv);
  }
  const views = [...mains.values()];
  const stats = playerQueryStats("record");
  const keyOf: Record<string, string> = { min: "minSec" };
  let compared = 0;
  let ng = 0;
  let first = "";
  for (const pv of RAW_PERIODS) {
    for (const stat of RAW_COUNT_STATS) {
      const key = stat === "minSec" ? "min" : stat;
      const def = stats.find((x) => x.key === key);
      if (!def) continue;
      const raw = rawMax.get(`${pv}|${stat}`);
      if (!raw || raw.max === 0) continue;
      const rows = queryPlayerGameRecords({ views, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies: null, stat: def, includeSpecial: true, period: { period: pv, views: periods } }).rows;
      const top = rows.filter((r) => r.rank === 1);
      const value = stat === "minSec" ? Math.round((top[0]?.value ?? 0) * 60) : (top[0]?.value ?? 0);
      compared += 1;
      if (value !== raw.max || top.length !== raw.count) {
        ng += 1;
        first ||= `${pv} ${key} 集計 ${value}×${top.length} / 生データ ${raw.max}×${raw.count}`;
      }
    }
  }
  void keyOf;
  ok(`読む側: 7区間×${compared / 7}項目の1位（値と同率の行数）が、試合の生データから別に数えた最大値と一致（${compared}組）`, ng === 0 && compared > 0, `${ng} ${first}`);

  // 条件つき: 前半・勝った試合・3PM 3以上 の得点
  const ptsDef = stats.find((x) => x.key === "pts")!;
  const cond = rawCondMax.get("h1|pts|win&tpm>=3");
  const condRows = queryPlayerGameRecords({
    views,
    gameType: "both",
    conditions: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" },
    group: "all",
    positions: [],
    statConditions: { match: "all", conditions: [{ id: 1, key: "tpm", op: "gte", value: "3" }] },
    rookies: null,
    stat: ptsDef,
    includeSpecial: true,
    period: { period: "h1", views: periods },
  }).rows.filter((r) => r.rank === 1);
  ok(`読む側: 前半・勝った試合・3PM 3以上の得点の1位が一致（${condRows[0]?.value}点×${condRows.length}件）`, !!cond && condRows[0]?.value === cond.max && condRows.length === cond.count, `${JSON.stringify(cond)} / ${condRows[0]?.value}×${condRows.length}`);
  void PLAYER_STAT_CONDITION_ITEMS;
  void PERIOD_ATOM_INDEXES;

  // 画面の確認に使う3つの例
  const example = (pv: GameRecordPeriod, key: string) =>
    queryPlayerGameRecords({ views, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies: null, stat: stats.find((x) => x.key === key)!, includeSpecial: true, period: { period: pv, views: periods } }).rows.filter((r) => r.rank === 1);
  const q1 = example("q1", "pts");
  const h1 = example("h1", "tpm");
  const ot = example("ot", "pts");
  const show = (rows: typeof q1) => rows.map((r) => `${r.playerName} ${r.date}`).join(" / ");
  console.log(`  例: 1Qの最多得点 ${q1[0]?.value}点×${q1.length}: ${show(q1)}`);
  console.log(`  例: 前半の最多3P ${h1[0]?.value}本×${h1.length}件: ${show(h1)}`);
  console.log(`  例: 延長の最多得点 ${ot[0]?.value}点×${ot.length}: ${show(ot)}`);
}

const LEGACY_SEASONS = new Set(["2016-17", "2017-18", "2018-19", "2019-20"]);

/** 9. チームの追加の列（256章の段階1）を、チームの試合ログ（team-games）・teams.json と比べる */
async function checkTeamExtras(d: SeasonData): Promise<void> {
  const { season, team, teamIndex } = d;
  const dir = path.join(DATA_DIR, season);
  const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
  const logByKeySide = new Map<string, TeamGameLog>();
  const regularForeign = new Map<string, number[]>();
  for (const t of teams) {
    const logs = (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? [];
    const sum = [0, 0, 0, 0, 0];
    for (const g of logs) {
      logByKeySide.set(`${g.scheduleKey}|${g.isHome ? 0 : 1}`, g);
      if (g.gameType === "regular" && g.foreignCourtSeconds) g.foreignCourtSeconds.forEach((v, i) => (sum[i] = sum[i]! + v));
    }
    regularForeign.set(t.teamId, sum);
  }
  let extraNg = 0;
  let extraFirst = "";
  let ocNg = 0;
  let ocFirst = "";
  let pairNg = 0;
  let checked = 0;
  let noForeign = 0;
  let legacyOt = 0;
  let legacyOtNg = 0;
  teamIndex.games.key.forEach((key, gi) => {
    if (isManualBoxscoreKey(key)) return; // 合計だけの手入力の試合
    const short = (teamIndex.games.flags[gi]! & GAME_FLAG_SHORT) !== 0;
    for (const side of [0, 1] as const) {
      const log = logByKeySide.get(`${key}|${side}`);
      if (!log) continue; // オールスター等の擬似チーム（teams.json に無い）
      const tr = gi * 2 + side;
      checked += 1;
      if (!short) {
        for (const c of TEAM_PERIOD_EXTRA_COLUMNS) {
          const sum = PERIOD_ATOMS.reduce((s2, a) => s2 + Math.max(0, team.rows.counts[`${a}.${c}`]?.[tr] ?? Number.NaN), 0);
          const expect = Number((log as unknown as Record<string, unknown>)[c] ?? 0);
          if (sum !== expect) {
            extraNg += 1;
            if (!extraFirst) extraFirst = `${season} ${key} ${side} ${c} ${sum}/${expect}`;
          }
        }
      }
      // 人数別の在コート秒数: 区間の合計 = 試合ログ（前後半5分の特別な試合は延長しか値が無いので、試合ログが無いか全区間 -1 のときだけ確かめる）
      const values = PERIOD_ATOMS.map((a) => TEAM_PERIOD_FOREIGN_COLUMNS.map((c) => team.rows.counts[`${a}.${c}`]?.[tr] ?? Number.NaN));
      const allMissing = values.every((v) => v.every((x) => x === -1));
      if (!log.foreignCourtSeconds) {
        noForeign += 1;
        if (!allMissing) {
          ocNg += 1;
          if (!ocFirst) ocFirst = `${season} ${key} ${side}: 試合ログに無いのに索引に値`;
        }
      } else if (!short) {
        const sum = TEAM_PERIOD_FOREIGN_COLUMNS.map((_, i) => values.reduce((s2, v) => s2 + Math.max(0, v[i]!), 0));
        if (sum.some((v, i) => v !== log.foreignCourtSeconds![i]) || values.some((v) => v.some((x) => Number.isNaN(x)))) {
          ocNg += 1;
          if (!ocFirst) ocFirst = `${season} ${key} ${side}: ${JSON.stringify(sum)} ≠ ${JSON.stringify(log.foreignCourtSeconds)}`;
        }
      }
      // 2016-17〜2019-20 の延長: 在コートの復元が延長を含むようになった（256章）ので、延長の人数別の秒数の合計が延長の長さ（チームの出場時間÷5）になる
      if (LEGACY_SEASONS.has(season) && values[PERIOD_ATOMS.indexOf("ot")]![0] !== -1) {
        legacyOt += 1;
        const otSum = values[PERIOD_ATOMS.indexOf("ot")]!.reduce((a, b) => a + b, 0);
        if (Math.abs(otSum - team.rows.counts["ot.minSec"]![tr]! / 5) > 1) legacyOtNg += 1;
      }
      const other = logByKeySide.get(`${key}|${1 - side}`);
      if (other && JSON.stringify(other.foreignCourtSeconds ?? null) !== JSON.stringify(log.opponentForeignCourtSeconds ?? null)) pairNg += 1;
    }
  });
  ok(`${season} チームの追加の列（${TEAM_PERIOD_EXTRA_COLUMNS.length}項目）の区間の合計 = 試合ログ（${checked}行）`, extraNg === 0, `${extraNg} ${extraFirst}`);
  ok(`${season} 人数別の在コート秒数の区間の合計 = 試合ログ（値の無い ${noForeign}行は全区間 -1）`, ocNg === 0, `${ocNg} ${ocFirst}`);
  ok(`${season} 試合ログの相手の人数別の在コート秒数 = 相手の試合ログ`, pairNg === 0, `${pairNg}`);
  if (LEGACY_SEASONS.has(season)) ok(`${season} 延長の人数別の在コート秒数の合計 = 延長の長さ（${legacyOt}行）`, legacyOt > 0 && legacyOtNg === 0, `${legacyOtNg}/${legacyOt}`);
  let seasonNg = 0;
  for (const t of teams) {
    const expect = t.foreignPlayerCourtSeconds ?? [0, 0, 0, 0, 0];
    if (JSON.stringify(regularForeign.get(t.teamId)) !== JSON.stringify(expect)) seasonNg += 1;
  }
  ok(`${season} レギュラーシーズンの試合ログの合計 = teams.json の On-Court Foreign（${teams.length}チーム）`, seasonNg === 0, `${seasonNg}`);
}

/**
 * 10. 人数別の得点・失点・攻撃回数（256章の段階3の作り直しの回）: 試合全体（all）の秒数が試合ログと一致し、特別な試合以外は区間の合計が試合全体と一致する。
 * チームのシーズンの試合全体の合計が、よく使われるラインナップ（lineups）を人数ごとに足した値（チーム詳細のオンザコート別の合計）と一致する。
 * 攻撃回数は 2020-21 以降だけ値があり、2019-20 以前は -1
 */
async function checkForeignDetail(d: SeasonData): Promise<void> {
  const { season, team, teamIndex } = d;
  const dir = path.join(DATA_DIR, season);
  const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
  const players = (await readJson<PlayerSummary[]>(path.join(dir, "players.json"))) ?? [];
  const classification = new Map(players.map((p) => [p.playerId, p.classification]));
  const rules = (await readJson<SeasonRules[]>(path.join(DATA_DIR, "season-rules.json"))) ?? [];
  const max = rules.find((r) => r.season === season)?.maxForeignOnCourt ?? 4;
  const modern = Number(season.slice(0, 4)) >= 2020;
  const teamOfRow = new Map<number, string>();
  const logOfRow = new Map<number, TeamGameLog>();
  const gameNumber = new Map(teamIndex.games.key.map((k, i) => [k, i]));
  for (const t of teams) {
    for (const g of (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? []) {
      const gi = gameNumber.get(g.scheduleKey);
      if (gi === undefined) continue;
      teamOfRow.set(gi * 2 + (g.isHome ? 0 : 1), t.teamId);
      logOfRow.set(gi * 2 + (g.isHome ? 0 : 1), g);
    }
  }
  const all = (c: string, r: number) => team.rows.counts[`${TEAM_PERIOD_WHOLE_GAME_KEY}.${c}`]?.[r] ?? Number.NaN;
  let wholeNg = 0;
  let sumNg = 0;
  let possNg = 0;
  let first = "";
  const seasonSum = new Map<string, Record<string, number>>();
  for (const [r, teamId] of teamOfRow) {
    const log = logOfRow.get(r)!;
    const gi = Math.floor(r / 2);
    const short = (teamIndex.games.flags[gi]! & GAME_FLAG_SHORT) !== 0;
    const seconds = TEAM_PERIOD_FOREIGN_COLUMNS.map((c) => all(c, r));
    const expectSeconds = log.foreignCourtSeconds ?? [-1, -1, -1, -1, -1];
    if (seconds.some((v, i) => v !== expectSeconds[i])) {
      wholeNg += 1;
      if (!first) first = `${season} ${log.scheduleKey} ${teamId} 試合全体の秒数 ${JSON.stringify(seconds)} ≠ ${JSON.stringify(expectSeconds)}`;
    }
    if (!log.foreignCourtSeconds) continue;
    for (const c of [...TEAM_PERIOD_FOREIGN_COLUMNS, ...TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS]) {
      const whole = all(c, r);
      const isPoss = c.endsWith("Poss");
      if (isPoss && (modern ? whole < 0 : whole !== -1)) possNg += 1;
      if (!short && !(isPoss && !modern)) {
        const sum = PERIOD_ATOMS.reduce((a, at) => a + Math.max(0, team.rows.counts[`${at}.${c}`]?.[r] ?? Number.NaN), 0);
        if (Math.abs(sum - whole) > 1e-9) {
          sumNg += 1;
          if (!first) first = `${season} ${log.scheduleKey} ${teamId} ${c} 区間の合計 ${sum} ≠ 試合全体 ${whole}`;
        }
      }
      const acc = seasonSum.get(teamId) ?? {};
      acc[c] = (acc[c] ?? 0) + Math.max(0, whole);
      seasonSum.set(teamId, acc);
    }
  }
  // チームのシーズンの合計 = よく使われるラインナップを人数ごとに足した値
  let lineupNg = 0;
  let lineupTeams = 0;
  for (const t of teams) {
    const file = await readJson<TeamLineupsFile>(path.join(dir, "lineups", `${t.teamId}.json`));
    const got = seasonSum.get(t.teamId);
    if (!file || !got) continue;
    lineupTeams += 1;
    const expect: Record<string, number> = {};
    for (const l of file.lineups) {
      const n = foreignCountBucket(foreignCountInLineup(l.playerIds, (id) => classification.get(id)), max);
      if (n === null) continue;
      const add = (k: string, v: number) => (expect[k] = (expect[k] ?? 0) + v);
      add(`oc${n}`, l.secondsPlayed);
      add(`oc${n}Pts`, l.ownPoints);
      add(`oc${n}OppPts`, l.oppPoints);
      if (modern) {
        add(`oc${n}Poss`, l.ownPoss ?? Number.NaN);
        add(`oc${n}OppPoss`, l.oppPoss ?? Number.NaN);
      }
    }
    for (const c of [...TEAM_PERIOD_FOREIGN_COLUMNS, ...TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS]) {
      if (c.endsWith("Poss") && !modern) continue;
      if (Math.abs((got[c] ?? 0) - (expect[c] ?? 0)) > 1e-6) {
        lineupNg += 1;
        if (!first) first = `${season} ${t.teamId} ${c} 索引 ${got[c]} ≠ ラインナップ ${expect[c] ?? 0}`;
      }
    }
  }
  if (capture) {
    ok("", wholeNg === 0 && sumNg === 0 && possNg === 0 && lineupNg === 0);
    return;
  }
  ok(`${season} 人数別の秒数（試合全体）= 試合ログ（${teamOfRow.size}行）`, wholeNg === 0, `${wholeNg} ${first}`);
  ok(`${season} 人数別の得点・失点・攻撃回数・秒数の区間の合計 = 試合全体（特別な試合を除く）`, sumNg === 0, `${sumNg} ${first}`);
  ok(`${season} 攻撃回数の列は${modern ? "値がある" : "すべて -1"}`, possNg === 0, `${possNg}`);
  ok(`${season} チームのシーズンの人数別の合計 = よく使われるラインナップを人数ごとに足した値（${lineupTeams}チーム）`, lineupNg === 0, `${lineupNg} ${first}`);
}

async function main(): Promise<void> {
  const t0 = Date.now();
  for (const season of SEASONS) {
    const d = await load(season);
    if (!d) {
      ok(`${season}: ファイルがある`, false, "player-period-index / team-period-index / 1試合行の索引のどれかが見つかりません");
      continue;
    }
    const keys = new Set(d.playerIndex.games.key);
    const allGames = (await readAllGames(season)).filter((g) => keys.has(String(g.scheduleKey)));
    allGames.sort((a, b) => d.playerIndex.games.key.indexOf(String(a.scheduleKey)) - d.playerIndex.games.key.indexOf(String(b.scheduleKey)));
    ok(`${season}: 索引の全${keys.size}試合の生データがある`, allGames.length === keys.size, `${allGames.length}`);
    checkShape(d);
    await checkValues(d, allGames);
    if (!capture) await checkTeamExtras(d);
    if (!capture) await checkForeignDetail(d);
    // 7. 感度: 索引を1か所壊すと、食い違いとして検出される（小さいシーズンで、選手の得点・チームのポゼッションを1か所ずつ壊す）
    if (season === (onlySeason ?? "2026-27")) {
      const brokenPlayer = { ...d, player: { ...d.player, rows: { ...d.player.rows, stats: { ...d.player.rows.stats, pts: d.player.rows.stats.pts.map((v, i) => (i === 100 ? v + 1 : v)) } } } };
      const brokenTeam = { ...d, team: { ...d.team, rows: { ...d.team.rows, poss: { ...d.team.rows.poss, h1: d.team.rows.poss.h1.map((v, i) => (i === 10 ? v + 1 : v)) } } } };
      for (const [name, broken] of [["選手の得点", brokenPlayer], ["チームの前半のポゼッション", brokenTeam]] as const) {
        capture = { ng: 0 };
        await checkValues(broken, allGames);
        const detected = capture.ng;
        capture = null;
        ok(`${season} 感度: ${name}を1か所壊すと食い違いとして検出される（${detected}項目がNG）`, detected > 0);
      }
      // 追加の列（9）も、1か所壊すと検出される（値が 0 以上のマスを選ぶ）
      for (const col of ["q1.pt2in", "q2.oc2", "q3.oc2Pts", "all.oc2OppPts"]) {
        const values = d.team.rows.counts[col]!;
        const at = values.findIndex((v) => v > 0);
        const brokenExtra = { ...d, team: { ...d.team, rows: { ...d.team.rows, counts: { ...d.team.rows.counts, [col]: values.map((v, i) => (i === at ? v + 1 : v)) } } } };
        capture = { ng: 0 };
        await (col.endsWith("Pts") ? checkForeignDetail(brokenExtra) : checkTeamExtras(brokenExtra));
        const detected = capture.ng;
        capture = null;
        ok(`${season} 感度: チームの ${col} を1か所壊すと食い違いとして検出される（${detected}項目がNG）`, detected > 0);
      }
    }
    console.log(`  （${season} 完了 ${((Date.now() - t0) / 1000).toFixed(0)}秒）`);
  }
  await checkQuery();
  console.log(`\n確認 ${checks.ok + checks.ng} 項目: ok ${checks.ok} / NG ${checks.ng}`);
  if (failures > 0) process.exit(1);
}

await main();
