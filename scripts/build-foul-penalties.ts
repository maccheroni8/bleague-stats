// 出場停止の台帳（docs/foul-points/suspensions.json）から、集計に使う最小の表 data/{season}/foul-penalties.json.gz（B.ONE は one/）を作る（DESIGN.md 416章）。
// 台帳の status が「自動読み取り」「手で確認」の行のうち、そのシーズン・リーグのクラブに結び付く行だけを入れる。
// クラブ名は、そのシーズンの試合の生データのチーム名と、data/team-history.json.gz の名前の移り変わりで、チームの ID にする。
// 台帳を直したら、これを流してから build:data（表の中身が変わったシーズンだけ保存キーが変わる）。
//
// 使い方:
//   node --experimental-strip-types scripts/build-foul-penalties.ts            # 書き出す
//   node --experimental-strip-types scripts/build-foul-penalties.ts --check    # 書き出さず、今のファイルと台帳が合っているかだけ見る（合わなければ終了コード1）

import { existsSync } from "node:fs";
import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, readJson, seasonDirName, writeJson } from "./lib/storage.ts";
import { readLedger, type LedgerRow } from "./lib/penaltyLedger.ts";
import type { FoulPenaltiesFile, FoulPenaltyRow } from "../shared/foulPoints.ts";
import type { Category, StoredGame } from "../shared/types.ts";
import { gunzipSync } from "node:zlib";

const NOTE = "反則ポイントの出場停止・コーチの退場（docs/foul-points/suspensions.json から scripts/build-foul-penalties.ts が作る。手で直さない）";

export const normalizeClubName = (s: string) =>
  s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s・･]/g, "")
    .toLowerCase();

/** そのシーズン・リーグの試合に出たチーム（名前 → ID） */
async function seasonTeams(season: string, category: Category): Promise<Map<string, string>> {
  const dir = path.join(DATA_DIR, seasonDirName(season, category), "games");
  const out = new Map<string, string>();
  if (!existsSync(dir)) return out;
  for (const f of await readdir(dir)) {
    if (!f.endsWith(".json.gz")) continue;
    const g = JSON.parse(gunzipSync(await readFile(path.join(dir, f))).toString("utf8")) as StoredGame;
    for (const t of [g.homeTeam, g.awayTeam]) if (t?.id && t.name) out.set(normalizeClubName(t.name), String(t.id));
  }
  return out;
}

// B2 は B.ONE の置き場所（data/{season}/one/。今は 2025-26 の B2 の記録がある）
const LEAGUE_CATEGORY: Record<string, Category> = { B1: "premier", "B.PREMIER": "premier", B2: "one", "B.ONE": "one" };

export async function buildFoulPenaltyTables(): Promise<{ files: Map<string, FoulPenaltiesFile>; unresolved: string[] }> {
  const ledger = await readLedger();
  const history = ((await readJson<{ teamId: string; names: { name: string }[] }[]>(path.join(DATA_DIR, "team-history.json"))) ?? []);
  const historyNames = new Map<string, string>();
  for (const h of history) for (const n of h.names) historyNames.set(normalizeClubName(n.name), h.teamId);
  const teamCache = new Map<string, Map<string, string>>();
  const teamsOf = async (season: string, category: Category) => {
    const key = `${season}:${category}`;
    if (!teamCache.has(key)) teamCache.set(key, await seasonTeams(season, category));
    return teamCache.get(key)!;
  };
  const files = new Map<string, FoulPenaltiesFile>();
  const unresolved: string[] = [];
  const usable = ledger.rows.filter((r) => (r.status === "自動読み取り" || r.status === "手で確認") && r.season && r.club && r.incidentDate && r.suspensionGames !== null && r.competition);
  for (const r of usable) {
    const season = r.season!;
    const categories: Category[] = r.league ? (LEAGUE_CATEGORY[r.league] ? [LEAGUE_CATEGORY[r.league]!] : []) : ["premier", "one"];
    for (const category of categories) {
      const teams = await teamsOf(season, category);
      if (teams.size === 0) continue;
      const name = normalizeClubName(r.club!);
      let teamId = teams.get(name);
      if (!teamId) {
        const viaHistory = historyNames.get(name);
        if (viaHistory && [...teams.values()].includes(viaHistory)) teamId = viaHistory;
      }
      if (!teamId) {
        if (r.league) unresolved.push(`${r.newsId} ${season} ${r.league} ${r.club}`);
        continue;
      }
      const key = `${season}:${category}`;
      const file = files.get(key) ?? { season, league: category as "premier" | "one", note: NOTE, rows: [] };
      file.rows.push(toPenaltyRow(r, teamId));
      files.set(key, file);
    }
  }
  for (const f of files.values()) f.rows.sort((a, b) => (a.incidentDate < b.incidentDate ? -1 : a.incidentDate > b.incidentDate ? 1 : Number(a.newsId) - Number(b.newsId) || a.person.localeCompare(b.person, "ja")));
  return { files, unresolved };
}

function toPenaltyRow(r: LedgerRow, teamId: string): FoulPenaltyRow {
  return {
    newsId: r.newsId,
    teamId,
    incidentDate: r.incidentDate!,
    competition: r.competition!,
    role: r.role ?? "",
    person: r.person,
    suspensionGames: r.suspensionGames!,
    coachEjection: r.ejected && (r.role === "ヘッドコーチ" || r.role === "アシスタントコーチ"),
  };
}

async function main() {
  const check = process.argv.includes("--check");
  const { files, unresolved } = await buildFoulPenaltyTables();
  const seasons = (await readdir(DATA_DIR)).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
  let changed = 0;
  for (const season of seasons) {
    for (const category of ["premier", "one"] as Category[]) {
      const target = path.join(DATA_DIR, seasonDirName(season, category), "foul-penalties.json");
      const want = files.get(`${season}:${category}`) ?? null;
      const have = await readJson<FoulPenaltiesFile>(target);
      if (JSON.stringify(want) === JSON.stringify(have)) continue;
      changed++;
      if (check) {
        console.error(`${season} ${category}: data の表が台帳と合いません（scripts/build-foul-penalties.ts を流す）`);
        continue;
      }
      if (want) {
        await writeJson(target, want);
        console.log(`${season} ${category}: ${want.rows.length} 行を書き出しました`);
      } else {
        await unlink(`${target}.gz`);
        console.log(`${season} ${category}: 行が無くなったので消しました`);
      }
    }
  }
  if (unresolved.length > 0) console.log(`チームに結び付かなかった行（そのシーズン・リーグの試合に出ていないクラブ。B2 など）: ${unresolved.length} 行`);
  if (check && changed > 0) process.exitCode = 1;
  if (!check) console.log(`変わったファイル: ${changed}`);
}

// 検証（validate-foul-points.ts）から import されたときは実行しない
if (process.argv[1] && path.basename(process.argv[1]) === "build-foul-penalties.ts" && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main();
