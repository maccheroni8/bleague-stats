// shared/assistedScoring.tsの精度検証スクリプト（UIには一切関与しない、検証専用）。
//
// アシストイベント（ActionCD1=12）自体にはどの得点に紐づくかを示すタグが無く、
// PlayByPlays配列内の構造的な隣接パターン（バックワードスキャン）でペアリングしている
// （DESIGN.md該当章の調査参照）。ここでは以下2点を検証する:
// 1. マッチ率: 全アシストイベントのうち、実際に得点イベントとペアリングできた割合
//    （調査時点で全10シーズン中6シーズン100%・残り4シーズン99.88%〜99.97%を確認済み。
//    このスクリプトはその結果を継続的に再確認するための回帰チェック）
// 2. 内部整合性: 得点者単位（byScorer）の合計とペア単位（pairs）の合計が一致するか
//    （同じマッチ結果から2通りの集計をしているだけなので理論上必ず一致するはずだが、
//    実装ミスが無いことの確認として実施）
//
// 使い方:
//   node --experimental-strip-types scripts/validate-assisted-scoring.ts --season 2025-26
//   node --experimental-strip-types scripts/validate-assisted-scoring.ts --season 2025-26 --category one

import { readAllGames } from "./lib/storage.ts";
import { computeAssistedScoring } from "../shared/assistedScoring.ts";
import type { Category } from "../shared/types.ts";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : "2025-26";
  const categoryIndex = args.indexOf("--category");
  const category: Category = categoryIndex !== -1 ? (args[categoryIndex + 1] as Category) : "premier";
  if (!season) {
    console.error("使い方: validate-assisted-scoring.ts --season 2025-26 [--category one]");
    process.exitCode = 1;
    return;
  }

  const games = (await readAllGames(season, category)).filter((g) => g.gameEndedFlg);
  console.log(`[${season}/${category}] 検証対象: ${games.length}試合（終了済みのみ）\n`);

  let totalAssistEvents = 0;
  let totalMatched = 0;
  let consistencyMismatches = 0;

  for (const game of games) {
    const pbp = game.raw.PlayByPlays;
    const assistEventCount = pbp.filter((e) => e.ActionCD1 === 12).length;
    const { byScorer, pairs } = computeAssistedScoring(pbp);

    const byScorerTotal = [...byScorer.values()].reduce((sum, c) => sum + c.assisted2m + c.assisted3m + c.assistedFtm, 0);
    const pairsTotal = [...pairs.values()].reduce((sum, p) => sum + p.count, 0);
    if (byScorerTotal !== pairsTotal) {
      consistencyMismatches++;
      console.log(`  ⚠ byScorer合計とpairs合計が不一致 [${game.scheduleKey}] byScorer=${byScorerTotal} pairs=${pairsTotal}`);
    }

    totalAssistEvents += assistEventCount;
    totalMatched += byScorerTotal;
  }

  const matchRate = totalAssistEvents > 0 ? (totalMatched / totalAssistEvents) * 100 : 0;
  console.log("===== 全体集計 =====");
  console.log(`試合数: ${games.length}`);
  console.log(`アシストイベント総数: ${totalAssistEvents}`);
  console.log(`得点ペアリング成功数: ${totalMatched}`);
  console.log(`マッチ率: ${matchRate.toFixed(4)}%`);
  console.log(`内部整合性（byScorer⇔pairs）の不一致: ${consistencyMismatches}件`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
