// Time to Shot の導出データ（data/{season}/team-tts.json.gz）の検証。先に npm run build:data で作っておく。
// 試合の生データから計算し直した値と、ファイルの値が一致すること／本数の整合（計測＋除外＝PBPのFG＝ボックスのFGA）／2019-20以前は作らないこと、を確かめる。
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import { calculateTimeToShot } from "../shared/timeToShot.ts";
import { TTS_ATOMS, TTS_FIRST_SEASON, TTS_INDEX_CATEGORIES, ttsExcludedKey, ttsKey, type TtsAtom, type TtsIndexFile } from "../shared/ttsIndex.ts";
import type { TeamGameIndexFile } from "../shared/gameIndex.ts";

const seasons = readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
let checks = 0;
for (const season of seasons) {
  const file = path.join(DATA_DIR, season, "team-tts.json.gz");
  if (season < TTS_FIRST_SEASON) {
    assert.equal(existsSync(file), false, `${season}: 2019-20以前には作らない`);
    checks++;
    continue;
  }
  const tts = await readJson<TtsIndexFile>(path.join(DATA_DIR, season, "team-tts.json"));
  const idx = await readJson<TeamGameIndexFile>(path.join(DATA_DIR, season, "team-game-index.json"));
  assert.ok(tts && idx, `${season}: ファイルがありません`);
  assert.equal(tts.indexRows, idx.games.key.length * 2);
  const c = tts.rows.counts;
  const gameNumber = new Map(idx.games.key.map((k, i) => [k, i]));
  let measured = 0, excluded = 0, boxFga = 0, noPbp = 0;
  for (const game of await readAllGames(season)) {
    const gn = gameNumber.get(String(game.scheduleKey));
    if (gn === undefined) continue; // オールスター等は索引に無い（サイトに出ない）
    const g: number = gn;
    const hasPbp = (game.raw.PlayByPlays?.length ?? 0) > 0;
    const calc = hasPbp ? calculateTimeToShot(game) : null;
    if (!calc) noPbp++;
    for (const side of [0, 1] as const) {
      const team = side === 0 ? game.homeTeam : game.awayTeam;
      const row: number = g * 2 + side;
      const atomOf = (p: number): TtsAtom => (p <= 4 ? TTS_ATOMS[p - 1]! : "ot");
      let fgOfTeam = 0;
      for (const a of TTS_ATOMS) {
        if (!calc) { assert.equal(c[ttsExcludedKey(a)]![row], -1); continue; }
        const shots = calc.shots.filter((s) => s.team === team.id && atomOf(s.period) === a);
        const hasOt = calc.shots.some((s) => s.period > 4) || calc.events.some((e) => e.period > 4);
        if (a === "ot" && !hasOt) { assert.equal(c[ttsExcludedKey(a)]![row], -1, `${season} ${game.scheduleKey} 延長なし`); continue; }
        assert.equal(c[ttsExcludedKey(a)]![row], shots.filter((s) => s.seconds === null || s.category === null).length);
        for (const cat of TTS_INDEX_CATEGORIES) {
          const own = shots.filter((s) => s.category === cat && s.seconds !== null);
          assert.equal(c[ttsKey(a, cat, "n")]![row], own.length, `${season} ${game.scheduleKey} ${a} ${cat} 本数`);
          assert.equal(c[ttsKey(a, cat, "s")]![row], own.reduce((n, s) => n + s.seconds!, 0), `${season} ${game.scheduleKey} ${a} ${cat} 秒数`);
        }
        fgOfTeam += shots.length;
        checks++;
      }
      if (!calc) continue;
      // 計測＋除外＝そのチームのPBPのFG＝ボックスのFGA
      const ownRows = side === 0 ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
      const box = ownRows.find((r) => r.Category === 3 && r.PeriodCategory === 18);
      if (box) { assert.equal(fgOfTeam, box.PT2A + box.PT3A, `${season} ${game.scheduleKey} ${team.id}: PBPのFGとボックスのFGAが違う`); boxFga += fgOfTeam; }
      for (const a of TTS_ATOMS) {
        const x = c[ttsExcludedKey(a)]![row]!;
        if (x < 0) continue;
        excluded += x;
        for (const cat of TTS_INDEX_CATEGORIES) measured += c[ttsKey(a, cat, "n")]![row]!;
      }
    }
  }
  // 初回全体＋OREB後＝全体、のために、その他を含む6分類の本数＋OREB＝計測本数。ここでは測定済み＋除外＝FGを確かめる
  assert.equal(measured + excluded, boxFga, `${season}: 計測＋除外がFGAと合わない`);
  console.log(`${season}: 計測 ${measured} / 除外 ${excluded} / FGA ${boxFga}（${((100 * measured) / boxFga).toFixed(3)}%）PBPなし ${noPbp} 試合`);
  checks++;
}
console.log(`team-tts: ${checks} 項目 OK`);
