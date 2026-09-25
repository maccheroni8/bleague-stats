// Wayback Machine（web.archive.org）に保存された bleague.jp の選手ページから、各シーズン当時の身長・体重・ポジションを読み取り、
// data/season-profiles.json に保存する（1回だけ実行するバッチ。DESIGN.md 146章）。
//
// - bleague.jp には問い合わせない。読み取り専用で、選手マスタ（players-master.json）は書き換えない（scrape:roster は使わない）
// - 対象: 終了したシーズン（2016-17〜2025-26）の players.json に載っている選手
// - スナップショットの選び方: そのシーズンの10月1日〜翌5月31日に保存されたもののうち、翌1月15日に最も近いもの。無ければ対象外
// - スナップショットの一覧は CDX API の前方一致で一度に取る（4ページ）。ページの取得は3秒間隔・並列にしない。
//   5xx・通信の失敗は10秒待って1回だけ再試行（scripts/lib/throttle.ts）
// - 途中で止めても、もう一度実行すれば取得済みの分を飛ばして続きから取る（50件ごとに保存）
//
// 使い方:
//   node --experimental-strip-types scripts/scrape-wayback-profiles.ts [--dry-run]
//   --dry-run: スナップショットの一覧だけ取り、取得するページ数を表示して終わる

import path from "node:path";
import { readdirSync } from "node:fs";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, readJson, writeJson } from "./lib/storage.ts";
import { decodeSnapshot, parseWaybackProfile } from "./lib/waybackProfile.ts";
import { currentSeason } from "./lib/season.ts";
import type { PlayerSummary, SeasonProfilesFile } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 3000;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal research; one-time read-only)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);
const OUT_PATH = path.join(DATA_DIR, "season-profiles.json");
const SAVE_EVERY = 50;

const CDX_BASE = "https://web.archive.org/cdx/search/cdx?url=bleague.jp/roster_detail/&matchType=prefix";
const CDX = `${CDX_BASE}&fl=original,timestamp,statuscode&filter=statuscode:200`;

/** playerId → [timestamp, original URL][] */
async function fetchCaptures(): Promise<Map<string, [string, string][]>> {
  const numPages = Number((await (await throttledFetch(`${CDX_BASE}&showNumPages=true`)).text()).trim());
  if (!Number.isInteger(numPages) || numPages <= 0) throw new Error("スナップショットの一覧のページ数を取得できませんでした");
  const captures = new Map<string, [string, string][]>();
  for (let page = 0; page < numPages; page += 1) {
    const text = await (await throttledFetch(`${CDX}&page=${page}`)).text();
    for (const line of text.split("\n")) {
      const [original, timestamp] = line.trim().split(/\s+/);
      const m = original ? /^https?:\/\/(?:www\.)?bleague\.jp\/roster_detail\/\?PlayerID=(\d+)$/.exec(original) : null;
      if (!m || !timestamp) continue;
      const list = captures.get(m[1]!) ?? [];
      list.push([timestamp, original!]);
      captures.set(m[1]!, list);
    }
  }
  return captures;
}

/** そのシーズンの10/1〜翌5/31のうち、翌1/15に最も近いスナップショット */
function pickSnapshot(list: [string, string][] | undefined, season: string): [string, string] | undefined {
  if (!list) return undefined;
  const y = Number(season.slice(0, 4));
  const from = `${y}1001`;
  const to = `${y + 1}0531235959`;
  const target = Date.UTC(y + 1, 0, 15);
  const toMs = (ts: string) => Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10), +ts.slice(10, 12));
  return list
    .filter(([ts]) => ts >= from && ts <= to)
    .sort((a, b) => Math.abs(toMs(a[0]) - target) - Math.abs(toMs(b[0]) - target))[0];
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const current = currentSeason();
  const seasons = readdirSync(DATA_DIR)
    .filter((d) => /^\d{4}-\d{2}$/.test(d) && d < current)
    .sort();

  const captures = await fetchCaptures();
  console.log(`スナップショット: 選手${captures.size}人・${[...captures.values()].reduce((n, l) => n + l.length, 0)}件`);

  const jobs: { season: string; playerId: string; ts: string; url: string }[] = [];
  for (const season of seasons) {
    const players = (await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, "players.json"))) ?? [];
    let n = 0;
    for (const p of players) {
      const snap = pickSnapshot(captures.get(p.playerId), season);
      if (!snap) continue;
      jobs.push({ season, playerId: p.playerId, ts: snap[0], url: snap[1] });
      n += 1;
    }
    console.log(`${season}: ${players.length}人中 ${n}人にスナップショットあり`);
  }

  const out: SeasonProfilesFile = (await readJson<SeasonProfilesFile>(OUT_PATH)) ?? { generatedAt: "", seasons: {} };
  const todo = jobs.filter((j) => !out.seasons[j.season]?.[j.playerId] || out.seasons[j.season]![j.playerId]!.error);
  console.log(`取得するページ: ${todo.length}件（全${jobs.length}件、取得済み${jobs.length - todo.length}件）`);
  if (dryRun) return;

  const started = Date.now();
  let done = 0;
  const save = async () => {
    out.generatedAt = new Date().toISOString();
    await writeJson(OUT_PATH, out);
  };
  for (const j of todo) {
    const entry = (out.seasons[j.season] ??= {});
    try {
      const res = await throttledFetch(`https://web.archive.org/web/${j.ts}id_/${j.url}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const profile = parseWaybackProfile(decodeSnapshot(Buffer.from(await res.arrayBuffer())));
      entry[j.playerId] = { snapshot: j.ts, ...profile };
    } catch (err) {
      entry[j.playerId] = { snapshot: j.ts, error: (err as Error).message };
    }
    done += 1;
    if (done % SAVE_EVERY === 0) {
      await save();
      const perPage = (Date.now() - started) / done;
      console.log(`${done}/${todo.length}件（残り約${Math.round(((todo.length - done) * perPage) / 60000)}分）`);
    }
  }
  await save();
  const all = Object.values(out.seasons).flatMap((s) => Object.values(s));
  console.log(`完了: ${all.length}件（身長あり${all.filter((e) => e.heightCm).length}・ポジションあり${all.filter((e) => e.position).length}・失敗${all.filter((e) => e.error).length}）`);
}

main();
