// Yahoo!スポーツ（sports.yahoo.co.jp）のplay-by-playテキストを取得し、
// data/{season}/yahoo/{scheduleKey}.json に保存する。
//
// bleague.jp本体のスクレイパー（scrape-boxscore.ts等）とは独立した追加データ源として扱う
// （aggregate.tsやフロントエンドへの配線はまだ行わない。基盤の検証段階。DESIGN.md参照）。
//
// 対応シーズン: scripts/lib/yahooCoverage.tsのyahooPbpCoverage()が判定する2023-24以降のみ
// （それ以前のScheduleKeyはウィジェットが500を返す。2026-08-21実機確認）。
//
// 500エラーの試合はスキップして処理を続ける（--season全体を落とさない）。取得できた試合は
// 自前のボックススコア（data/{season}/games/{scheduleKey}.json.gz）と突き合わせて
// (TeamID, 背番号) → PlayerID を解決し、パース結果の品質を2軸でクロスチェックする:
//   - シュートの累計得点(cumulativePointsAfter最終値) vs 自前ボックススコアのFG得点(PT2M*2+PT3M*3)
//   - ターンオーバー件数 vs 自前ボックススコアのTO
// 一致しない場合はパース漏れ・二重カウントの疑いがあるため、選手単位で不一致件数を記録する。
//
// 使い方:
//   npm run scrape:yahoo-pbp -- --season 2024-25
//   npm run scrape:yahoo-pbp -- --season 2024-25 --limit 20   （動作確認用に件数を絞る）
//   npm run scrape:yahoo-pbp -- --season 2024-25 --force      （保存済みでも再取得）

import path from "node:path";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, fileExists, gameFilePath, readGameFile, readJson, writeJson } from "./lib/storage.ts";
import { yahooPbpCoverage } from "./lib/yahooCoverage.ts";
import { buildPlayerLookup, parseYahooPbpHtml, type PlayerLookupEntry } from "./lib/yahooPbp.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { ScheduleFile, YahooGamePbp } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

function widgetUrl(scheduleKey: string): string {
  return `https://sports.yahoo.co.jp/basket/widget/ds/pc/b1/games/${scheduleKey}/text_live.html`;
}

function yahooFilePath(season: string, scheduleKey: string): string {
  return path.join(DATA_DIR, season, "yahoo", `${scheduleKey}.json`);
}

interface CrossCheckTally {
  playersChecked: number;
  pointsMismatch: number;
  tovCountMismatch: number;
}

function crossCheck(pbp: YahooGamePbp, lookup: Map<string, PlayerLookupEntry>): CrossCheckTally {
  const pointsByKey = new Map<string, number>();
  const tovByKey = new Map<string, number>();
  for (const shot of pbp.shots) {
    if (!shot.made) continue;
    const key = `${shot.teamId}:${shot.playerNo}`;
    // cumulativePointsAfterはFT込みの累計点（実機確認で判明。DESIGN.md参照）なのでFG得点の
    // クロスチェックには使えない。代わりにこちらで拾ったmadeショットのshotValueを合算し、
    // 「パース漏れ・二重カウントが無いか」を独立に検証する
    pointsByKey.set(key, (pointsByKey.get(key) ?? 0) + shot.shotValue);
  }
  for (const to of pbp.turnovers) {
    if (to.isTeamTurnover || !to.playerNo) continue;
    const key = `${to.teamId}:${to.playerNo}`;
    tovByKey.set(key, (tovByKey.get(key) ?? 0) + 1);
  }

  let playersChecked = 0;
  let pointsMismatch = 0;
  let tovCountMismatch = 0;
  for (const [key, entry] of lookup) {
    const parsedPoints = pointsByKey.get(key) ?? 0;
    const parsedTov = tovByKey.get(key) ?? 0;
    if (entry.fgPoints === 0 && parsedPoints === 0 && entry.tov === 0 && parsedTov === 0) continue;
    playersChecked += 1;
    if (parsedPoints !== entry.fgPoints) pointsMismatch += 1;
    if (parsedTov !== entry.tov) tovCountMismatch += 1;
  }
  return { playersChecked, pointsMismatch, tovCountMismatch };
}

interface RunSummary {
  season: string;
  attempted: number;
  skipped500: number;
  alreadyStored: number;
  parsed: number;
  totalEvents: number;
  totalShots: number;
  totalTurnovers: number;
  unresolvedPlayerRate: number;
  crossCheck: CrossCheckTally;
  turnoverSubtypeCounts: Record<string, number>;
  turnoverBallTypeCounts: Record<string, number>;
  parseWarningSamples: string[];
  parseWarningCount: number;
}

export async function scrapeYahooPbpSeason(
  season: string,
  options: { limit?: number; force?: boolean } = {},
): Promise<RunSummary> {
  const scheduleFile = await readJson<ScheduleFile>(path.join(DATA_DIR, season, "schedule.json"));
  if (!scheduleFile) throw new Error(`schedule.jsonが見つかりません: season=${season}`);

  let scheduleKeys = scheduleFile.scheduleKeys;
  if (options.limit) scheduleKeys = scheduleKeys.slice(0, options.limit);

  const summary: RunSummary = {
    season,
    attempted: 0,
    skipped500: 0,
    alreadyStored: 0,
    parsed: 0,
    totalEvents: 0,
    totalShots: 0,
    totalTurnovers: 0,
    unresolvedPlayerRate: 0,
    crossCheck: { playersChecked: 0, pointsMismatch: 0, tovCountMismatch: 0 },
    turnoverSubtypeCounts: {},
    turnoverBallTypeCounts: {},
    parseWarningSamples: [],
    parseWarningCount: 0,
  };

  let totalUnresolved = 0;
  let totalResolvable = 0;

  for (const scheduleKey of scheduleKeys) {
    const outPath = yahooFilePath(season, scheduleKey);
    if (!options.force && fileExists(`${outPath}.gz`)) {
      summary.alreadyStored += 1;
      continue;
    }

    summary.attempted += 1;
    const res = await throttledFetch(widgetUrl(scheduleKey));
    if (!res.ok) {
      console.log(`[yahoo-pbp] ${scheduleKey}: HTTP ${res.status} のためスキップ`);
      summary.skipped500 += 1;
      continue;
    }
    const html = await res.text();

    const game = await readGameFile(gameFilePath(season, scheduleKey));
    const lookup = game ? buildPlayerLookup(game) : new Map<string, PlayerLookupEntry>();
    if (!game) {
      console.log(`[yahoo-pbp] ${scheduleKey}: 自前ボックススコア未取得のためplayerId解決なしで保存`);
    }

    const pbp = parseYahooPbpHtml(html, scheduleKey, season, lookup);
    await writeJson(outPath, pbp);

    summary.parsed += 1;
    summary.totalEvents += pbp.eventCount;
    summary.totalShots += pbp.shots.length;
    summary.totalTurnovers += pbp.turnovers.length;
    totalUnresolved += pbp.unresolvedPlayerCount;
    totalResolvable += pbp.shots.length + pbp.turnovers.filter((t) => !t.isTeamTurnover).length;
    summary.parseWarningCount += pbp.parseWarnings.length;
    for (const w of pbp.parseWarnings) {
      if (summary.parseWarningSamples.length < 30) summary.parseWarningSamples.push(`${scheduleKey}: ${w}`);
    }

    for (const to of pbp.turnovers) {
      const key = to.subtypeRaw ?? "(なし)";
      summary.turnoverSubtypeCounts[key] = (summary.turnoverSubtypeCounts[key] ?? 0) + 1;
      summary.turnoverBallTypeCounts[to.ballType] = (summary.turnoverBallTypeCounts[to.ballType] ?? 0) + 1;
    }

    if (game) {
      const check = crossCheck(pbp, lookup);
      summary.crossCheck.playersChecked += check.playersChecked;
      summary.crossCheck.pointsMismatch += check.pointsMismatch;
      summary.crossCheck.tovCountMismatch += check.tovCountMismatch;
    }

    if (summary.attempted % 25 === 0) {
      console.log(`[yahoo-pbp] 進捗: ${summary.attempted}件取得試行（成功${summary.parsed}・500スキップ${summary.skipped500}）`);
    }
  }

  summary.unresolvedPlayerRate = totalResolvable > 0 ? totalUnresolved / totalResolvable : 0;
  return summary;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error("使い方: scrape-yahoo-pbp.ts --season 2024-25 [--limit N] [--force]");
    process.exitCode = 1;
    return;
  }
  if (!yahooPbpCoverage(season)) {
    console.error(`${season}シーズンはYahoo!スポーツのplay-by-play対応範囲外です（2023-24以降のみ）`);
    process.exitCode = 1;
    return;
  }

  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) : undefined;
  const force = args.includes("--force");

  const summary = await scrapeYahooPbpSeason(season, { limit, force });

  console.log("\n=== Yahoo!スポーツ play-by-play 取得結果 ===");
  console.log(JSON.stringify(summary, null, 2));

  const reportPath = path.join(DATA_DIR, season, "yahoo", "_validation-report.json");
  await writeJson(reportPath, summary);
  console.log(`\n検証レポート保存: ${reportPath}.gz`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
