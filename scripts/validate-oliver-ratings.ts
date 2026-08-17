// 個人ORtg/DRtg（Dean Oliver方式、NBA.com/Basketball-Reference流）の精度検証スクリプト
// （UIには一切関与しない、検証専用）。公式の正解値が存在しないため、以下の間接的な整合性
// チェックを行う:
//
//   Dean Oliver氏の設計上、あるチームの全選手のPProd（個人の得点貢献推定値）の合計は、
//   そのチームの実際の得点（PTS）に近い値になるはず（完全一致はしないが大きく乖離しないはず）。
//   これを複数試合・複数シーズンで確認する
//
// 使い方: node --experimental-strip-types scripts/validate-oliver-ratings.ts --season 2025-26
//        node --experimental-strip-types scripts/validate-oliver-ratings.ts --game 503902

import { gameFilePath, readAllGames, readGameFile } from "./lib/storage.ts";
import {
  individualDefRtg,
  individualOffRtg,
  individualPointsProduced,
  parsePlayTime,
  type OliverBoxStats,
} from "../shared/formulas.ts";
import { estimatedPossessions } from "../shared/formulas.ts";
import type { BoxscoreRow, StoredGame } from "../shared/types.ts";

function toOliverBox(r: BoxscoreRow): OliverBoxStats {
  return {
    min: parsePlayTime(r.PlayTime),
    fgm: r.PT2M + r.PT3M,
    fga: r.PT2A + r.PT3A,
    fg3m: r.PT3M,
    ftm: r.FTM,
    fta: r.FTA,
    pts: r.Point,
    ast: r.AS,
    oreb: r.RB_OFF,
    dreb: r.RB_DEF,
    tov: r.TO,
    stl: r.ST,
    blk: r.BS,
    pf: r.FOUL,
  };
}

function teamTotalRow(teamRows: BoxscoreRow[]): BoxscoreRow | undefined {
  return teamRows.find((r) => r.Category === 3 && r.PeriodCategory === 18);
}

function playerGameRows(teamRows: BoxscoreRow[]): BoxscoreRow[] {
  return teamRows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
}

interface TeamGameResult {
  scheduleKey: string;
  team: string;
  actualPts: number;
  pprodSum: number;
  diff: number;
  playerOffRtgs: number[];
  playerDefRtgs: number[];
}

function evaluateTeam(teamRows: BoxscoreRow[], oppRows: BoxscoreRow[], teamName: string, scheduleKey: string): TeamGameResult | null {
  const totalRow = teamTotalRow(teamRows);
  const oppTotalRow = teamTotalRow(oppRows);
  if (!totalRow || !oppTotalRow) return null;

  const teamBox = toOliverBox(totalRow);
  const oppBox = toOliverBox(oppTotalRow);
  const teamPossessions = estimatedPossessions(
    { fga: teamBox.fga, fgm: teamBox.fgm, fta: teamBox.fta, oreb: teamBox.oreb, dreb: teamBox.dreb, tov: teamBox.tov },
    { fga: oppBox.fga, fgm: oppBox.fgm, fta: oppBox.fta, oreb: oppBox.oreb, dreb: oppBox.dreb, tov: oppBox.tov },
  );

  const players = playerGameRows(teamRows).filter((r) => r.PlayTime !== "DNP");
  let pprodSum = 0;
  const playerOffRtgs: number[] = [];
  const playerDefRtgs: number[] = [];
  for (const p of players) {
    const playerBox = toOliverBox(p);
    const pprod = individualPointsProduced(playerBox, teamBox, oppBox);
    if (pprod !== undefined) pprodSum += pprod;
    const offRtg = individualOffRtg(playerBox, teamBox, oppBox);
    const defRtg = individualDefRtg(playerBox, teamBox, oppBox, teamPossessions);
    if (offRtg !== undefined) playerOffRtgs.push(offRtg);
    if (defRtg !== undefined) playerDefRtgs.push(defRtg);
  }

  return {
    scheduleKey,
    team: teamName,
    actualPts: totalRow.Point,
    pprodSum,
    diff: pprodSum - totalRow.Point,
    playerOffRtgs,
    playerDefRtgs,
  };
}

function evaluateGame(game: StoredGame): TeamGameResult[] {
  const results: TeamGameResult[] = [];
  const home = evaluateTeam(game.raw.HomeBoxscores, game.raw.AwayBoxscores, game.homeTeam.name, game.scheduleKey);
  const away = evaluateTeam(game.raw.AwayBoxscores, game.raw.HomeBoxscores, game.awayTeam.name, game.scheduleKey);
  if (home) results.push(home);
  if (away) results.push(away);
  return results;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function meanAbs(values: number[]): number {
  return mean(values.map((v) => Math.abs(v)));
}

async function findGameFile(scheduleKey: string): Promise<StoredGame | undefined> {
  // シーズンが分からないので直近シーズンから遡って探す
  const seasons = ["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2020-21", "2019-20", "2018-19", "2017-18", "2016-17"];
  for (const season of seasons) {
    const game = await readGameFile(gameFilePath(season, scheduleKey));
    if (game) return game;
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const gameIndex = args.indexOf("--game");

  if (gameIndex !== -1) {
    const scheduleKey = args[gameIndex + 1];
    if (!scheduleKey) {
      console.error("使い方: validate-oliver-ratings.ts --game 503902");
      process.exitCode = 1;
      return;
    }
    const game = await findGameFile(scheduleKey);
    if (!game) {
      console.error(`試合が見つかりません: ${scheduleKey}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[${game.season}] ${game.scheduleKey} ${game.homeTeam.name} vs ${game.awayTeam.name}\n`);
    const results = evaluateGame(game);
    for (const r of results) {
      console.log(`=== ${r.team} ===`);
      console.log(`  実際のPTS: ${r.actualPts} / PProd合計: ${r.pprodSum.toFixed(1)} / 差: ${r.diff.toFixed(1)}`);
    }

    console.log("\n選手別ORtg/DRtg:");
    for (const side of ["home", "away"] as const) {
      const rows = side === "home" ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
      const oppRows = side === "home" ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
      const totalRow = teamTotalRow(rows);
      const oppTotalRow = teamTotalRow(oppRows);
      if (!totalRow || !oppTotalRow) continue;
      const teamBox = toOliverBox(totalRow);
      const oppBox = toOliverBox(oppTotalRow);
      const teamPossessions = estimatedPossessions(
        { fga: teamBox.fga, fgm: teamBox.fgm, fta: teamBox.fta, oreb: teamBox.oreb, dreb: teamBox.dreb, tov: teamBox.tov },
        { fga: oppBox.fga, fgm: oppBox.fgm, fta: oppBox.fta, oreb: oppBox.oreb, dreb: oppBox.dreb, tov: oppBox.tov },
      );
      for (const p of playerGameRows(rows)) {
        if (p.PlayTime === "DNP") continue;
        const playerBox = toOliverBox(p);
        const offRtg = individualOffRtg(playerBox, teamBox, oppBox);
        const defRtg = individualDefRtg(playerBox, teamBox, oppBox, teamPossessions);
        const netRtg = offRtg !== undefined && defRtg !== undefined ? offRtg - defRtg : undefined;
        console.log(
          `  ${p.PlayerNameJ}（${p.TeamNameJ}）: MIN=${p.PlayTime} PTS=${p.Point} ORtg=${offRtg?.toFixed(1) ?? "-"} ` +
            `DRtg=${defRtg?.toFixed(1) ?? "-"} NetRtg=${netRtg?.toFixed(1) ?? "-"}`,
        );
      }
    }
    return;
  }

  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : "2025-26";
  if (!season) {
    console.error("使い方: validate-oliver-ratings.ts --season 2025-26");
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

  const diffs = allResults.map((r) => r.diff);
  const relDiffs = allResults.map((r) => (r.actualPts === 0 ? 0 : r.diff / r.actualPts));
  const allOffRtgs = allResults.flatMap((r) => r.playerOffRtgs);
  const allDefRtgs = allResults.flatMap((r) => r.playerDefRtgs);

  console.log("===== PProd合計 vs 実際のPTS（チーム×試合単位）=====");
  console.log(`対象: ${allResults.length}チーム×試合`);
  console.log(`平均絶対誤差: ${meanAbs(diffs).toFixed(2)}点`);
  console.log(`平均誤差（符号あり・偏りの確認用）: ${mean(diffs).toFixed(2)}点`);
  console.log(`平均相対誤差: ${(mean(relDiffs) * 100).toFixed(2)}%`);
  console.log(`平均絶対相対誤差: ${(meanAbs(relDiffs) * 100).toFixed(2)}%`);

  const buckets = [1, 2, 5, 10];
  console.log("\n===== 誤差の分布（点差）=====");
  for (const b of buckets) {
    const within = diffs.filter((d) => Math.abs(d) <= b).length;
    console.log(`  ±${b}点以内: ${within}/${diffs.length} = ${((within / diffs.length) * 100).toFixed(1)}%`);
  }

  const sorted = [...allResults].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  console.log("\n===== PProd誤差が大きい上位10件 =====");
  for (const r of sorted.slice(0, 10)) {
    console.log(`  ${r.scheduleKey} ${r.team}: 実PTS=${r.actualPts} PProd合計=${r.pprodSum.toFixed(1)} 差=${r.diff.toFixed(1)}`);
  }

  console.log("\n===== 個人ORtg/DRtgの分布（外れ値チェック） =====");
  console.log(`ORtg: min=${Math.min(...allOffRtgs).toFixed(1)} max=${Math.max(...allOffRtgs).toFixed(1)} 平均=${mean(allOffRtgs).toFixed(1)}`);
  console.log(`DRtg: min=${Math.min(...allDefRtgs).toFixed(1)} max=${Math.max(...allDefRtgs).toFixed(1)} 平均=${mean(allDefRtgs).toFixed(1)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
