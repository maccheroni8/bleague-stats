// シーズン別の選手写真を取って、台帳（public/media/player-photos/）を作る（手で実行する道具。形式は shared/seasonPhotos.ts）。
//
// - 対象の組（シーズン・チーム・選手）: 当時の名簿（data/season-rosters.json.gz）と、そのシーズンの players.json（出場した選手。
//   移籍した選手は playedTeamTotals のチームも）。players.json は導出データなので、先に `npm run build:data` を実行する
// - 出典:
//   official … 公式の名簿の画像サーバー `roster/{チームID}/{シーズン}/{選手ID}_03.png`（2021-22 以降に残っている）
//   wayback  … Wayback Machine に保存された公式の写真（同じフォルダの決まり。_03.png → _01.jpg〔400×500〕→ _02.jpg〔120×150〕の順）
//   チームとシーズンは出典のURLのフォルダで決まる（名簿の写真のフォルダそのもの）
// - 写真は今の写真と同じ形（240×240 の WebP。上を基準に正方形に切る）。毎週の名簿の取得（data/player-photos/）とは別の場所なので上書きされない
// - 進行中のシーズンは対象にしない（今の写真がそのシーズンの写真）。シーズンが終わったら、そのシーズンを指定して1回実行する
// - 問い合わせは createThrottledFetch（ホストごとに直列・3秒間隔）。取得済みと「取れなかった」と記録した組は飛ばすので、途中で止めても続きから取れる
//
// 使い方:
//   node --experimental-strip-types scripts/fetch-season-photos.ts --seasons 2021-22,2022-23 [--source official|wayback|both] [--dry-run] [--limit N] [--retry-missing]
//   --seasons を省くと、終わったシーズンすべて。--source の既定は both（2021-22 以降は公式→無ければ Wayback、2020-21 以前は Wayback だけ）

import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createThrottledFetch, formatRequestCounts } from "./lib/throttle.ts";
import { DATA_DIR } from "./lib/storage.ts";
import { currentSeason } from "./lib/season.ts";
import { toCompactWebp } from "./lib/mediaAssets.ts";
import {
  SEASON_PHOTO_SCHEMA,
  seasonPhotoFileName,
  type SeasonPhotoIndex,
  type SeasonPhotoOrigin,
  type SeasonPhotoSources,
} from "../shared/seasonPhotos.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SEASON_PHOTO_DIR = path.join(ROOT, "public", "media", "player-photos");
const CDX_CACHE = path.join(ROOT, "node_modules", ".cache", "season-photos-cdx.txt");
const FIRST_OFFICIAL_SEASON = "2021-22";
const IMG_HOST = "https://bleague.bl.kuroco-img.app";
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal research; read-only)";
export const throttledFetch = createThrottledFetch(3000, USER_AGENT);
const SAVE_EVERY = 25;

type Pair = { teamId: string; playerId: string };

function readJsonMaybeGz<T>(file: string): T | null {
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as T;
  if (existsSync(`${file}.gz`)) return JSON.parse(gunzipSync(readFileSync(`${file}.gz`)).toString("utf8")) as T;
  return null;
}

/** そのシーズンの（チーム・選手）の組。名簿の順 → 出場した選手で名簿に無い組 */
export function seasonPairs(season: string): Pair[] {
  const rosters = readJsonMaybeGz<Record<string, { teamId: string; playerIds: string[] }[]>>(path.join(DATA_DIR, "season-rosters.json")) ?? {};
  const seen = new Set<string>();
  const pairs: Pair[] = [];
  const add = (teamId: string, playerId: string) => {
    if (!teamId || !playerId || !/^\d+$/.test(teamId) || !/^\d+$/.test(playerId)) return;
    const key = `${teamId}|${playerId}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ teamId, playerId });
  };
  for (const team of rosters[season] ?? []) for (const playerId of team.playerIds) add(team.teamId, playerId);
  const players = readJsonMaybeGz<{ playerId: string; teamId: string; playedTeamTotals?: Record<string, unknown> }[]>(
    path.join(DATA_DIR, season, "players.json"),
  );
  if (!players) console.warn(`[${season}] players.json がありません（先に npm run build:data）。名簿の選手だけを対象にします`);
  for (const p of players ?? []) {
    for (const teamId of Object.keys(p.playedTeamTotals ?? {})) add(teamId, p.playerId);
    add(p.teamId, p.playerId);
  }
  return pairs;
}

/** Wayback に残る公式の写真の一覧（"チームID|シーズン|選手ID" → 候補。良い順） */
async function loadWaybackCaptures(): Promise<Map<string, { url: string; ts: string }[]>> {
  let text: string;
  if (existsSync(CDX_CACHE)) {
    text = readFileSync(CDX_CACHE, "utf8");
  } else {
    const lines: string[] = [];
    for (const prefix of ["bleague.jp/files/user/roster/", "bleague.bl.kuroco-img.app/files/user/roster/"]) {
      const base = `https://web.archive.org/cdx/search/cdx?url=${prefix}&matchType=prefix`;
      const pages = Number((await (await throttledFetch(`${base}&showNumPages=true`)).text()).trim());
      if (!Number.isInteger(pages) || pages <= 0) throw new Error(`Wayback の一覧のページ数を読めませんでした（${prefix}）`);
      for (let page = 0; page < pages; page += 1) {
        const res = await throttledFetch(`${base}&fl=original,timestamp,statuscode,mimetype&filter=statuscode:200&page=${page}`);
        const body = await res.text();
        if (!res.ok || body.includes("<html")) throw new Error(`Wayback の一覧を読めませんでした（${prefix} ${page}ページ目: HTTP ${res.status}）`);
        lines.push(...body.split("\n").filter((l) => /^https?:\/\//.test(l)));
      }
    }
    text = lines.join("\n");
    mkdirSync(path.dirname(CDX_CACHE), { recursive: true });
    writeFileSync(CDX_CACHE, text);
  }
  const rank = (variant: string) => ({ "3.png": 0, "1.jpg": 1, "2.jpg": 2 })[variant] ?? 9;
  const map = new Map<string, { url: string; ts: string; r: number }[]>();
  for (const line of text.split("\n")) {
    const [url, ts, , mime] = line.split(" ");
    if (!url || !ts || !mime?.startsWith("image/")) continue;
    const m = /\/files\/user\/roster\/(\d+)\/(\d{4}-\d{2})\/(\d+)_0(\d\.(?:png|jpg))(?:\?.*)?$/.exec(url);
    if (!m) continue;
    const r = rank(m[4]!);
    if (r === 9) continue;
    const key = `${m[1]}|${m[2]}|${m[3]}`;
    const list = map.get(key) ?? [];
    list.push({ url, ts, r });
    map.set(key, list);
  }
  const out = new Map<string, { url: string; ts: string }[]>();
  // 良い形（_03 → _01 → _02）を先に、同じ形の中では新しい保存を先に
  for (const [key, list] of map) out.set(key, list.sort((a, b) => a.r - b.r || b.ts.localeCompare(a.ts)).map(({ url, ts }) => ({ url, ts })));
  return out;
}

export async function fetchImage(url: string): Promise<Buffer | null> {
  const res = await throttledFetch(url);
  if (res.status === 404 || res.status === 403 || res.status === 410) {
    await res.body?.cancel();
    return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
  const type = res.headers.get("content-type") ?? "";
  const buf = Buffer.from(await res.arrayBuffer());
  if (!type.startsWith("image/")) {
    // 種類（content-type）が付かないだけで中身は画像のことがある（Wayback の一部の保存。374-5章）。中身が画像として読めれば受け取る
    const looksLikeImage = type === "" || type === "application/octet-stream" ? await sharp(buf).metadata().then((m) => !!m.format, () => false) : false;
    // Wayback が一時停止のときは 200 で HTML を返すことがある。取れなかったと記録せず、止める
    if (!looksLikeImage) throw new Error(`画像でない応答（${type || "種類なし"}）: ${url}`);
  }
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height || meta.width < 100) return null;
  return buf;
}

function seasonsFromArgs(args: string[]): string[] {
  const i = args.indexOf("--seasons");
  const current = currentSeason();
  if (i >= 0 && args[i + 1]) return args[i + 1]!.split(",").map((s) => s.trim()).filter((s) => /^\d{4}-\d{2}$/.test(s) && s < current);
  const out: string[] = [];
  for (let y = 2016; ; y += 1) {
    const s = `${y}-${String(y + 1).slice(-2)}`;
    if (s >= current) break;
    out.push(s);
  }
  return out;
}

export function loadState(season: string): { index: SeasonPhotoIndex; sources: SeasonPhotoSources } {
  const indexPath = path.join(SEASON_PHOTO_DIR, `${season}.json`);
  const sourcesPath = path.join(SEASON_PHOTO_DIR, season, "sources.json");
  const index: SeasonPhotoIndex = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf8"))
    : { v: SEASON_PHOTO_SCHEMA, season, photos: {} };
  const sources: SeasonPhotoSources = existsSync(sourcesPath)
    ? JSON.parse(readFileSync(sourcesPath, "utf8"))
    : { v: SEASON_PHOTO_SCHEMA, season, photos: [], missing: {} };
  return { index, sources };
}

/** 台帳を名簿の順（チームの並び）にそろえて書く。同じ中身なら同じバイトになるようにする */
export function saveState(season: string, pairs: Pair[], sources: SeasonPhotoSources): void {
  const dir = path.join(SEASON_PHOTO_DIR, season);
  mkdirSync(dir, { recursive: true });
  const have = new Set(sources.photos.map((p) => `${p.teamId}|${p.playerId}`));
  const photos: Record<string, string[]> = {};
  const order = new Map(pairs.map((p, i) => [`${p.teamId}|${p.playerId}`, i]));
  const sortedSources = [...sources.photos].sort(
    (a, b) => (order.get(`${a.teamId}|${a.playerId}`) ?? 1e9) - (order.get(`${b.teamId}|${b.playerId}`) ?? 1e9),
  );
  for (const p of pairs) if (have.has(`${p.teamId}|${p.playerId}`)) (photos[p.playerId] ??= []).push(p.teamId);
  // 名簿から外れた組（あとで名簿が直った等）も台帳には残す
  for (const s of sortedSources) if (!photos[s.playerId]?.includes(s.teamId)) (photos[s.playerId] ??= []).push(s.teamId);
  const index: SeasonPhotoIndex = { v: SEASON_PHOTO_SCHEMA, season, photos };
  writeFileSync(path.join(SEASON_PHOTO_DIR, `${season}.json`), `${JSON.stringify(index)}\n`);
  const missing = Object.fromEntries(Object.entries(sources.missing).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(path.join(dir, "sources.json"), `${JSON.stringify({ ...sources, photos: sortedSources, missing }, null, 1)}\n`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const retryMissing = args.includes("--retry-missing");
  const sourceArg = args.includes("--source") ? args[args.indexOf("--source") + 1] : "both";
  const limitArg = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
  const useOfficial = sourceArg === "official" || sourceArg === "both";
  const useWayback = sourceArg === "wayback" || sourceArg === "both";
  const seasons = seasonsFromArgs(args);
  if (seasons.length === 0) throw new Error("対象のシーズンがありません（進行中のシーズンは対象外）");

  const captures = useWayback ? await loadWaybackCaptures() : new Map<string, { url: string; ts: string }[]>();
  if (useWayback) console.log(`Wayback の写真の一覧: ${captures.size}組`);

  let done = 0;
  for (const season of seasons) {
    const pairs = seasonPairs(season);
    const { sources } = loadState(season);
    const have = new Set(sources.photos.map((p) => `${p.teamId}|${p.playerId}`));
    const todo = pairs.filter((p) => {
      const key = `${p.teamId}|${p.playerId}`;
      if (have.has(key)) return false;
      if (!retryMissing && sources.missing[key]) return false;
      const official = useOfficial && season >= FIRST_OFFICIAL_SEASON;
      return official || captures.has(`${p.teamId}|${season}|${p.playerId}`);
    });
    const waybackOnly = todo.filter((p) => !(useOfficial && season >= FIRST_OFFICIAL_SEASON)).length;
    console.log(`[${season}] 組 ${pairs.length}・取得済み ${have.size}・取れなかった記録 ${Object.keys(sources.missing).length}・これから ${todo.length}（Wayback だけ ${waybackOnly}）`);
    if (dryRun) continue;

    let sinceSave = 0;
    for (const pair of todo) {
      if (done >= limitArg) break;
      const key = `${pair.teamId}|${pair.playerId}`;
      let got: { buf: Buffer; origin: SeasonPhotoOrigin; url: string; snapshot?: string } | null = null;
      if (useOfficial && season >= FIRST_OFFICIAL_SEASON) {
        const url = `${IMG_HOST}/files/user/roster/${pair.teamId}/${season}/${pair.playerId}_03.png`;
        const buf = await fetchImage(url);
        if (buf) got = { buf, origin: "official", url };
      }
      if (!got && useWayback) {
        for (const cap of captures.get(`${pair.teamId}|${season}|${pair.playerId}`) ?? []) {
          const buf = await fetchImage(`https://web.archive.org/web/${cap.ts}id_/${cap.url}`);
          if (buf) {
            got = { buf, origin: "wayback", url: cap.url, snapshot: cap.ts };
            break;
          }
        }
      }
      const today = new Date().toISOString().slice(0, 10);
      if (got) {
        const webp = await toCompactWebp(got.buf);
        mkdirSync(path.join(SEASON_PHOTO_DIR, season), { recursive: true });
        writeFileSync(path.join(SEASON_PHOTO_DIR, season, seasonPhotoFileName(pair.teamId, pair.playerId)), webp);
        sources.photos.push({
          teamId: pair.teamId,
          playerId: pair.playerId,
          origin: got.origin,
          url: got.url,
          ...(got.snapshot ? { snapshot: got.snapshot } : {}),
          fetchedAt: today,
          sha256: createHash("sha256").update(webp).digest("hex"),
        });
        delete sources.missing[key];
      } else {
        sources.missing[key] = today;
      }
      done += 1;
      sinceSave += 1;
      if (sinceSave >= SAVE_EVERY) {
        saveState(season, pairs, sources);
        sinceSave = 0;
        console.log(`[${season}] ${sources.photos.length}枚（${formatRequestCounts()}）`);
      }
    }
    saveState(season, pairs, sources);
    console.log(`[${season}] 完了: 写真 ${sources.photos.length}枚・取れなかった ${Object.keys(sources.missing).length}組`);
  }
  console.log(formatRequestCounts());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
