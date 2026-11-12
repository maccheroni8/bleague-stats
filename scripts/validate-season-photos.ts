// シーズン別の選手写真の検証（台帳と画面の接続）。外のサイトには問い合わせない。
//
// 1. 台帳（public/media/player-photos/{season}.json）: 形式・シーズンが終わったシーズンだけ・台帳の写真がすべてあり、台帳に無い写真が無い・
//    取得の記録（sources.json）と1対1で、指紋（sha256）が写真と一致・出典のURLのフォルダが台帳のチーム・シーズン・選手と一致・240×240 の WebP
// 2. 選び方（pickSeasonPhotoTeam）: チームの指定・移籍・台帳に無い選手
// 3. 画面の接続: 選手の写真は PlayerPhoto だけが出す（ほかで写真のURLを組み立てない）。PlayerPhoto を使う所は season を渡す
//    （通算・今季だけの画面は一覧 CURRENT_PHOTO_ONLY に理由つきで書く）
// 4. 保存キー: 台帳・写真の置き場所は data/ の外。台帳の部品が保存キーの対象のコード（build-data code-files）に入っていない
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { isSeasonPhotoIndex, pickSeasonPhotoTeam, seasonPhotoFileName, type SeasonPhotoIndex, type SeasonPhotoSources } from "../shared/seasonPhotos.ts";
import { currentSeason } from "./lib/season.ts";

const DIR = path.join("public", "media", "player-photos");
let problems = 0;
const fail = (msg: string) => {
  problems += 1;
  console.error(`NG: ${msg}`);
};

// ---- 1. 台帳 ----
const seasons = existsSync(DIR) ? readdirSync(DIR).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, -5)).sort() : [];
let photoCount = 0;
for (const season of seasons) {
  if (season >= currentSeason()) fail(`${season}: 進行中のシーズンの台帳がある（今の写真がそのシーズンの写真）`);
  const index = JSON.parse(readFileSync(path.join(DIR, `${season}.json`), "utf8")) as SeasonPhotoIndex;
  if (!isSeasonPhotoIndex(index, season)) {
    fail(`${season}: 台帳の形式が違う`);
    continue;
  }
  const sourcesPath = path.join(DIR, season, "sources.json");
  if (!existsSync(sourcesPath)) {
    fail(`${season}: sources.json が無い`);
    continue;
  }
  const sources = JSON.parse(readFileSync(sourcesPath, "utf8")) as SeasonPhotoSources;
  const listed = new Set<string>();
  for (const [playerId, teams] of Object.entries(index.photos)) {
    if (new Set(teams).size !== teams.length) fail(`${season}: ${playerId} のチームが重複`);
    for (const teamId of teams) listed.add(seasonPhotoFileName(teamId, playerId));
  }
  const files = new Set(readdirSync(path.join(DIR, season)).filter((f) => f.endsWith(".webp")));
  for (const f of listed) if (!files.has(f)) fail(`${season}: 台帳にあるのに写真が無い ${f}`);
  for (const f of files) if (!listed.has(f)) fail(`${season}: 台帳に無い写真 ${f}`);
  const bySource = new Map(sources.photos.map((s) => [seasonPhotoFileName(s.teamId, s.playerId), s]));
  if (bySource.size !== sources.photos.length) fail(`${season}: sources.json に同じ組が2回`);
  for (const f of listed) if (!bySource.has(f)) fail(`${season}: 取得の記録が無い ${f}`);
  for (const [f, s] of bySource) {
    if (!listed.has(f)) fail(`${season}: 記録だけあって台帳に無い ${f}`);
    const m = /\/files\/user\/roster\/(\d+)\/(\d{4}-\d{2})\/(\d+)_0[123]\.(?:png|jpg)(?:\?.*)?$/.exec(s.url);
    if (!m || m[1] !== s.teamId || m[2] !== season || m[3] !== s.playerId) fail(`${season}: 出典のURLのフォルダが台帳と違う ${f} ${s.url}`);
    if (s.origin === "official" && !s.url.startsWith("https://bleague.bl.kuroco-img.app/")) fail(`${season}: 公式の出典のURLが違う ${f}`);
    if (s.origin === "wayback" && !/^\d{14}$/.test(s.snapshot ?? "")) fail(`${season}: Wayback の保存日時が無い ${f}`);
    const file = path.join(DIR, season, f);
    if (!existsSync(file)) continue;
    const buf = readFileSync(file);
    if (createHash("sha256").update(buf).digest("hex") !== s.sha256) fail(`${season}: 指紋が写真と違う ${f}`);
    const meta = await sharp(buf).metadata();
    if (meta.format !== "webp" || meta.width !== 240 || meta.height !== 240) fail(`${season}: 240×240 の WebP でない ${f}`);
    if (statSync(file).size > 40 * 1024) fail(`${season}: 大きすぎる写真 ${f}`);
    photoCount += 1;
  }
  for (const key of Object.keys(sources.missing)) if (bySource.has(seasonPhotoFileName(...(key.split("|") as [string, string])))) fail(`${season}: 取れなかった記録と写真の両方にある ${key}`);
}
console.log(`台帳: ${seasons.length}シーズン・写真${photoCount}枚`);

// ---- 2. 選び方 ----
const idx: SeasonPhotoIndex = { v: 1, season: "2022-23", photos: { p1: ["10"], p2: ["10", "20"] } };
assert.equal(pickSeasonPhotoTeam(idx, "p1"), "10");
assert.equal(pickSeasonPhotoTeam(idx, "p1", "10"), "10");
assert.equal(pickSeasonPhotoTeam(idx, "p1", "30"), "10", "指定のチームの写真が無ければ同じシーズンの写真");
assert.equal(pickSeasonPhotoTeam(idx, "p2"), "20", "指定なしは最後の所属");
assert.equal(pickSeasonPhotoTeam(idx, "p2", "10"), "10", "移籍した選手は指定のチーム");
assert.equal(pickSeasonPhotoTeam(idx, "p3"), null, "台帳に無い選手は今の写真");
assert.equal(pickSeasonPhotoTeam(null, "p1"), null);
assert.equal(isSeasonPhotoIndex({ v: 1, season: "2022-23", photos: { p: [] } }), false);
assert.equal(isSeasonPhotoIndex(idx, "2023-24"), false);

// ---- 3. 画面の接続 ----
/** 今の写真だけを出す所（season を渡さない）。ファイル → 理由 */
const CURRENT_PHOTO_ONLY: Record<string, string> = {
  "src/pages/HomePage.tsx": "ホームは今季のリーダーだけ（今の写真がそのシーズンの写真）",
  "src/components/CareerRecordRanking.tsx": "通算記録は1人1行の通算なので最新（今の写真）",
  "src/components/PublicMediaImage.tsx": "257章の対応表が無いときの戻り先。チーム詳細の選手表は TeamDetailPublicMedia で season を渡す",
};
function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}
let wired = 0;
for (const file of walk("src")) {
  const rel = file.split(path.sep).join("/");
  const text = readFileSync(file, "utf8");
  if (rel !== "src/components/PlayerPhoto.tsx" && rel !== "src/lib/data.ts" && /playerPhotoUrl\(/.test(text)) fail(`${rel}: 写真のURLを直接組み立てている（PlayerPhoto を使う）`);
  if (/player-photos\//.test(text.replace(/\/\/.*$/gm, "")) && !["src/lib/data.ts", "src/lib/seasonPhotos.ts", "src/lib/publicMediaSelection.ts"].includes(rel)) {
    fail(`${rel}: 写真の置き場所を直接書いている`);
  }
  for (const m of text.matchAll(/<PlayerPhoto\b[^>]*?\/>/gs)) {
    if (rel === "src/components/PlayerPhoto.tsx") continue;
    if (/\bseason=/.test(m[0])) {
      wired += 1;
      continue;
    }
    if (rel in CURRENT_PHOTO_ONLY) continue;
    if (rel === "src/components/TeamDetailPublicMedia.tsx" && /\{\.\.\.props\}/.test(m[0])) continue;
    fail(`${rel}: PlayerPhoto に season が無い（今の写真だけでよい所は CURRENT_PHOTO_ONLY に理由を書く）: ${m[0].replace(/\s+/g, " ").slice(0, 120)}`);
  }
}
const teamDetailMedia = readFileSync("src/components/TeamDetailPublicMedia.tsx", "utf8");
if (!/<PlayerPhoto \{\.\.\.props\} season=\{season\} teamId=\{pageTeamId\} \/>/.test(teamDetailMedia)) fail("チーム詳細の選手表が season・チームを渡していない");
console.log(`画面: season を渡す PlayerPhoto ${wired}か所`);

// ---- 4. 保存キー ----
const codeFiles = execFileSync("node", ["--experimental-strip-types", "--no-warnings", "scripts/build-data.ts", "code-files"], { encoding: "utf8" });
for (const f of ["shared/seasonPhotos.ts", "src/lib/seasonPhotos.ts", "src/components/PlayerPhoto.tsx", "scripts/fetch-season-photos.ts", "scripts/lib/mediaAssets.ts"]) {
  if (codeFiles.includes(f)) fail(`${f} が保存キーの対象のコードに入っている`);
}
if (readFileSync("scripts/lib/dataLayout.ts", "utf8").includes("media/player-photos")) fail("dataLayout.ts に台帳の置き場所が書かれている（data/ の外に置く）");

if (problems > 0) {
  console.error(`NG: ${problems}件`);
  process.exit(1);
}
console.log("OK: シーズン別の選手写真");
