// 勝敗表の確定マーク（data/{season}/playoff-race.json の clinchEvents。DESIGN.md 132章）を、各シーズンの最終順位と
// 突き合わせる検証スクリプト。
//   - 誤った確定: 確定とした種類を、公式の最終順位（タイブレーク適用済み）で実際には達成していないクラブ
//       地区優勝＝地区1位、ホームコート＝地区2位以内、ポストシーズン進出＝出場形式（shared/postseasonFormat.ts）の8クラブ
//   - 取りこぼし（終了済みのシーズンのみ）: 実際に達成したのに確定が記録されていないクラブ
//   - 枠を付ける試合: scheduleKey がそのクラブの試合で、確定日（試合の無い日の確定なら直前の試合）と合っているか
// 事前に npm run aggregate で playoff-race.json を作り直しておくこと。
//
// 使い方: node --experimental-strip-types scripts/validate-playoff-race.ts [--season 2025-26]

import path from "node:path";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { postseasonFormat, postseasonQualifiedTeamIds } from "../shared/postseasonFormat.ts";
import type { GameSummary, PlayoffRaceFile, StandingsSnapshot } from "../shared/types.ts";
import { isMainModule } from "./lib/isMain.ts";

const ALL_SEASONS = [
  "2016-17",
  "2017-18",
  "2018-19",
  "2019-20",
  "2020-21",
  "2021-22",
  "2022-23",
  "2023-24",
  "2024-25",
  "2025-26",
  "2026-27",
];

async function validateSeason(season: string): Promise<{ wrong: number; missed: number; badGame: number }> {
  const race = await readJson<PlayoffRaceFile>(path.join(DATA_DIR, season, "playoff-race.json"));
  const history = await readJson<StandingsSnapshot[]>(path.join(DATA_DIR, season, "standings-history.json"));
  const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
  if (!race || !history || history.length === 0) {
    console.log(`[${season}] データなし`);
    return { wrong: 0, missed: 0, badGame: 0 };
  }
  const events = race.clinchEvents ?? [];
  const final = history.at(-1)!.teams;
  const name = (id: string) => final.find((t) => t.teamId === id)?.teamName ?? race.teams.find((t) => t.teamId === id)?.teamName ?? id;
  // 進行中のシーズン: 「全クラブが規定の試合数を消化した」ときだけ終了済みとみなす
  const complete = race.format === "legacy" || race.teams.every((t) => t.remaining === 0);

  const format = postseasonFormat(season);
  const qualified = format ? postseasonQualifiedTeamIds(final, format) : new Set<string>();
  const achieved = (teamId: string, type: string): boolean => {
    const t = final.find((x) => x.teamId === teamId);
    if (!t) return false;
    if (type === "division") return t.divisionRank === 1;
    if (type === "homeCourt") return (t.divisionRank ?? 99) <= 2;
    return qualified.has(teamId);
  };

  let wrong = 0;
  let badGame = 0;
  for (const e of events) {
    // 誤った確定は、終了済みのシーズンでだけ最終順位と比べられる（進行中は最終順位が未確定）
    if (complete && !achieved(e.teamId, e.type)) {
      wrong++;
      console.log(`  誤った確定: ${e.date} ${name(e.teamId)} ${e.type}`);
    }
    const game = summaries.find((g) => g.scheduleKey === e.scheduleKey);
    const ownGame = game && (game.homeTeamId === e.teamId || game.awayTeamId === e.teamId);
    const dateOk = game && (e.onGameDay ? game.date === e.date : game.date < e.date);
    if (!ownGame || !dateOk) {
      badGame++;
      console.log(`  枠を付ける試合が不正: ${e.date} ${name(e.teamId)} ${e.type} scheduleKey=${e.scheduleKey}`);
    }
  }

  let missed = 0;
  if (complete) {
    const types = [...new Set(events.map((e) => e.type))];
    for (const type of types) {
      for (const t of final) {
        if (achieved(t.teamId, type) && !events.some((e) => e.teamId === t.teamId && e.type === type)) {
          missed++;
          console.log(`  取りこぼし: ${name(t.teamId)} ${type}`);
        }
      }
    }
  }

  const byType = (type: string) => events.filter((e) => e.type === type);
  const summary = (type: string, label: string) => {
    const list = byType(type);
    if (list.length === 0) return null;
    const dashed = list.filter((e) => !e.onGameDay).length;
    const tiebreak = list.filter((e) => e.byTiebreak).length;
    return `${label}${list.length}（最初 ${list[0]!.date} ${name(list[0]!.teamId)}、試合なしの日${dashed}、最終日タイブレーク${tiebreak}）`;
  };
  const parts = [summary("division", "◎地区優勝"), summary("homeCourt", "★ホームコート"), summary("playoffs", "☆進出")].filter(Boolean);
  console.log(
    `[${season}] ${complete ? "終了済み" : "進行中"} 確定${events.length}件 ／ 誤った確定${wrong}・取りこぼし${missed}・試合の対応付け不正${badGame}` +
      (parts.length > 0 ? `\n  ${parts.join(" ／ ")}` : "（確定マークの対象外、または確定なし）"),
  );
  return { wrong, missed, badGame };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const seasons = seasonIndex !== -1 ? [args[seasonIndex + 1]!] : ALL_SEASONS;
  let wrong = 0;
  let missed = 0;
  let badGame = 0;
  for (const season of seasons) {
    const r = await validateSeason(season);
    wrong += r.wrong;
    missed += r.missed;
    badGame += r.badGame;
  }
  console.log(`\n合計: 誤った確定${wrong}件・取りこぼし${missed}件・試合の対応付け不正${badGame}件`);
  if (wrong + missed + badGame > 0) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
