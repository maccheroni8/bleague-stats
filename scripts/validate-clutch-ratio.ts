// ランキング（個人）のクラッチの掲載基準「クラッチ出場率」（src/lib/seasonPeriod.ts の clutchAppearances・clutchCandidates。DESIGN.md 479章）の検証スクリプト
// （検証専用。`npm run build:data` のあとに実行する）。
//
// 確かめること:
//  1. 分子（クラッチに出た試合）が、従来の延長・クラッチの対象判定（overtimeCandidates の数え方）と同じ数であること
//  2. 分母（所属期間のチームのクラッチになった試合）が、チームのピリオド別の索引から別の経路（試合の番号の総当たり）で数えた値と一致し、
//     出場した試合のうちクラッチに出た数が分母を超えないこと（超える選手は報告）
//  3. 最低3試合が、出場率の基準が0%でも残ること。出場率の基準を上げると対象は増えないこと（単調）
//  4. 参考の出力: 2026-27・2025-26 の、基準が「3試合以上だけ」のときと「50%以上かつ3試合以上」のときの人数・外れた選手と入った選手の例・移籍した選手
//
// 使い方: npm run validate:clutch-ratio [-- --list]。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../shared/gameIndex.ts";
import { GAME_FLAG_SHORT, ROW_FLAG_HOME } from "../shared/gameIndex.ts";
import type { PlayerPeriodIndexFile, TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import { PERIOD_ATOMS } from "../shared/periodIndex.ts";
import { viewPlayerGameIndex, viewTeamGameIndex } from "../src/lib/gameIndex";
import { viewPlayerPeriodIndex } from "../src/lib/periodIndex";
import { OVERTIME_MIN_GAMES, clutchAppearances, clutchCandidates, overtimeCandidates, type SeasonPeriodSource } from "../src/lib/seasonPeriod";

const list = process.argv.includes("--list");
let failures = 0;
const fail = (m: string) => {
  failures++;
  if (failures <= 30) console.log(`  NG ${m}`);
};

async function buildSource(season: string): Promise<{ source: SeasonPeriodSource; pFile: PlayerGameIndexFile } | null> {
  const dir = path.join(DATA_DIR, season);
  const pFile = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
  const tFile = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
  const ppFile = await readJson<PlayerPeriodIndexFile>(path.join(dir, "player-period-index.json"));
  const tpFile = await readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json"));
  if (!pFile || !tFile || !ppFile || !tpFile) return null;
  const player = viewPlayerGameIndex(pFile);
  const team = viewTeamGameIndex(tFile);
  const period = viewPlayerPeriodIndex(ppFile, player);
  if (!period || tpFile.indexRows !== team.size) return null;
  const teamGameNo = new Map<string, number>();
  const shortGames = new Set<string>();
  tFile.games.key.forEach((k, i) => {
    teamGameNo.set(k, i);
    if ((tFile.games.flags[i]! & GAME_FLAG_SHORT) !== 0) shortGames.add(k);
  });
  return { source: { season, player, period, team, teamPeriod: tpFile, rowByPlayerGame: new Map(), teamGameNo, shortGames }, pFile };
}

async function main() {
  const seasons = ["2026-27", "2025-26"];
  for (const season of seasons) {
    const built = await buildSource(season);
    if (!built) {
      console.log(`${season}: 索引が読めない（build:data を先に流してください）`);
      failures++;
      continue;
    }
    const { source, pFile } = built;
    const ap = clutchAppearances(source);
    // 1. 分子: overtimeCandidates（クラッチ）の対象 = 分子が3以上の選手
    const old = overtimeCandidates(source, OVERTIME_MIN_GAMES, "clutch");
    const fromAp = new Set([...ap].filter(([, a]) => a.played >= OVERTIME_MIN_GAMES).map(([id]) => id));
    if (old.size !== fromAp.size || [...old].some((id) => !fromAp.has(id))) fail(`${season}: 分子の数え方が従来の対象と違う（従来 ${old.size}人・新 ${fromAp.size}人）`);
    // 2. 分母: 別の経路（試合ごと・チームごとに総当たり）で数える
    const clutchPts = source.teamPeriod.rows.counts["clutch.pts"]!;
    const games = pFile.games;
    const span = new Map<string, [number, number]>();
    for (let i = 0; i < pFile.rows.player.length; i++) {
      const g = pFile.rows.game[i]!;
      const home = (pFile.rows.flags[i]! & ROW_FLAG_HOME) !== 0;
      const tid = pFile.teams[(home ? games.home : games.away)[g]!]![0];
      const k = `${pFile.players[pFile.rows.player[i]!]![0]}|${tid}`;
      const cur = span.get(k);
      span.set(k, cur ? [Math.min(cur[0], g), Math.max(cur[1], g)] : [g, g]);
    }
    const denom = new Map<string, number>();
    for (const [k, [a, b]] of span) {
      const [pid, tid] = k.split("|") as [string, string];
      let n = 0;
      for (let g = a; g <= b; g++) {
        const no = source.teamGameNo.get(games.key[g]!);
        if (no === undefined) continue;
        for (const side of [0, 1]) {
          const id = pFile.teams[(side === 0 ? games.home : games.away)[g]!]![0];
          if (id === tid && (clutchPts[no * 2 + side] ?? -1) >= 0) n++;
        }
      }
      denom.set(pid, (denom.get(pid) ?? 0) + n);
    }
    let over = 0;
    for (const [id, a] of ap) {
      if ((denom.get(id) ?? 0) !== a.teamGames) fail(`${season}: 分母が一致しない ${id} ${a.teamGames} / ${denom.get(id)}`);
      if (a.played > a.teamGames) over++;
    }
    if (over > 0) console.log(`  参考: クラッチに出た試合がチームのクラッチ試合数より多い選手 ${over}人（所属期間の外・判定のずれ）`);
    // 3. 最低3試合・単調
    let prev = Infinity;
    for (const pct of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
      const set = clutchCandidates(source, OVERTIME_MIN_GAMES, pct);
      if (set.size > prev) fail(`${season}: 基準を上げたのに対象が増えた（${pct}%）`);
      prev = set.size;
      for (const id of set) if ((ap.get(id)?.played ?? 0) < OVERTIME_MIN_GAMES) fail(`${season}: 最低3試合が残っていない ${id}`);
    }
    if (clutchCandidates(source, OVERTIME_MIN_GAMES, 0).size !== old.size) fail(`${season}: 0%のときが従来の対象と違う`);
    // 4. 参考の出力
    const now = clutchCandidates(source, OVERTIME_MIN_GAMES, 50);
    const names = new Map(pFile.players.map((p) => [p[0], p[1]]));
    const fmt = (id: string) => `${names.get(id)}（${ap.get(id)!.played}/${ap.get(id)!.teamGames}＝${((100 * ap.get(id)!.played) / Math.max(1, ap.get(id)!.teamGames)).toFixed(0)}%）`;
    const dropped = [...old].filter((id) => !now.has(id));
    console.log(`${season}: 従来（3試合以上）${old.size}人 → 新（50%以上かつ3試合以上）${now.size}人（外れた ${dropped.length}人・入った ${[...now].filter((id) => !old.has(id)).length}人）`);
    for (const pct of [0, 30, 50, 70]) console.log(`  クラッチ出場率${pct}%以上: ${clutchCandidates(source, OVERTIME_MIN_GAMES, pct).size}人`);
    const sortedDropped = dropped.sort((x, y) => ap.get(y)!.played - ap.get(x)!.played);
    console.log(`  外れた例: ${sortedDropped.slice(0, 6).map(fmt).join("、")}`);
    const teamCount = new Map<string, number>();
    for (const k of span.keys()) teamCount.set(k.split("|")[0]!, (teamCount.get(k.split("|")[0]!) ?? 0) + 1);
    const moved = [...teamCount].filter(([, n]) => n > 1).map(([id]) => id).filter((id) => ap.get(id)!.played > 0);
    console.log(`  移籍した選手（クラッチに出た人）: ${moved.length}人`);
    if (list || true) {
      for (const id of moved.slice(0, 5)) {
        const parts = [...span].filter(([k]) => k.startsWith(`${id}|`)).map(([k, [a, b]]) => `${pFile.teams.find((t) => t[0] === k.split("|")[1])![1]} ${games.date[a]}〜${games.date[b]}`);
        console.log(`    ${fmt(id)} ${now.has(id) ? "対象" : "対象外"} ／ ${parts.join(" ＋ ")}`);
      }
    }
    if (list) console.log(`  入った選手: ${[...now].filter((id) => !old.has(id)).map(fmt).join("、")}`);
  }
  void PERIOD_ATOMS;
  if (failures > 0) {
    console.log(`NG: ${failures}件`);
    process.exit(1);
  }
  console.log("OK: クラッチ出場率の検証は通りました");
}
void main();
