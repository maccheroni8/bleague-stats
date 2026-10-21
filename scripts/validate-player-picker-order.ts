// 比較ページの選手の選択肢の並び（src/lib/playerPickerOrder.ts。DESIGN.md 281章）の検証スクリプト（検証専用）。
//
// 確かめること（data/ にある全シーズン。導出データが無いシーズンは飛ばす）:
// ①選手一覧（players.json）の全員が1回以上出る・選択肢の値（選手ID@チームID）が重ならない
// ②チームの中は出場時間の長い順（同じなら元の並び）で、出場時間0は最後
// ③1人の選手の各チームの出場時間の合計＝その選手の索引の出場時間の合計（移籍した選手はチームごとに分かれる）
// ④チームの並びは、最新の順位表の地区の順（東→中→西）・地区順位の順と同じ
// ⑤試合区分（レギュラー・ポストシーズン・合算）で出場時間が切り替わる（合算＝レギュラー＋ポストシーズン）
//
// 使い方: npm run validate:player-picker-order（src/ のコードを使うため esbuild でまとめて実行する）。食い違いがあれば終了コード1

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { PlayerGameIndexFile } from "../shared/gameIndex";
import type { PlayerSummary, PlayoffRaceFile, StandingsSnapshot } from "../shared/types";
import { buildPlayerPickerGroups, type PickerGroup, minutesByPlayerTeam, pickerPlayerIdOf, pickerTeamOrder } from "../src/lib/playerPickerOrder";
import { DIVISION_ORDER } from "../src/lib/divisionGroups";

const DATA = path.resolve("data");
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failures += 1;
    console.error(`NG ${label} ${detail}`);
  }
}
function readJson<T>(file: string): T | null {
  for (const f of [`${file}.gz`, file]) {
    if (existsSync(f)) return JSON.parse((f.endsWith(".gz") ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString("utf8")) as T;
  }
  return null;
}

const seasons = readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
let checkedSeasons = 0;
for (const season of seasons) {
  const players = readJson<PlayerSummary[]>(path.join(DATA, season, "players.json"));
  const index = readJson<PlayerGameIndexFile>(path.join(DATA, season, "player-game-index.json"));
  if (!players || !index) continue;
  checkedSeasons += 1;
  const standings = readJson<StandingsSnapshot[]>(path.join(DATA, season, "standings-history.json"));
  const race = readJson<PlayoffRaceFile>(path.join(DATA, season, "playoff-race.json"));
  const latest = standings && standings.length > 0 ? standings[standings.length - 1]!.teams : null;
  const teamOrder = pickerTeamOrder(latest, race);
  const indexNames = new Map(index.teams.map((t) => [t[0], t[1]]));

  const totals = new Map<string, number>();
  for (const [key, sec] of minutesByPlayerTeam(index, "both")) totals.set(pickerPlayerIdOf(key), (totals.get(pickerPlayerIdOf(key)) ?? 0) + sec);
  const reg = minutesByPlayerTeam(index, "regular");
  const post = minutesByPlayerTeam(index, "playoff");
  const both = minutesByPlayerTeam(index, "both");
  for (const [k, v] of both) check(`${season} 合算 ${k}`, v === (reg.get(k) ?? 0) + (post.get(k) ?? 0));

  for (const gameType of ["regular", "playoff", "both"] as const) {
    const label = `${season} ${gameType}`;
    const groups: PickerGroup[] = buildPlayerPickerGroups({ players, index, gameType, teamOrder, teamNameOf: (id) => indexNames.get(id) });
    const keys = groups.flatMap((g) => g.entries.map((e) => e.key));
    check(`${label} 値が重ならない`, new Set(keys).size === keys.length);
    const seen = new Set(keys.map(pickerPlayerIdOf));
    for (const p of players) check(`${label} ${p.name} が出る`, seen.has(p.playerId));
    const minutes = minutesByPlayerTeam(index, gameType);
    const order = new Map(players.map((p, i) => [p.playerId, i]));
    for (const g of groups) {
      for (let i = 1; i < g.entries.length; i++) {
        const a = g.entries[i - 1]!;
        const b = g.entries[i]!;
        const ok = a.minSec > b.minSec || (a.minSec === b.minSec && (order.get(a.playerId) ?? 0) <= (order.get(b.playerId) ?? 0));
        check(`${label} ${g.teamName} の並び`, ok, `${a.name}(${a.minSec}) → ${b.name}(${b.minSec})`);
      }
      for (const e of g.entries) check(`${label} ${e.name} の出場時間`, e.minSec === (minutes.get(e.key) ?? 0), `${e.minSec}`);
    }
    // 1人の合計＝索引の合計（その試合区分）
    const perPlayer = new Map<string, number>();
    for (const g of groups) for (const e of g.entries) perPlayer.set(e.playerId, (perPlayer.get(e.playerId) ?? 0) + e.minSec);
    const expected = new Map<string, number>();
    for (const [k, v] of minutes) expected.set(pickerPlayerIdOf(k), (expected.get(pickerPlayerIdOf(k)) ?? 0) + v);
    for (const [id, v] of perPlayer) check(`${label} ${id} の合計`, v === (expected.get(id) ?? 0), `${v} ≠ ${expected.get(id) ?? 0}`);

    // チームの並び: 地区の順 → 地区順位の順
    if (latest && gameType === "regular") {
      const pos = new Map(groups.map((g, i) => [g.teamId, i]));
      const rows = latest.filter((t) => t.division && pos.has(t.teamId));
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1]!;
        const b = rows[i]!;
        const da = DIVISION_ORDER.indexOf(a.division!);
        const db = DIVISION_ORDER.indexOf(b.division!);
        const inOrder = da < db || (da === db && (a.divisionRank ?? 0) <= (b.divisionRank ?? 0));
        if (inOrder) check(`${label} チームの並び ${a.teamName}→${b.teamName}`, pos.get(a.teamId)! < pos.get(b.teamId)!);
      }
    }
  }
}
check("検証できたシーズンがある", checkedSeasons > 0, "（先に npm run build:data）");

if (failures > 0) {
  console.error(`\n${failures}件の食い違いがあります`);
  process.exit(1);
}
console.log(`${checkedSeasons}シーズンで、すべて一致しました`);
