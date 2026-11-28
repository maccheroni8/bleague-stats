// Time to Shot の導出データ（data/{season}/team-tts.json.gz）の検証。先に npm run build:data で作っておく。
// 試合の生データから計算し直した値と、ファイルの値が一致すること／本数の整合（計測＋除外＝PBPのFG＝ボックスのFGA）／2019-20以前は作らないこと、を確かめる。
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import { calculateTimeToShot } from "../shared/timeToShot.ts";
import { TTS_ATOMS, TTS_FIRST_SEASON, TTS_INDEX_CATEGORIES, ttsExcludedKey, ttsFtExcludedKey, ttsFtKey, ttsKey, ttsPossExcludedKey, ttsPossKey, ttsPossOrCountKey, type TtsAtom, type TtsIndexFile } from "../shared/ttsIndex.ts";
import type { PlayerTtsFile } from "../shared/playerTts.ts";
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
  let measured = 0, excluded = 0, boxFga = 0, noPbp = 0, ftMeasured = 0, ftExcluded = 0, possOk = 0, possExcluded = 0;
  for (const game of await readAllGames(season)) {
    const gn = gameNumber.get(String(game.scheduleKey));
    if (gn === undefined) continue; // オールスター等は索引に無い（サイトに出ない）
    const g: number = gn;
    const hasPbp = (game.raw.PlayByPlays?.length ?? 0) > 0;
    // 前後半5分の特別な試合（旧形式の4試合）は、作る側と同じく値なし（-1。Qの区切りが違う。372章）
    const short = game.quarterScores.home.length < 4 && (game.raw.PlayByPlays ?? []).reduce((n, e) => Math.max(n, e.Period), 0) < 4;
    const calc = hasPbp && !short ? calculateTimeToShot(game) : null;
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
        // フリースローをもらうまでの時間（480章）
        const fts = calc.fts.filter((f) => f.team === team.id && atomOf(f.period) === a);
        for (const kind of ["shoot", "bonus"] as const) {
          const own = fts.filter((f) => f.kind === kind && f.seconds !== null);
          assert.equal(c[ttsFtKey(a, kind, "n")]![row], own.length, `${season} ${game.scheduleKey} ${a} FT ${kind} 件数`);
          assert.equal(c[ttsFtKey(a, kind, "s")]![row], own.reduce((n, f) => n + f.seconds!, 0), `${season} ${game.scheduleKey} ${a} FT ${kind} 秒数`);
          ftMeasured += own.length;
        }
        const and1 = fts.filter((f) => f.kind === "shoot" && f.andOne && f.seconds !== null);
        assert.equal(c[ttsFtKey(a, "and1", "n")]![row], and1.length, `${season} ${game.scheduleKey} ${a} FT and1`);
        assert.equal(c[ttsFtExcludedKey(a, "u")]![row], fts.filter((f) => f.kind === "unclassified").length);
        assert.equal(c[ttsFtExcludedKey(a, "o")]![row], fts.filter((f) => f.kind === "overlap").length);
        assert.equal(c[ttsFtExcludedKey(a, "x")]![row], fts.filter((f) => f.kind === "unknown").length);
        ftExcluded += fts.filter((f) => f.seconds === null).length;
        // 攻撃時間（481章）: 試合ごとの列が計算し直した値と一致
        const pos = calc.possessions.filter((p) => p.team === team.id && atomOf(p.period) === a);
        const ok = pos.filter((p) => p.seconds !== null);
        for (const [k, list] of [["all", ok], ["or", ok.filter((p) => p.orebs > 0)], ["pts", ok.filter((p) => p.scored)]] as const) {
          assert.equal(c[ttsPossKey(a, k, "n")]![row], list.length, `${season} ${game.scheduleKey} ${a} 攻撃 ${k} 回数`);
          assert.equal(c[ttsPossKey(a, k, "s")]![row], list.reduce((n, p) => n + p.seconds!, 0), `${season} ${game.scheduleKey} ${a} 攻撃 ${k} 秒数`);
        }
        assert.equal(c[ttsPossOrCountKey(a)]![row], ok.reduce((n, p) => n + p.orebs, 0));
        assert.equal(c[ttsPossExcludedKey(a)]![row], pos.length - ok.length);
        possOk += ok.length;
        possExcluded += pos.length - ok.length;
        // アンドワンの起点は同じ秒の成功FGの起点（シュートまでの時間にも同じ攻撃で入る）
        for (const f of and1) assert.ok(shots.some((sh) => sh.start && f.start && sh.start.index === f.start.index && sh.end.clock === f.end.clock), `${season} ${game.scheduleKey} アンドワンの起点がFGと違う`);
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
  // 選手の Time to Shot（player-tts。480章）: レギュラー＋ポストシーズンの合計が、チームの計測（選手の付いた FG・FT）と合う
  const pt = await readJson<PlayerTtsFile>(path.join(DATA_DIR, season, "player-tts.json"));
  assert.ok(pt, `${season}: player-tts がありません`);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  assert.ok(sum(pt.rows.fgN) <= measured && sum(pt.rows.fgN) >= measured * 0.999, `${season}: 選手の FG 本数 ${sum(pt.rows.fgN)} とチーム ${measured}`);
  assert.ok(sum(pt.rows.ftN) <= ftMeasured && sum(pt.rows.ftN) >= ftMeasured * 0.999, `${season}: 選手の FT 件数 ${sum(pt.rows.ftN)} とチーム ${ftMeasured}`);
  const keys = pt.rows.player.map((p, i) => `${p}|${pt.rows.team[i]}|${pt.rows.playoff[i]}`);
  assert.equal(new Set(keys).size, keys.length, `${season}: 選手の行が重複`);
  // 攻撃時間: 数えなかった攻撃は 3% 未満（記録の食い違いが増えていないか。旧形式の 2016-17 は約2%、2020-21 以降は0.3〜0.4%）
  assert.ok(possExcluded / (possOk + possExcluded) < 0.03, `${season}: 数えなかった攻撃が多い ${possExcluded}/${possOk + possExcluded}`);
  console.log(`${season}: 攻撃時間 数えた ${possOk} / 数えなかった ${possExcluded}（${((100 * possExcluded) / (possOk + possExcluded)).toFixed(2)}%）`);
  console.log(`${season}: FTをもらうまで 計測 ${ftMeasured} / 数えなかった ${ftExcluded}（${((100 * ftExcluded) / (ftMeasured + ftExcluded)).toFixed(2)}%）／選手 ${new Set(pt.rows.player).size} 人`);
  checks++;
  console.log(`${season}: 計測 ${measured} / 除外 ${excluded} / FGA ${boxFga}（${((100 * measured) / boxFga).toFixed(3)}%）PBPなし ${noPbp} 試合`);
  checks++;
}
console.log(`team-tts: ${checks} 項目 OK`);
