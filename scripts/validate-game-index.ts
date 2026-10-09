// 1試合行の索引（data/{season}/player-game-index.json.gz・team-game-index.json.gz。DESIGN.md 219章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（導出データを作ったあと、`npm run build:data` のあとに実行する）:
//  1. 選手の行: 試合ログ（player-games/）の出場した全試合が1行ずつあり、27の統計・先発・ホーム・チーム・対戦相手・最大リード・延長・最終点差・ポジション・生年月日・登録区分が元と一致する。並びは選手→試合の順
//  2. チームの行: 試合ログ（team-games/）の全試合が、各試合のホーム・アウェイの2行になり、統計・1Q〜4Q・被記録（opponentXxx）が元と一致する。TEAM_RECORD_STATS・TEAM_AGAINST_RECORD_STATS の全項目の値・対象の試合も一致する
//  3. 今の上位20位のファイル（シーズンごとの player-game-records.json と、全シーズンの league-player-game-records.json）が、索引の行から再現できる
//  4. 試合の表: 延長の本数・最大リード・前後半5分の特別な試合の旗が、試合の生データから数え直した値と一致する。並びが日付順
//  5. ルーキーの突き合わせ（rookie-eligibility.json）・試合当日の年齢（〇歳〇日）・古いデータ（新しい項目が無い）の扱い・版が合わないファイルの扱い
//
// 使い方: npm run validate:game-index（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import path from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";
import { DATA_DIR, readGameFile, readJson } from "./lib/storage.ts";
import { currentPlayerNames, normalizePlayerName } from "../shared/playerName.ts";
import { buildRecordTables, type RecordGame } from "./lib/playerGameRecordsTop.ts";
import { regulationPeriodScores } from "../shared/periodPoints.ts";
import { gameMaxMargins } from "../shared/gameMargins.ts";
import { overtimeCount } from "../shared/gamePeriods.ts";
import { classKeyOf } from "../shared/classificationKey.ts";
import { ageOnDate, compareAge, formatAgeOnDate } from "../shared/gameAge.ts";
import { PLAYER_GAME_RECORD_STATS, type PlayerRecordGame } from "../shared/playerGameRecords.ts";
import { TEAM_AGAINST_RECORD_STATS, TEAM_RECORD_STATS } from "../shared/teamRecords.ts";
import { PLAYER_INDEX_CLUTCH_COLUMNS, PLAYER_INDEX_STAT_COLUMNS, type PlayerGameIndexFile, type TeamGameIndexFile } from "../shared/gameIndex.ts";
import { clutchByPlayer, maxRuns, scoringSequence } from "../shared/gameFlow.ts";
import { computeAssistedScoring } from "../shared/assistedScoring.ts";
import { assistPairPoints, sortedAssistPairRows, type AssistPairsFile } from "../shared/assistPairs.ts";
import { withChronologicalPlayByPlays } from "../shared/pbpOrder.ts";
import type { GameSummary, PlayerGameLog, PlayerMasterEntry, PlayerSummary, RookieEligibilityFile, TeamGameLog } from "../shared/types.ts";
import { gameOvertimes, playerFinalMargin, teamFinalMargin } from "../src/lib/gameFacts.ts";
import {
  isSupportedGameIndex,
  playerAgeAt,
  playerGameAt,
  rookieOfIndex,
  teamGameAt,
  viewPlayerGameIndex,
  viewTeamGameIndex,
  type IndexedPlayerGame,
  type IndexedTeamGame,
} from "../src/lib/gameIndex.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`ok ${label}`);
  } else {
    failures += 1;
    console.error(`NG ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `実際: ${a}\n   期待: ${e}`);
}

/** 食い違いを数え、最初の数件だけ詳しく出す */
class Mismatches {
  count = 0;
  samples: string[] = [];
  add(detail: string): void {
    this.count += 1;
    if (this.samples.length < 4) this.samples.push(detail);
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** 勝負所の合計の配列から、窓 w・種類 k・FG/FT の値を取り出す（位置は shared/gameFlow.ts の clutchIndex と同じ） */
const expectedClutch = (totals: number[], w: number, k: number, ft: boolean): number => totals[w * 6 + k * 2 + (ft ? 1 : 0)]!;

const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name) && existsSync(path.join(DATA_DIR, e.name, "player-game-index.json.gz")))
  .map((e) => e.name)
  .sort();
check("索引のあるシーズンが2016-17〜", seasons.length >= 11 && seasons[0] === "2016-17", seasons.join(","));

const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
const masterById = new Map(master.map((p) => [p.playerId, p]));
const rookies = await readJson<RookieEligibilityFile>(path.join(DATA_DIR, "rookie-eligibility.json"));

const allRecordGames: RecordGame[] = [];
const perSeasonRecordGames = new Map<string, RecordGame[]>();
let totalPlayerRows = 0;
let totalTeamRows = 0;
let totalGames = 0;
let ageNull = 0;
let ageNullExpected = 0;

for (const season of seasons) {
  console.log(`\n== ${season}`);
  const seasonDir = path.join(DATA_DIR, season);
  const playerFile = (await readJson<PlayerGameIndexFile>(path.join(seasonDir, "player-game-index.json")))!;
  const teamFile = (await readJson<TeamGameIndexFile>(path.join(seasonDir, "team-game-index.json")))!;
  const pv = viewPlayerGameIndex(playerFile);
  const tv = viewTeamGameIndex(teamFile);
  const summaries = ((await readJson<GameSummary[]>(path.join(seasonDir, "games-summary.json"))) ?? []).filter(
    // 終了した試合だけ（進行中の試合は、要約にはあるが、索引・試合ログには入らない）
    (s) => (s.gameType === "regular" || s.gameType === "playoff") && s.gameEndedFlg,
  );
  const summaryByKey = new Map(summaries.map((s) => [s.scheduleKey, s]));
  const playersJson = (await readJson<PlayerSummary[]>(path.join(seasonDir, "players.json"))) ?? [];
  const playerSummaryById = new Map(playersJson.map((p) => [p.playerId, p]));

  // ---- 試合の表 ----
  const games = playerFile.games;
  eq(`${season} 試合の表が選手・チームの索引で同じ`, playerFile.games, teamFile.games);
  eq(`${season} チーム辞書が選手・チームの索引で同じ`, playerFile.teams, teamFile.teams);
  eq(`${season} 試合の表の並びが要約（日付→試合番号）のまま`, games.key, summaries.map((s) => s.scheduleKey));
  check(`${season} 試合の表の日付が昇順`, games.date.every((d, i) => i === 0 || games.date[i - 1]! <= d));
  check(`${season} チーム辞書の地区が全クラブにある`, playerFile.teams.every((t) => t[2] !== ""), JSON.stringify(playerFile.teams.filter((t) => t[2] === "")));
  totalGames += games.key.length;

  // ---- 選手の行 ----
  const sourceLogs = new Map<string, PlayerGameLog>();
  const playerDir = path.join(seasonDir, "player-games");
  for (const f of readdirSync(playerDir).filter((x) => x.endsWith(".json.gz")).sort()) {
    const playerId = f.replace(/\.json\.gz$/, "");
    for (const g of (await readJson<PlayerGameLog[]>(path.join(playerDir, `${playerId}.json`))) ?? []) {
      if (g.min <= 0 || (g.gameType !== "regular" && g.gameType !== "playoff") || !summaryByKey.has(g.scheduleKey)) continue;
      sourceLogs.set(`${playerId}:${g.scheduleKey}`, g);
    }
  }
  eq(`${season} 選手の行数 = 出場した試合の数`, pv.size, sourceLogs.size);
  totalPlayerRows += pv.size;
  const pm = new Mismatches();
  let orderOk = true;
  const seen = new Set<string>();
  const recordGames: RecordGame[] = [];
  for (let i = 0; i < pv.size; i += 1) {
    const r = playerGameAt(pv, i);
    const key = `${r.playerId}:${r.scheduleKey}`;
    if (seen.has(key)) pm.add(`重複 ${key}`);
    seen.add(key);
    if (i > 0 && (playerFile.rows.player[i]! < playerFile.rows.player[i - 1]! || (playerFile.rows.player[i] === playerFile.rows.player[i - 1] && playerFile.rows.game[i]! <= playerFile.rows.game[i - 1]!))) orderOk = false;
    const src = sourceLogs.get(key);
    if (!src) {
      pm.add(`元に無い行 ${key}`);
      continue;
    }
    const s = summaryByKey.get(r.scheduleKey)!;
    const homeSide = src.isHome;
    const expected: Record<string, unknown> = {
      date: src.date,
      gameType: src.gameType,
      isHome: src.isHome,
      isStarter: src.isStarter,
      win: src.win,
      opponentTeamId: src.opponentTeamId,
      opponentTeamName: src.opponentTeamName,
      teamId: homeSide ? s.homeTeamId : s.awayTeamId,
      teamName: homeSide ? s.homeTeamName : s.awayTeamName,
      teamScore: homeSide ? s.homeScore : s.awayScore,
      opponentScore: homeSide ? s.awayScore : s.homeScore,
      finalMargin: src.finalMargin,
      overtimes: src.overtimes,
      maxLead: src.maxLead,
      maxDeficit: src.maxDeficit,
    };
    for (const [k, v] of Object.entries(expected)) {
      if ((r as unknown as Record<string, unknown>)[k] !== v) pm.add(`${key} ${k}: 索引 ${String((r as unknown as Record<string, unknown>)[k])} / 元 ${String(v)}`);
    }
    if (Math.abs(r.min - src.min) > 1e-9) pm.add(`${key} min: 索引 ${r.min} / 元 ${src.min}`);
    const clutchColumns: readonly string[] = PLAYER_INDEX_CLUTCH_COLUMNS;
    for (const col of PLAYER_INDEX_STAT_COLUMNS) {
      if (col === "minSec") continue;
      const clutchAt = clutchColumns.indexOf(col);
      const actual = clutchAt >= 0 ? (r.clutch?.[clutchAt] ?? 0) : (r as unknown as Record<string, number>)[col];
      const original = clutchAt >= 0 ? (src.clutch?.[clutchAt] ?? 0) : ((src as unknown as Record<string, number | undefined>)[col] ?? 0);
      if (actual !== original) pm.add(`${key} ${col}: 索引 ${actual} / 元 ${String(original)}`);
    }
    const ps = playerSummaryById.get(r.playerId);
    const m = masterById.get(r.playerId);
    if (r.playerName !== normalizePlayerName(ps?.name ?? m?.name ?? r.playerId)) pm.add(`${key} 名前`);
    if (r.position !== (ps?.position ?? "")) pm.add(`${key} ポジション: 索引 ${r.position} / 元 ${String(ps?.position)}`);
    if (r.positionFallback !== (ps?.profileFallback?.position ?? "")) pm.add(`${key} ポジションの補い方`);
    if (r.birthDate !== (ps?.birthDate ?? m?.birthDate ?? "")) pm.add(`${key} 生年月日`);
    if (r.classKey !== (classKeyOf(m?.classification) ?? "")) pm.add(`${key} 登録区分: 索引 ${r.classKey} / マスタ ${String(m?.classification)}`);
    if ((r.birthDate === "") !== (playerAgeAt(pv, i) === null)) pm.add(`${key} 年齢の有無`);
    if (playerAgeAt(pv, i) === null) ageNull += 1;
    if (r.birthDate === "") ageNullExpected += 1;
    recordGames.push({
      ...(r as unknown as PlayerRecordGame),
      season,
      playerId: r.playerId,
      playerName: r.playerName,
      teamId: r.teamId,
      teamName: r.teamName,
      classKey: r.classKey === "" ? undefined : r.classKey,
    });
  }
  check(`${season} 選手の行の値が元と一致`, pm.count === 0, `${pm.count}件\n   ${pm.samples.join("\n   ")}`);
  check(`${season} 選手の行が 選手→試合 の順に並ぶ（連続記録に使える）`, orderOk);
  perSeasonRecordGames.set(season, recordGames);
  allRecordGames.push(...recordGames);

  // ---- ターンオーバーからの得点（2016-17を含む全シーズンで値がある。DESIGN.md 221章） ----
  check(`${season} ターンオーバーからの得点に 0 でない値がある（選手・チーム）`, playerFile.rows.stats.ptsOffTov.some((v) => v > 0) && teamFile.rows.stats.pft.some((v) => v > 0));

  // ---- チームの行 ----
  eq(`${season} チームの行数 = 試合の数×2`, tv.size, games.key.length * 2);
  totalTeamRows += tv.size;
  const gameIndexByKey = new Map(games.key.map((k, i) => [k, i]));
  const teamIdToDictIndex = new Map(teamFile.teams.map((t, i) => [t[0], i]));
  const tm = new Mismatches();
  const defMismatch = new Mismatches();
  let teamLogCount = 0;
  const teamDir = path.join(seasonDir, "team-games");
  for (const f of readdirSync(teamDir).filter((x) => x.endsWith(".json.gz")).sort()) {
    const teamId = f.replace(/\.json\.gz$/, "");
    for (const log of (await readJson<TeamGameLog[]>(path.join(teamDir, `${teamId}.json`))) ?? []) {
      if ((log.gameType !== "regular" && log.gameType !== "playoff") || !summaryByKey.has(log.scheduleKey)) continue;
      teamLogCount += 1;
      const gi = gameIndexByKey.get(log.scheduleKey);
      if (gi === undefined) {
        tm.add(`試合の表に無い ${log.scheduleKey}`);
        continue;
      }
      const row = gi * 2 + (log.isHome ? 0 : 1);
      const t: IndexedTeamGame = teamGameAt(tv, row);
      const key = `${teamId}:${log.scheduleKey}`;
      if (t.teamId !== teamId || teamIdToDictIndex.get(t.teamId) === undefined) tm.add(`${key} チームの番号`);
      const flat: Record<string, unknown> = { ...(t as unknown as Record<string, unknown>) };
      const fields = [
        "date", "gameType", "isHome", "win", "teamScore", "opponentScore", "overtimes", "maxLead", "maxDeficit", "opponentTeamId", "opponentTeamName",
        "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf", "fb", "pt2in", "pft", "pt2nd", "foulsDrawn", "dunks",
        "benchPoints", "starterPoints", "attendance", "japanesePoints", "foreignPoints", "naturalizedOrAsianPoints",
        "periodPoints", "opponentPeriodPoints", "periodPointsFromPbp",
        "maxRun", "maxRunFromSec", "maxRunToSec", "maxRunOwnBefore", "maxRunOppBefore",
        "opponentFgm", "opponentFga", "opponentTpm", "opponentTpa", "opponentFtm", "opponentFta", "opponentOreb", "opponentDreb", "opponentAst", "opponentTov",
        "opponentStl", "opponentBlk", "opponentPf", "opponentFb", "opponentPt2in", "opponentPft", "opponentPt2nd", "opponentFoulsDrawn", "opponentDunks",
      ];
      for (const k of fields) {
        const orig = (log as unknown as Record<string, unknown>)[k];
        if (!same(flat[k], orig)) tm.add(`${key} ${k}: 索引 ${JSON.stringify(flat[k])} / 元 ${JSON.stringify(orig)}`);
      }
      if (t.finalMargin !== teamFinalMargin(log)) tm.add(`${key} 最終点差`);
      // 1試合記録の項目: 値と対象の試合が元のログで計算した結果と同じ
      for (const def of [...TEAM_RECORD_STATS, ...TEAM_AGAINST_RECORD_STATS]) {
        const a = def.value(t as unknown as TeamGameLog);
        const b = def.value(log);
        if (a !== b) defMismatch.add(`${key} ${def.key}: 索引 ${a} / 元 ${b}`);
        if ((def.filter ? def.filter(t as unknown as TeamGameLog) : true) !== (def.filter ? def.filter(log) : true)) defMismatch.add(`${key} ${def.key} の対象`);
      }
    }
  }
  eq(`${season} チームの試合ログの数 = 試合の数×2`, teamLogCount, games.key.length * 2);
  check(`${season} チームの行の値が元と一致`, tm.count === 0, `${tm.count}件\n   ${tm.samples.join("\n   ")}`);
  check(`${season} 1試合記録の項目（記録・被記録）の値と対象の試合が元と一致`, defMismatch.count === 0, `${defMismatch.count}件\n   ${defMismatch.samples.join("\n   ")}`);

  // ---- 試合の生データと突き合わせ（延長・最大リード・特別な試合） ----
  const gm = new Mismatches();
  const clutchExpectedTotal = new Array<number>(PLAYER_INDEX_CLUTCH_COLUMNS.length).fill(0);
  const gameClutchExpected = new Map<number, number[]>();
  const expectedPairs = new Map<string, string[]>();
  let shortGames = 0;
  const otHistogram: Record<number, number> = {};
  for (const [key, gi] of gameIndexByKey) {
    const raw = await readGameFile(path.join(seasonDir, "games", `${key}.json`));
    if (!raw) {
      gm.add(`${key} 生データが無い`);
      continue;
    }
    const ot = overtimeCount(raw);
    otHistogram[ot] = (otHistogram[ot] ?? 0) + 1;
    // 集計行（PeriodCategory 5〜14＝第1〜第10延長）だけで数えた本数（overtimeCount の別経路）
    const categories = (raw.raw.Summaries ?? []).map((x) => x.PeriodCategory).filter((c) => c >= 5 && c <= 14);
    const independent = categories.length > 0 ? Math.max(...categories) - 4 : 0;
    if (games.overtimes[gi] !== ot || ot !== independent) gm.add(`${key} 延長: 索引 ${games.overtimes[gi]} / 数え直し ${ot} / 集計行 ${independent}`);
    const margins = gameMaxMargins(raw);
    if (games.homeMaxLead[gi] !== (margins?.homeMaxLead ?? -1) || games.awayMaxLead[gi] !== (margins?.awayMaxLead ?? -1)) gm.add(`${key} 最大リード`);
    if (games.homeScore[gi] !== raw.homeScore || games.awayScore[gi] !== raw.awayScore) gm.add(`${key} 得点`);
    const isShort = regulationPeriodScores(raw) === null;
    if (((games.flags[gi]! & 2) !== 0) !== isShort) gm.add(`${key} 特別な試合の旗`);
    if (isShort) shortGames += 1;
    if (((games.flags[gi]! & 1) !== 0) !== (summaryByKey.get(key)!.gameType === "playoff")) gm.add(`${key} ポストシーズンの旗`);

    // ターンオーバーからの得点: チームの行が公式SummariesのPTPFT（試合全体の行 PeriodCategory=18）と一致する
    const official = (raw.raw.Summaries ?? []).find((x) => x.PeriodCategory === 18);
    if (!official) gm.add(`${key} 公式の集計行（PeriodCategory=18）が無い`);
    else {
      const h = teamGameAt(tv, gi * 2).pft;
      const a = teamGameAt(tv, gi * 2 + 1).pft;
      if (h !== official.HomeTeamPTPFT || a !== official.AwayTeamPTPFT) gm.add(`${key} ターンオーバーからの得点: 索引 ${h}-${a} / 公式 ${official.HomeTeamPTPFT}-${official.AwayTeamPTPFT}`);
    }

    // 最大のラン・勝負所: 生データから作り直した値（shared/gameFlow.ts）と、索引のチームの行・選手の行の合計が一致する
    const flow = scoringSequence(raw.raw.PlayByPlays ?? []);
    const runs = maxRuns(flow.events);
    for (const side of [0, 1] as const) {
      const t = teamGameAt(tv, gi * 2 + side);
      const run = runs[side];
      const got = t.maxRun === undefined ? null : [t.maxRun, t.maxRunFromSec, t.maxRunToSec, t.maxRunOwnBefore, t.maxRunOppBefore];
      const want = run ? [run.points, run.fromSec, run.toSec, run.ownBefore, run.oppBefore] : null;
      if (!same(got, want)) gm.add(`${key} ${side === 0 ? "ホーム" : "アウェイ"}の最大のラン: 索引 ${JSON.stringify(got)} / 数え直し ${JSON.stringify(want)}`);
    }
    const expectedClutch = new Array<number>(PLAYER_INDEX_CLUTCH_COLUMNS.length).fill(0);
    for (const arr of clutchByPlayer(flow.events, raw.homeScore, raw.awayScore).values()) arr.forEach((v, k) => (expectedClutch[k]! += v));
    clutchExpectedTotal.forEach((_, k) => (clutchExpectedTotal[k]! += expectedClutch[k]!));
    gameClutchExpected.set(gi, expectedClutch);

    // アシストペア: 生データから作り直した行が assist-pairs.json.gz と一致する
    const pairRows = sortedAssistPairRows(computeAssistedScoring(withChronologicalPlayByPlays(raw).raw.PlayByPlays ?? []).pairs.values());
    expectedPairs.set(key, pairRows.map((r) => `${r.assisterId}>${r.scorerId}:${r.n2},${r.n3},${r.nf}`));
  }
  check(`${season} 延長の本数・最大リード・得点・旗・最大のラン・ターンオーバーからの得点（公式Summaries）が生データの数え直しと一致`, gm.count === 0, `${gm.count}件\n   ${gm.samples.join("\n   ")}`);

  // 勝負所: 試合ごとに、索引の選手の行の合計が、生データから数えた合計と一致する（出場していない選手の分が無いことの確認も兼ねる）
  {
    const sums = new Map<number, number[]>();
    for (let i = 0; i < pv.size; i += 1) {
      const row = playerGameAt(pv, i);
      if (!row.clutch) continue;
      const gi = playerFile.rows.game[i]!;
      const acc = sums.get(gi) ?? new Array<number>(PLAYER_INDEX_CLUTCH_COLUMNS.length).fill(0);
      row.clutch.forEach((v, k) => (acc[k]! += v));
      sums.set(gi, acc);
    }
    const cm = new Mismatches();
    for (const [gi, want] of gameClutchExpected) {
      const got = sums.get(gi) ?? new Array<number>(PLAYER_INDEX_CLUTCH_COLUMNS.length).fill(0);
      if (!same(got, want)) cm.add(`${games.key[gi]}: 索引 ${JSON.stringify(got)} / 数え直し ${JSON.stringify(want)}`);
    }
    check(`${season} 勝負所（勝ち越し弾・同点弾・決勝弾）が生データの数え直しと一致`, cm.count === 0, `${cm.count}件\n   ${cm.samples.join("\n   ")}`);
    console.log(`   勝負所の合計（窓5分・2分・1分の [勝ち越し,同点,決勝弾] FG+FT）: ${[0, 1, 2].map((w) => [0, 1, 2].map((k) => `${expectedClutch(clutchExpectedTotal, w, k, false)}+${expectedClutch(clutchExpectedTotal, w, k, true)}`).join(",")).join(" / ")}`);
  }

  // アシストペア（assist-pairs.json.gz）: 生データの数え直しと一致。選手は索引の選手辞書にいる。（試合, 得点した選手）ごとの点数が選手の行のアシストされた得点と一致
  {
    const pairsFile = await readJson<AssistPairsFile>(path.join(seasonDir, "assist-pairs.json"));
    check(`${season} assist-pairs.json.gz がある`, !!pairsFile && pairsFile.season === season);
    if (pairsFile) {
      const got = new Map<string, string[]>();
      let orderOk2 = true;
      const r = pairsFile.rows;
      for (let i = 0; i < r.game.length; i += 1) {
        const key = pairsFile.keys[r.game[i]!]!;
        const a = pairsFile.players[r.assister[i]!]!;
        const sc = pairsFile.players[r.scorer[i]!]!;
        (got.get(key) ?? got.set(key, []).get(key)!).push(`${a}>${sc}:${r.n2[i]},${r.n3[i]},${r.nf[i]}`);
        if (i > 0 && (r.game[i]! < r.game[i - 1]! || (r.game[i] === r.game[i - 1] && (pairsFile.players[r.assister[i]!]! < pairsFile.players[r.assister[i - 1]!]! || (r.assister[i] === r.assister[i - 1] && pairsFile.players[r.scorer[i]!]! <= pairsFile.players[r.scorer[i - 1]!]!))))) orderOk2 = false;
      }
      check(`${season} ペアの行が (試合, アシストした選手ID, 得点した選手ID) の昇順で固定されている`, orderOk2 && same(pairsFile.keys, [...pairsFile.keys].sort()) && same(pairsFile.players, [...pairsFile.players].sort()));
      const pmm = new Mismatches();
      for (const [key, want] of expectedPairs) if (!same(got.get(key) ?? [], want)) pmm.add(`${key}: 索引 ${JSON.stringify(got.get(key))} / 数え直し ${JSON.stringify(want)}`);
      for (const key of got.keys()) if (!expectedPairs.has(key)) pmm.add(`${key}: 試合の表に無い`);
      check(`${season} ペアの行が生データの数え直しと一致`, pmm.count === 0, `${pmm.count}件\n   ${pmm.samples.join("\n   ")}`);
      // 得点した選手ごとの点数 = 選手の行のアシストされた得点
      const idsInIndex = new Set(playerFile.players.map((p) => p[0]));
      const scored = new Map<string, number>();
      let missingPlayers = 0;
      for (let i = 0; i < r.game.length; i += 1) {
        const a = pairsFile.players[r.assister[i]!]!;
        const sc = pairsFile.players[r.scorer[i]!]!;
        if (!idsInIndex.has(a) || !idsInIndex.has(sc)) missingPlayers += 1;
        const k = `${sc}:${pairsFile.keys[r.game[i]!]}`;
        scored.set(k, (scored.get(k) ?? 0) + assistPairPoints({ n2: r.n2[i]!, n3: r.n3[i]!, nf: r.nf[i]! }));
      }
      const sm = new Mismatches();
      const rowsByKey = new Set<string>();
      for (let i = 0; i < pv.size; i += 1) {
        const row = playerGameAt(pv, i);
        const k = `${row.playerId}:${row.scheduleKey}`;
        rowsByKey.add(k);
        const want = row.assisted2m * 2 + row.assisted3m * 3 + row.assistedFtm;
        if ((scored.get(k) ?? 0) !== want) sm.add(`${k}: ペア ${scored.get(k) ?? 0} / 選手の行 ${want}`);
      }
      for (const k of scored.keys()) if (!rowsByKey.has(k)) sm.add(`${k}: 出場していない選手の行にペアがある`);
      check(`${season} ペアの得点の合計が、選手の行のアシストされた得点と一致`, sm.count === 0, `${sm.count}件\n   ${sm.samples.join("\n   ")}`);
      check(`${season} ペアの選手が全員、選手の索引にいる`, missingPlayers === 0, `${missingPlayers}行`);
      console.log(`   ペアの行 ${r.game.length}、ファイル ${(statSync(path.join(seasonDir, "assist-pairs.json.gz")).size / 1024).toFixed(0)}KB（gz）`);
    }
  }
  console.log(`   延長の本数: ${JSON.stringify(otHistogram)}、前後半5分の特別な試合: ${shortGames}`);
  if (season === "2016-17" || season === "2017-18") eq(`${season} 前後半5分の特別な試合`, shortGames, 2);
  else check(`${season} 前後半5分の特別な試合は無い`, shortGames === 0);

  // ---- シーズンごとの上位20位のファイルが索引から再現できる ----
  const tables = buildRecordTables(recordGames, false);
  const existing = await readJson<Record<string, unknown>>(path.join(seasonDir, "player-game-records.json"));
  eq(`${season} 上位20位（player-game-records.json）が索引から再現できる（全選手・登録区分別）`, { byGameType: tables.byGameType, byClassification: tables.byClassification }, {
    byGameType: existing?.byGameType,
    byClassification: existing?.byClassification,
  });

  // ---- ルーキーの突き合わせ ----
  const rookieIds = new Set(rookies?.seasons[season] ?? []);
  let rookieRowsViaIndex = 0;
  for (let i = 0; i < pv.size; i += 1) if (rookieOfIndex(rookies, season, playerFile.players[playerFile.rows.player[i]!]![0])) rookieRowsViaIndex += 1;
  let rookieRowsViaLogs = 0;
  for (const key of sourceLogs.keys()) if (rookieIds.has(key.split(":")[0]!)) rookieRowsViaLogs += 1;
  eq(`${season} ルーキーの行数（索引との突き合わせ = 試合ログとの突き合わせ）`, rookieRowsViaIndex, rookieRowsViaLogs);
  const playedIds = new Set(playerFile.players.map((p) => p[0]));
  console.log(`   ルーキー: 対象 ${rookieIds.size}名のうち出場 ${[...rookieIds].filter((id) => playedIds.has(id)).length}名、行 ${rookieRowsViaIndex}`);

  console.log(`   ファイル: 選手 ${(statSync(path.join(seasonDir, "player-game-index.json.gz")).size / 1024).toFixed(0)}KB・チーム ${(statSync(path.join(seasonDir, "team-game-index.json.gz")).size / 1024).toFixed(0)}KB（gz）、選手の行 ${pv.size}、試合 ${games.key.length}`);
}

// ---- 全シーズンの上位20位 ----
console.log("\n== 全シーズン");
// 全シーズンのファイルは、複数のシーズンをまたぐ表なので選手名が選手マスタの今の登録名（無い選手はその試合のシーズンの名前）。DESIGN.md 222-5
const currentNames = currentPlayerNames(master);
const allTime = buildRecordTables(
  allRecordGames.map((g) => ({ ...g, playerName: currentNames.get(g.playerId) ?? g.playerName })),
  true,
);
const existingAll = await readJson<Record<string, unknown>>(path.join(DATA_DIR, "league-player-game-records.json"));
eq("全シーズンの上位20位（league-player-game-records.json）が索引から再現できる", { byGameType: allTime.byGameType, byClassification: allTime.byClassification }, {
  byGameType: existingAll?.byGameType,
  byClassification: existingAll?.byClassification,
});
console.log(`   合計: 試合 ${totalGames}、選手の行 ${totalPlayerRows}、チームの行 ${totalTeamRows}`);
eq("チームの行の合計 = 試合の合計×2", totalTeamRows, totalGames * 2);
eq("年齢が不明な行 = 生年月日が無い選手の行", ageNull, ageNullExpected);
console.log(`   年齢が不明な行: ${ageNull}`);

// 特定の試合（目で確かめられるもの）: 2026-10-02 千葉 131-138 東京は4延長
const latest = (await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, "2026-27", "player-game-index.json")))!;
const g4 = latest.games.key.indexOf("506406");
check("2026-27 千葉 131-138 東京（506406）は4延長", g4 >= 0 && latest.games.overtimes[g4] === 4 && latest.games.homeScore[g4] === 131 && latest.games.awayScore[g4] === 138);

// ---- 試合当日の年齢（〇歳〇日） ----
console.log("\n== 年齢");
const ageCases: [string, string, string | null][] = [
  ["2000-01-15", "2026-10-09", "26歳267日"],
  ["2000-03-01", "2026-03-01", "26歳0日"],
  ["2000-03-01", "2026-02-28", "25歳364日"],
  ["2000-02-29", "2025-02-28", "25歳0日"],
  ["2000-02-29", "2025-02-27", "24歳364日"],
  ["2000-02-29", "2024-02-29", "24歳0日"],
  ["2000-02-29", "2028-02-28", "27歳365日"], // 2027-02-28（平年の誕生日）から、うるう年をはさんで365日
  ["2008-12-31", "2026-01-01", "17歳1日"],
  ["", "2026-01-01", null],
];
for (const [birth, date, want] of ageCases) {
  const a = ageOnDate(birth, date);
  eq(`年齢 ${birth || "(なし)"} → ${date}`, a ? formatAgeOnDate(a) : null, want);
}
check("年齢の大小（若い方が小さい）", compareAge({ years: 19, days: 300 }, { years: 20, days: 0 }) < 0 && compareAge({ years: 20, days: 5 }, { years: 20, days: 4 }) > 0);

// ---- 古いデータ・版が合わないファイル ----
console.log("\n== 古いデータの扱い");
eq("延長の項目が無い試合ログは不明（undefined）", gameOvertimes({}), undefined);
eq("延長の項目が無い要約は不明（undefined）", gameOvertimes({ overtimes: undefined }), undefined);
eq("延長なしの試合は 0", gameOvertimes({ overtimes: 0 }), 0);
eq("最終点差の項目が無い選手の試合ログは不明（undefined）", playerFinalMargin({}), undefined);
eq("チームの最終点差は得点から出せる（古いデータでも値がある）", teamFinalMargin({ teamScore: 80, opponentScore: 91 }), -11);
check("版が合わないファイルは使わない（版 999）", !isSupportedGameIndex({ version: 999, rows: {}, games: {} }));
check("空・null のファイルは使わない", !isSupportedGameIndex(null) && !isSupportedGameIndex({}));
check("今のファイルは使える", isSupportedGameIndex(latest));
{
  // 新しい列（アシストされた得点・勝負所・最大のラン）が無い古い索引でも読める
  const oldPlayer = JSON.parse(JSON.stringify(latest)) as PlayerGameIndexFile;
  for (const c of ["assisted2m", "assisted3m", "assistedFtm", ...PLAYER_INDEX_CLUTCH_COLUMNS]) delete (oldPlayer.rows.stats as unknown as Record<string, unknown>)[c];
  const latestTeam = (await readJson<TeamGameIndexFile>(path.join(DATA_DIR, "2026-27", "team-game-index.json")))!;
  const oldTeam = JSON.parse(JSON.stringify(latestTeam)) as TeamGameIndexFile;
  for (const c of ["maxRun", "maxRunFromSec", "maxRunToSec", "maxRunOwnBefore", "maxRunOppBefore"]) delete (oldTeam.rows.stats as unknown as Record<string, unknown>)[c];
  const op = playerGameAt(viewPlayerGameIndex(oldPlayer), 0);
  const ot = teamGameAt(viewTeamGameIndex(oldTeam), 0);
  check("新しい列が無い古い索引（選手）は、アシストされた得点が0・勝負所が無し", op.assisted2m === 0 && op.assistedFtm === 0 && op.clutch === undefined);
  check("新しい列が無い古い索引（チーム）は、最大のランが無し", ot.maxRun === undefined && ot.maxRunFromSec === undefined);
}

// ---- 同じ選手の連続記録の順（シーズンをまたいで時系列に並べられる） ----
// 全シーズンの行を選手ごとに並べ、日付が昇順（同じ日は試合番号順）になること
const byPlayer = new Map<string, { date: string; key: string }[]>();
const seasonsOfPlayer = new Map<string, Set<string>>();
for (const season of seasons) {
  const f = (await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, season, "player-game-index.json")))!;
  for (let i = 0; i < f.rows.player.length; i += 1) {
    const id = f.players[f.rows.player[i]!]![0];
    const g = f.rows.game[i]!;
    const list = byPlayer.get(id) ?? [];
    list.push({ date: f.games.date[g]!, key: f.games.key[g]! });
    byPlayer.set(id, list);
    (seasonsOfPlayer.get(id) ?? seasonsOfPlayer.set(id, new Set()).get(id)!).add(season);
  }
}
let unsorted = 0;
for (const list of byPlayer.values()) for (let i = 1; i < list.length; i += 1) if (list[i - 1]!.date > list[i]!.date) unsorted += 1;
eq("選手ごとに、シーズンの順に読むだけで日付の昇順（シーズンまたぎ・移籍を含む）", unsorted, 0);
console.log(`   選手 ${byPlayer.size}名、うち複数シーズンに出場した選手 ${[...seasonsOfPlayer.values()].filter((x) => x.size > 1).length}`);

console.log(failures === 0 ? "\n全項目 ok" : `\n${failures}件の食い違い`);
process.exit(failures === 0 ? 0 : 1);
