// ランキング > チーム > 観客動員（DESIGN.md 270章）の計算を、試合の一覧（games-summary）から独立に数え直して照らし合わせる。
// 先に npm run build:data で導出データ（games-summary）を作っておく。
import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { GameSummary } from "../shared/types.ts";
import { attendanceRows, attendanceVenueOptions, type AttendanceFilter, type AttendanceGame } from "../src/lib/attendanceRanking.ts";
import { isWeekdayGame } from "../src/lib/japaneseHolidays.ts";

let failed = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "ok  " : "NG  "} ${label}`);
  if (!ok) failed += 1;
};

const games: AttendanceGame[] = [];
for (const season of readdirSync(DATA_DIR).filter((n) => /^\d{4}-\d{2}$/.test(n)).sort()) {
  const list = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
  games.push(...list.map((g) => ({ ...g, season })));
}
const base: AttendanceFilter = { gameType: "regular", day: "all", venue: "", isWeekday: isWeekdayGame };
const name = (_: string, n: string) => n;

// 1. シーズンごとに、全クラブの合計＝来場者数が1人以上入っているホームのレギュラーシーズンの試合の合計
for (const season of [...new Set(games.map((g) => g.season))]) {
  const sg = games.filter((g) => g.season === season);
  const expected = sg.filter((g) => g.gameType === "regular" && g.gameEndedFlg && (g.attendance ?? 0) > 0);
  const rows = attendanceRows(sg, base, name);
  const sum = rows.reduce((a, r) => a + r.total, 0);
  const n = rows.reduce((a, r) => a + r.games, 0);
  check(sum === expected.reduce((a, g) => a + g.attendance!, 0) && n === expected.length, `${season}: 合計と試合数が数え直しと一致（${n}試合）`);
  check(rows.every((r) => Math.abs(r.average * r.games - r.total) < 1e-6), `${season}: 平均×試合数＝合計`);
  // 2. 平日開催（祝日を除く）と土日祝開催で、ちょうど2つに分かれる
  const wd = attendanceRows(sg, { ...base, day: "wkday" }, name);
  const we = attendanceRows(sg, { ...base, day: "wkend" }, name);
  const sum2 = [...wd, ...we].reduce((a, r) => a + r.total, 0);
  const n2 = [...wd, ...we].reduce((a, r) => a + r.games, 0);
  check(sum2 === sum && n2 === n, `${season}: 平日開催＋土日祝開催＝すべて`);
  // 3. 会場ごとに分けた合計＝すべて
  const venues = attendanceVenueOptions(sg, base);
  const sum3 = venues.reduce((a, v) => a + attendanceRows(sg, { ...base, venue: v.venue }, name).reduce((b, r) => b + r.total, 0), 0);
  const noVenue = sg.filter((g) => g.gameType === "regular" && g.gameEndedFlg && (g.attendance ?? 0) > 0 && !g.venue).reduce((a, g) => a + g.attendance!, 0);
  check(sum3 + noVenue === sum, `${season}: 会場ごとの合計の和＝すべて`);
}

// 4. 無観客（0人）の試合は入らない（2019-20）
const zero = games.filter((g) => g.season === "2019-20" && g.attendance === 0).length;
const g1920 = games.filter((g) => g.season === "2019-20");
const total1920 = attendanceRows(g1920, base, name).reduce((a, r) => a + r.games, 0);
check(zero > 0 && total1920 === g1920.filter((g) => g.gameType === "regular" && g.gameEndedFlg && (g.attendance ?? 0) > 0).length, `2019-20: 0人の試合（${zero}試合）は平均・合計に入らない`);

console.log(failed === 0 ? "\nすべて ok" : `\n${failed} 件 NG`);
process.exit(failed === 0 ? 0 : 1);
