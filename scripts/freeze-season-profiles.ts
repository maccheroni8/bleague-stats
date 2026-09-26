// 進行中のシーズンの身長・体重・ポジションを、そのシーズンの1月15日時点の選手名簿の値で固定し、data/season-profiles.json に
// 保存する（夜間実行。DESIGN.md 148章）。固定した値は、終了後もそのシーズンの当時の値として使う（shared/seasonProfile.ts）。
//
// - 1月15日より前（JST）は何もしない（画面は今までどおり選手マスタの現在の値を使い、＊は付けない）
// - 1月15日以降の最初の夜間実行で、そのシーズンに出場した選手と、B.PREMIER のクラブに在籍している選手（data/current-roster.json）の
//   値を、その時点の選手マスタ（直前の Scrape roster で更新済み）から保存する
// - その後に初めて出場した選手（1月15日より後に加入した選手）は、出場した後の最初の夜間実行で、その時点の値を保存する。
//   2回目以降は出場した選手だけを見る（在籍で加えるのは最初の1回だけ。シーズン終了後の来季の新加入選手を混ぜないため）
//   （出場の判定は試合ログ。その夜間実行の中で取り込んだ試合は、翌日の夜間実行で固定する）
// - 既に保存した選手は上書きしない（その後の選手名簿の更新で値が変わっても固定したまま）
// - 選手マスタは読むだけで書き換えない
//
// 使い方:
//   node --experimental-strip-types scripts/freeze-season-profiles.ts [--today YYYY-MM-DD] [--dry-run]

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import { currentSeason } from "./lib/season.ts";
import type { CurrentRosterFile, DivisionHistoryFile, PlayerMasterEntry, SeasonProfilesFile } from "../shared/types.ts";

const OUT_PATH = path.join(DATA_DIR, "season-profiles.json");

function jstDate(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

async function main() {
  const todayArg = process.argv.indexOf("--today");
  const today = todayArg >= 0 ? process.argv[todayArg + 1]! : jstDate(new Date());
  const dryRun = process.argv.includes("--dry-run");
  const season = currentSeason(new Date(`${today}T12:00:00+09:00`));
  const baseDate = `${Number(season.slice(0, 4)) + 1}-01-15`;
  if (today < baseDate) {
    console.log(`${season}: 1月15日（${baseDate}）より前のため固定しません`);
    return;
  }

  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const masterById = new Map(master.map((p) => [p.playerId, p]));
  // そのシーズンの B.PREMIER のクラブ（地区の構成。teams.json は試合をしたクラブしか持たないので使わない）
  const divisions = await readJson<DivisionHistoryFile>(path.join(DATA_DIR, "division-history.json"));
  const teamIds = new Set(Object.keys(divisions?.premier?.[season] ?? {}));
  // 今の選手名簿（scripts/scrape-roster.ts が直前の Scrape roster で保存）。選手マスタの所属は退団後も残るので使わない
  const roster = await readJson<CurrentRosterFile>(path.join(DATA_DIR, "current-roster.json"));

  const file: SeasonProfilesFile = (await readJson<SeasonProfilesFile>(OUT_PATH)) ?? { generatedAt: "", seasons: {} };
  const firstFreeze = !file.seasons[season] || Object.keys(file.seasons[season]!).length === 0;
  const entries = (file.seasons[season] ??= {});

  // そのシーズンに出場した選手（試合ログがある選手）。最初の固定（1月15日）のときだけ、B.PREMIER のクラブに在籍している選手
  // （まだ出場していない選手を含む）も加える。2回目以降に選手マスタの所属で加えると、シーズン終了後（6〜8月も同じシーズン扱い）の
  // 来季の新加入選手まで、終わったシーズンの値として固定してしまうため
  const dir = path.join(DATA_DIR, season, "player-games");
  const appeared = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json.gz")).map((f) => f.replace(/\.json\.gz$/, "")) : [];
  const onRoster = firstFreeze ? (roster?.season === season ? roster.players : []).filter((p) => teamIds.has(p.teamId)).map((p) => p.playerId) : [];
  const targets = new Set([...onRoster, ...appeared]);
  let added = 0;
  for (const playerId of targets) {
    if (entries[playerId]) continue; // 固定済み（上書きしない）
    const m = masterById.get(playerId);
    if (!m) continue;
    entries[playerId] = {
      frozenOn: today,
      ...(m.heightCm !== undefined ? { heightCm: m.heightCm } : {}),
      ...(m.weightKg !== undefined ? { weightKg: m.weightKg } : {}),
      ...(m.position ? { position: m.position } : {}),
    };
    added += 1;
  }
  console.log(`${season}: 新たに${added}人を固定（固定済み${Object.keys(entries).length}人、対象${targets.size}人）`);
  if (dryRun || added === 0) return;
  file.generatedAt = new Date().toISOString();
  await writeJsonIfChanged(OUT_PATH, file as unknown as Record<string, unknown>);
}

main();
