// シチュエーション別勝敗の曜日・祝日と、対戦相手の最新シーズン勝率による区分を検証する。
// npm run build:data のあとに実行。画面が使う行定義で、全シーズンの試合数・勝敗も確認する。
import assert from "node:assert/strict";
import path from "node:path";
import { readdirSync } from "node:fs";
import { buildSituationalRecordGroups } from "../src/pages/TeamDetailPage";
import { isJapaneseHoliday, isWeekdayGame, isWeekendGame } from "../src/lib/japaneseHolidays";
import { buildRecordsBeforeGame, buildBackToBackStatus } from "../src/lib/situational";
import { filterByGameType } from "../src/lib/playerSeasonBoxscore";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { buildOpponentSeasonWinRates, type OpponentSeasonRecord } from "../src/lib/opponentSeasonWinRate";
import type { DivisionHistoryFile, GameSummary, TeamGameLog, TeamSummary } from "../shared/types.ts";

// filterByGameType は元の勝敗表と同じ試合区分の関数を使う。
const cases: [string, boolean, boolean][] = [
  ["2026-10-21", false, true], // 通常の水曜日
  ["2026-10-24", false, false], // 土曜日
  ["2026-10-25", false, false], // 日曜日
  ["2026-10-12", true, false], // 月曜日の祝日
  ["2024-09-23", true, false], // 振替休日
  ["2026-09-22", true, false], // 国民の休日
  ["2026-03-20", true, false], // 春分の日
  ["2026-09-23", true, false], // 水曜日の祝日
  ["2019-04-30", true, false],
  ["2019-05-01", true, false],
  ["2019-05-02", true, false],
  ["2019-10-22", true, false], // 即位に伴う特例
  ["2019-12-23", false, true], // 2019年は天皇誕生日なし
  ["2020-07-23", true, false],
  ["2020-07-24", true, false],
  ["2020-07-20", false, true], // 五輪特例で通常の日付は平日
  ["2020-08-10", true, false],
  ["2021-07-22", true, false],
  ["2021-07-23", true, false],
  ["2021-08-09", true, false], // 特例の山の日の振替休日
  ["2021-08-11", false, true],
  ["2020-10-12", false, true],
  ["2021-10-11", false, true],
  ["2018-12-24", true, false], // 旧天皇誕生日の振替休日
  ["2020-02-24", true, false], // 新天皇誕生日の振替休日
];
function fixture(date: string, i: number): TeamGameLog {
  return { scheduleKey: String(i), date, opponentTeamId: "other", isHome: i % 2 === 0, win: i % 3 === 0,
    gameType: "regular", min: 200, teamScore: 80, opponentScore: 75, poss: 70 } as TeamGameLog;
}
const fixtureLogs = cases.map(([date], i) => fixture(date, i));
const groups = buildSituationalRecordGroups(fixtureLogs, "own", undefined, new Map(), undefined, "2026-27");
const days = groups.find((g) => g.key === "weekday")!.rows;
assert.deepEqual(days.map((r) => [r.key, r.label]), [["weekday", "平日開催（祝日を除く）"], ["weekend", "土日祝開催"]]);
for (let i = 0; i < cases.length; i++) {
  const [date, holiday, weekday] = cases[i]!;
  assert.equal(isJapaneseHoliday(date), holiday, `${date} 祝日`);
  assert.equal(isWeekdayGame(date), weekday, `${date} 平日`);
  assert.equal(isWeekendGame(date), !weekday, `${date} 土日祝日`);
  assert.deepEqual(days.map((r) => r.predicate(fixtureLogs[i]!, undefined)), [weekday, !weekday], `${date} 画面の行`);
}
console.log(`ok 曜日・祝日・振替休日・特例祝日 ${cases.length}件（画面の行定義も確認）`);

const rateCases: [number, number, boolean[]][] = [
  [5, 5, [false, true, false, false]], // ちょうど5割
  [6, 4, [false, true, true, false]], // ちょうど6割
  [4, 6, [true, false, false, false]],
  [5, 4, [false, true, false, false]], // 6割未満
  [4, 0, [false, true, true, false]], // 5試合未満も数える
  [3, 2, [false, true, true, false]],
  [1, 0, [false, true, true, false]], // 初出場の1試合でも判定
  [0, 1, [true, false, false, false]],
  [0, 0, [false, false, false, true]], // 0試合は推測しない
];
function strength(logs: TeamGameLog[], teams: readonly OpponentSeasonRecord[] | null) {
  return buildSituationalRecordGroups(logs, "own", undefined, buildOpponentSeasonWinRates(teams), undefined, "2026-27")
    .find((g) => g.key === "opponentStrength")!.rows;
}
for (const [wins, losses, expected] of rateCases) {
  const log = fixture("2026-10-21", 0);
  assert.deepEqual(strength([log], [{ teamId: "other", wins, losses }]).map((r) => r.predicate(log, undefined)),
    expected, "最新勝敗 " + wins + "勝" + losses + "敗");
}
const malformed = [
  { teamId: "other", wins: 1 },
  { teamId: "other", wins: undefined, losses: 1 },
  { teamId: "other", wins: NaN, losses: 1 },
  { teamId: "other", wins: Infinity, losses: 1 },
  { teamId: "other", wins: -1, losses: 2 },
  { teamId: "other", wins: 1.5, losses: 2 },
] as OpponentSeasonRecord[];
for (const team of malformed) {
  const log = fixture("2026-10-21", 0);
  assert.deepEqual(strength([log], [team]).map((r) => r.predicate(log, undefined)), [false, false, false, true], "欠損・不正値は対象外");
}
const previousGames = [fixture("2026-09-22", 0), fixture("2026-09-23", 1)];
const snapshot = JSON.stringify(previousGames);
const selectedCounts = (teams: readonly OpponentSeasonRecord[] | null) =>
  strength(previousGames, teams).map((r) => previousGames.filter((g) => r.predicate(g, undefined)).length);
assert.deepEqual(selectedCounts([{ teamId: "other", wins: 0, losses: 1 }]), [2, 0, 0, 0]);
assert.deepEqual(selectedCounts([{ teamId: "other", wins: 1, losses: 1 }]), [0, 2, 0, 0], "更新後は過去の対戦2試合も再分類");
assert.deepEqual(selectedCounts([{ teamId: "other", wins: 3, losses: 2 }]), [0, 2, 2, 0]);
assert.deepEqual(selectedCounts(null), [0, 0, 0, 2], "データが無ければ対象外");
assert.deepEqual(selectedCounts([]), [0, 0, 0, 2], "相手が見つからなければ対象外");
const unknownRows = strength(previousGames, []).find((r) => r.key === "unclassified")!;
const unknownGames = previousGames.filter((g) => unknownRows.predicate(g, undefined));
assert.deepEqual([unknownGames.length, unknownGames.filter((g) => g.win).length, unknownGames.filter((g) => !g.win).length], [2, 1, 1], "対象外の件数と勝敗を表示できる");
assert.equal(JSON.stringify(previousGames), snapshot, "再分類は試合ログを変更しない");
console.log("ok 最新勝率の50%・60%境界、最低試合数なし、0試合・欠損の対象外、更新時の過去対戦の再分類");

const temporal: GameSummary[] = Array.from({ length: 7 }, (_, i) => ({
  scheduleKey: String(i), date: `2026-10-${String(i + 1).padStart(2, "0")}`, gameType: "regular", gameEndedFlg: true,
  homeTeamId: "other", awayTeamId: "own", homeScore: i < 3 || i >= 5 ? 80 : 70, awayScore: 75,
} as GameSummary));
const before = buildRecordsBeforeGame(temporal);
assert.deepEqual(before.get("5")!.get("other"), { wins: 3, losses: 2 }, "対象試合の結果は含めない");
assert.deepEqual(before.get("5"), buildRecordsBeforeGame(temporal.slice(0, 6)).get("5"), "後の試合の結果は含めない");
console.log("ok 他画面が使う既存の試合前勝率処理も維持");

const divisionHistory = await readJson<DivisionHistoryFile>(path.join(DATA_DIR, "division-history.json"));
let scopes = 0;
let games = 0;
for (const season of readdirSync(DATA_DIR).filter((s) => /^20\d\d-\d\d$/.test(s)).sort()) {
  const summaries = await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"));
  assert(summaries, `${season}: build:data が必要です`);
  const teams = await readJson<TeamSummary[]>(path.join(DATA_DIR, season, "teams.json"));
  assert(teams, season + ": チームの最新成績が必要です");
  const latestRates = buildOpponentSeasonWinRates(teams);
  const teamsById = new Map(teams.map((t) => [t.teamId, t]));
  const backToBack = buildBackToBackStatus(summaries);
  const dir = path.join(DATA_DIR, season, "team-games");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
    const teamId = file.replace(/\.json\.gz$/, "");
    const all = (await readJson<TeamGameLog[]>(path.join(dir, file.replace(/\.gz$/, ""))))!;
    for (const gameType of ["regular", "playoff", "both"] as const) {
      const logs = filterByGameType(all, gameType);
      const actual = buildSituationalRecordGroups(logs, teamId, backToBack, latestRates, divisionHistory, season);
      const weekdayRows = actual.find((g) => g.key === "weekday")!.rows;
      const selections = weekdayRows.map((r) => logs.filter((g) => r.predicate(g, undefined)));
      assert.equal(selections[0]!.length + selections[1]!.length, logs.length, `${season} ${teamId} ${gameType} 全試合を一度だけ分類`);
      assert.equal(selections.flat().filter((g) => g.win).length, logs.filter((g) => g.win).length, "曜日の勝数の合計");
      for (const g of logs) assert.equal(weekdayRows.filter((r) => r.predicate(g, undefined)).length, 1, "曜日は排他的");
      const venue = actual.find((g) => g.key === "venue")!.rows;
      assert.deepEqual(venue.map((r) => logs.filter((g) => r.predicate(g, undefined)).length),
        [logs.filter((g) => g.isHome).length, logs.filter((g) => !g.isHome).length], "会場の分類を維持");
      const strength = actual.find((g) => g.key === "opponentStrength")!.rows;
      const buckets = strength.map((r) => logs.filter((g) => r.predicate(g, undefined)));
      assert.equal(buckets[0]!.length + buckets[1]!.length + buckets[3]!.length, logs.length, "5割未満＋5割以上＋対象外＝全試合");
      const winsOf = (list: TeamGameLog[]) => list.filter((g) => g.win).length;
      assert.equal(winsOf(buckets[0]!) + winsOf(buckets[1]!) + winsOf(buckets[3]!), winsOf(logs), "勝数の合計");
      assert.equal(buckets[0]!.filter((g) => !g.win).length + buckets[1]!.filter((g) => !g.win).length + buckets[3]!.filter((g) => !g.win).length,
        logs.filter((g) => !g.win).length, "敗数の合計");
      const highIds = new Set(buckets[1]!.map((g) => g.scheduleKey));
      for (const g of buckets[2]!) assert(highIds.has(g.scheduleKey), "6割以上は5割以上の内数");
      for (const g of logs) {
        const t = teamsById.get(g.opponentTeamId);
        const gp = t ? t.wins + t.losses : 0;
        const valid = !!t && Number.isSafeInteger(t.wins) && Number.isSafeInteger(t.losses) && t.wins >= 0 && t.losses >= 0 && gp > 0;
        const rate = valid ? t!.wins / gp : 0;
        assert.deepEqual(strength.map((r) => r.predicate(g, undefined)),
          [valid && rate < 0.5, valid && rate >= 0.5, valid && rate >= 0.6, !valid], "相手の最新シーズン勝敗を使用");
      }
      const recordOf = (list: TeamGameLog[]) => [list.length, winsOf(list), list.length - winsOf(list)];
      if (season === "2025-26" && teamId === "703" && gameType === "regular") {
        assert.deepEqual(recordOf(buckets[1]!), [32, 19, 13], "宇都宮 対5割以上");
        assert.deepEqual(recordOf(buckets[0]!), [28, 26, 2], "宇都宮 対5割未満");
        assert.deepEqual(recordOf(buckets[3]!), [0, 0, 0], "宇都宮 対象外なし");
      }
      if (season === "2022-23" && (teamId === "698" || teamId === "729") && gameType === "regular") {
        const t = teamsById.get(teamId)!;
        assert.equal(t.wins + t.losses, 60, "勝率の分母は不戦勝・不戦敗を含む公式の60試合");
        assert.equal(latestRates.get(teamId), t.wins / 60);
        assert.notEqual(latestRates.get(teamId), t.wins / t.gamesPlayed, "スタッツの59試合で割らない");
        assert.equal(logs.length, 59, "結果だけの試合を母集団へ追加しない");
        assert(!logs.some((g) => g.scheduleKey === "500609"));
      }
      scopes++;
      games += logs.length;
    }
  }
}
assert(scopes > 0 && games > 0);
console.log(`ok 全シーズン ${scopes}チーム・試合区分、延べ${games}チーム試合：曜日の試合数・勝敗、会場、相手の強さ（入力は従来の試合ログのみ）`);
