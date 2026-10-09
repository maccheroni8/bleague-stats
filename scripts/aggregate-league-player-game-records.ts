// data/league-player-game-records.json（選手一覧「記録」タブの範囲「歴代」・カテゴリ「B.PREMIER（旧B1）レコード」。DESIGN.md 188章）を生成する。
//
// 全シーズンの選手の1試合の記録の上位（shared/playerGameRecords.ts の項目ごとに上位20位、同じ記録はすべて）だけを書き出す。
// 画面が全選手の試合ログを読まずに済むようにするため。項目・成功率の最低試投数・対象の試合は、シーズンごとの記録
// （scripts/aggregate-player-game-records.ts）と同じ。試合区分はレギュラーシーズン・ポストシーズン・合算（オールスター等は対象外）。
// 各行には記録した試合のシーズンを添える。チーム名はその試合のときの名称（試合一覧の名称）。ワーストは出さない。
//
// 夜間実行（update-stats.yml のディープrecheck）で毎晩作り直す。作った時刻以外が前回と同じならファイルを書き換えない。
//
// 使い方:
//   npm run aggregate:league-player-game-records

import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import { currentPlayerNames } from "../shared/playerName.ts";
import { buildRecordTables, loadSeasonRecordGames, type RecordGame } from "./lib/playerGameRecordsTop.ts";
import type { LeaguePlayerGameRecordsFile, PlayerMasterEntry } from "../shared/types.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;

async function main() {
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
  const games: RecordGame[] = [];
  for (const season of seasons) {
    const g = await loadSeasonRecordGames(season);
    games.push(...g);
    console.log(`${season}: ${g.length}件`);
  }

  // 複数のシーズンをまたぐ表なので、選手名は選手マスタの今の登録名にそろえる（マスタに無い選手は、その試合のシーズンの名前のまま。DESIGN.md 222-5）
  const names = currentPlayerNames((await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? []);
  for (const g of games) g.playerName = names.get(g.playerId) ?? g.playerName;

  const { byGameType, byClassification } = buildRecordTables(games, true);
  const file: LeaguePlayerGameRecordsFile = { generatedAt: new Date().toISOString(), byGameType, byClassification };
  const changed = await writeJsonIfChanged(path.join(DATA_DIR, "league-player-game-records.json"), file as unknown as Record<string, unknown>);
  console.log(changed ? "data/league-player-game-records.json に保存しました" : "内容に変化が無いため書き換えませんでした");
}

await main();
