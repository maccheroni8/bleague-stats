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
// 取得対象は、自前のボックススコアが保存済みで試合終了フラグが立っている試合だけ（未開催・試合中の
// 試合は問い合わせない。2026-09-24変更。DESIGN.md 129章）。
//
// 使い方:
//   npm run scrape:yahoo-pbp -- --season 2024-25
//   npm run scrape:yahoo-pbp -- --season 2024-25 --limit 20   （動作確認用に件数を絞る）
//   npm run scrape:yahoo-pbp -- --season 2024-25 --force      （保存済みでも再取得）
//   npm run scrape:yahoo-pbp -- --season 2026-27 --incremental                 （自動更新用: 未取得の終了試合だけ。
//                                                                              検証レポートは書かない）
//   npm run scrape:yahoo-pbp -- --season 2026-27 --incremental --recheck-recent（＋直近14日の試合のうち、保存済みの
//                                                                              PBPが現在のボックススコアと合わないものを取り直す。深夜用）

import path from "node:path";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, fileExists, gameFilePath, readGameFile, readJson, writeJson } from "./lib/storage.ts";
import { yahooPbpCoverage, yahooWidgetLeaguePath } from "./lib/yahooCoverage.ts";
import { buildPlayerLookup, parseYahooPbpHtml, type PlayerLookupEntry } from "./lib/yahooPbp.ts";
import { isMainModule } from "./lib/isMain.ts";
import { isExhibitionGame } from "./lib/exhibitionGames.ts";
import type { ScheduleFile, YahooGamePbp } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

function widgetUrl(season: string, scheduleKey: string): string {
  return `https://sports.yahoo.co.jp/basket/widget/ds/pc/${yahooWidgetLeaguePath(season)}/games/${scheduleKey}/text_live.html`;
}

/** 深夜の取り直し対象にする期間（scrape-boxscore.tsのwatching再チェック期間と同じ14日） */
const RECHECK_WITHIN_DAYS = 14;

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
  notEnded: number;
  exhibition: number;
  rechecked: number;
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
  options: { limit?: number; force?: boolean; recheckRecent?: boolean } = {},
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
    notEnded: 0,
    exhibition: 0,
    rechecked: 0,
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

  const recheckSince = Date.now() - RECHECK_WITHIN_DAYS * 86_400_000;

  for (const scheduleKey of scheduleKeys) {
    // 自前のボックススコアが無い・試合が終わっていない試合は問い合わせない（未開催の試合は500、
    // 試合中の試合は途中経過のまま保存されて以後取り直されなくなるため）
    const game = await readGameFile(gameFilePath(season, scheduleKey));
    if (!game?.gameEndedFlg) {
      summary.notEnded += 1;
      continue;
    }
    // オールスター等の集計対象外の試合はスポーツナビにPBPが無い（2025-26の5試合で500を確認）うえ
    // 集計でも使わないため問い合わせない
    if (isExhibitionGame(game.raw.Game.ConventionNameJ)) {
      summary.exhibition += 1;
      continue;
    }
    const lookup = buildPlayerLookup(game);

    const outPath = yahooFilePath(season, scheduleKey);
    if (!options.force && fileExists(`${outPath}.gz`)) {
      // 深夜の取り直し: 直近14日の試合で、保存済みPBPが現在のボックススコアと合わないもの
      // （試合終了直後の取得でテキスト速報が確定前だった、公式記録が後から訂正された等）
      const recent = new Date(`${game.date}T00:00:00+09:00`).getTime() >= recheckSince;
      const stored = options.recheckRecent && recent ? await readJson<YahooGamePbp>(outPath) : null;
      const check = stored ? crossCheck(stored, lookup) : null;
      if (!check || (check.pointsMismatch === 0 && check.tovCountMismatch === 0)) {
        summary.alreadyStored += 1;
        continue;
      }
      console.log(
        `[yahoo-pbp] ${scheduleKey}: 保存済みPBPがボックススコアと不一致（得点${check.pointsMismatch}人・TO${check.tovCountMismatch}人）のため取り直す`,
      );
      summary.rechecked += 1;
    }

    summary.attempted += 1;
    const res = await throttledFetch(widgetUrl(season, scheduleKey));
    if (!res.ok) {
      console.log(`[yahoo-pbp] ${scheduleKey}: HTTP ${res.status} のためスキップ`);
      summary.skipped500 += 1;
      continue;
    }
    const html = await res.text();

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

    const check = crossCheck(pbp, lookup);
    summary.crossCheck.playersChecked += check.playersChecked;
    summary.crossCheck.pointsMismatch += check.pointsMismatch;
    summary.crossCheck.tovCountMismatch += check.tovCountMismatch;
    console.log(
      `[yahoo-pbp] ${scheduleKey}: 保存（イベント${pbp.eventCount}件、得点不一致${check.pointsMismatch}人・TO不一致${check.tovCountMismatch}人）`,
    );

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
  const incremental = args.includes("--incremental");
  if (!yahooPbpCoverage(season)) {
    console.error(`${season}シーズンはYahoo!スポーツのplay-by-play対応範囲外です（2023-24以降のみ）`);
    // 自動更新から呼ばれた場合は失敗扱いにしない
    if (!incremental) process.exitCode = 1;
    return;
  }

  const limitIndex = args.indexOf("--limit");
  const limit = limitIndex !== -1 ? Number(args[limitIndex + 1]) : undefined;
  const force = args.includes("--force");
  const recheckRecent = args.includes("--recheck-recent");

  const summary = await scrapeYahooPbpSeason(season, { limit, force, recheckRecent });

  if (incremental) {
    console.log(
      `[yahoo-pbp] ${season}: 問い合わせ${summary.attempted}件（うち取り直し${summary.rechecked}件）・保存${summary.parsed}件・` +
        `HTTPエラー${summary.skipped500}件 ／ 保存済み${summary.alreadyStored}件・未終了/未取得${summary.notEnded}件・オールスター等${summary.exhibition}件`,
    );
    return;
  }

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
