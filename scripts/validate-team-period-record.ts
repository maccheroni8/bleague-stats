// チームの1試合記録の「Q別・前後半」（設計書265章。src/lib/teamPeriodGames.ts）の検証（検証専用。CIには入れず、必要なときに手で実行する）。
//
// 確かめること（全シーズン・全行）:
// - 前後半5分の特別な試合を除き、1Q〜4Qと延長の値を足すと、試合全体の値（1試合行の索引）と一致する（得点・シュート・リバウンド・ファウル・内訳の得点・
//   登録区分別の得点・相手の値）。前半＝1Q＋2Q・後半＝3Q＋4Q
// - 延長の無い試合は延長が null、前後半5分の特別な試合は1Q〜4Q・前半・後半が null
// - 相手の得点は、同じ試合の相手の行の得点と一致する
// 使い方: npm run validate:team-period-record（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
// （導出データ data/{season}/team-game-index.json.gz・team-period-index.json.gz が要る。無ければ npm run build:data）

import { isManualBoxscoreKey } from "./lib/manualBoxscores.ts";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { viewTeamGameIndex, teamGameAt, type IndexedTeamGame } from "../shared/gameIndexRead";
import type { TeamPeriodIndexFile } from "../shared/periodIndex";
import { teamPeriodGameAt } from "../src/lib/teamPeriodGames";
import type { GameRecordPeriod } from "../src/lib/periodIndex";

const ROOT = path.resolve("data");
const readGz = (f: string) => JSON.parse(gunzipSync(readFileSync(f)).toString("utf8"));

const COLS = [
  "teamScore", "opponentScore", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf",
  "fb", "pt2in", "pft", "pt2nd", "foulsDrawn", "dunks", "benchPoints", "starterPoints", "japanesePoints", "foreignPoints", "naturalizedOrAsianPoints",
  "opponentFgm", "opponentFga", "opponentTpm", "opponentTpa", "opponentFtm", "opponentFta", "opponentOreb", "opponentDreb", "opponentAst", "opponentTov",
  "opponentStl", "opponentBlk", "opponentPf", "opponentFb", "opponentPt2in", "opponentPft", "opponentPt2nd", "opponentFoulsDrawn", "opponentDunks",
] as const;

let failures = 0;
const samples: string[] = [];
function bad(msg: string): void {
  failures += 1;
  if (samples.length < 12) samples.push(msg);
}

const seasons = readdirSync(ROOT).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
let rowsChecked = 0;
for (const season of seasons) {
  const gf = path.join(ROOT, season, "team-game-index.json.gz");
  const pf = path.join(ROOT, season, "team-period-index.json.gz");
  if (!existsSync(gf) || !existsSync(pf)) continue;
  const view = viewTeamGameIndex(readGz(gf));
  const file = readGz(pf) as TeamPeriodIndexFile;
  if (file.indexRows !== view.size) {
    bad(`${season}: 行数が合わない`);
    continue;
  }
  const at = (i: number, p: GameRecordPeriod) => teamPeriodGameAt(view, file, i, p);
  for (let i = 0; i < view.size; i++) {
    const whole = teamGameAt(view, i);
    const q = (["q1", "q2", "q3", "q4"] as const).map((p) => at(i, p));
    const h1 = at(i, "h1");
    const h2 = at(i, "h2");
    const ot = at(i, "ot");
    if (isManualBoxscoreKey(whole.scheduleKey)) {
      if (q.some((r) => r) || h1 || h2 || ot) bad(`${season} ${whole.scheduleKey} 行${i}: ピリオド別の行が無い手入力の試合に区間の値がある`);
      continue;
    }
    if (whole.shortGame) {
      if (q.some((r) => r) || h1 || h2) bad(`${season} ${whole.scheduleKey} 行${i}: 前後半5分の特別な試合に1Q〜4Qの値がある`);
      continue;
    }
    if (q.some((r) => !r) || !h1 || !h2) {
      bad(`${season} ${whole.scheduleKey} 行${i}: 1Q〜4Q・前半・後半のどれかが無い`);
      continue;
    }
    if (whole.overtimes === 0 && ot) bad(`${season} ${whole.scheduleKey} 行${i}: 延長の無い試合に延長の値がある`);
    if (whole.overtimes > 0 && !ot) bad(`${season} ${whole.scheduleKey} 行${i}: 延長のあった試合に延長の値が無い`);
    const parts = [...(q as IndexedTeamGame[]), ...(ot ? [ot] : [])];
    for (const c of COLS) {
      const sum = parts.reduce((s, r) => s + (r[c] as number), 0);
      if (sum !== (whole[c] as number)) bad(`${season} ${whole.scheduleKey} 行${i}: ${c} の合計 ${sum} が試合全体 ${whole[c]} と違う`);
      const hs = (h1[c] as number) + (h2[c] as number) + (ot ? (ot[c] as number) : 0);
      if (hs !== (whole[c] as number)) bad(`${season} ${whole.scheduleKey} 行${i}: ${c} の前半＋後半${ot ? "＋延長" : ""} ${hs} が試合全体 ${whole[c]} と違う`);
    }
    const oppWhole = teamGameAt(view, i ^ 1);
    if (q[0]!.opponentScore !== at(i ^ 1, "q1")!.teamScore) bad(`${season} ${whole.scheduleKey} 行${i}: 1Qの相手の得点が相手の行の得点と違う`);
    if (whole.opponentScore !== oppWhole.teamScore) bad(`${season} ${whole.scheduleKey} 行${i}: 試合の得点が相手の行と違う`);
    rowsChecked += 1;
  }
}
console.log(`${seasons.length} シーズン・${rowsChecked} 行を確認`);
if (failures > 0) {
  console.error(`NG ${failures} 件\n   ${samples.join("\n   ")}`);
  process.exit(1);
}
console.log("すべて一致しました");
