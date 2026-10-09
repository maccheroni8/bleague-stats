// shared/pointsOffTurnovers.tsの精度検証スクリプト（UIには一切関与しない、検証専用）。
//
// data/{season}/(one/)games/*.json（終了済み試合）全件に対し、PlayByPlaysから算出した
// チーム単位のターンオーバーからの得点（byTeam）を、公式Summaries（PeriodCategory=18の
// 試合全体行）のHomeTeamPTPFT/AwayTeamPTPFTと突合する。一致すれば選手単位の算出ロジックも
// 正しいとみなせる（選手単位はチーム単位の内訳に過ぎないため）。
//
// 使い方:
//   node --experimental-strip-types scripts/validate-points-off-turnovers.ts                          全シーズン（B.PREMIER と、あれば B.ONE）。1つでも不一致なら終了コード1
//   node --experimental-strip-types scripts/validate-points-off-turnovers.ts --season 2025-26
//   node --experimental-strip-types scripts/validate-points-off-turnovers.ts --season 2025-26 --category one
//   npm run validate:points-off-turnovers                                                                  同上（全シーズン）

import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, gamesDir, readAllGames } from "./lib/storage.ts";
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

/** 選手IDの無いタグ付きの得点がある試合: "シーズン/試合番号" → チーム合計と選手合計の差（点）。2020-21の5858はシモンズの3件（4点・8点・9点の得点のうち2+2+1点） */
const KNOWN_PLAYER_SUM_GAPS: Record<string, number> = { "2020-21/5858": 5 };

interface SeasonResult {
  label: string;
  games: number;
  teamGames: number;
  mismatches: number;
  playerSumMismatches: number;
  details: GameCheck[];
}

async function checkSeason(season: string, category: Category, verbose: boolean): Promise<SeasonResult> {
  const games = (await readAllGames(season, category)).filter((g) => g.gameEndedFlg);
  let checkedTeamGames = 0;
  let mismatches = 0;
  let playerSumMismatches = 0;
  const details: GameCheck[] = [];
  for (const game of games) {
    const check = checkGame(game);
    if (!check) continue;
    checkedTeamGames += 2;
    if (!check.homeMatch || !check.awayMatch) {
      mismatches += (check.homeMatch ? 0 : 1) + (check.awayMatch ? 0 : 1);
      details.push(check);
    }
    // 公式の記録で、タグのある得点に選手IDが無い試合（ここ1試合だけ。チームの合計には入り、選手の合計には入らない）
    const knownGap = KNOWN_PLAYER_SUM_GAPS[`${season}/${check.scheduleKey}`];
    if (check.playerSum !== check.teamSum && !(knownGap !== undefined && check.teamSum - check.playerSum === knownGap)) {
      playerSumMismatches++;
      if (verbose) console.log(`  ⚠ 選手合計とチーム合計が不一致 [${check.scheduleKey}] ${check.homeTeam} vs ${check.awayTeam} playerSum=${check.playerSum} teamSum=${check.teamSum}`);
    }
  }
  return { label: `${season}${category === "one" ? "(B.ONE)" : ""}`, games: games.length, teamGames: checkedTeamGames, mismatches, playerSumMismatches, details };
}

// 2016-17は、タグの表記が「ポイントフロムターンオーバ」（2017-18以降は「ポインツオフターンオーバ」）。両方を数えて、全557試合で公式と一致すること（DESIGN.md 221章）
const SEASON_2016_17_GAMES = 557;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const categoryIndex = args.indexOf("--category");
  const category: Category = categoryIndex !== -1 ? (args[categoryIndex + 1] as Category) : "premier";
  const all = args.includes("--all") || (seasonIndex === -1 && categoryIndex === -1);

  // --all（既定）: 全シーズンのB.PREMIERと、B.ONE。--season / --category で絞る
  const targets: [string, Category][] = [];
  if (all) {
    for (const season of readdirSync(DATA_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
      targets.push([season, "premier"]);
      if (existsSync(gamesDir(season, "one"))) targets.push([season, "one"]);
    }
  } else {
    targets.push([seasonIndex !== -1 ? args[seasonIndex + 1]! : "2025-26", category]);
  }

  let failed = false;
  for (const [season, cat] of targets) {
    const r = await checkSeason(season, cat, !all);
    const ok = r.mismatches === 0 && r.playerSumMismatches === 0;
    console.log(`${ok ? "ok" : "NG"} ${r.label}: ${r.games}試合、公式PTPFTとの一致 ${r.teamGames - r.mismatches}/${r.teamGames}、選手合計⇔チーム合計の不一致 ${r.playerSumMismatches}件`);
    if (!ok) {
      failed = true;
      for (const d of r.details.slice(0, 20)) {
        console.log(`  [${d.scheduleKey}] ${d.homeTeam} vs ${d.awayTeam}: home公式=${d.officialHome} 算出=${d.computedHome} / away公式=${d.officialAway} 算出=${d.computedAway}`);
      }
    }
    if (season === "2016-17" && cat === "premier" && all) {
      const full = r.games === SEASON_2016_17_GAMES && r.teamGames === SEASON_2016_17_GAMES * 2 && r.mismatches === 0;
      console.log(`${full ? "ok" : "NG"} 2016-17: 全${SEASON_2016_17_GAMES}試合で、チームの合計が公式Summariesと一致（${r.teamGames - r.mismatches}/${SEASON_2016_17_GAMES * 2}チーム×試合）`);
      if (!full) failed = true;
    }
  }
  if (failed) process.exitCode = 1;
  else console.log("\n全項目 ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
