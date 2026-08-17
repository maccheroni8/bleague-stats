// shared/pointsOffTurnovers.tsの精度検証スクリプト（UIには一切関与しない、検証専用）。
//
// data/{season}/(one/)games/*.json（終了済み試合）全件に対し、PlayByPlaysから算出した
// チーム単位のターンオーバーからの得点（byTeam）を、公式Summaries（PeriodCategory=18の
// 試合全体行）のHomeTeamPTPFT/AwayTeamPTPFTと突合する。一致すれば選手単位の算出ロジックも
// 正しいとみなせる（選手単位はチーム単位の内訳に過ぎないため）。
//
// 使い方:
//   node --experimental-strip-types scripts/validate-points-off-turnovers.ts --season 2025-26
//   node --experimental-strip-types scripts/validate-points-off-turnovers.ts --season 2025-26 --category one

import { readAllGames } from "./lib/storage.ts";
import { computePointsOffTurnovers } from "../shared/pointsOffTurnovers.ts";
import type { Category, StoredGame } from "../shared/types.ts";

interface GameCheck {
  scheduleKey: string;
  homeTeam: string;
  awayTeam: string;
  officialHome: number;
  computedHome: number;
  officialAway: number;
  computedAway: number;
  homeMatch: boolean;
  awayMatch: boolean;
  playerSum: number;
  teamSum: number;
}

function checkGame(game: StoredGame): GameCheck | null {
  const totalSummary = game.raw.Summaries.find((s) => s.PeriodCategory === 18);
  if (!totalSummary) return null;

  const result = computePointsOffTurnovers(game.raw.PlayByPlays);
  const computedHome = result.byTeam.get(game.homeTeam.id) ?? 0;
  const computedAway = result.byTeam.get(game.awayTeam.id) ?? 0;
  const playerSum = [...result.byPlayer.values()].reduce((a, b) => a + b, 0);
  const teamSum = computedHome + computedAway;

  return {
    scheduleKey: game.scheduleKey,
    homeTeam: game.homeTeam.name,
    awayTeam: game.awayTeam.name,
    officialHome: totalSummary.HomeTeamPTPFT,
    computedHome,
    officialAway: totalSummary.AwayTeamPTPFT,
    computedAway,
    homeMatch: totalSummary.HomeTeamPTPFT === computedHome,
    awayMatch: totalSummary.AwayTeamPTPFT === computedAway,
    playerSum,
    teamSum,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : "2025-26";
  const categoryIndex = args.indexOf("--category");
  const category: Category = categoryIndex !== -1 ? (args[categoryIndex + 1] as Category) : "premier";
  if (!season) {
    console.error("使い方: validate-points-off-turnovers.ts --season 2025-26 [--category one]");
    process.exitCode = 1;
    return;
  }

  const games = (await readAllGames(season, category)).filter((g) => g.gameEndedFlg);
  console.log(`[${season}/${category}] 検証対象: ${games.length}試合（終了済みのみ）\n`);

  let checkedTeamGames = 0;
  let mismatches = 0;
  let playerSumMismatches = 0;
  const mismatchDetails: GameCheck[] = [];

  for (const game of games) {
    const check = checkGame(game);
    if (!check) continue;
    checkedTeamGames += 2;
    if (!check.homeMatch || !check.awayMatch) {
      mismatches += (check.homeMatch ? 0 : 1) + (check.awayMatch ? 0 : 1);
      mismatchDetails.push(check);
    }
    if (check.playerSum !== check.teamSum) {
      playerSumMismatches++;
      console.log(
        `  ⚠ 選手合計とチーム合計が不一致 [${check.scheduleKey}] ${check.homeTeam} vs ${check.awayTeam} playerSum=${check.playerSum} teamSum=${check.teamSum}`,
      );
    }
  }

  console.log("===== 全体集計 =====");
  console.log(`試合数: ${games.length}`);
  console.log(`検証チーム×試合数: ${checkedTeamGames}`);
  console.log(`公式PTPFTとの一致: ${checkedTeamGames - mismatches}/${checkedTeamGames}`);
  console.log(`選手合計⇔チーム合計の内部整合性の不一致: ${playerSumMismatches}件`);

  if (mismatchDetails.length > 0) {
    console.log("\n不一致の詳細（最大20件）:");
    for (const d of mismatchDetails.slice(0, 20)) {
      console.log(
        `  [${d.scheduleKey}] ${d.homeTeam} vs ${d.awayTeam}: home公式=${d.officialHome} 算出=${d.computedHome} / away公式=${d.officialAway} 算出=${d.computedAway}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
