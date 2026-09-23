// 30分おきの頻繁チェック（update-stats.yml）の起動直後に、bleague.jpへ一切アクセスせず
// ローカルのschedule.json（前回までのコミット済みデータ）だけで「本処理に進む必要があるか」を
// 判定する（DESIGN.md 8章の更新、2026-09-23）。
//
// 判定基準: upcomingGames（生データ未取得の開催予定試合）のうち、
// 「ティップオフ時刻 + 3時間」を過ぎている試合が1件でもあれば should_run=true。
// tipoffTime未解決のエントリ（導入前に取得済みだった等）は安全側に倒してtrue扱いにする
// （scrape-schedule.tsのresolveUpcomingGames側で次回の本処理時に自動的に再解決される）。
//
// GitHub Actionsのjob outputに should_run=true/false を書き込む（GITHUB_OUTPUT未設定時は
// 標準出力のみ、ローカル動作確認用）。
//
// 使い方: check-pending-games.ts --season 2026-27

import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, readJson, seasonDirName } from "./lib/storage.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { Category, ScheduleFile } from "../shared/types.ts";

const TIPOFF_GRACE_HOURS = 3;

function parseJstDateTime(date: string, time: string): number {
  return new Date(`${date}T${time}:00+09:00`).getTime();
}

export async function hasPendingGames(season: string, category: Category = "premier"): Promise<boolean> {
  const schedulePath = path.join(DATA_DIR, seasonDirName(season, category), "schedule.json");
  const schedule = await readJson<ScheduleFile>(schedulePath);
  const upcoming = schedule?.upcomingGames ?? [];
  const now = Date.now();
  const graceMs = TIPOFF_GRACE_HOURS * 60 * 60 * 1000;

  const pending = upcoming.filter((g) => {
    if (!g.tipoffTime) return true; // 時刻不明は安全側に倒して対象とする
    return now >= parseJstDateTime(g.date, g.tipoffTime) + graceMs;
  });

  console.log(
    `[${season}] upcomingGames ${upcoming.length}件中、ティップオフ+${TIPOFF_GRACE_HOURS}時間経過済み（またはtipoffTime不明）: ${pending.length}件`,
  );
  for (const g of pending) {
    console.log(`  - ScheduleKey=${g.scheduleKey} ${g.date} ${g.tipoffTime ?? "(時刻不明)"} ${g.homeTeamName} vs ${g.awayTeamName}`);
  }

  return pending.length > 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error("使い方: check-pending-games.ts --season 2026-27");
    process.exitCode = 1;
    return;
  }

  const shouldRun = await hasPendingGames(season);
  console.log(shouldRun ? "→ 対象試合あり。本処理へ進みます" : "→ 対象試合なし。bleague.jpへアクセスせず終了します");

  const githubOutput = process.env.GITHUB_OUTPUT;
  if (githubOutput) {
    await fs.appendFile(githubOutput, `should_run=${shouldRun}\n`);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
