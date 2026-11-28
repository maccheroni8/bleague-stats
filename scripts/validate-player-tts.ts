// 選手の Time to Shot（DESIGN.md 480章。data/{season}/player-tts.json.gz と src/lib/playerTts.ts）の検証。先に npm run build:data で導出データを作っておく。
// - 試合の生データから計算し直した選手×チーム×試合区分の件数・秒数と、ファイルの値が一致する（2016-17・2025-26・2026-27、B.ONE 2026-27）
// - 移籍した選手のシーズン合計＝チームごとの合計、試合区分の絞り込み
// - 全選手スタッツの順位: FGA（ボックススコア）の1試合平均 1.0以上だけ・速い順・同じ表示値は同じ順位で次は飛ばす
import assert from "node:assert/strict";
import path from "node:path";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { calculateTimeToShot } from "../shared/timeToShot.ts";
import { GAME_FLAG_PLAYOFF, type TeamGameIndexFile } from "../shared/gameIndex.ts";
import type { PlayerTtsFile } from "../shared/playerTts.ts";
import type { Category } from "../shared/types.ts";
import { PLAYER_TTS_MIN_FGA_PER_GAME, playerTtsByTeam, playerTtsEligible, playerTtsRanks, playerTtsSeasonTotal } from "../src/lib/playerTts.ts";

let checks = 0;
for (const [season, category] of [["2016-17", "premier"], ["2025-26", "premier"], ["2026-27", "premier"], ["2026-27", "one"]] as [string, Category][]) {
  const dir = path.join(DATA_DIR, seasonDirName(season, category));
  const file = await readJson<PlayerTtsFile>(path.join(dir, "player-tts.json"));
  const idx = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
  assert.ok(file && idx, `${season} ${category}: ファイルがありません`);
  const gameNo = new Map(idx.games.key.map((k, i) => [k, i]));
  const exp = new Map<string, { fgN: number; fgS: number; ftN: number; ftS: number }>();
  for (const game of await readAllGames(season, category)) {
    const g = gameNo.get(String(game.scheduleKey));
    if (g === undefined || !game.raw.PlayByPlays?.length) continue;
    if (game.quarterScores.home.length < 4 && game.raw.PlayByPlays.reduce((n, e) => Math.max(n, e.Period), 0) < 4) continue;
    const playoff = (idx.games.flags[g]! & GAME_FLAG_PLAYOFF) !== 0 ? 1 : 0;
    const r = calculateTimeToShot(game);
    const add = (player: string | null | undefined, team: string, kind: "fg" | "ft", s: number) => {
      if (!player) return;
      const k = `${player}|${team}|${playoff}`;
      const t = exp.get(k) ?? { fgN: 0, fgS: 0, ftN: 0, ftS: 0 };
      if (kind === "fg") { t.fgN++; t.fgS += s; } else { t.ftN++; t.ftS += s; }
      exp.set(k, t);
    };
    for (const s of r.shots) if (s.category !== null && s.seconds !== null) add(s.end.player, s.team, "fg", s.seconds);
    for (const f of r.fts) if ((f.kind === "shoot" || f.kind === "bonus") && f.seconds !== null) add(f.shooter, f.team, "ft", f.seconds);
  }
  const rows = file.rows;
  assert.equal(rows.player.length, exp.size, `${season} ${category}: 行の数`);
  for (let i = 0; i < rows.player.length; i++) {
    const e = exp.get(`${rows.player[i]}|${rows.team[i]}|${rows.playoff[i]}`);
    assert.ok(e, `${season} ${category}: 余分な行 ${rows.player[i]}`);
    assert.deepEqual([rows.fgN[i], rows.fgS[i], rows.ftN[i], rows.ftS[i]], [e.fgN, e.fgS, e.ftN, e.ftS], `${season} ${category} ${rows.player[i]} ${rows.team[i]}`);
    checks++;
  }
  // 試合区分: レギュラー＋ポストシーズン＝合算
  const reg = playerTtsByTeam(file, "regular"), po = playerTtsByTeam(file, "playoff"), both = playerTtsByTeam(file, "both");
  for (const pid of both.keys()) {
    const t = playerTtsSeasonTotal(both, pid)!;
    const a = playerTtsSeasonTotal(reg, pid), b = playerTtsSeasonTotal(po, pid);
    assert.equal(t.fgN, (a?.fgN ?? 0) + (b?.fgN ?? 0));
    assert.equal(t.fgS, (a?.fgS ?? 0) + (b?.fgS ?? 0));
    checks++;
  }
  // 移籍した選手: 合計＝チームごとの合計
  const moved = [...reg].filter(([, teams]) => teams.size > 1);
  for (const [pid, teams] of moved) {
    const t = playerTtsSeasonTotal(reg, pid)!;
    assert.equal(t.fgN, [...teams.values()].reduce((n, x) => n + x.fgN, 0));
    checks++;
  }
  console.log(`${season} ${category === "one" ? "B.ONE" : "B.PREMIER"}: ${rows.player.length} 行・移籍した選手 ${moved.length} 人 OK`);
}

// 順位の対象: FGA の1試合平均が1.0以上（ちょうど1.0は対象・試合数0は対象外）
assert.equal(PLAYER_TTS_MIN_FGA_PER_GAME, 1.0);
assert.equal(playerTtsEligible(60, 60), true);
assert.equal(playerTtsEligible(59, 60), false);
assert.equal(playerTtsEligible(0, 0), false);
checks++;
// 順位: 対象の選手だけ・速い順・同じ表示値は同じ順位で次は飛ばす
const ranks = playerTtsRanks([
  { id: "a", avg: 10.004, eligible: true },
  { id: "b", avg: 9.5, eligible: true },
  { id: "c", avg: 10.001, eligible: true },
  { id: "d", avg: 11, eligible: true },
  { id: "e", avg: 8, eligible: false },
  { id: "f", avg: null, eligible: true },
]);
assert.deepEqual(Object.fromEntries(ranks), { b: 1, a: 2, c: 2, d: 4 });
checks++;
// 実データ: players.json（ボックススコア）の FGA で数えた順位の対象の人数（レギュラーシーズン）
for (const season of ["2025-26", "2026-27"]) {
  const file = await readJson<PlayerTtsFile>(path.join(DATA_DIR, season, "player-tts.json"));
  const players = await readJson<{ players?: { playerId: string; gamesPlayed: number; totals: { fga: number } }[] } | { playerId: string; gamesPlayed: number; totals: { fga: number } }[]>(path.join(DATA_DIR, season, "players.json"));
  assert.ok(file && players);
  const list = Array.isArray(players) ? players : (players.players ?? []);
  const reg = playerTtsByTeam(file, "regular");
  const entries = list.map((p) => ({ id: p.playerId, avg: playerTtsSeasonTotal(reg, p.playerId) ? playerTtsSeasonTotal(reg, p.playerId)!.fgS / Math.max(1, playerTtsSeasonTotal(reg, p.playerId)!.fgN) : null, eligible: playerTtsEligible(p.totals.fga, p.gamesPlayed) }));
  const ranked = playerTtsRanks(entries);
  for (const e of entries) if (ranked.has(e.id)) assert.ok(e.eligible, `${season} ${e.id}: 対象外の選手に順位`);
  console.log(`${season}: 順位の対象 ${ranked.size} 人（出場率の基準をかける前）／選手 ${list.length} 人`);
  checks++;
}
console.log(`player-tts: ${checks} 項目 OK`);
