// ルーキーの判定（shared/rookieEligibility.ts。規程 第5条〔新人選手〕に準じる。DESIGN.md 215章）の検証スクリプト（検証専用。CIには入れず、必要なときに手で実行する）。
// 導出データ（`npm run build:data` で作る）と、取得済みの所属履歴（data/player-club-history.json）を読む。
//
// 出力:
//  1. シーズンごとの人数（ルーキー全体・うち2年目以降＝延長で対象になった選手）
//  2. 判定不能で対象から外した選手（理由・氏名・選手ID）
//  3. 履歴で外れた選手（B2・B3で先に登録されていた選手）の人数と一覧
//  4. 延長で2年目以降も対象になった選手の例（シーズンごとの出場試合数・チームの試合数つき）
//  5. 最優秀新人賞の受賞者（2017-18〜）が、受賞したシーズンにルーキーに入っているか（入っていない場合は理由。規程の定義では入らないことがある。結果は参考で、終了コードには影響しない）
//
// 使い方: npm run validate:rookie-eligibility

import path from "node:path";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { loadRookieInputs } from "./lib/rookieInputs.ts";
import { judgeRookie, FIRST_LEAGUE_SEASON } from "../shared/rookieEligibility.ts";
import type { PlayerAwardsFile } from "../shared/types.ts";

const REASON_LABEL: Record<string, string> = {
  "no-classification": "登録区分が読めない",
  "no-birth-date": "生年月日が読めない（延長の判定に必要）",
  "no-history": "所属履歴が未取得",
  "history-lacks-first-season": "所属履歴にB1の最初の登録シーズンが載っていない",
};

async function main(): Promise<void> {
  const { players, names, historyCount } = await loadRookieInputs();
  const awards = (await readJson<PlayerAwardsFile>(path.join(DATA_DIR, "player-awards.json"))) ?? {};
  const nameOf = (id: string) => `${names.get(id) ?? "(名前不明)"}（${id}）`;
  const seasons = [...new Set([...players.values()].flatMap((p) => p.registeredSeasons))].sort().filter((s) => s !== FIRST_LEAGUE_SEASON);

  const all = new Map<string, Set<string>>(); // シーズン → ルーキー
  const extended = new Map<string, Set<string>>(); // シーズン → うち2年目以降
  for (const s of seasons) {
    all.set(s, new Set());
    extended.set(s, new Set());
  }
  const undeterminable: { id: string; reason: string }[] = [];
  const earlier: { first: string; id: string; line: string }[] = [];
  const extendedExamples: string[] = [];
  for (const [id, input] of players) {
    const j = judgeRookie(input);
    if (j.status === "judged") {
      for (const s of j.seasons) all.get(s)?.add(id);
      for (const s of j.extendedSeasons) extended.get(s)?.add(id);
      if (j.extendedSeasons.length > 0) {
        const detail = j.seasons
          .map((s) => {
            const g = input.games[s];
            return `${s}（${g ? `${g.gamesPlayed}試合出場／チーム${g.teamGames}試合` : "試合の記録なし"}）`;
          })
          .join(" → ");
        extendedExamples.push(`  ${nameOf(id)}: ${detail}`);
      }
    }
    if (j.status === "undeterminable") undeterminable.push({ id, reason: j.reason });
    if (j.status === "registered-earlier") {
      const first = input.registeredSeasons[0]!;
      earlier.push({
        first,
        id,
        line: `  ${first} ${nameOf(id)}: 履歴の最初は ${j.firstHistorySeason}（${input.history!.filter((h) => h.season === j.firstHistorySeason).map((h) => h.club).join("・")}）`,
      });
    }
  }

  console.log(`所属履歴を取得できている選手: ${historyCount}名`);
  console.table(
    seasons.map((s) => ({
      シーズン: s,
      ルーキー: all.get(s)!.size,
      "うち2年目以降（延長）": extended.get(s)!.size,
      "うち初めての登録の年": all.get(s)!.size - extended.get(s)!.size,
      "B2・B3で先に登録されていて外れた（初登録の年で数える）": earlier.filter((e) => e.first === s).length,
    })),
  );

  console.log(`\n判定不能で対象から外した選手: ${undeterminable.length}名`);
  for (const u of undeterminable) console.log(`  ${nameOf(u.id)}: ${REASON_LABEL[u.reason] ?? u.reason}`);

  console.log(`\nB2・B3で先に登録されていたため、B1ではルーキーとしない選手: ${earlier.length}名`);
  for (const e of earlier) console.log(e.line);

  console.log(`\n延長で2年目以降も対象になった選手: ${extendedExamples.length}名`);
  for (const line of extendedExamples) console.log(line);

  console.log("\n最優秀新人賞の受賞者（2017-18〜）");
  for (const s of seasons) {
    for (const [id, input] of players) {
      if (!(awards[id] ?? []).some((a) => a.name === "最優秀新人賞" && a.season === s)) continue;
      const hit = all.get(s)!.has(id);
      console.log(`  ${s} ${nameOf(id)}: ${hit ? "ルーキーに入っている" : `入っていない（${JSON.stringify(judgeRookie(input))}）`}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
