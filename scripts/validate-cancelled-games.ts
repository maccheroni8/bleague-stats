// 中止の試合の扱い（DESIGN.md 411章）の検証。
//  1. 「本物の生データ」の判定（shared/gameRealData.ts）
//  2. 公式の日程の実際のカード（2026-11-15 信州-茨城 ScheduleKey=506592）から、空の枠がある試合でも中止にできる・本物の生データがある試合は中止にしない
//  3. 集計の読み込み（readAllGames）が、中止の試合の空の枠だけを外す。過去の中止（2019-20 の173試合など）の扱いは変わらない
import { gunzipSync } from "node:zlib";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { hasRealGameData } from "../shared/gameRealData.ts";
import { parseScheduleCards, reconcileCancelled } from "./lib/scheduleCancelled.ts";
import { DATA_DIR, classifyStoredGames, readAllGames, readCancelledScheduleKeys } from "./lib/storage.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}

// 1. 判定
check("空の枠（終了していない・得点なし）は本物ではない", !hasRealGameData({ gameEndedFlg: false, homeScore: null, awayScore: null }));
check("終了した試合は本物", hasRealGameData({ gameEndedFlg: true, homeScore: 80, awayScore: 70 }));
check("試合中（得点がある）は本物", hasRealGameData({ gameEndedFlg: false, homeScore: 12, awayScore: 9 }));
check("試合中（0-0 でも得点の欄が数値）は本物", hasRealGameData({ gameEndedFlg: false, homeScore: 0, awayScore: 0 }));
check("得点の欄が欠けた古い形も落ちない", !hasRealGameData({ gameEndedFlg: false }));

// 2. 公式のカード（2026-11-15。中止のカードにはリンクが無い）
const CARD_506592 =
  '<li class="list-item" id="506592"><script>(function(j$){ _contexts_s3id[506592]=1; })(jQuery);</script><div class="inner"><div class="data-game"><div class="game "><span class="team home"><span class="team-name">信州</span></span><span class="point font-blg"></span><span class="team away"><span class="team-name">茨城</span></span></div><div class="info"><div class="info-arena"><span class="setu-none"></span><span>長野県 | ホワイト</span><span>14:05</span></div><div class="info-scorestate"></div></div></div><div class="data-link"><span class="btn disabled">試合中止</span></div></div></li>';
const cards = parseScheduleCards([CARD_506592]);
check("中止のカードを読む", cards.cancelledKeys.join() === "506592" && cards.keys.length === 0);
const base = { existingKeys: ["506592", "506593"], normalKeys: [], cancelledKeys: ["506592"], existingCancelledKeys: [] as string[] };
check(
  "空の枠だけの試合も、中止のカードがあれば中止にする（本物の生データの集合に入れない）",
  reconcileCancelled({ ...base, withBoxscore: new Set<string>() }).cancelled.join() === "506592",
);
check(
  "本物の生データがある試合は、中止のカードがあっても中止にしない",
  reconcileCancelled({ ...base, withBoxscore: new Set(["506592"]) }).cancelled.length === 0,
);
check(
  "中止のカードが無ければ、空の枠でも中止にしない（試合が始まった直後の試合を中止と見まちがえない）",
  reconcileCancelled({ ...base, cancelledKeys: [], withBoxscore: new Set<string>() }).cancelled.length === 0,
);
check(
  "生データの無い中止（507280 など過去の形）は今までどおり中止",
  reconcileCancelled({ existingKeys: [], normalKeys: [], cancelledKeys: ["507280"], existingCancelledKeys: [], withBoxscore: new Set<string>() }).cancelled.join() === "507280",
);
check(
  "同じキーが通常のカードに載れば中止を外す（延期で再設定）",
  reconcileCancelled({ existingKeys: [], normalKeys: ["506592"], cancelledKeys: ["506592"], existingCancelledKeys: ["506592"], withBoxscore: new Set<string>() }).restored.join() === "506592",
);

// 3. 読み込み（実データ）
const rj = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString("utf-8"));
let filtered = 0;
for (const season of readdirSync(DATA_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d))) {
  for (const category of ["premier", "one"] as const) {
    const dir = path.join(DATA_DIR, season, category === "premier" ? "" : "one", "games");
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
    const cancelled = await readCancelledScheduleKeys(season, category);
    const { real, emptyFrames } = await classifyStoredGames(season, category);
    const games = await readAllGames(season, category);
    // 中止かつ空の枠の試合だけが外れる
    const expectedDropped = [...cancelled].filter((k) => emptyFrames.has(k));
    check(
      `${season}${category === "one" ? " B.ONE" : ""}: 読み込み ${games.length}／ファイル ${files.length}（外れた試合 ${expectedDropped.length}）`,
      games.length === files.length - expectedDropped.length && expectedDropped.every((k) => !games.some((g) => g.scheduleKey === k)),
    );
    // 本物の生データがある試合は中止の一覧にあっても外さない
    check(
      `${season}${category === "one" ? " B.ONE" : ""}: 本物の生データがある試合は外れない`,
      [...cancelled].filter((k) => real.has(k)).every((k) => games.some((g) => g.scheduleKey === k)),
    );
    filtered += expectedDropped.length;
  }
}
// 過去の中止（2019-20 は中止173試合。生データの無い試合なので、読み込みは何も外さない）
const sched1920 = existsSync(path.join(DATA_DIR, "2019-20", "schedule.json.gz")) ? rj(path.join(DATA_DIR, "2019-20", "schedule.json.gz")) : null;
if (sched1920) {
  const n = (sched1920.cancelledGames ?? []).length;
  check(`2019-20 の中止 ${n} 試合は、生データの空の枠を持たない（外れる試合 0）`, (await classifyStoredGames("2019-20")).emptyFrames.size === 0);
}
console.log(`中止の試合の空の枠で外れた試合: 全体 ${filtered}`);

if (failed > 0) {
  console.error(`NG ${failed}件`);
  process.exit(1);
}
console.log("OK");
