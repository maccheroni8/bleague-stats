// 個人詳細「誰へのアシストが多いか」の数え方（src/lib/assistDistribution.ts）の検証。
//
// 1. PBP のアシストの数（相手不明を含む）が、ボックススコアの公式 AST と合うか（試合全体・ピリオドごと）。
//    合わない選手・試合は一覧に出す（公式の記録のずれは許容し、件数が基準を超えたら失敗）
// 2. 相手の見つかったアシストの数が、アシストされた得点の集計（shared/assistedScoring.ts）と合うか
//    （FG へのアシスト＝被アシストの 2P＋3P 成功数、FT へのアシスト ≦ 被アシストの FT 成功数）。
//    たどり方を片方だけ変えたら、ここで失敗する
// 3. 割合の合計（相手不明を含む）が100%になること、分母0は null になること
//
// 使い方:
//   node --experimental-strip-types scripts/validate-assist-distribution.ts
//   node --experimental-strip-types scripts/validate-assist-distribution.ts --season 2025-26 --verbose

import { existsSync } from "node:fs";
import { readAllGames, gamesDir } from "./lib/storage.ts";
import { isManualBoxscoreKey } from "./lib/manualBoxscores.ts";
import { computeAssistedScoring } from "../shared/assistedScoring.ts";
import { countAssistDistribution, assistSharePct, emptyAssistDistribution, addAssistDistribution } from "../src/lib/assistDistribution.ts";
import type { BoxscoreRow, Category } from "../shared/types.ts";

const ALL_SEASONS = ["2016-17", "2017-18", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"];
// 公式の記録のずれで PBP の数と AST が合わない選手・試合の上限（全シーズン合計。見つかった件数より少し多めの値）
const MAX_GAME_MISMATCH_ROWS = 400;

interface Mismatch {
  season: string;
  key: string;
  playerId: string;
  name: string;
  scope: string;
  official: number;
  pbp: number;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonArg = args.includes("--season") ? args[args.indexOf("--season") + 1] : null;
  const verbose = args.includes("--verbose");
  const seasons = seasonArg ? [seasonArg] : ALL_SEASONS;
  const failures: string[] = [];
  const mismatches: Mismatch[] = [];
  const periodMismatches: Mismatch[] = [];
  let gamesChecked = 0;
  let gamesSkippedNoPbp = 0;
  let playerRows = 0;
  let assistsOfficial = 0;
  let assistsPbp = 0;
  let unknownTotal = 0;

  for (const season of seasons) {
    for (const category of ["premier", "one"] as Category[]) {
      if (!existsSync(gamesDir(season, category))) continue;
      const games = (await readAllGames(season, category)).filter((g) => g.gameEndedFlg);
      for (const game of games) {
        const key = String(game.scheduleKey);
        const pbp = game.raw.PlayByPlays ?? [];
        if (isManualBoxscoreKey(key) || pbp.length === 0) {
          gamesSkippedNoPbp++;
          continue;
        }
        gamesChecked++;
        const rows: BoxscoreRow[] = [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores].filter((r) => r.Category === 1 && r.PlayerID);
        const whole = countAssistDistribution(pbp);

        // 1. 試合全体
        for (const r of rows.filter((r) => r.PeriodCategory === 18)) {
          playerRows++;
          const d = whole.get(r.PlayerID);
          const pbpCount = d?.total ?? 0;
          assistsOfficial += r.AS;
          assistsPbp += pbpCount;
          unknownTotal += d?.unknown ?? 0;
          if (pbpCount !== r.AS) mismatches.push({ season, key, playerId: r.PlayerID, name: r.PlayerNameJ, scope: "試合", official: r.AS, pbp: pbpCount });
        }
        // PBP にだけいる選手（ボックススコアに行の無いアシスト）
        const boxIds = new Set(rows.map((r) => r.PlayerID));
        for (const [pid, d] of whole) {
          if (!boxIds.has(pid)) mismatches.push({ season, key, playerId: pid, name: "(ボックススコアに無い)", scope: "試合", official: 0, pbp: d.total });
        }
        // 1. ピリオドごと
        const periodRows = rows.filter((r) => r.PeriodCategory !== 18 && r.PeriodCategory >= 1 && r.PeriodCategory <= 10);
        const byPeriod = new Map<number, ReturnType<typeof countAssistDistribution>>();
        for (const r of periodRows) {
          if (!byPeriod.has(r.PeriodCategory)) byPeriod.set(r.PeriodCategory, countAssistDistribution(pbp, [r.PeriodCategory]));
          const pbpCount = byPeriod.get(r.PeriodCategory)!.get(r.PlayerID)?.total ?? 0;
          if (pbpCount !== r.AS) periodMismatches.push({ season, key, playerId: r.PlayerID, name: r.PlayerNameJ, scope: `P${r.PeriodCategory}`, official: r.AS, pbp: pbpCount });
        }

        // 2. アシストされた得点の集計との一致
        const pairs = computeAssistedScoring(pbp).pairs;
        for (const pair of pairs.values()) {
          const d = whole.get(pair.assisterId) ?? emptyAssistDistribution();
          const events = d.byScorer.get(pair.scorerId) ?? 0;
          const ftEvents = d.ftByScorer.get(pair.scorerId) ?? 0;
          if (events - ftEvents !== pair.assisted2m + pair.assisted3m || ftEvents > pair.assistedFtm || (pair.assistedFtm > 0 && ftEvents === 0)) {
            failures.push(`${season} ${key} ${pair.assisterId}→${pair.scorerId}: FG ${events - ftEvents}/${pair.assisted2m + pair.assisted3m}・FT ${ftEvents}/${pair.assistedFtm}`);
          }
        }
        for (const [aid, d] of whole) {
          for (const sid of d.byScorer.keys()) {
            if (!pairs.has(`${aid}:${sid}`)) failures.push(`${season} ${key} ${aid}→${sid}: アシストされた得点の集計に無い組`);
          }
        }
        // 3. 割合の合計
        for (const d of whole.values()) {
          const sum = [...d.byScorer.values()].reduce((s, v) => s + v, 0) + d.unknown;
          if (sum !== d.total) failures.push(`${season} ${key}: 相手ごと＋相手不明の合計 ${sum} が合計 ${d.total} と違う`);
        }
      }
    }
  }

  const sumCheck = emptyAssistDistribution();
  addAssistDistribution(sumCheck, { total: 2, byScorer: new Map([["a", 1]]), ftByScorer: new Map(), unknown: 1 });
  if (assistSharePct(0, 0) !== null || assistSharePct(1, sumCheck.total) !== 50) failures.push("割合の計算（分母0は null・1/2＝50%）");

  console.log(`対象: ${gamesChecked}試合（PBP の無い試合 ${gamesSkippedNoPbp} は除く）・選手の行 ${playerRows}`);
  console.log(`アシスト: 公式 AST ${assistsOfficial}・PBP ${assistsPbp}（うち相手不明 ${unknownTotal}）`);
  const gamesWithMismatch = new Set(mismatches.map((m) => `${m.season}:${m.key}`));
  console.log(`試合全体で合わない選手の行: ${mismatches.length}（${gamesWithMismatch.size}試合）`);
  const bySeason = new Map<string, number>();
  for (const m of mismatches) bySeason.set(m.season, (bySeason.get(m.season) ?? 0) + 1);
  console.log(`  シーズン別: ${[...bySeason].map(([s, n]) => `${s} ${n}`).join("・") || "なし"}`);
  const periodGames = new Set(periodMismatches.map((m) => `${m.season}:${m.key}`));
  console.log(`ピリオドごとで合わない選手の行: ${periodMismatches.length}（${periodGames.size}試合）`);
  if (verbose) {
    for (const m of mismatches) console.log(`  ${m.season} ${m.key} ${m.name}(${m.playerId}) ${m.scope}: 公式 ${m.official}・PBP ${m.pbp}`);
    for (const m of periodMismatches.slice(0, 200)) console.log(`  ${m.season} ${m.key} ${m.name}(${m.playerId}) ${m.scope}: 公式 ${m.official}・PBP ${m.pbp}`);
  }
  if (!seasonArg && mismatches.length > MAX_GAME_MISMATCH_ROWS) failures.push(`公式 AST と合わない行が上限 ${MAX_GAME_MISMATCH_ROWS} を超えた（${mismatches.length}）`);

  if (failures.length > 0) {
    console.error(`\n失敗 ${failures.length}件`);
    for (const f of failures.slice(0, 30)) console.error(`  ${f}`);
    process.exitCode = 1;
    return;
  }
  console.log("\nOK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
