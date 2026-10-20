// 保存画像（DESIGN.md 239章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること:
//  1. データの基準日: 試合の一覧から「終わった試合の最も新しい試合日」を試合区分ごとに求める（終わっていない試合は数えない・区分で絞る）。
//     実データ（全シーズンの games-summary）で、総当たりの計算と一致し、日付として読めて、未来の日付にならないこと
//  2. フッターの文言・書式（「データの基準日：2026/10/11時点」。基準日が無いときは出さない）
//  3. 上位10名で保存するときの「10位タイ ほか◯人」の数え方（同じ順位が10位の外に続く行数）
//  4. 保存の選択に応じたファイル名（初期の選択は変えない）
//  5. 画面の表の下の「データの基準日」と保存画像のフッターが使う、基準日の指定（240章）
//  6. スマホ幅から保存するときの画面幅の判定（広い画面として評価する）と、iPhone・iPad の canvas の上限に収める倍率（241章）
//  7. 画像を作る段階の時間の上限（上限を超えたら止まった段階のエラー・失敗も段階つきのエラー・上限のあとは先へ進めない。242章）
//
// 使い方: npm run validate:export-image（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  baseDateFooterText,
  baseDateOf,
  baseDateSpecKey,
  exportErrorMessage,
  exportFilenameWithOptions,
  ExportImageError,
  fitExportScale,
  formatBaseDate,
  IOS_CANVAS_MAX_AREA,
  IOS_CANVAS_MAX_SIDE,
  latestBaseDate,
  latestEndedGameDate,
  matchesAtViewportWidth,
  runWithinDeadline,
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
if (seasons.length === 0) {
  console.log("SKIP 実データの基準日: 導出データ（games-summary.json.gz）が無いため判定できません（npm run build:data で作成後に再実行）");
} else {
  eq(`実データ（${seasons.length}シーズン×3区分）の基準日の食い違い`, bad.slice(0, 10), []);
  console.log(`   確かめた組: ${checked}`);
}

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

// --- 5. スマホ幅から保存するときの画面幅の判定（241章）。保存の間だけ、useMediaQuery が広い画面（1280px）の答えを返す ---
const WIDE = 1280;
eq("スマホ幅の判定は広い画面では不一致", matchesAtViewportWidth("(max-width: 560px)", WIDE), false);
eq("広い画面の判定は広い画面で一致", matchesAtViewportWidth("(min-width: 561px)", WIDE), true);
eq("境目: 560px は max-width: 560px に一致", matchesAtViewportWidth("(max-width: 560px)", 560), true);
eq("境目: 561px は max-width: 560px に不一致", matchesAtViewportWidth("(max-width: 560px)", 561), false);
eq("境目: 561px は min-width: 561px に一致", matchesAtViewportWidth("(min-width: 561px)", 561), true);
eq("and でつないだ条件", matchesAtViewportWidth("(min-width: 561px) and (max-width: 1000px)", WIDE), false);
eq("画面幅では決まらない条件は null（実際の判定を使う）", matchesAtViewportWidth("(prefers-color-scheme: dark)", WIDE), null);
eq("画面幅の条件と混ざるときも null", matchesAtViewportWidth("(min-width: 561px) and (prefers-color-scheme: dark)", WIDE), null);

// --- 6. canvas の上限に収める倍率（241章。iPhone・iPad だけ。上限が null のときは今までどおり） ---
const IOS = { maxArea: IOS_CANVAS_MAX_AREA, maxSide: IOS_CANVAS_MAX_SIDE };
eq("iOS の上限（4096×4096）", IOS_CANVAS_MAX_AREA, 4096 * 4096);
eq("上限が無ければ倍率はそのまま", fitExportScale(984, 3356, 3, { maxArea: null, maxSide: null }), 3);
eq("上限に収まるなら倍率はそのまま（個人ランキング 744×1725）", fitExportScale(744, 1725, 3, IOS), 3);
eq("3人組 984×3356 は 2.25 倍", fitExportScale(984, 3356, 3, IOS), 2.25);
eq("下げた倍率で、寸法（切り捨て）の面積が上限以内", (() => {
  const s = fitExportScale(984, 3356, 3, IOS);
  return Math.floor(984 * s) * Math.floor(3356 * s) <= IOS_CANVAS_MAX_AREA;
})(), true);
eq("下限は 0.1 倍", fitExportScale(100000, 100000, 3, IOS), 0.1);
eq("1辺の上限も効く（細長い画像）", fitExportScale(100, 40000, 3, IOS), 0.4);
eq("サイズが 0 のときはそのまま", fitExportScale(0, 0, 3, IOS), 3);

// --- 7. 画像を作る段階の時間の上限（242章）。上限を超えたら、そのときの段階のエラーで終わる（「出力中...」のまま止まらない） ---
const never = new Promise<never>(() => {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function outcome<T>(p: Promise<T>): Promise<unknown> {
  try {
    return { ok: await p };
  } catch (e) {
    return e instanceof ExportImageError ? { phase: e.phase, reason: e.reason, message: e.message } : { other: String(e) };
  }
}
eq("上限の中で終われば、その結果", await outcome(runWithinDeadline(async () => "done", 200)), { ok: "done" });
eq(
  "複製の途中で止まったら、上限で「表の複製」のエラー",
  await outcome(runWithinDeadline(async (d) => { d.setPhase("clone"); return never; }, 50)),
  { phase: "clone", reason: "timeout", message: "画像を作れませんでした（表の複製（写真・ロゴの読み込み）の途中で0秒を超えました）。もう一度お試しください。" },
);
eq(
  "30秒の上限の文言",
  new ExportImageError("draw", "timeout").message,
  "画像を作れませんでした（画像の描画の途中で30秒を超えました）。もう一度お試しください。",
);
eq(
  "途中の失敗は、そのときの段階のエラー",
  await outcome(runWithinDeadline(async (d) => { d.setPhase("draw"); throw new Error("canvas"); }, 200)),
  { phase: "draw", reason: "failed", message: "画像を作れませんでした（画像の描画で失敗しました）。もう一度お試しください。" },
);
eq(
  "画像ファイルにできない（toBlob が空）のエラーはそのまま",
  await outcome(runWithinDeadline(async () => { throw new ExportImageError("file", "failed"); }, 200)),
  { phase: "file", reason: "failed", message: "画像を作れませんでした（画像ファイルの作成で失敗しました）。もう一度お試しください。" },
);
eq("思いがけない失敗の文言", exportErrorMessage(new Error("x")), "画像を作れませんでした。もう一度お試しください。");
eq(
  "上限を超えたあとは先の段階へ進めない（checkpoint が投げる・段階も変わらない）",
  await (async () => {
    let reached = false;
    let afterPhase = "";
    const r = await outcome(
      runWithinDeadline(async (d) => {
        d.setPhase("clone");
        await sleep(80);
        try {
          d.checkpoint();
          reached = true;
        } catch (e) {
          afterPhase = e instanceof ExportImageError ? e.phase : "";
        }
        d.setPhase("file");
        return "late";
      }, 30),
    );
    await sleep(80);
    return { r: (r as { phase?: string }).phase, reached, afterPhase };
  })(),
  { r: "clone", reached: false, afterPhase: "clone" },
);
if (failures > 0) {
  console.log(`\n${failures}件の食い違いがあります`);
  process.exit(1);
}
console.log(seasons.length === 0 ? "\n実行した検証はすべて一致しました（実データの基準日は判定できないためスキップ）" : "\nすべて一致しました");
