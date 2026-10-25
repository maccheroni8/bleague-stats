// 旧B2・B.ONE の、終わったシーズンの試合に出たのに選手マスタに居ない選手のプロフィールを、公式の個人ページから足す（手で1回だけ実行。DESIGN.md 295章）。
// 2025-26 の旧B2の439試合に出た選手のうち、選手マスタに無い選手（2026-10-25時点で108人）が対象。
//
// - 所属（teamId・teamName）は、そのシーズンの最後に出た試合のクラブにする。今の名簿の取得（scrape-roster.ts）が、在籍中の選手の所属を毎晩上書きする
// - 過去の年の名簿は取得しない（scrape:roster を過去の年に使わない決まり。CLAUDE.md・設計書70-5章）。個人ページはシーズンに関係しないプロフィールだけを読む
// - 登録区分は、ほかの選手と同じ決め方（国籍＋手動の上書き。scrape-roster.ts の deriveClassification）
// - 個人ページから読めたクラブ所属履歴も、ほかの選手と同じく data/player-club-history.json に足す
//
// 使い方: node --experimental-strip-types scripts/backfill-one-profiles.ts --season 2025-26 [--dry-run]

import path from "node:path";
import { DATA_DIR, readAllGames, readJson, writeJson } from "./lib/storage.ts";
import { isMainModule } from "./lib/isMain.ts";
import { isExhibitionGame } from "./lib/exhibitionGames.ts";
import { addClubHistory } from "./lib/clubHistory.ts";
import { deriveClassification, fetchPlayerPage } from "./scrape-roster.ts";
import { DEEMED_JAPANESE_PLAYER_IDS } from "./lib/playerClassificationOverrides.ts";
import { normalizePlayerName } from "../shared/playerName.ts";
import { formatRequestCounts } from "./lib/throttle.ts";
import type { ClubHistoryEntry, PlayerMasterEntry } from "../shared/types.ts";

const MASTER_PATH = path.join(DATA_DIR, "players-master.json");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error("使い方: backfill-one-profiles.ts --season 2025-26 [--dry-run]");
    process.exitCode = 1;
    return;
  }
  const dryRun = args.includes("--dry-run");

  const master = (await readJson<PlayerMasterEntry[]>(MASTER_PATH)) ?? [];
  const byId = new Map(master.map((p) => [p.playerId, p]));

  // そのシーズンの B.ONE の試合に出た選手と、最後に出た試合のクラブ・名前
  const last = new Map<string, { date: string; teamId: string; teamName: string; name: string }>();
  for (const g of await readAllGames(season, "one")) {
    if (isExhibitionGame(g.raw.Game.ConventionNameJ)) continue; // オールスター等（他リーグ・海外の選抜の選手が出る）は数えない
    for (const [rows, team] of [
      [g.raw.HomeBoxscores, g.homeTeam],
      [g.raw.AwayBoxscores, g.awayTeam],
    ] as const) {
      for (const r of rows) {
        if (r.PeriodCategory !== 18 || !r.PlayerID) continue;
        const id = String(r.PlayerID);
        const prev = last.get(id);
        if (prev && prev.date > g.date) continue;
        last.set(id, { date: g.date, teamId: team.id, teamName: team.name, name: normalizePlayerName(String(r.PlayerNameJ ?? "").trim() || id) });
      }
    }
  }
  const targets = [...last.keys()].filter((id) => !byId.has(id)).sort();
  console.log(`${season} B.ONE: 試合に出た選手 ${last.size}名のうち、選手マスタに無い選手 ${targets.length}名`);
  if (dryRun || targets.length === 0) return;

  const clubHistory = new Map<string, ClubHistoryEntry[]>();
  let failed = 0;
  for (const id of targets) {
    const seen = last.get(id)!;
    const entry: PlayerMasterEntry = { playerId: id, name: seen.name, teamId: seen.teamId, teamName: seen.teamName };
    try {
      const page = await fetchPlayerPage(id);
      entry.position = page.detail.position;
      entry.nationality = page.detail.nationality?.trim() || undefined;
      entry.heightCm = page.detail.heightCm;
      entry.weightKg = page.detail.weightKg;
      entry.birthDate = page.detail.birthDate;
      if (page.clubHistory) clubHistory.set(id, page.clubHistory);
    } catch (err) {
      failed += 1;
      console.warn(`${id}（${seen.name}）の個人ページの取得に失敗: ${String(err)}`);
    }
    entry.classification = deriveClassification(entry);
    if (DEEMED_JAPANESE_PLAYER_IDS.has(id)) entry.deemedJapanese = true;
    byId.set(id, entry);
  }
  await writeJson(MASTER_PATH, [...byId.values()].sort((a, b) => a.playerId.localeCompare(b.playerId)));
  const added = await addClubHistory(clubHistory);
  console.log(`選手マスタに${targets.length}名を足しました（個人ページの取得に失敗 ${failed}名）。クラブ所属履歴 ${added}名分`);
  console.log(formatRequestCounts());
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
