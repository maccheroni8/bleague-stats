// 個人単位OFFRTG/DEFRTG/NETRTG/PACE（「この選手が出場中のチームのレーティング」）の
// 精度検証スクリプト（UIには一切関与しない、検証専用）。公式の正解値が存在しないため、
// 以下の間接的な整合性チェックのみを行う:
//
//   1. チーム内の全選手について、在コート時間で加重平均したOFFRTG/DEFRTGが、
//      公式BoxscoreRow（Category=3・PeriodCategory=18）のOFFRTG/DEFRTG（試合単位の確定値）に
//      近い値になるか（チーム×試合単位で誤差を集計）
//   2. shared/onCourt.tsのbuildPossessionStartEvents()が検出した「そのチームの新ポゼッション
//      開始」の総数が、公式POSSフィールド（Oliver式の推定値）と大きく乖離していないか
//      （個人レーティングの分母となるポゼッション検出ロジック自体の健全性チェック）
//
// 使い方: node --experimental-strip-types scripts/validate-oncourt-ratings.ts --season 2025-26

import { readAllGames } from "./lib/storage.ts";
import { computeOnCourtRatings, reconstructOnCourt, substitutionModelForSeason } from "../shared/onCourt.ts";
import type { BoxscoreRow, StoredGame } from "../shared/types.ts";

interface TeamGameResult {
  scheduleKey: string;
  team: string;
  officialOffRtg: number;
  officialDefRtg: number;
  officialPoss: number;
  weightedOffRtg: number;
  weightedDefRtg: number;
  detectedPoss: number;
  offRtgDiff: number;
  defRtgDiff: number;
  possDiff: number;
  coveredSec: number;
  expectedSec: number;
}

// Category=3（チーム合計行）はTeamIDが常にnullのため、Home/AwayBoxscoresそれぞれの
// 配列内でCategory=3を探す（boxscoreAggregate.tsのbuildTeamTotalCounts()と同じ前提）
function teamTotalRow(teamRows: BoxscoreRow[]): BoxscoreRow | undefined {
  return teamRows.find((r) => r.Category === 3 && r.PeriodCategory === 18);
}

function playerGameRows(teamRows: BoxscoreRow[]): BoxscoreRow[] {
  return teamRows.filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.PlayTime !== "DNP");
}

function evaluateGame(game: StoredGame): TeamGameResult[] {
  const homeId = game.homeTeam.id;
  const awayId = game.awayTeam.id;
  const periods = game.quarterScores.home.length;

  const result = reconstructOnCourt(
    game.raw.PlayByPlays,
    game.raw.HomeBoxscores,
    game.raw.AwayBoxscores,
    homeId,
    awayId,
    periods,
    substitutionModelForSeason(game.season),
  );
  const ratings = computeOnCourtRatings(result.intervals);

  const results: TeamGameResult[] = [];
  for (const [teamId, teamName, boxscores] of [
    [homeId, game.homeTeam.name, game.raw.HomeBoxscores],
    [awayId, game.awayTeam.name, game.raw.AwayBoxscores],
  ] as const) {
    const totalRow = teamTotalRow(boxscores);
    if (!totalRow || typeof totalRow.OFFRTG !== "number" || typeof totalRow.DEFRTG !== "number") continue;

    const players = playerGameRows(boxscores);
    let weightedOffRtgSum = 0;
    let weightedDefRtgSum = 0;
    let coveredSec = 0;
    for (const p of players) {
      const r = ratings[p.PlayerID];
      if (!r || r.onCourtSec === 0) continue;
      weightedOffRtgSum += r.offRtg * r.onCourtSec;
      weightedDefRtgSum += r.defRtg * r.onCourtSec;
      coveredSec += r.onCourtSec;
    }
    if (coveredSec === 0) continue;
    const weightedOffRtg = weightedOffRtgSum / coveredSec;
    const weightedDefRtg = weightedDefRtgSum / coveredSec;

    const detectedPoss = result.intervals
      .filter((iv) => iv.teamId === teamId)
      .reduce((sum, iv) => sum + iv.ownPoss, 0);
    // 1ポゼッションは同時に5人分のownPossとして数えられるため、5で割って
    // 「そのチームの試合全体の新ポゼッション開始回数」に戻す
    const detectedPossPerGame = detectedPoss / 5;

    results.push({
      scheduleKey: game.scheduleKey,
      team: teamName,
      officialOffRtg: totalRow.OFFRTG,
      officialDefRtg: totalRow.DEFRTG,
      officialPoss: totalRow.POSS ?? 0,
      weightedOffRtg,
      weightedDefRtg,
      detectedPoss: detectedPossPerGame,
      offRtgDiff: weightedOffRtg - totalRow.OFFRTG,
      defRtgDiff: weightedDefRtg - totalRow.DEFRTG,
      possDiff: detectedPossPerGame - (totalRow.POSS ?? 0),
      coveredSec,
      expectedSec: players.reduce((sum, p) => sum + (ratings[p.PlayerID]?.onCourtSec ?? 0), 0),
    });
  }
  return results;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function meanAbs(values: number[]): number {
  return mean(values.map((v) => Math.abs(v)));
}

function rmse(values: number[]): number {
  return Math.sqrt(mean(values.map((v) => v * v)));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : "2025-26";
  if (!season) {
    console.error("使い方: validate-oncourt-ratings.ts --season 2025-26");
    process.exitCode = 1;
    return;
  }

  const games = (await readAllGames(season)).filter((g) => g.gameEndedFlg);
  console.log(`[${season}] 検証対象: ${games.length}試合（終了済みのみ）\n`);

  const allResults: TeamGameResult[] = [];
  for (const game of games) {
    try {
      allResults.push(...evaluateGame(game));
    } catch (err) {
      console.error(`✗ ${game.scheduleKey} でエラー: ${(err as Error).message}`);
    }
  }

  const offRtgDiffs = allResults.map((r) => r.offRtgDiff);
  const defRtgDiffs = allResults.map((r) => r.defRtgDiff);
  const possDiffs = allResults.map((r) => r.possDiff);

  console.log("===== OFFRTG（加重平均 vs 公式チーム値）=====");
  console.log(`平均絶対誤差: ${meanAbs(offRtgDiffs).toFixed(2)}`);
  console.log(`RMSE: ${rmse(offRtgDiffs).toFixed(2)}`);
  console.log(`平均誤差（符号あり・偏りの確認用）: ${mean(offRtgDiffs).toFixed(2)}`);

  console.log("\n===== DEFRTG（加重平均 vs 公式チーム値）=====");
  console.log(`平均絶対誤差: ${meanAbs(defRtgDiffs).toFixed(2)}`);
  console.log(`RMSE: ${rmse(defRtgDiffs).toFixed(2)}`);
  console.log(`平均誤差（符号あり・偏りの確認用）: ${mean(defRtgDiffs).toFixed(2)}`);

  console.log("\n===== 検出ポゼッション数（自チーム） vs 公式POSS（Oliver式推定値）=====");
  console.log(`平均絶対誤差: ${meanAbs(possDiffs).toFixed(2)}`);
  console.log(`平均誤差（符号あり）: ${mean(possDiffs).toFixed(2)}（負＝過少検出）`);
  console.log(`公式POSS平均: ${mean(allResults.map((r) => r.officialPoss)).toFixed(1)}`);
  console.log(`検出ポゼッション数平均: ${mean(allResults.map((r) => r.detectedPoss)).toFixed(1)}`);

  const buckets = [5, 10, 15, 20];
  console.log("\n===== OFFRTG誤差の分布 =====");
  for (const b of buckets) {
    const within = offRtgDiffs.filter((d) => Math.abs(d) <= b).length;
    console.log(`  ±${b}以内: ${within}/${offRtgDiffs.length} = ${((within / offRtgDiffs.length) * 100).toFixed(1)}%`);
  }

  const sorted = [...allResults].sort((a, b) => Math.abs(b.offRtgDiff) - Math.abs(a.offRtgDiff));
  console.log("\n===== OFFRTG誤差が大きい上位10件 =====");
  for (const r of sorted.slice(0, 10)) {
    console.log(
      `  ${r.scheduleKey} ${r.team}: 公式ORtg=${r.officialOffRtg.toFixed(1)} 加重平均=${r.weightedOffRtg.toFixed(1)} 差=${r.offRtgDiff.toFixed(1)} ` +
        `(カバー秒数=${r.coveredSec}/${r.expectedSec})`,
    );
  }

  console.log(`\n有効チーム×試合数: ${allResults.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
