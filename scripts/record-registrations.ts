// そのシーズン・リーグの登録区分の記録（data/{season}/registrations.json、B.ONE は data/{season}/one/registrations.json。
// 形式は shared/registration.ts。DESIGN.md 295章）を作る・足す。2026-27 以降だけ。
//
// - 既定（深夜実行の名簿の取得のあと）: 今の名簿（current-roster.json）とそのシーズンの試合に出た選手のうち、まだ記録の無い選手を、
//   選手マスタの今の区分（classification・deemedJapanese）で足す。**記録済みの選手は書き換えない**（来季以降に選手マスタの区分が
//   変わっても、このシーズンの区分は変わらない）
// - --set: 記録済みの選手のシーズンの初めの区分を直す（区分の誤りを見つけたとき。手で実行）
// - --change: シーズン途中の区分の変更を日付付きで足す（その日以降の試合に当てる。手で実行）
//
// 使い方:
//   node --experimental-strip-types scripts/record-registrations.ts --season 2026-27
//   node --experimental-strip-types scripts/record-registrations.ts --season 2026-27 --league one --set 46082 --class 帰化選手 --source <URL>
//   node --experimental-strip-types scripts/record-registrations.ts --season 2026-27 --league premier --change 12345 --from 2027-02-01 --class 帰化選手 --source <URL>
//   （--deemed を付けると見做し日本人。--class 日本人 と一緒に使う）

import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { DATA_DIR, gamesDir, readJson, seasonDirName, writeJsonIfChanged } from "./lib/storage.ts";
import { isMainModule } from "./lib/isMain.ts";
import {
  CLASSIFICATION_CODES,
  hasSplitClassification,
  type Classification,
  type SeasonRegistrationEntry,
  type SeasonRegistrationFile,
} from "../shared/registration.ts";
import type { Category, CurrentRosterFile, PlayerMasterEntry, StoredGame } from "../shared/types.ts";

const LEAGUES: Category[] = ["premier", "one"];

function todayJst(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function registrationPath(season: string, league: Category): string {
  return path.join(DATA_DIR, seasonDirName(season, league), "registrations.json");
}

/** そのシーズン・リーグの試合（生データ）に出た選手ID */
async function playersInGames(season: string, league: Category): Promise<Set<string>> {
  const dir = gamesDir(season, league);
  const ids = new Set<string>();
  if (!existsSync(dir)) return ids;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json.gz"))) {
    const g = JSON.parse(gunzipSync(await readFile(path.join(dir, f))).toString("utf-8")) as StoredGame;
    for (const r of [...g.raw.HomeBoxscores, ...g.raw.AwayBoxscores]) {
      if (r.PeriodCategory === 18 && r.PlayerID) ids.add(String(r.PlayerID));
    }
  }
  return ids;
}

function sortedFile(file: SeasonRegistrationFile): SeasonRegistrationFile {
  return { ...file, players: Object.fromEntries(Object.entries(file.players).sort(([a], [b]) => a.localeCompare(b))) };
}

/** 記録の無い選手を、選手マスタの今の区分で足す。足した人数 */
export async function recordNewPlayers(season: string, league: Category, master: Map<string, PlayerMasterEntry>, roster: CurrentRosterFile | null): Promise<{ added: number; missing: string[]; total: number }> {
  const file = (await readJson<SeasonRegistrationFile>(registrationPath(season, league))) ?? { season, league, players: {} };
  const candidates = new Set<string>(await playersInGames(season, league));
  if (roster?.season === season) for (const p of roster.players) if ((p.league ?? "premier") === league) candidates.add(p.playerId);
  const today = todayJst();
  let added = 0;
  const missing: string[] = [];
  for (const id of [...candidates].sort()) {
    if (file.players[id]) continue;
    const m = master.get(id);
    if (!m?.classification) {
      missing.push(id); // 選手マスタに区分が無い（国籍が未取得など）。次の夜にやり直す
      continue;
    }
    file.players[id] = {
      classification: m.classification,
      ...(m.deemedJapanese ? { deemedJapanese: true } : {}),
      recordedAt: today,
      source: "players-master",
    };
    added += 1;
  }
  await writeJsonIfChanged(registrationPath(season, league), sortedFile(file) as unknown as Record<string, unknown>, []);
  return { added, missing, total: Object.keys(file.players).length };
}

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const season = argValue(args, "--season");
  if (!season) {
    console.error("使い方: record-registrations.ts --season 2026-27 [--league one --set <選手ID> | --change <選手ID> --from YYYY-MM-DD] --class <区分> [--deemed] [--source <URL>]");
    process.exitCode = 1;
    return;
  }
  if (!hasSplitClassification(season)) {
    console.log(`${season}: 登録区分の記録は 2026-27 以降だけです（何もしません）`);
    return;
  }

  const setId = argValue(args, "--set");
  const changeId = argValue(args, "--change");
  if (setId || changeId) {
    const league = (argValue(args, "--league") ?? "premier") as Category;
    const cls = argValue(args, "--class") as Classification | undefined;
    if (!LEAGUES.includes(league) || !cls || !CLASSIFICATION_CODES.includes(cls)) {
      console.error(`--league は premier か one、--class は ${CLASSIFICATION_CODES.join("・")} のどれかを指定してください`);
      process.exitCode = 1;
      return;
    }
    const deemed = args.includes("--deemed");
    if (deemed && cls !== "日本人") {
      console.error("--deemed（見做し日本人）は --class 日本人 と一緒に使ってください");
      process.exitCode = 1;
      return;
    }
    const source = argValue(args, "--source");
    const file = (await readJson<SeasonRegistrationFile>(registrationPath(season, league))) ?? { season, league, players: {} };
    if (setId) {
      const prev = file.players[setId];
      file.players[setId] = { ...prev, classification: cls, recordedAt: todayJst(), source: source ?? "manual" } as SeasonRegistrationEntry;
      if (deemed) file.players[setId]!.deemedJapanese = true;
      else delete file.players[setId]!.deemedJapanese;
      console.log(`${season} ${league} ${setId}: シーズンの初めの区分を ${cls}${deemed ? "（見做し日本人）" : ""} にしました`);
    } else {
      const from = argValue(args, "--from");
      const entry = file.players[changeId!];
      if (!entry || !from || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        console.error("--change は記録済みの選手に、--from YYYY-MM-DD と一緒に使ってください（記録が無ければ先に既定の実行か --set で記録する）");
        process.exitCode = 1;
        return;
      }
      entry.changes = [...(entry.changes ?? []).filter((c) => c.from !== from), { from, classification: cls, ...(deemed ? { deemedJapanese: true } : {}), ...(source ? { source } : {}) }].sort((a, b) =>
        a.from.localeCompare(b.from),
      );
      console.log(`${season} ${league} ${changeId}: ${from} 以降の区分を ${cls} にしました`);
    }
    await writeJsonIfChanged(registrationPath(season, league), sortedFile(file) as unknown as Record<string, unknown>, []);
    return;
  }

  const master = new Map(((await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? []).map((p) => [p.playerId, p]));
  const roster = await readJson<CurrentRosterFile>(path.join(DATA_DIR, "current-roster.json"));
  for (const league of LEAGUES) {
    const r = await recordNewPlayers(season, league, master, roster);
    console.log(`${season} ${league}: 新しく${r.added}名を記録（全${r.total}名）${r.missing.length > 0 ? ` ／ 選手マスタに区分が無く記録できない選手 ${r.missing.length}名: ${r.missing.join(", ")}` : ""}`);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
