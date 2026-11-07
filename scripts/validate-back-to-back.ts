// 連戦（同じ相手と中1日以内に続けた試合）の GAME1・GAME2・GAME3… の数え方を検証する（347章）。
// npm run build:data のあとに実行。別の書き方（対戦カードごとに日程から連なりを取り出す方式）で数えた値と、
// 画面が使う buildBackToBackStatus を全シーズン・B.PREMIER／B.ONE で突き合わせ、宇都宮 2026-27 の手計算値も確かめる。
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { buildBackToBackStatus, backToBackGameLabels } from "../src/lib/situational";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { GameSummary } from "../shared/types.ts";

const day = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
const g = (scheduleKey: string, date: string, home: string, away: string, gameType: "regular" | "playoff" = "regular") =>
  ({ scheduleKey, date, homeTeamId: home, awayTeamId: away, homeScore: 80, awayScore: 70, gameEndedFlg: true, gameType }) as GameSummary;

// 小さな例
const mini = buildBackToBackStatus([
  g("1", "2026-10-03", "A", "B"), g("2", "2026-10-04", "A", "B"), // 同じ相手と連日 → GAME1・GAME2
  g("3", "2026-10-06", "A", "C"), g("4", "2026-10-07", "A", "C"), // 前の試合(B)と2日差でも相手が違う → 3は連戦の1試合目、4は2試合目
  g("5", "2026-10-10", "D", "A"), // 3日空き → 連戦ではない
  g("6", "2026-10-13", "A", "E", "playoff"), g("7", "2026-10-15", "A", "E", "playoff"), g("8", "2026-10-16", "A", "E", "playoff"), // GAME1・2・3
  g("9", "2026-10-20", "A", "F", "playoff"), g("10", "2026-10-23", "A", "F", "playoff"), // 中2日空き → 連戦ではない
  g("11", "2026-11-01", "G", "A"), g("12", "2026-11-02", "H", "A"), g("13", "2026-11-03", "G", "A"), // 相手が交互 → 連戦ではない
]);
const at = (key: string, team: string) => mini.get(key)?.get(team);
assert.deepEqual(["1", "2"].map((k) => at(k, "A")), ["GAME1", "GAME2"]);
assert.deepEqual(["1", "2"].map((k) => at(k, "B")), ["GAME1", "GAME2"], "相手側も同じ番号");
assert.deepEqual(["3", "4"].map((k) => at(k, "A")), ["GAME1", "GAME2"], "相手が違う試合が中1日以内でも、同じ相手でなければ続けない");
assert.equal(at("5", "A"), undefined);
assert.deepEqual(["6", "7", "8"].map((k) => at(k, "A")), ["GAME1", "GAME2", "GAME3"]);
assert.deepEqual(["9", "10"].map((k) => at(k, "A")), [undefined, undefined], "中2日以上空けば別の連戦（1試合ずつなので連戦ではない）");
assert.deepEqual(["11", "12", "13"].map((k) => at(k, "A")), [undefined, undefined, undefined]);
assert.deepEqual(backToBackGameLabels(mini), ["GAME1", "GAME2", "GAME3"]);
assert.deepEqual(backToBackGameLabels(mini, new Set(["1", "2"])), ["GAME1", "GAME2"], "GAME3は当てはまる試合があるときだけ");
console.log("ok 連戦の小さな例（同じ相手・別の相手・中2日・3連戦）");

/** 別の書き方: チームと相手の組ごとに日付順に並べ、2日以内でつながる試合を1つの連なりにする。間にほかの相手の試合が入っても切れる必要があるので、チームの全日程の中の隣り合いで確かめる */
function independent(games: GameSummary[]): Map<string, string> {
  const out = new Map<string, string>(); // `${scheduleKey}|${teamId}` → GAMEn
  const teams = new Set(games.flatMap((x) => [x.homeTeamId, x.awayTeamId]));
  for (const t of teams) {
    const mine = games.filter((x) => x.gameEndedFlg && (x.homeTeamId === t || x.awayTeamId === t)).sort((a, b) => day(a.date) - day(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
    const opp = (x: GameSummary) => (x.homeTeamId === t ? x.awayTeamId : x.homeTeamId);
    const runs: GameSummary[][] = [];
    for (const x of mine) {
      const last = runs[runs.length - 1];
      const prev = last?.[last.length - 1];
      if (last && prev && opp(prev) === opp(x) && day(x.date) - day(prev.date) <= 2) last.push(x);
      else runs.push([x]);
    }
    for (const run of runs) if (run.length >= 2) run.forEach((x, i) => out.set(`${x.scheduleKey}|${t}`, `GAME${i + 1}`));
  }
  return out;
}

const categories: { label: string; dir: string; season: string }[] = [];
for (const season of readdirSync(DATA_DIR).filter((s) => /^20\d\d-\d\d$/.test(s)).sort()) {
  categories.push({ label: `${season} B.PREMIER/B1`, dir: path.join(DATA_DIR, season), season });
  if (existsSync(path.join(DATA_DIR, season, "one"))) categories.push({ label: `${season} B.ONE`, dir: path.join(DATA_DIR, season, "one"), season });
}

let total = 0;
const longSeries: string[] = [];
const gaps: string[] = [];
const maxByCategory: string[] = [];
let utsunomiya: Record<string, [number, number]> | null = null;
for (const c of categories) {
  const summaries = await readJson<GameSummary[]>(path.join(c.dir, "games-summary.json"));
  if (!summaries) continue;
  const actual = buildBackToBackStatus(summaries);
  const expected = independent(summaries);
  const flat = new Map<string, string>();
  for (const [key, byTeam] of actual) for (const [team, v] of byTeam) flat.set(`${key}|${team}`, v);
  assert.equal(flat.size, expected.size, `${c.label}: 連戦に数える件数`);
  for (const [k, v] of expected) assert.equal(flat.get(k), v, `${c.label}: ${k}`);
  total += flat.size;
  // 両チームで同じ番号になること
  for (const [key, byTeam] of actual) if (byTeam.size === 2) { const [a, b] = [...byTeam.values()]; assert.equal(a, b, `${c.label}: ${key} の両チームの番号`); }
  const labels = backToBackGameLabels(actual);
  if (labels.length > 2) maxByCategory.push(`${c.label}: 最大 ${labels[labels.length - 1]}`);
  // GAME3以降の試合、および同じ相手の続きの途中に中2日以上空いた例（プレーオフ）を集める
  const byKey = new Map(summaries.map((x) => [x.scheduleKey, x]));
  for (const [key, byTeam] of actual) for (const [team, v] of byTeam) if (Number(v.slice(4)) >= 3 && byTeam.size && team === [...byTeam.keys()][0]) {
    const x = byKey.get(key)!; longSeries.push(`${c.label} ${x.date} ${x.homeTeamId}-${x.awayTeamId} ${v} (${x.gameType})`);
  }
  const pairs = new Map<string, GameSummary[]>();
  for (const x of summaries) if (x.gameEndedFlg && x.gameType === "playoff") { const k = [x.homeTeamId, x.awayTeamId].sort().join("-"); (pairs.get(k) ?? pairs.set(k, []).get(k)!).push(x); }
  for (const [k, list] of pairs) {
    list.sort((a, b) => day(a.date) - day(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
    for (let i = 1; i < list.length; i++) {
      const gap = day(list[i]!.date) - day(list[i - 1]!.date);
      if (gap >= 3 && gap <= 7) gaps.push(`${c.label} ${k}: ${list[i - 1]!.date}→${list[i]!.date}（${gap}日差。${list[i - 1]!.scheduleKey}→${list[i]!.scheduleKey}）`);
    }
  }
  if (c.label === "2026-27 B.PREMIER/B1" || c.label.startsWith("2026-27") && !c.label.includes("B.ONE")) {
    const rec: Record<string, [number, number]> = {};
    for (const x of summaries) {
      if (!x.gameEndedFlg || x.gameType !== "regular") continue;
      const st = actual.get(x.scheduleKey)?.get("703");
      if (!st || (x.homeTeamId !== "703" && x.awayTeamId !== "703")) continue;
      const win = x.homeTeamId === "703" ? x.homeScore > x.awayScore : x.awayScore > x.homeScore;
      (rec[st] ??= [0, 0])[win ? 0 : 1]++;
    }
    utsunomiya = rec;
  }
  console.log(`ok ${c.label}: 連戦に数えた試合（チームごと）${flat.size}件、別の数え方と一致`);
}
console.log(`ok 全体 ${total}件`);
if (maxByCategory.length) console.log("GAME3以降が出るカテゴリ:\n  " + maxByCategory.join("\n  "));
console.log(`GAME3以降の試合 ${longSeries.length}件（先頭5件）:\n  ` + longSeries.slice(0, 5).join("\n  "));
console.log(`プレーオフの同じ対戦で中2日〜7日空いた箇所 ${gaps.length}件:\n  ` + gaps.join("\n  "));
console.log("宇都宮(703) 2026-27 レギュラー:", JSON.stringify(utsunomiya));
assert.deepEqual(utsunomiya, { GAME1: [1, 2], GAME2: [1, 2] }, "宇都宮 2026-27 は GAME1 1勝2敗・GAME2 1勝2敗");
console.log("ok 宇都宮 2026-27: GAME1 1勝2敗・GAME2 1勝2敗");
