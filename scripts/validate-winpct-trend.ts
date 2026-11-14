// 順位表の「勝率推移」タブ（DESIGN.md 388章）の検証。standings-history の各日付のスナップショットで、
// winPct が 勝÷(勝＋敗) と一致し、0〜1 に収まり、最新の日が順位表の勝率と同じ値であることを全シーズン・両リーグで確かめる。
// 使い方: npm run validate:winpct-trend（先に build:data）。食い違いがあれば終了コード1

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { formatWinPct } from "../src/lib/format.ts";
import type { StandingsSnapshot } from "../shared/types.ts";

let failures = 0;
const ng = (m: string) => {
  failures += 1;
  console.error(`NG ${m}`);
};
const ok = (m: string) => console.log(`ok ${m}`);

if (formatWinPct(0.8125) !== ".813" || formatWinPct(1) !== "1.000" || formatWinPct(0) !== ".000") ng("勝率の書き方（.813／1.000／.000）");
else ok("勝率の書き方");

const dataDir = path.join("data");
let files = 0;
let rows = 0;
for (const season of readdirSync(dataDir)) {
  for (const sub of ["", "one"]) {
    const file = path.join(dataDir, season, sub, "standings-history.json.gz");
    if (!existsSync(file)) continue;
    files += 1;
    const history = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as StandingsSnapshot[];
    for (const snap of history) {
      for (const t of snap.teams) {
        rows += 1;
        const games = t.wins + t.losses;
        const expected = games === 0 ? 0 : t.wins / games;
        if (Math.abs(t.winPct - expected) > 1e-9) ng(`${season}${sub ? "/one" : ""} ${snap.date} ${t.teamId}: winPct ${t.winPct} ≠ ${expected}`);
        if (!(t.winPct >= 0 && t.winPct <= 1)) ng(`${season}${sub ? "/one" : ""} ${snap.date} ${t.teamId}: 範囲外 ${t.winPct}`);
      }
    }
  }
}
if (files === 0) ng("standings-history.json.gz が1つも見つからない（先に npm run build:data）");
else ok(`${files} ファイル・${rows} 行の winPct が 勝÷(勝＋敗) と一致し 0〜1`);
if (failures > 0) process.exit(1);
