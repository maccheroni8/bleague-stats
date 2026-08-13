// Phase 4「在コート状態の復元」の精度検証スクリプト（UIには一切関与しない、検証専用）。
//
// data/{season}/games/*.json（終了済み試合）全件に対しshared/onCourt.tsの復元ロジックを走らせ、
// 以下を集計・報告する:
//   1. 在コート人数チェック（常にちょうど5人になっているか。崩れの警告件数）
//   2. 選手ごとの在コート合計時間 vs ボックススコアのMIN（±6秒/0.1分以内の一致率）
//   3. 復元ロジックから再計算した個人+/- vs 公式PLUSMINUSフィールドの完全一致率
//   4. ラインナップスティント（同じ5人の在コート区間）の整合性チェック（DESIGN.md参照）:
//      a. 1試合内、あるチームの全スティント時間の合計 == 試合時間（40分+OT）
//      b. 1試合内、あるチームの全スティント純得失点の合計 == そのチームの最終得失点差
//
// 使い方: node --experimental-strip-types scripts/validate-oncourt.ts --season 2025-26

import { readAllGames } from "./lib/storage.ts";
import { reconstructOnCourt, substitutionModelForSeason, totalGameSeconds, totalOnCourtSeconds } from "../shared/onCourt.ts";
import { parsePlayTime } from "../shared/formulas.ts";
import type { BoxscoreRow, StoredGame } from "../shared/types.ts";

const MIN_TOLERANCE_SEC = 6; // ±0.1分

interface GameReport {
  scheduleKey: string;
  homeTeam: string;
  awayTeam: string;
  hasOT: boolean;
  warningCount: number;
  warningsByType: Record<string, number>;
  playerCount: number;
  playedPlayerCount: number;
  minMatchWithinTolerance: number;
  minMismatchDetails: { name: string; team: string; officialMin: number; reconstructedMin: number; diffSec: number }[];
  plusMinusMatchCount: number;
  plusMinusMismatchDetails: { name: string; team: string; official: number; reconstructed: number }[];
  lineupTimeMismatches: { team: string; expectedSec: number; actualSec: number }[];
  lineupNetMismatches: { team: string; expectedNet: number; actualNet: number }[];
  lineupCount: number;
}

function playerRows(rows: BoxscoreRow[]): BoxscoreRow[] {
  return rows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
}

function evaluateGame(game: StoredGame): GameReport {
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

  const warningsByType: Record<string, number> = {};
  for (const w of result.warnings) {
    warningsByType[w.type] = (warningsByType[w.type] ?? 0) + 1;
  }

  const onCourtSeconds = totalOnCourtSeconds(result.intervals);
  const allPlayers = [...playerRows(game.raw.HomeBoxscores), ...playerRows(game.raw.AwayBoxscores)];

  let minMatchWithinTolerance = 0;
  let playedPlayerCount = 0;
  const minMismatchDetails: GameReport["minMismatchDetails"] = [];
  let plusMinusMatchCount = 0;
  const plusMinusMismatchDetails: GameReport["plusMinusMismatchDetails"] = [];

  for (const row of allPlayers) {
    const officialSec = Math.round(parsePlayTime(row.PlayTime) * 60);
    const reconstructedSec = Math.round(onCourtSeconds[row.PlayerID] ?? 0);
    if (row.PlayTime !== "DNP") {
      playedPlayerCount += 1;
      const diffSec = Math.abs(officialSec - reconstructedSec);
      if (diffSec <= MIN_TOLERANCE_SEC) {
        minMatchWithinTolerance += 1;
      } else {
        minMismatchDetails.push({
          name: row.PlayerNameJ,
          team: row.TeamNameJ,
          officialMin: officialSec / 60,
          reconstructedMin: reconstructedSec / 60,
          diffSec,
        });
      }
    }

    const officialPM = row.PLUSMINUS ?? 0;
    const reconstructedPM = result.plusMinus[row.PlayerID] ?? 0;
    if (officialPM === reconstructedPM) {
      plusMinusMatchCount += 1;
    } else {
      plusMinusMismatchDetails.push({
        name: row.PlayerNameJ,
        team: row.TeamNameJ,
        official: officialPM,
        reconstructed: reconstructedPM,
      });
    }
  }

  const gameSeconds = totalGameSeconds(periods);
  const lineupTimeMismatches: GameReport["lineupTimeMismatches"] = [];
  const lineupNetMismatches: GameReport["lineupNetMismatches"] = [];
  const teamNet: Record<string, number> = {
    [homeId]: game.homeScore - game.awayScore,
    [awayId]: game.awayScore - game.homeScore,
  };
  for (const [teamId, teamName] of [
    [homeId, game.homeTeam.name],
    [awayId, game.awayTeam.name],
  ] as const) {
    const stints = result.lineupStints.filter((s) => s.teamId === teamId);
    const totalSec = stints.reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
    if (totalSec !== gameSeconds) {
      lineupTimeMismatches.push({ team: teamName, expectedSec: gameSeconds, actualSec: totalSec });
    }
    const totalNet = stints.reduce((sum, s) => sum + s.netPoints, 0);
    if (totalNet !== teamNet[teamId]) {
      lineupNetMismatches.push({ team: teamName, expectedNet: teamNet[teamId]!, actualNet: totalNet });
    }
  }

  return {
    scheduleKey: game.scheduleKey,
    homeTeam: game.homeTeam.name,
    awayTeam: game.awayTeam.name,
    hasOT: periods > 4,
    warningCount: result.warnings.length,
    warningsByType,
    playerCount: allPlayers.length,
    playedPlayerCount,
    minMatchWithinTolerance,
    minMismatchDetails,
    plusMinusMatchCount,
    plusMinusMismatchDetails,
    lineupTimeMismatches,
    lineupNetMismatches,
    lineupCount: result.lineupStints.length,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : "2025-26";
  if (!season) {
    console.error("使い方: validate-oncourt.ts --season 2025-26");
    process.exitCode = 1;
    return;
  }

  const games = (await readAllGames(season)).filter((g) => g.gameEndedFlg);
  console.log(`[${season}] 検証対象: ${games.length}試合（終了済みのみ）\n`);

  const reports = games.map(evaluateGame);

  let totalWarnings = 0;
  const totalWarningsByType: Record<string, number> = {};
  let totalPlayed = 0;
  let totalMinMatch = 0;
  let totalPlayers = 0;
  let totalPMMatch = 0;
  let totalLineupTimeMismatches = 0;
  let totalLineupNetMismatches = 0;
  let totalLineupTeamChecks = 0;
  let totalLineupStints = 0;

  for (const r of reports) {
    console.log(
      `=== ${r.scheduleKey} ${r.homeTeam} vs ${r.awayTeam}${r.hasOT ? "（OT）" : ""} ===`,
    );
    console.log(`  在コート人数警告: ${r.warningCount}件 ${JSON.stringify(r.warningsByType)}`);
    console.log(
      `  MIN一致（±${MIN_TOLERANCE_SEC}秒以内）: ${r.minMatchWithinTolerance}/${r.playedPlayerCount}人（出場選手のみ）`,
    );
    for (const m of r.minMismatchDetails) {
      console.log(
        `    ✗ MIN不一致: ${m.name}（${m.team}） 公式=${m.officialMin.toFixed(2)}分 復元=${m.reconstructedMin.toFixed(2)}分 差=${m.diffSec}秒`,
      );
    }
    console.log(`  +/-完全一致: ${r.plusMinusMatchCount}/${r.playerCount}人（DNP含む全選手）`);
    for (const m of r.plusMinusMismatchDetails) {
      console.log(`    ✗ +/-不一致: ${m.name}（${m.team}） 公式=${m.official} 復元=${m.reconstructed}`);
    }
    console.log(`  ラインナップスティント: ${r.lineupCount}件`);
    for (const m of r.lineupTimeMismatches) {
      console.log(`    ✗ スティント時間合計不一致: ${m.team} 期待=${m.expectedSec}秒 実際=${m.actualSec}秒`);
    }
    for (const m of r.lineupNetMismatches) {
      console.log(`    ✗ スティント純得失点合計不一致: ${m.team} 期待=${m.expectedNet} 実際=${m.actualNet}`);
    }
    console.log("");

    totalWarnings += r.warningCount;
    for (const [type, count] of Object.entries(r.warningsByType)) {
      totalWarningsByType[type] = (totalWarningsByType[type] ?? 0) + count;
    }
    totalPlayed += r.playedPlayerCount;
    totalMinMatch += r.minMatchWithinTolerance;
    totalPlayers += r.playerCount;
    totalPMMatch += r.plusMinusMatchCount;
    totalLineupTimeMismatches += r.lineupTimeMismatches.length;
    totalLineupNetMismatches += r.lineupNetMismatches.length;
    totalLineupTeamChecks += 2;
    totalLineupStints += r.lineupCount;
  }

  console.log("===== 全体集計 =====");
  console.log(`試合数: ${reports.length}（うちOT: ${reports.filter((r) => r.hasOT).length}）`);
  console.log(`在コート人数警告: 合計${totalWarnings}件 ${JSON.stringify(totalWarningsByType)}`);
  console.log(
    `MIN一致率（±${MIN_TOLERANCE_SEC}秒以内・出場選手のみ）: ${totalMinMatch}/${totalPlayed} = ${((totalMinMatch / totalPlayed) * 100).toFixed(1)}%`,
  );
  console.log(
    `+/-完全一致率（DNP含む全選手）: ${totalPMMatch}/${totalPlayers} = ${((totalPMMatch / totalPlayers) * 100).toFixed(1)}%`,
  );
  console.log(`ラインナップスティント総数: ${totalLineupStints}件`);
  console.log(
    `スティント時間合計一致率（チーム×試合単位）: ${totalLineupTeamChecks - totalLineupTimeMismatches}/${totalLineupTeamChecks} = ${(((totalLineupTeamChecks - totalLineupTimeMismatches) / totalLineupTeamChecks) * 100).toFixed(1)}%`,
  );
  console.log(
    `スティント純得失点合計一致率（チーム×試合単位）: ${totalLineupTeamChecks - totalLineupNetMismatches}/${totalLineupTeamChecks} = ${(((totalLineupTeamChecks - totalLineupNetMismatches) / totalLineupTeamChecks) * 100).toFixed(1)}%`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
