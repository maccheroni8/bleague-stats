// 30分おきの頻繁チェック（update-stats.yml）の起動直後に、bleague.jpへ一切アクセスせず
// ローカルのschedule.json（前回までのコミット済みデータ）だけで「本処理に進む必要があるか」を
// 判定する（DESIGN.md 8-5章）。
//
// 判定基準: upcomingGames（生データ未取得の開催予定試合）のうち、「ティップオフ時刻 + 3時間」を
// 過ぎている試合、または生データはあるが未終了（試合中に取得された）の試合が1件でもあれば
// should_run=true。tipoffTime不明の試合は試合日の22:00開始とみなす（lib/pendingGames.ts）。
//
// GitHub Actionsのjob outputに should_run=true/false を書き込む（GITHUB_OUTPUT未設定時は
// 標準出力のみ、ローカル動作確認用）。
//
// 使い方: check-pending-games.ts --season 2026-27

import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, readJson, seasonDirName } from "./lib/storage.ts";
import { isMainModule } from "./lib/isMain.ts";
import { FALLBACK_TIPOFF_TIME, TIPOFF_GRACE_HOURS, isDue } from "./lib/pendingGames.ts";
import type { Category, GameSummary, ScheduleFile } from "../shared/types.ts";

export async function hasPendingGames(season: string, category: Category = "premier"): Promise<boolean> {
  const schedulePath = path.join(DATA_DIR, seasonDirName(season, category), "schedule.json");
  const schedule = await readJson<ScheduleFile>(schedulePath);
  const upcoming = schedule?.upcomingGames ?? [];
  // 生データ取得済みの試合（games-summary.json）。schedule.jsonは同じ実行内でボックススコア取得より
  // 先に書かれるため、取得済みの試合がupcomingGamesに一時的に残っていることがある
  const summaries =
    (await readJson<GameSummary[]>(path.join(DATA_DIR, seasonDirName(season, category), "games-summary.json"))) ?? [];
  const stored = new Set(summaries.map((g) => g.scheduleKey));
  const now = Date.now();

  const unknownTime = upcoming.filter((g) => !g.tipoffTime);
  const pending = upcoming.filter((g) => !stored.has(g.scheduleKey) && isDue(g, now));
  // 試合中に取得されて終了フラグが立っていない試合（途中経過のまま保存されたもの）も取り直す
  const unfinished = summaries.filter((g) => !g.gameEndedFlg);

  console.log(
    `[${season}] upcomingGames ${upcoming.length}件（うちtipoffTime不明 ${unknownTime.length}件＝${FALLBACK_TIPOFF_TIME}開始とみなす）。` +
      `ティップオフ+${TIPOFF_GRACE_HOURS}時間経過済み: ${pending.length}件、取得済みだが未終了: ${unfinished.length}件`,
  );
  for (const g of pending) {
    console.log(`  - ScheduleKey=${g.scheduleKey} ${g.date} ${g.tipoffTime ?? `(時刻不明→${FALLBACK_TIPOFF_TIME})`} ${g.homeTeamName} vs ${g.awayTeamName}`);
  }
  for (const g of unfinished) {
    console.log(`  - ScheduleKey=${g.scheduleKey} ${g.date} ${g.homeTeamName} ${g.homeScore}-${g.awayScore} ${g.awayTeamName}（未終了）`);
  }

  return pending.length > 0 || unfinished.length > 0;
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
