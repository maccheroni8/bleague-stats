// 過去シーズンのみ出場していた選手（現在の在籍中ロースター＝data/players-master.jsonには
// 存在しない選手）の写真を取得する、1回限りのバックフィルスクリプト。
//
// scrape-roster.tsの週次写真取得は「players-master.jsonに載っている現役選手」のみを対象に
// しており、引退・退団済みの選手はそもそもマスタに載らないため対象外になる。このスクリプトは
// data/{season}/players.jsonを全10シーズン分走査してplayers-master.jsonに存在しないplayerIdを
// 洗い出し、その選手が最後に出場したシーズン・チームをplayers.jsonから逆引きして、
// mediaAssets.tsのdownloadPlayerPhoto()をそのまま使って写真取得を試みる。
//
// 引退済み選手を対象にしているため、週次cronのような繰り返しリトライの必要性は低く、
// 一度実行すれば十分という判断で日次/週次スクレイパーには組み込まない（DESIGN.md参照）。
//
// 使い方: npm run backfill:legacy-photos

import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { downloadPlayerPhoto } from "./lib/mediaAssets.ts";
import { isMainModule } from "./lib/isMain.ts";
import path from "node:path";
import type { PlayerMasterEntry, PlayerSummary } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

// 古い順。「最後に出場したシーズン」を探すときは逆順(新しい順)に走査する
const SEASONS = [
  "2016-17",
  "2017-18",
  "2018-19",
  "2019-20",
  "2020-21",
  "2021-22",
  "2022-23",
  "2023-24",
  "2024-25",
  "2025-26",
];

async function main() {
  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const masterIds = new Set(master.map((p) => p.playerId));

  const playersBySeason = new Map<string, PlayerSummary[]>();
  for (const season of SEASONS) {
    const players = (await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, "players.json"))) ?? [];
    playersBySeason.set(season, players);
  }

  // 全シーズンに登場するplayerIdの集合から、マスタに無いものを対象とする
  const allIds = new Set<string>();
  for (const players of playersBySeason.values()) {
    for (const p of players) allIds.add(p.playerId);
  }
  const missingIds = [...allIds].filter((id) => !masterIds.has(id));

  // 各対象選手について、最後に出場したシーズン・その時点のteamIdを新しい順の走査で特定する
  const targets: Array<{ playerId: string; season: string; teamId: string; teamName: string }> = [];
  const seasonsDesc = [...SEASONS].reverse();
  for (const playerId of missingIds) {
    for (const season of seasonsDesc) {
      const found = playersBySeason.get(season)!.find((p) => p.playerId === playerId);
      if (found) {
        targets.push({ playerId, season, teamId: found.teamId, teamName: found.teamName });
        break;
      }
    }
  }

  console.log(`対象: ${targets.length}名（players-master.jsonに存在しない、過去出場選手）`);

  let downloaded = 0;
  let notFound = 0;
  const notFoundList: typeof targets = [];

  for (const [i, t] of targets.entries()) {
    const saved = await downloadPlayerPhoto(t.teamId, t.playerId, t.season, throttledFetch);
    if (saved) {
      downloaded += 1;
    } else {
      notFound += 1;
      notFoundList.push(t);
    }
    if ((i + 1) % 50 === 0 || i === targets.length - 1) {
      console.log(`[${i + 1}/${targets.length}] 取得済み=${downloaded} 見つからず=${notFound}`);
    }
  }

  console.log("\n=== 結果 ===");
  console.log(`対象: ${targets.length}名`);
  console.log(`取得できた: ${downloaded}名`);
  console.log(`見つからなかった: ${notFound}名`);

  const bySeasonNotFound = new Map<string, number>();
  for (const t of notFoundList) {
    bySeasonNotFound.set(t.season, (bySeasonNotFound.get(t.season) ?? 0) + 1);
  }
  console.log("\n見つからなかった選手の最終出場シーズン内訳:");
  for (const season of SEASONS) {
    const count = bySeasonNotFound.get(season) ?? 0;
    if (count > 0) console.log(`  ${season}: ${count}名`);
  }
}

if (isMainModule(import.meta.url)) {
  main();
}
