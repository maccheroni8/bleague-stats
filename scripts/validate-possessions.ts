// 実際のポゼッションの数え上げ（shared/onCourt.ts の StintCounts。DESIGN.md 204章）の精度検証スクリプト（検証専用）。
//
// data/{season}/games/*.json（終了済み試合）全件で、プレーバイプレーから数えたチームの合計を確かめる:
//   1. ボックススコアのチーム合計との一致（得点・FGM/FGA・3PM/3PA・FTM/FTA・OR・DR・AST・TOV）
//      TOV は、ボックススコアのほうがプレーバイプレーより多い試合がある（記録漏れ）ため、差の件数を別に出す
//   2. スティントに入れられた合計と、試合全体の合計の差（5人を割り出せなかった間に起きた分の取りこぼし）
//   3. 両チームのポゼッションの差の分布（0・±1・±2）
//   4. 推定の式（FGA＋0.44×FTA−OR＋TOV。ボックススコアの値）とのずれの分布
//   5. 暗黙の終わり（記録漏れから判断したポゼッションの終わり）の件数
//   6. 公式のチーム行の POSS（あるシーズンのみ）との差
//
// 使い方: node --experimental-strip-types scripts/validate-possessions.ts --season 2025-26 [--category one]

import { readAllGames } from "./lib/storage.ts";
import { STINT_COUNT_KEYS, onCourtPeriodCount, reconstructOnCourt, substitutionModelForSeason, sumCountsByPeriod, type StintCounts } from "../shared/onCourt.ts";
import type { BoxscoreRow, Category, StoredGame } from "../shared/types.ts";

type BoxKey = "pts" | "fgm" | "fga" | "tpm" | "tpa" | "ftm" | "fta" | "tov" | "or" | "dr" | "ast";
const BOX_KEYS: BoxKey[] = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "or", "dr", "ast", "tov"];

function teamRow(rows: BoxscoreRow[]): BoxscoreRow | undefined {
  return rows.find((r) => r.Category === 3 && r.PeriodCategory === 18) ?? rows.find((r) => r.Category === 2 && r.PeriodCategory === 18);
}

function boxCounts(r: BoxscoreRow): Record<BoxKey, number> {
  return {
    pts: r.Point,
    fgm: r.PT2M + r.PT3M,
    fga: r.PT2A + r.PT3A,
    tpm: r.PT3M,
    tpa: r.PT3A,
    ftm: r.FTM,
    fta: r.FTA,
    or: r.RB_OFF,
    dr: r.RB_DEF,
    ast: r.AS,
    tov: r.TO,
  };
}

function dist(values: number[]): string {
  const m = new Map<number, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(" ");
}
const pct = (n: number, d: number): string => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`);
function quantile(sorted: number[], p: number): number {
  return sorted[Math.floor(p * (sorted.length - 1))] ?? 0;
}

function evaluate(game: StoredGame) {
  const homeId = game.homeTeam.id;
  const awayId = game.awayTeam.id;
  const r = reconstructOnCourt(
    game.raw.PlayByPlays,
    game.raw.HomeBoxscores,
    game.raw.AwayBoxscores,
    homeId,
    awayId,
    onCourtPeriodCount(game.season, game.quarterScores.home.length, game.raw.PlayByPlays),
    substitutionModelForSeason(game.season),
  );
  if (!r.teamTotals) return null;
  const perTeam = [homeId, awayId].map((teamId) => {
    const total = r.teamTotals![teamId]!;
    const stintSum: StintCounts = Object.fromEntries(STINT_COUNT_KEYS.map((k) => [k, 0])) as unknown as StintCounts;
    for (const s of r.lineupStints.filter((x) => x.teamId === teamId)) {
      const sum = sumCountsByPeriod(s.countsByPeriod ?? {});
      for (const k of STINT_COUNT_KEYS) stintSum[k] += sum.own[k];
    }
    const box = teamRow(teamId === homeId ? game.raw.HomeBoxscores : game.raw.AwayBoxscores);
    return { teamId, total, stintSum, box, boxCounts: box ? boxCounts(box) : null };
  });
  return perTeam;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const season = args[args.indexOf("--season") + 1] ?? "2025-26";
  const catIndex = args.indexOf("--category");
  const category = (catIndex !== -1 ? args[catIndex + 1] : "premier") as Category;
  const games = (await readAllGames(season, category)).filter((g) => g.gameEndedFlg && g.raw.PlayByPlays.length > 0);

  const mismatchGames: Record<string, number> = {};
  const mismatchTeamGames: Record<string, number> = {};
  const tovDiffDist: number[] = [];
  const lostByKey: Record<string, number> = {};
  let lostTeamGames = 0;
  const possDiff: number[] = [];
  const gaps: number[] = [];
  const signedGaps: number[] = [];
  let implicitTotal = 0;
  let implicitTeamGames = 0;
  let teamGames = 0;
  let possTotal = 0;
  const officialPossDiff: number[] = [];
  let tovDeficitGames = 0;
  let tovDeficitCovered = 0;
  let implicitWithoutDeficit = 0;

  for (const game of games) {
    const perTeam = evaluate(game);
    if (!perTeam) continue;
    possDiff.push(perTeam[0]!.total.poss - perTeam[1]!.total.poss);
    for (const t of perTeam) {
      teamGames += 1;
      implicitTotal += t.total.implicitEnds;
      if (t.total.implicitEnds > 0) implicitTeamGames += 1;
      possTotal += t.total.poss;
      let lost = false;
      for (const k of STINT_COUNT_KEYS) {
        const d = t.total[k] - t.stintSum[k];
        if (d !== 0) {
          lostByKey[k] = (lostByKey[k] ?? 0) + d;
          lost = true;
        }
      }
      if (lost) lostTeamGames += 1;
      if (!t.boxCounts) continue;
      for (const k of BOX_KEYS) {
        if (t.total[k] !== t.boxCounts[k]) mismatchTeamGames[k] = (mismatchTeamGames[k] ?? 0) + 1;
      }
      tovDiffDist.push(t.boxCounts.tov - t.total.tov);
      const deficit = t.boxCounts.tov - t.total.tov;
      if (deficit > 0) {
        tovDeficitGames += 1;
        if (t.total.implicitEnds >= deficit) tovDeficitCovered += 1;
      } else if (t.total.implicitEnds > 0) {
        implicitWithoutDeficit += 1;
      }
      const b = t.boxCounts;
      const est = b.fga + 0.44 * b.fta - b.or + b.tov;
      gaps.push(Math.abs(t.total.poss - est));
      signedGaps.push(t.total.poss - est);
      if (typeof t.box?.POSS === "number" && t.box.POSS > 0) officialPossDiff.push(t.total.poss - t.box.POSS);
    }
    for (const k of BOX_KEYS) {
      if (perTeam.some((t) => t.boxCounts && t.total[k] !== t.boxCounts[k])) mismatchGames[k] = (mismatchGames[k] ?? 0) + 1;
    }
  }

  const n = possDiff.length;
  console.log(`[${season}${category === "one" ? " one" : ""}] 検証対象: ${n}試合（${teamGames}チーム・試合）`);
  console.log("--- 1. ボックススコアとの一致（チーム・試合ごと。不一致の件数）");
  for (const k of BOX_KEYS) {
    console.log(`  ${k.padEnd(4)}: 不一致 ${mismatchTeamGames[k] ?? 0}チーム・試合 / ${mismatchGames[k] ?? 0}試合${k === "tov" ? "（ボックスのほうが多い。差の分布は下）" : ""}`);
  }
  console.log(`  TOV（ボックス−プレーバイプレーの差）の分布: ${dist(tovDiffDist)}`);
  console.log("--- 2. スティントに入れられた合計と、試合全体の合計の差（5人を割り出せなかった間に起きた分）");
  console.log(`  差のあるチーム・試合: ${lostTeamGames} / ${teamGames}。項目別の取りこぼし合計: ${JSON.stringify(lostByKey)}`);
  console.log("--- 3. 両チームのポゼッションの差（ホーム−アウェイ）");
  console.log(`  分布 ${dist(possDiff)}`);
  console.log(
    `  0: ${pct(possDiff.filter((d) => d === 0).length, n)} / ±1以内: ${pct(possDiff.filter((d) => Math.abs(d) <= 1).length, n)} / ±2以内: ${pct(possDiff.filter((d) => Math.abs(d) <= 2).length, n)} / 3以上: ${pct(possDiff.filter((d) => Math.abs(d) >= 3).length, n)}`,
  );
  const sorted = [...gaps].sort((a, b) => a - b);
  console.log("--- 4. 推定の式（FGA＋0.44×FTA−OR＋TOV。ボックスの値）とのずれ |実際−推定|");
  console.log(
    `  中央 ${quantile(sorted, 0.5).toFixed(2)} / 90%点 ${quantile(sorted, 0.9).toFixed(2)} / 99%点 ${quantile(sorted, 0.99).toFixed(2)} / 最大 ${quantile(sorted, 1).toFixed(2)} / 平均(実際−推定) ${(signedGaps.reduce((a, b) => a + b, 0) / Math.max(1, signedGaps.length)).toFixed(2)}`,
  );
  console.log("--- 5. 暗黙の終わり（記録漏れから判断したポゼッションの終わり）");
  console.log(`  合計 ${implicitTotal}件（1チーム・試合あたり ${(implicitTotal / Math.max(1, teamGames)).toFixed(2)}件、全ポゼッションの ${pct(implicitTotal, possTotal)}）。1件以上あるチーム・試合 ${implicitTeamGames} / ${teamGames}`);
  console.log(
    `  ボックスのTOVがプレーバイプレーより多いチーム・試合 ${tovDeficitGames}件のうち、暗黙の終わりがその不足分以上あった: ${tovDeficitCovered}件。ボックスのTOVと一致しているのに暗黙の終わりがあった: ${implicitWithoutDeficit}件`,
  );
  if (officialPossDiff.length > 0) {
    const s2 = [...officialPossDiff].sort((a, b) => a - b);
    console.log("--- 6. 公式のチーム行の POSS との差（実際−公式）");
    console.log(`  件数 ${officialPossDiff.length}、中央 ${quantile(s2, 0.5)}、5%点 ${quantile(s2, 0.05)}、95%点 ${quantile(s2, 0.95)}、平均 ${(officialPossDiff.reduce((a, b) => a + b, 0) / officialPossDiff.length).toFixed(2)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
