// 不戦勝／不戦敗の台帳（docs/forfeit-ledger/ledger.json。DESIGN.md 431章）の行を、そのシーズンの schedule.json の resultOnlyGames に反映する（ネットワークは使わない）。
// 台帳の試合は、cancelledGames・upcomingGames・scheduleKeys から外す。すでに resultOnlyGames にある試合（公式のカードから作った項目）は上書きしない。
//   npm run apply:forfeit-ledger
// 取り込み（scrape-schedule.ts）も同じ台帳を読むので、これを流さなくても次の実行で反映される。手元で確かめたいとき・すぐ反映したいときに使う。
import path from "node:path";
import { DATA_DIR, readJson, seasonDirName, writeJson } from "./lib/storage.ts";
import { forfeitLedgerEntries, ledgerFill, readForfeitLedgerRows } from "./lib/forfeitLedger.ts";
import { reconcileResultOnly } from "./lib/resultOnlyGames.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { Category } from "../shared/types.ts";
import type { ScheduleFileExtended } from "../shared/resultOnlyGames.ts";

async function main(): Promise<void> {
  const targets = new Map<string, { season: string; category: Category }>();
  for (const r of readForfeitLedgerRows()) {
    const category = (r.category ?? "premier") as Category;
    targets.set(`${r.season}/${category}`, { season: r.season, category });
  }
  for (const { season, category } of targets.values()) {
    const file = path.join(DATA_DIR, seasonDirName(season, category), "schedule.json");
    const schedule = await readJson<ScheduleFileExtended>(file);
    if (!schedule) {
      console.warn(`[${season}] schedule.json が無いので反映しません`);
      continue;
    }
    const existing = schedule.resultOnlyGames ?? [];
    const fill = ledgerFill(forfeitLedgerEntries(season, category), existing, []);
    if (fill.length === 0) {
      console.log(`[${season}${category === "one" ? " B.ONE" : ""}] 台帳に反映する新しい試合はありません`);
      continue;
    }
    // 本物の生データがある試合は結果だけの試合にしない、という判定は取り込み側が行う。ここでは台帳の行を足すだけ
    const rec = reconcileResultOnly({ existing, built: fill, withBoxscore: new Set() });
    const keys = new Set(fill.map((g) => g.scheduleKey));
    const next: ScheduleFileExtended = {
      ...schedule,
      scheduleKeys: schedule.scheduleKeys.filter((k) => !keys.has(k)),
      upcomingGames: schedule.upcomingGames.filter((g) => !keys.has(g.scheduleKey)),
      resultOnlyGames: rec.entries,
    };
    const cancelled = (schedule.cancelledGames ?? []).filter((g) => !keys.has(g.scheduleKey));
    if (cancelled.length > 0) next.cancelledGames = cancelled;
    else delete next.cancelledGames;
    await writeJson(file, next);
    for (const g of fill) console.log(`[${season}] 台帳から反映: ScheduleKey=${g.scheduleKey} ${g.date} ${g.homeTeamName} ${g.homeScore}-${g.awayScore} ${g.awayTeamName}`);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
