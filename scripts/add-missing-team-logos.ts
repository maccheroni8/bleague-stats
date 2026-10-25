// 対応表（scripts/lib/teamLogoCodes.ts）にあって、まだ data/logos/{teamId}.png が無いクラブのロゴだけを取る（手で実行）。
// 新しく対応表に足したクラブ（2026-27 の B.ONE の21クラブなど）の初回取得用。既存のロゴは取り直さない
// （毎晩の名簿の取得 scrape-roster.ts は、対応表の全クラブのロゴを取り直す。DESIGN.md 14章・125章）。
//
// 使い方: node --experimental-strip-types scripts/add-missing-team-logos.ts --season 2026-27

import { createThrottledFetch, formatRequestCounts } from "./lib/throttle.ts";
import { downloadTeamLogos } from "./lib/mediaAssets.ts";
import { isMainModule } from "./lib/isMain.ts";

const throttledFetch = createThrottledFetch(2500, "Mozilla/5.0 (bleague-stats personal scraper)");

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error("使い方: add-missing-team-logos.ts --season 2026-27");
    process.exitCode = 1;
    return;
  }
  await downloadTeamLogos(season, throttledFetch, { onlyMissing: true });
  console.log(formatRequestCounts());
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
