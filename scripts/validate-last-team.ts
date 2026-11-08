// ランキング（個人）の通算・歴代の行の「最終所属：〇〇」の書き方（DESIGN.md 357章）の検証スクリプト（検証専用）。
//  1. 判定（isLastTeamRow）: 最後のシーズンが今季で名簿にいる → 今季の行／最後のシーズンが過去 → 最終所属（名簿にいても）／今季でも名簿に無い → 最終所属／
//     名簿が読めない間は最後のシーズンだけで判定／複数の選手の行は全員が今季のときだけ今季の行
//  2. 書き方: チーム名とシーズンの範囲を出す5つの一覧（達成記録・通算記録・勝負所・アシストペア・On/Off）が LastTeamName を通し、
//     名前の下の行にチーム名を出す表では、保存画像（写真なし）の名前の横にチーム略称（exportTeam）を足さない（重複させない）
import { readFileSync } from "node:fs";
import { isLastTeamRow } from "../src/lib/lastTeamRule.ts";

const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (!ok) failures.push(name);
};

const S = "2026-27";
const active = new Set(["a", "b"]);
check("今季・名簿にいる", isLastTeamRow(S, ["a"], active, S) === false);
check("過去の最後のシーズンは名簿にいても最終所属（別リーグ・移籍後）", isLastTeamRow("2025-26", ["a"], active, S) === true);
check("今季でも名簿に無い", isLastTeamRow(S, ["z"], active, S) === true);
check("名簿が読めない間は最後のシーズンだけで判定（今季）", isLastTeamRow(S, ["z"], null, S) === false);
check("名簿が読めない間は最後のシーズンだけで判定（過去）", isLastTeamRow("2023-24", ["a"], null, S) === true);
check("組み合わせは全員が今季のときだけ今季の行", isLastTeamRow(S, ["a", "b"], active, S) === false && isLastTeamRow(S, ["a", "z"], active, S) === true);

const files = ["ThresholdLists", "CareerRecordRanking", "PlayerClutchRanking", "AssistPairRanking", "PlayerLineupRanking"];
for (const f of files) {
  const src = readFileSync(`src/components/${f}.tsx`, "utf8");
  check(`${f}: LastTeamName を使う`, src.includes("<LastTeamName"));
  check(`${f}: 名前の下の行にチーム名を出す表で exportTeam を足さない`, !src.includes("exportTeam="));
}
check("PlayerGameRecordRanking: exportTeam を足さない", !readFileSync("src/components/PlayerGameRecordRanking.tsx", "utf8").includes("exportTeam="));
check("在籍確認の文言は最終所属の書き方とセット", !/[^>}]シーズンまで在籍確認/.test(readFileSync("src/components/CareerRecordRanking.tsx", "utf8").replace(/\{r\.info\.latestSeason\}シーズンまで在籍確認/, "")));

if (failures.length) {
  console.error(`NG ${failures.length}件:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("OK: 最終所属の書き方");
