// bleague.jp/roster/（e=全選手。在籍中+退団済の全選手）から、シーズンごとのクラブ所属選手ID
// 一覧を取得し data/season-rosters.json に保存する。
//
// players-master.json（scrape-roster.tsが管理）は「直近確認できたクラブ」という単一の
// スナップショットしか持てず、過去シーズンの退団済み選手は元々そこに一度も入っていない
// ことが多い（DESIGN.md参照）。このスクリプトは「そのシーズン、その選手がどのクラブに
// 所属していたか」を正確に記録する別ファイルを新設し、あわせてplayers-master.jsonに
// 存在しない新規選手を発見してroster_detailからプロフィールを補完する
// （scrape-roster.tsのscrapeRosterMaster()と同じ「未知の選手だけ個人ページ取得」パターン）。
//
// クラブ一覧はシーズンごとに変動する（新規参入・改称・降格等）ため、bleague.jpの
// 裏側JSON API（scripts/probe-team-history.mjsで既に使用実績あり）からその年の
// B1/B.PREMIERクラブ一覧を取得する:
//   https://www.bleague.jp/api/v1/club/?data_format=json&
//     name=getTeamsByYearAndEventAndDistrict&year={year}&event=2&district=0
//
// 使い方: node --experimental-strip-types scripts/scrape-season-rosters.ts
//   [--from 2016] [--to 2025]   （デフォルト: 2016〜2025 = 2016-17〜2025-26の10シーズン。
//   2026-27は開幕前でロースター発表が進行中のため対象外。既存の週次scrape-roster.tsが
//   e=在籍中で引き続きカバーする）

import path from "node:path";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, readJson, seasonFromYear, writeJson } from "./lib/storage.ts";
import { deriveClassification, fetchPlayerPage, parseRosterList } from "./scrape-roster.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { PlayerMasterEntry, SeasonRosterEntry, SeasonRostersFile } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

const MASTER_PATH = path.join(DATA_DIR, "players-master.json");
const SEASON_ROSTERS_PATH = path.join(DATA_DIR, "season-rosters.json");

interface ClubInfo {
  teamId: string;
  teamName: string;
}

async function fetchClubsForYear(year: number): Promise<ClubInfo[]> {
  const url = `https://www.bleague.jp/api/v1/club/?data_format=json&name=getTeamsByYearAndEventAndDistrict&year=${year}&event=2&district=0`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  const data = (await res.json()) as { topics?: { TeamID: string; TeamNameJ: string }[] };
  return (data.topics ?? []).map((t) => ({ teamId: t.TeamID, teamName: t.TeamNameJ }));
}

async function fetchClubRosterAllTime(year: number, teamId: string) {
  const url = `https://www.bleague.jp/roster/?year=${year}&club=${teamId}&p=&c=&o=random&e=${encodeURIComponent("全選手")}&tab=1`;
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return parseRosterList(await res.text());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fromIdx = args.indexOf("--from");
  const toIdx = args.indexOf("--to");
  const fromYear = fromIdx !== -1 ? Number(args[fromIdx + 1]) : 2016;
  const toYear = toIdx !== -1 ? Number(args[toIdx + 1]) : 2025;

  const seasonRosters: SeasonRostersFile = (await readJson<SeasonRostersFile>(SEASON_ROSTERS_PATH)) ?? {};
  const master = (await readJson<PlayerMasterEntry[]>(MASTER_PATH)) ?? [];
  const byId = new Map(master.map((p) => [p.playerId, p]));
  const knownIds = new Set(byId.keys());

  // 新規選手のPlayerMasterEntry初期値用（name・直近所属クラブ）。古い年から新しい年へ
  // 順に処理するため、同じplayerIdを複数シーズンで見つけた場合は後勝ちで自然に最新になる
  const discovered = new Map<string, { name: string; season: string; teamId: string; teamName: string }>();

  for (let year = fromYear; year <= toYear; year++) {
    const season = seasonFromYear(year);
    const clubs = await fetchClubsForYear(year);
    console.log(`[season-rosters] ${season}: ${clubs.length}クラブ`);
    const entries: SeasonRosterEntry[] = [];

    for (const club of clubs) {
      const items = await fetchClubRosterAllTime(year, club.teamId);
      entries.push({ teamId: club.teamId, teamName: club.teamName, playerIds: items.map((i) => i.playerId) });
      for (const item of items) {
        if (!knownIds.has(item.playerId)) {
          discovered.set(item.playerId, { name: item.name, season, teamId: club.teamId, teamName: club.teamName });
        }
      }
    }
    seasonRosters[season] = entries;
    // 長時間走る一括処理のため、シーズン単位で都度保存する（中断しても取れた分は残る）
    await writeJson(SEASON_ROSTERS_PATH, seasonRosters);
  }

  const totalUniquePlayers = new Set(Object.values(seasonRosters).flat().flatMap((e) => e.playerIds)).size;
  console.log(
    `[season-rosters] ${fromYear}-${toYear}年度: 延べユニーク選手数=${totalUniquePlayers}、新規発見=${discovered.size}名`,
  );

  let fetchedCount = 0;
  let failedCount = 0;
  let processed = 0;
  for (const [playerId, seen] of discovered) {
    try {
      const { detail } = await fetchPlayerPage(playerId);
      byId.set(playerId, {
        playerId,
        name: seen.name,
        teamId: seen.teamId,
        teamName: seen.teamName,
        position: detail.position,
        nationality: detail.nationality,
        heightCm: detail.heightCm,
        weightKg: detail.weightKg,
        birthDate: detail.birthDate,
      });
      fetchedCount += 1;
    } catch (err) {
      console.error(`[season-rosters] roster_detail取得失敗: playerId=${playerId} name=${seen.name}`, err);
      failedCount += 1;
    }
    processed += 1;
    if (processed % 20 === 0 || processed === discovered.size) {
      console.log(`[season-rosters] 新規選手の個人ページ取得: ${processed}/${discovered.size}`);
      // classificationは全選手分を毎回再計算してから保存する（CLASSIFICATION_OVERRIDESの
      // 反映漏れを防ぐ。scrapeRosterMaster()と同じ方針）
      for (const entry of byId.values()) entry.classification = deriveClassification(entry);
      await writeJson(
        MASTER_PATH,
        [...byId.values()].sort((a, b) => a.playerId.localeCompare(b.playerId)),
      );
    }
  }

  console.log(
    `[season-rosters] 完了: 新規${discovered.size}名中、取得成功${fetchedCount}名／失敗${failedCount}名` +
      `（成功率${discovered.size > 0 ? ((100 * fetchedCount) / discovered.size).toFixed(1) : "100.0"}%）`,
  );
  console.log(`保存完了: ${SEASON_ROSTERS_PATH}, ${MASTER_PATH}（計${byId.size}名）`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
