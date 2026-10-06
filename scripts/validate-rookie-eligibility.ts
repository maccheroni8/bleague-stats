// ルーキーの判定（shared/rookieEligibility.ts。DESIGN.md 214章）の検証スクリプト（検証専用。CIには入れず、必要なときに手で実行する）。
// 導出データ（`npm run build:data` で作る）と、取得済みの所属履歴（data/player-club-history.json）を読む。
//
// 出力:
//  1. シーズンごとの対象人数（履歴を使わない判定／履歴を使った判定／履歴で外れた人数）
//  2. 判定不能で対象から外した選手（理由・氏名・選手ID）
//  3. 履歴で外れた選手（B2・B3で先に登録されていた選手）の人数をシーズンごとに（B1の最初の登録シーズンで数える）と、一覧
//  4. 2017-18〜2025-26の最優秀新人賞の受賞者が、受賞したシーズンに対象に入っているか（入っていなければ終了コード1）
//
// 使い方: npm run validate:rookie-eligibility

import { loadRookieInputs } from "./lib/rookieInputs.ts";
import { judgeRookie, FIRST_LEAGUE_SEASON } from "../shared/rookieEligibility.ts";

const REASON_LABEL: Record<string, string> = {
  "no-birth-date": "生年月日が読めない",
  "no-history": "所属履歴が未取得",
  "history-lacks-first-season": "所属履歴にB1の最初の登録シーズンが載っていない",
};

async function main(): Promise<void> {
  const { players, names, historyCount } = await loadRookieInputs();
  const nameOf = (id: string) => `${names.get(id) ?? "(名前不明)"}（${id}）`;
  const seasons = [...new Set([...players.values()].flatMap((p) => p.registeredSeasons))].sort().filter((s) => s !== FIRST_LEAGUE_SEASON);

  const before = new Map<string, Set<string>>(); // 履歴を使わない判定
  const after = new Map<string, Set<string>>(); // 履歴を使った判定
  const removedByHistory = new Map<string, string[]>(); // B1の最初の登録シーズン → 履歴で外れた選手
  const undeterminable: { id: string; reason: string }[] = [];
  const earlierDetail: string[] = [];
  for (const s of seasons) {
    before.set(s, new Set());
    after.set(s, new Set());
  }
  for (const [id, input] of players) {
    const b = judgeRookie(input, { useHistory: false });
    if (b.status === "judged") for (const s of b.seasons) before.get(s)?.add(id);
    const a = judgeRookie(input);
    if (a.status === "judged") for (const s of a.seasons) after.get(s)?.add(id);
    if (a.status === "undeterminable") undeterminable.push({ id, reason: a.reason });
    if (a.status === "registered-earlier") {
      const first = input.registeredSeasons[0]!;
      (removedByHistory.get(first) ?? removedByHistory.set(first, []).get(first)!).push(id);
      earlierDetail.push(`  ${first} ${nameOf(id)}: 履歴の最初は ${a.firstHistorySeason}（${input.history!.filter((h) => h.season === a.firstHistorySeason).map((h) => h.club).join("・")}）`);
    }
  }

  console.log(`所属履歴を取得できている選手: ${historyCount}名`);
  console.table(
    seasons.map((s) => ({
      シーズン: s,
      "対象（履歴を使わない）": before.get(s)!.size,
      "対象（履歴を使う）": after.get(s)!.size,
      "履歴で外れた": [...before.get(s)!].filter((id) => !after.get(s)!.has(id)).length,
      "うちB2・B3で先に登録（初登録の年で数える）": removedByHistory.get(s)?.length ?? 0,
    })),
  );

  console.log(`\n判定不能で対象から外した選手: ${undeterminable.length}名`);
  for (const u of undeterminable) console.log(`  ${nameOf(u.id)}: ${REASON_LABEL[u.reason] ?? u.reason}`);

  const earlierTotal = [...removedByHistory.values()].reduce((a, v) => a + v.length, 0);
  console.log(`\n履歴の取り直しで対象から外れた選手（B2・B3で先に登録されていた）: ${earlierTotal}名`);
  for (const line of earlierDetail) console.log(line);

  // 最優秀新人賞の受賞者が、受賞したシーズンに対象に入っているか
  let failed = false;
  console.log("\n最優秀新人賞の受賞者（2017-18〜）");
  for (const s of seasons) {
    for (const [id, input] of players) {
      if (!input.rookieAwardSeasons.has(s)) continue;
      const hit = after.get(s)!.has(id);
      if (!hit) failed = true;
      console.log(`  ${s} ${nameOf(id)}: ${hit ? "対象に入っている" : `入っていない（${JSON.stringify(judgeRookie(input))}）`}`);
    }
  }
  if (failed) process.exitCode = 1;
  console.log(failed ? "結果: 受賞者が対象から漏れている" : "結果: 受賞者は全員対象に入っている");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
