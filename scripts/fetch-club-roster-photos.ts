// 当時のクラブ公式サイトの選手一覧ページ（Wayback）から本人を決めて、シーズン別の写真の台帳に足す（手で実行する道具。設計書374-5章）。
//
// 背景: 2016-17・2017-18 は公式の名簿の写真（`roster/{チームID}/{シーズン}/…_01.jpg`）がほとんど残っていない（4人・86人）。
// 一方、当時のクラブ公式サイトの選手一覧ページ（`/roster/players/`）は、名前・背番号・写真の住所を1人ずつ書いたHTMLで、Wayback に保存されている。
// 写真の住所は `data.bleague.jp/{クラブ略称}/{年}/{JBA選手番号}/01/player.jpg`（JBA選手番号は選手IDとは別）。
// 手順:
//   1. クラブごとに、そのシーズンの保存日時の範囲（7月1日〜翌年6月30日）にある一覧ページの保存（中身が違うものだけ）を、新しい順にすべて読む
//   2. ページ上の名前を、そのシーズン・そのチームの選手の名前と突き合わせる。ちょうど1人に決まったときだけ本人とする
//      （決まらない・2人以上に当てはまる選手は台帳に入れず、報告に出す）
//   3. 写真は data.bleague.jp の保存のうち、ページの保存日時にいちばん近いものを取る（ページ側の住所が data.bleague.jp でないクラブは、ページと同じ保存日時のクラブのサイトの画像）
//   4. 台帳にすでに写真がある組（チーム・選手）は上書きしない
// 問い合わせは Wayback へ3秒間隔（ホストごとに直列。`createThrottledFetch`）。ページ・一覧は node_modules/.cache/club-roster/ に残すので、止めても続きから進む。
//
// 使い方（先に `npm run build:data` は要らない。名簿は data/season-rosters.json.gz と選手マスタを読む）:
//   node --experimental-strip-types scripts/fetch-club-roster-photos.ts --seasons 2017-18 [--dry-run] [--clubs 703,704] [--limit N]
//   --dry-run … ページを読んで突き合わせの結果（人数・決まらなかった選手）だけ出し、写真は取らない

import path from "node:path";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./lib/storage.ts";
import { toCompactWebp } from "./lib/mediaAssets.ts";
import { formatRequestCounts } from "./lib/throttle.ts";
import { fetchImage, loadState, saveState, seasonPairs, SEASON_PHOTO_DIR, throttledFetch } from "./fetch-season-photos.ts";
import { seasonPhotoFileName } from "../shared/seasonPhotos.ts";
import { clubPageWindow, clubPhotoLabels, matchClubPlayer, parseClubRosterPage, type ClubRosterEntry } from "./lib/clubRosterPage.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "node_modules", ".cache", "club-roster");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 当時の B1 のクラブ（チームID・当時の公式サイトのドメイン。`/roster/players/`）。シーズンは在籍した年 */
export const CLUB_SITES: { teamId: string; name: string; domain: string; seasons: string[]; path?: string }[] = [
  { teamId: "702", name: "レバンガ北海道", domain: "levanga.com", seasons: ["2016-17", "2017-18"] },
  { teamId: "692", name: "仙台89ERS", domain: "89ers.jp", seasons: ["2016-17"] },
  { teamId: "693", name: "秋田ノーザンハピネッツ", domain: "northern-happinets.com", seasons: ["2016-17"] },
  { teamId: "703", name: "栃木ブレックス", domain: "tochigibrex.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "704", name: "千葉ジェッツ", domain: "chibajets.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "706", name: "アルバルク東京", domain: "alvark-tokyo.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "726", name: "サンロッカーズ渋谷", domain: "hitachi-sunrockers.co.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "727", name: "川崎ブレイブサンダース", domain: "kawasaki-bravethunders.com", seasons: ["2016-17", "2017-18"] },
  { teamId: "694", name: "横浜ビー・コルセアーズ", domain: "b-corsairs.com", seasons: ["2016-17", "2017-18"] },
  { teamId: "695", name: "新潟アルビレックスBB", domain: "albirex.com", seasons: ["2016-17", "2017-18"] },
  { teamId: "696", name: "富山グラウジーズ", domain: "grouses.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "697", name: "三遠ネオフェニックス", domain: "neophoenix.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "728", name: "シーホース三河", domain: "go-seahorses.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "729", name: "名古屋ダイヤモンドドルフィンズ", domain: "nagoya-dolphins.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "698", name: "滋賀レイクスターズ", domain: "lakestars.net", seasons: ["2016-17", "2017-18"] },
  { teamId: "699", name: "京都ハンナリーズ", domain: "hannaryz.jp", seasons: ["2016-17", "2017-18"] },
  { teamId: "700", name: "大阪エヴェッサ", domain: "evessa.com", seasons: ["2016-17", "2017-18"], path: "/roster/" },
  { teamId: "718", name: "西宮ストークス", domain: "storks.jp", seasons: ["2017-18"] },
  { teamId: "720", name: "島根スサノオマジック", domain: "susanoo-m.com", seasons: ["2017-18"] },
  { teamId: "701", name: "琉球ゴールデンキングス", domain: "goldenkings.jp", seasons: ["2016-17", "2017-18"] },
];

// ---- Wayback への問い合わせ（止まっているときは待って続ける） ----

async function waybackText(url: string): Promise<{ status: number; text: string }> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const res = await throttledFetch(url);
    const text = await res.text();
    const offline = /Temporarily Offline|temporarily unavailable/i.test(text.slice(0, 2000)) && text.includes("<html");
    if (!offline && (res.status < 500 || attempt === 5)) return { status: res.status, text };
    const wait = 60 * (attempt + 1);
    console.warn(`[wayback] 一時的に応答がありません（HTTP ${res.status}）。${wait}秒待って続けます: ${url.slice(0, 120)}`);
    await sleep(wait * 1000);
  }
  throw new Error(`Wayback が応答しません: ${url}`);
}

function cdxUrl(target: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ url: target, ...params });
  return `https://web.archive.org/cdx/search/cdx?${q.toString()}`;
}

interface PageSnapshot {
  ts: string;
  original: string;
}

/** そのクラブの一覧ページの保存（範囲の中・中身が違うものだけ）。新しい順 */
async function listPageSnapshots(domain: string, season: string, pagePath = "/roster/players/"): Promise<PageSnapshot[]> {
  const file = path.join(CACHE, "lists", pagePath === "/roster/players/" ? `${domain}-${season}.json` : `${domain}${pagePath.replace(/\//g, "_")}-${season}.json`);
  if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as PageSnapshot[];
  const { from, to } = clubPageWindow(season);
  const { status, text } = await waybackText(
    cdxUrl(`${domain}${pagePath}`, {
      matchType: "exact",
      from: from.slice(0, 8),
      to: to.slice(0, 8),
      fl: "timestamp,original,statuscode",
      filter: "statuscode:200",
      collapse: "digest",
    }),
  );
  if (status !== 200) throw new Error(`一覧を読めません（${domain} ${season}: HTTP ${status}）`);
  const rows = text
    .split("\n")
    .map((l) => l.trim().split(" "))
    .filter((p) => /^\d{14}$/.test(p[0] ?? "") && p[0]! >= from && p[0]! <= to)
    .map((p) => ({ ts: p[0]!, original: p[1]! }))
    .sort((a, b) => b.ts.localeCompare(a.ts));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(rows));
  return rows;
}

async function readPage(domain: string, snap: PageSnapshot): Promise<string | null> {
  const file = path.join(CACHE, "pages", `${domain}-${snap.ts}.html`);
  if (existsSync(file)) return readFileSync(file, "utf8");
  const { status, text } = await waybackText(`https://web.archive.org/web/${snap.ts}id_/${snap.original}`);
  if (status !== 200) return null;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return text;
}

/** data.bleague.jp の写真の保存の一覧（"クラブ略称/年/JBA番号" → 保存日時の並び） */
async function loadDataSiteCaptures(): Promise<Map<string, string[]>> {
  const file = path.join(CACHE, "data-bleague-cdx.txt");
  let text: string;
  if (existsSync(file)) text = readFileSync(file, "utf8");
  else {
    const { status, text: body } = await waybackText(
      cdxUrl("data.bleague.jp/", { matchType: "prefix", fl: "original,timestamp,statuscode", filter: "statuscode:200", limit: "50000" }),
    );
    if (status !== 200 || body.includes("<html")) throw new Error(`data.bleague.jp の一覧を読めません（HTTP ${status}）`);
    text = body;
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, text);
  }
  const map = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const [url, ts] = line.trim().split(" ");
    const m = /data\.bleague\.jp\/([a-z0-9]+)\/([0-9-]+)\/(\d+)\/01\/player\.jpg/.exec(url ?? "");
    if (!m || !/^\d{14}$/.test(ts ?? "")) continue;
    const key = `${m[1]}/${m[2]}/${m[3]}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(ts!);
  }
  return map;
}

const tsToMs = (ts: string) => Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12), +ts.slice(12, 14));

// ---- 名簿 ----

interface Master {
  playerId: string;
  name: string;
}

function readGz<T>(file: string): T | null {
  if (existsSync(file)) return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as T;
  return null;
}

/** そのシーズン・そのチームの選手（名前は選手マスタ＋そのシーズンの players.json があればその名前） */
function candidatesFor(season: string, teamId: string, master: Map<string, string>): { playerId: string; names: string[] }[] {
  const seasonNames = new Map<string, string>();
  const players = readGz<{ playerId: string; name?: string }[]>(path.join(DATA_DIR, season, "players.json.gz"));
  for (const p of players ?? []) if (p.name) seasonNames.set(p.playerId, p.name);
  return seasonPairs(season)
    .filter((p) => p.teamId === teamId)
    .map((p) => ({ playerId: p.playerId, names: [master.get(p.playerId), seasonNames.get(p.playerId)].filter((n): n is string => !!n) }));
}

// ---- 本体 ----

interface Found {
  playerId: string;
  entry: ClubRosterEntry;
  snap: PageSnapshot;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limit = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
  const clubArg = args.includes("--clubs") ? new Set(args[args.indexOf("--clubs") + 1]!.split(",")) : null;
  const seasons = (args.includes("--seasons") ? args[args.indexOf("--seasons") + 1]!.split(",") : ["2017-18"]).map((s) => s.trim());

  const masterRows = readGz<Master[]>(path.join(DATA_DIR, "players-master.json.gz")) ?? [];
  const master = new Map<string, string>(masterRows.map((m) => [m.playerId, m.name]));
  const dataCaptures = dryRun ? new Map<string, string[]>() : await loadDataSiteCaptures();
  const summary: { season: string; teamId: string; name: string; roster: number; matched: number; added: number; pages: number }[] = [];
  const unresolved: string[] = [];
  const skipped: string[] = [];
  let fetched = 0;

  for (const season of seasons) {
    const { sources } = loadState(season);
    const pairs = seasonPairs(season);
    const labels = clubPhotoLabels(season);
    for (const club of CLUB_SITES) {
      if (!club.seasons.includes(season) || (clubArg && !clubArg.has(club.teamId))) continue;
      const candidates = candidatesFor(season, club.teamId, master);
      const snaps = await listPageSnapshots(club.domain, season, club.path);
      // 本人が決まった選手 → 写真の候補（新しい保存のページの順）
      const found = new Map<string, Found[]>();
      const issues = new Map<string, string>();
      let pages = 0;
      for (const snap of snaps) {
        const html = await readPage(club.domain, snap);
        if (!html) continue;
        pages += 1;
        for (const entry of parseClubRosterPage(html)) {
          const m = matchClubPlayer(entry.ja, candidates);
          if (m.kind === "match") (found.get(m.playerId) ?? found.set(m.playerId, []).get(m.playerId)!).push({ playerId: m.playerId, entry, snap });
          else if (!issues.has(entry.ja)) issues.set(entry.ja, m.kind === "ambiguous" ? `2人以上に当てはまる（${m.playerIds.join("/")}）` : "名簿に同じ名前がない");
        }
      }
      // 別のページで決まった名前は「決まらなかった」から外す
      const matchedNames = new Set([...found.values()].flatMap((f) => f.map((x) => normalizeKey(x.entry.ja))));
      for (const name of [...issues.keys()]) if (matchedNames.has(normalizeKey(name))) issues.delete(name);
      for (const [name, why] of issues) unresolved.push(`${season} ${club.name} ${name}: ${why}`);

      let added = 0;
      for (const c of candidates) {
        const key = `${club.teamId}|${c.playerId}`;
        if (sources.photos.some((p) => `${p.teamId}|${p.playerId}` === key)) continue;
        const list = found.get(c.playerId);
        if (!list || dryRun) continue;
        if (fetched >= limit) break;
        let got: { buf: Buffer; url: string; ts: string; f: Found } | null = null;
        const targets: { f: Found; url: string; ts: string }[] = [];
        for (const f of list) for (const t of resolvePhoto(f, club.domain, labels, dataCaptures)) if (!targets.some((x) => x.url === t.url && x.ts === t.ts)) targets.push({ f, ...t });
        for (const target of targets.slice(0, 4)) {
          const f = target.f;
          const imageUrl = `https://web.archive.org/web/${target.ts}id_/${target.url}`;
          let buf: Buffer | null = null;
          try {
            buf = await fetchImage(imageUrl);
          } catch (err) {
            // Wayback が一時的におかしいときは、少し待って1回だけやり直す。それでもだめならその写真は今回は飛ばす（取れなかった記録にはしない）
            console.warn(`[club] 写真を読めませんでした。30秒待ってやり直します: ${(err as Error).message}`);
            await sleep(30_000);
            try {
              buf = await fetchImage(imageUrl);
            } catch (err2) {
              skipped.push(`${season} ${club.name} ${f.entry.ja}: ${(err2 as Error).message}`);
              continue;
            }
          }
          if (buf) {
            got = { buf, url: target.url, ts: target.ts, f };
            break;
          }
        }
        fetched += 1;
        if (!got) continue;
        const webp = await toCompactWebp(got.buf);
        mkdirSync(path.join(SEASON_PHOTO_DIR, season), { recursive: true });
        writeFileSync(path.join(SEASON_PHOTO_DIR, season, seasonPhotoFileName(club.teamId, c.playerId)), webp);
        sources.photos.push({
          teamId: club.teamId,
          playerId: c.playerId,
          origin: "club",
          url: got.url,
          snapshot: got.ts,
          fetchedAt: new Date().toISOString().slice(0, 10),
          clubPage: `${club.domain} ${got.f.snap.ts} ${got.f.entry.ja}`,
          sha256: createHash("sha256").update(webp).digest("hex"),
        });
        delete sources.missing[key];
        added += 1;
      }
      saveState(season, pairs, sources);
      const already = candidates.filter((c) => sources.photos.some((p) => p.teamId === club.teamId && p.playerId === c.playerId)).length;
      summary.push({ season, teamId: club.teamId, name: club.name, roster: candidates.length, matched: found.size, added, pages });
      console.log(`[${season}] ${club.name}: 名簿${candidates.length}人・ページ${pages}枚・本人が決まった${found.size}人・今回の追加${added}枚（台帳の写真 計${already}人）`);
    }
  }
  const out = path.join(CACHE, `report-${seasons.join("_")}${dryRun ? "-dry" : ""}.json`);
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(out, JSON.stringify({ summary, unresolved, skipped }, null, 1));
  console.log(`決まらなかった名前 ${unresolved.length}件（${out}）`);
  for (const u of unresolved) console.log(`  ${u}`);
  if (skipped.length > 0) console.log(`今回は読めなかった写真 ${skipped.length}枚（もう一度実行すると続きから取る）`);
  for (const u of skipped) console.log(`  ${u}`);
  console.log(formatRequestCounts());
}

function normalizeKey(s: string): string {
  return s.normalize("NFKC").replace(/[\s　・･·\.．=＝'-]/g, "").toLowerCase();
}

/** ページの記載から、写真の住所と取る保存日時の候補を決める（ページの保存日時に近い順。なければ空） */
function resolvePhoto(f: Found, domain: string, labels: string[], captures: Map<string, string[]>): { url: string; ts: string }[] {
  const jba = f.entry.jba;
  if (jba) {
    if (!labels.includes(jba.label)) return [];
    const list = captures.get(`${jba.club}/${jba.label}/${jba.id}`);
    if (!list || list.length === 0) return [];
    const at = tsToMs(f.snap.ts);
    const url = `https://data.bleague.jp/${jba.club}/${jba.label}/${jba.id}/01/player.jpg`;
    return [...list].sort((a, b) => Math.abs(tsToMs(a) - at) - Math.abs(tsToMs(b) - at)).map((ts) => ({ url, ts }));
  }
  const photo = f.entry.photo;
  if (!photo) return [];
  // クラブのサイトの画像（相対の住所）は、ページと同じ保存日時の近くの保存を取る
  const abs = photo.startsWith("http") ? photo : `http://${domain}${photo.startsWith("/") ? "" : "/"}${photo}`;
  return [{ url: abs, ts: f.snap.ts }];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
