// data/rookie-eligibility.json（ルーキーの対象シーズン。導出データ）を作る（DESIGN.md 214章）。
// 判定は shared/rookieEligibility.ts（B.LEAGUEの新人賞の対象要件に準じた近似）。入力は scripts/lib/rookieInputs.ts が data/ から集める
// （選手のキャリア・選手の試合ログ・選手マスタ・最優秀新人賞の受賞・クラブ所属履歴）。デプロイのときの全シーズンをまたぐ集計（build-data.ts）で毎回作る。
// 履歴が取れていない選手は「判定不能」として対象から外し、理由を undeterminable に残す（履歴が取れた次の集計で判定に戻る）。
//
// 使い方: node --experimental-strip-types scripts/aggregate-rookie-eligibility.ts

import path from "node:path";
import { DATA_DIR, writeJsonIfChanged } from "./lib/storage.ts";
import { loadRookieInputs } from "./lib/rookieInputs.ts";
import { judgeRookie } from "../shared/rookieEligibility.ts";
import type { RookieEligibilityFile } from "../shared/types.ts";

async function main(): Promise<void> {
  const { players } = await loadRookieInputs();
  const bySeason = new Map<string, string[]>();
  const undeterminable: Record<string, string> = {};
  for (const [playerId, input] of [...players].sort(([a], [b]) => a.localeCompare(b))) {
    const j = judgeRookie(input);
    if (j.status === "undeterminable") undeterminable[playerId] = j.reason;
    if (j.status !== "judged") continue;
    for (const season of j.seasons) (bySeason.get(season) ?? bySeason.set(season, []).get(season)!).push(playerId);
  }
  const file: RookieEligibilityFile = {
    generatedAt: new Date().toISOString(),
    seasons: Object.fromEntries([...bySeason].sort(([a], [b]) => a.localeCompare(b))),
    undeterminable,
  };
  await writeJsonIfChanged(path.join(DATA_DIR, "rookie-eligibility.json"), file as unknown as Record<string, unknown>);
  const counts = Object.entries(file.seasons).map(([s, ids]) => `${s}:${ids.length}`).join(" ");
  console.log(`ルーキーの対象 ${counts}／判定不能 ${Object.keys(undeterminable).length}名`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
