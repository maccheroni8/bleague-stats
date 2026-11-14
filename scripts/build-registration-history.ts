// 旧B1（2016-17〜2025-26）の登録区分の根拠（docs/registration-history/{season}.json）から、集計に使う最小の区分表
// （data/{season}/registrations.json.gz。元データ）を作る（DESIGN.md 388章）。中身が同じなら書き換えない（保存キーは変わらない）。
// 根拠の区分・切り替えの日付を直したら、これを流して区分表もコミットする（validate:registration-history が食い違いを検出する）。
//   node --experimental-strip-types scripts/build-registration-history.ts
import path from "node:path";
import { DATA_DIR, writeJsonIfChanged } from "./lib/storage.ts";
import { evidenceProblems, minimalRegistrationFile, readEvidence, REGISTRATION_HISTORY_SEASONS } from "./lib/registrationHistory.ts";

let failed = false;
for (const season of REGISTRATION_HISTORY_SEASONS) {
  const evidence = await readEvidence(season);
  const problems = evidenceProblems(evidence);
  if (problems.length > 0) {
    failed = true;
    console.error(`${season}: 根拠の形に問題があります（区分表は書きません）\n  ${problems.slice(0, 20).join("\n  ")}`);
    continue;
  }
  const file = minimalRegistrationFile(evidence);
  const changed = await writeJsonIfChanged(path.join(DATA_DIR, season, "registrations.json"), file as unknown as Record<string, unknown>, []);
  const changes = Object.values(file.players).filter((p) => p.changes?.length).length;
  console.log(`${season}: ${Object.keys(file.players).length}名（途中で区分が変わる${changes}名）${changed ? " 書きました" : " 変化なし"}`);
}
if (failed) process.exit(1);
