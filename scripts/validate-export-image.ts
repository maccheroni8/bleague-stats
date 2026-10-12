// 保存画像（DESIGN.md 239章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること:
//  1. データの基準日: 試合の一覧から「終わった試合の最も新しい試合日」を試合区分ごとに求める（終わっていない試合は数えない・区分で絞る）。
//     実データ（全シーズンの games-summary）で、総当たりの計算と一致し、日付として読めて、未来の日付にならないこと
//  2. フッターの文言・書式（「データの基準日：2026/10/11時点」。基準日が無いときは出さない）
//  3. 上位10名で保存するときの「10位タイ ほか◯人」の数え方（同じ順位が10位の外に続く行数）
//  4. 保存の選択に応じたファイル名（初期の選択は変えない）
//  5. 画面の表の下の「データの基準日」と保存画像のフッターが使う、基準日の指定（240章）
//
// 使い方: npm run validate:export-image（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  baseDateFooterText,
  baseDateOf,
  baseDateSpecKey,
  exportFilenameWithOptions,
  formatBaseDate,
  latestBaseDate,
  latestEndedGameDate,
  tiesBeyondTop,
} from "../src/lib/exportFormat.ts";
import type { GameSummary } from "../shared/types.ts";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  const ok = a === e;
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   実際: ${a}\n   期待: ${e}`}`);
  if (!ok) failures += 1;
}

const g = (date: string, gameType: "regular" | "playoff", ended: boolean): GameSummary =>
  ({ scheduleKey: date + gameType, date, homeTeamId: "1", homeTeamName: "a", awayTeamId: "2", awayTeamName: "b", homeScore: 0, awayScore: 0, gameEndedFlg: ended, gameType }) as GameSummary;

// --- 1. 基準日 ---
const sample = [g("2026-10-03", "regular", true), g("2026-10-11", "regular", true), g("2026-10-18", "regular", false), g("2026-05-20", "playoff", true)];
eq("レギュラー: 終わった試合の最新日（終わっていない試合は数えない）", latestEndedGameDate(sample, "regular"), "2026-10-11");
eq("プレーオフ: その区分の最新日", latestEndedGameDate(sample, "playoff"), "2026-05-20");
eq("合算: 区分によらず最新日", latestEndedGameDate(sample, "both"), "2026-10-11");
eq("終わった試合が無い区分は undefined", latestEndedGameDate([g("2026-10-18", "regular", false)], "regular"), undefined);
eq("試合が無い", latestEndedGameDate([], "both"), undefined);
eq("書式 2026-10-11 → 2026/10/11", formatBaseDate("2026-10-11"), "2026/10/11");
eq("複数の枠の基準日は最も新しい日", latestBaseDate(["2025/05/03", undefined, "2026/10/11", "2026/05/03"]), "2026/10/11");
eq("基準日が全く取れなかったとき", latestBaseDate([undefined, undefined]), undefined);

// 実データ: 全シーズンで、総当たりの計算と一致する・日付として読める・未来にならない
const DATA = path.resolve("data");
const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const seasons = existsSync(DATA)
  ? readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d) && existsSync(path.join(DATA, d, "games-summary.json.gz"))).sort()
  : [];
let checked = 0;
const bad: string[] = [];
for (const season of seasons) {
  const summaries = JSON.parse(gunzipSync(readFileSync(path.join(DATA, season, "games-summary.json.gz"))).toString("utf-8")) as GameSummary[];
  for (const type of ["regular", "playoff", "both"] as const) {
    const got = latestEndedGameDate(summaries, type);
    const dates = summaries.filter((s) => s.gameEndedFlg && (type === "both" || s.gameType === type)).map((s) => s.date).sort();
    const want = dates.length ? dates[dates.length - 1] : undefined;
    checked += 1;
    if (got !== want) bad.push(`${season} ${type}: ${got} / ${want}`);
    else if (got !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(got)) bad.push(`${season} ${type}: 日付として読めない（${got}）`);
    else if (got !== undefined && got > todayJst) bad.push(`${season} ${type}: 未来の日付（${got}）`);
  }
}
eq(`実データ（${seasons.length}シーズン×3区分）の基準日の食い違い`, bad.slice(0, 10), []);
eq("実データがある（無いと確かめたことにならない）", seasons.length > 0, true);
console.log(`   確かめた組: ${checked}`);

// --- 2. フッター ---
eq("フッターの文言", baseDateFooterText("2026/10/11"), "データの基準日：2026/10/11時点");
eq("基準日が無いときはフッターの日付を出さない", baseDateFooterText(undefined), "");

// --- 2b. 基準日の指定（画面の表の下の日付と保存画像のフッターが同じ指定を使う。DESIGN.md 240章） ---
eq("通算・歴代の指定", baseDateOf(true, "2026-27", "regular"), { kind: "allTime", gameType: "regular" });
eq("シーズンの指定", baseDateOf(false, "2026-27", "both"), { kind: "season", season: "2026-27", gameType: "both" });
eq("同じ指定は同じ文字列（画面側が求め直さない）", baseDateSpecKey(baseDateOf(false, "2026-27", "regular")), baseDateSpecKey({ kind: "season", season: "2026-27", gameType: "regular" }));
eq("指定が違えば違う文字列（求め直す）", baseDateSpecKey(baseDateOf(false, "2026-27", "regular")) !== baseDateSpecKey(baseDateOf(false, "2025-26", "regular")), true);

// --- 3. 上位10名の同率 ---
eq("10位の外に同じ順位が続かない", tiesBeyondTop(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"], 10), 0);
eq("10位と11位・12位が同じ順位（ほか2）", tiesBeyondTop(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "j", "j", "k"], 10), 2);
eq("5位〜が全部同じ（10位の外に続く分だけ数える）", tiesBeyondTop(["a", "b", "c", "d", "e", "e", "e", "e", "e", "e", "e", "e", "e", "f"], 10), 3);
eq("10行以下なら 0", tiesBeyondTop(["a", "a", "a"], 10), 0);
eq("ちょうど10行", tiesBeyondTop(["a", "a", "a", "a", "a", "a", "a", "a", "a", "a"], 10), 0);

// --- 4. ファイル名 ---
eq("初期の選択（写真あり・画面の件数）は変えない", exportFilenameWithOptions("ランキング.png", {}), "ランキング.png");
eq("写真なし", exportFilenameWithOptions("ランキング.png", { plain: true }), "ランキング_写真なし.png");
eq("上位10名", exportFilenameWithOptions("ランキング.png", { top10: true }), "ランキング_上位10.png");
eq("写真なし・上位10名", exportFilenameWithOptions("ランキング.png", { plain: true, top10: true }), "ランキング_写真なし_上位10.png");

if (failures > 0) {
  console.log(`\n${failures}件の食い違いがあります`);
  process.exit(1);
}
console.log("\nすべて一致しました");
