// shared/gameFlow.ts（得点の流れ: 最大のラン・勝ち越し弾・同点弾・決勝弾。DESIGN.md 221章）の検証スクリプト（検証専用。CIには入れず、必要なときに手で実行する）。
//
// 全シーズンの終了済み試合（B.PREMIER。PBPのある試合）について、次を確かめる:
//  1. 得点の流れが完全: 使わなかった得点イベントが0、最後の得点の Score が公式の最終スコアと一致、時刻が逆行しない。同じ秒の並べ直しをした試合の一覧
//  2. 別の方法（時刻を使わず、累計得点の順だけで並べる）で作った得点の流れと、イベントがすべて一致
//  3. 最大のラン: 別の書き方（相手の得点が同じ間の区間の差）と、点数・開始・終了・ラン前のスコアが一致
//  4. 勝ち越し弾・同点弾・決勝弾: 別の書き方（点差の状態列から数える。決勝弾は「勝者の点差が最後に0以下だった状態の次の得点」）と、選手ごとの18個の数がすべて一致
//  5. 手で数えた小さな試合（合成）での期待値
//  6. 試合詳細の得点推移グラフ（src/lib/leadTracker.ts の buildScoreTimeline）が、同じ秒の並びの食い違いのある試合で、リードの入れ替わりを間違えて見せていないか（報告のみ。失敗にしない）
//
// 使い方: npm run validate:game-flow [-- --season 2025-26]
import { existsSync, readdirSync } from "node:fs";
import type { PlayByPlayEvent, StoredGame } from "../shared/types.ts";
import { DATA_DIR, gamesDir, gameFilePath, readAllGames } from "./lib/storage.ts";
import {
  CLUTCH_LENGTH,
  CLUTCH_WINDOWS_SEC,
  clutchByPlayer,
  clutchIndex,
  maxRuns,
  periodAndRestAt,
  scoringSequence,
  type ScoringEvent,
} from "../shared/gameFlow.ts";
import { buildScoreTimeline } from "../src/lib/leadTracker";
import { onCourtPeriodCount } from "../shared/onCourt.ts";

const args = process.argv.slice(2);
const onlySeason = args.includes("--season") ? args[args.indexOf("--season") + 1] : undefined;

let failures = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "ok" : "NG"} ${name}${cond ? "" : ` ${detail}`}`);
  if (!cond) failures += 1;
}

// ---- 5. 合成した小さな試合 ----
function ev(period: number, rest: string, score: string, code: number, team: string, player: string): PlayByPlayEvent {
  return { Period: period, RestTime: rest, Score: score, ActionCD1: code, TeamID: team, PlayerID1: player, PlayerID2: null, No: 0 } as unknown as PlayByPlayEvent;
}
/** 開始から home-away まで、ホームの得点→アウェイの得点の順に1点ずつ入れた合成の列 */
function prefixTo(home: number, away: number): PlayByPlayEvent[] {
  const out: PlayByPlayEvent[] = [];
  for (let i = 1; i <= home; i += 1) out.push(ev(1, "9:00", `${i}-0`, 7, "H", "hp"));
  for (let i = 1; i <= away; i += 1) out.push(ev(2, "9:00", `${home}-${i}`, 7, "A", "ap"));
  return out;
}
{
  // 同じ秒に 80-85, 80-83, 80-84 の順で並んだ FT（試合6158 と同じ形）が、83→84→85 に直る。直前は 80-82（アウェイ）
  const seq = scoringSequence([
    ...prefixTo(80, 82),
    ev(4, "4:04", "80-85", 7, "A", "b2"),
    ev(4, "4:04", "80-83", 7, "A", "b2"),
    ev(4, "4:04", "80-84", 7, "A", "b2"),
  ]);
  const tail = seq.events.slice(-3).map((e) => `${e.homeScore}-${e.awayScore}`).join(",");
  ok("合成: 同じ秒の並べ直し（累計の昇順）", tail === "80-83,80-84,80-85" && seq.reordered === 3 && seq.skipped === 0, `${tail} ${seq.reordered} ${seq.skipped}`);
}
{
  // 第4Q残り1:30: ホームの3Pで 60-62 → 63-62（勝ち越し）、残り0:40: アウェイのFT 63-63（同点）→ 63-64（勝ち越し）、残り0:10: ホームの2Pで 65-64（勝ち越し・決勝弾）
  const chain: [number, string, string, number, string, string][] = [
    [4, "3:00", "60-62", 3, "A", "a9"],
    [4, "1:30", "63-62", 1, "H", "h2"],
    [4, "0:50", "63-63", 7, "A", "a1"],
    [4, "0:40", "63-64", 7, "A", "a1"],
    [4, "0:10", "65-64", 3, "H", "h1"],
  ];
  // 開始から 60-62 までの得点は、ホーム60点・アウェイ62点の順に1点ずつ入れた合成の列
  const pre: PlayByPlayEvent[] = [];
  for (let i = 1; i <= 60; i += 1) pre.push(ev(1, "9:00", `${i}-0`, 7, "H", "hp"));
  for (let i = 1; i <= 62; i += 1) pre.push(ev(2, "9:00", `60-${i}`, 7, "A", "ap"));
  const all = [...pre, ...chain.slice(1).map((c) => ev(c[0], c[1], c[2], c[3], c[4], c[5]))];
  const s2 = scoringSequence(all);
  ok("合成: 得点の流れに欠けが無い", s2.skipped === 0 && s2.events.length === 60 + 62 + 4, `${s2.skipped} ${s2.events.length}`);
  const runs = maxRuns(s2.events);
  ok("合成: ホームの最大のラン 60-0（開始〜）", runs[0]?.points === 60 && runs[0].ownBefore === 0 && runs[0].oppBefore === 0, JSON.stringify(runs[0]));
  ok("合成: アウェイの最大のラン 62-0", runs[1]?.points === 62 && runs[1].ownBefore === 0 && runs[1].oppBefore === 60, JSON.stringify(runs[1]));
  const c = clutchByPlayer(s2.events, 65, 64);
  const h2 = c.get("h2");
  const a1 = c.get("a1");
  const h1 = c.get("h1");
  // 63-62: 62-60→63-62 でホームがリード（前: 60-62 で負け）→ 勝ち越し（3Pでなく FG: code 1）。残り1:30 は 2分窓・5分窓に入り、1分窓には入らない
  ok("合成: 勝ち越し弾（FG）は5分・2分の窓に入り1分の窓に入らない", !!h2 && h2[clutchIndex(0, 0, false)] === 1 && h2[clutchIndex(1, 0, false)] === 1 && h2[clutchIndex(2, 0, false)] === 0, JSON.stringify(h2));
  // 63-63 は同点弾（FT・残り0:50）、63-64 は勝ち越し（FT・残り0:40）。a1 は両方
  ok("合成: 同点弾と勝ち越し弾（FT）は3つの窓すべて", !!a1 && [0, 1, 2].every((w) => a1[clutchIndex(w, 1, true)] === 1 && a1[clutchIndex(w, 0, true)] === 1), JSON.stringify(a1));
  // 65-64: ホームの勝ち越しで、ホームが最終的に勝つ → 決勝弾。前の勝ち越し(63-62)は一度リードを失ったので決勝弾ではない
  ok("合成: 決勝弾は勝者の最後の勝ち越しだけ", !!h1 && [0, 1, 2].every((w) => h1[clutchIndex(w, 2, false)] === 1 && h1[clutchIndex(w, 0, false)] === 1) && !!h2 && [0, 1, 2].every((w) => h2[clutchIndex(w, 2, false)] === 0), JSON.stringify([h1, h2]));
  ok("合成: 引き分けには決勝弾が無い", ![...clutchByPlayer(s2.events, 64, 64).values()].some((a) => a.some((v, i) => Math.floor((i % 6) / 2) === 2 && v > 0)));
}
ok("合成: 経過秒 → ピリオドと残り時間", (() => {
  const a = periodAndRestAt(600);
  const b = periodAndRestAt(2400 + 120);
  const d = periodAndRestAt(2401);
  return a.period === 1 && a.restSec === 0 && b.period === 5 && b.restSec === 180 && d.period === 5 && d.restSec === 299;
})());

// ---- 全試合 ----
function parseRest(e: PlayByPlayEvent): number {
  const m = /^(\d+):(\d{2})$/.exec(e.RestTime ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** 別の並べ方: 時刻を使わず、累計得点（ホーム+アウェイ）の昇順だけで並べる。得点イベントの組（ホームの得点・アウェイの得点・ピリオド・残り・選手・FT）を返す */
function independentEvents(g: StoredGame): { h: number; a: number; period: number; rest: number; player: string | null; ft: boolean }[] {
  const raw = (g.raw.PlayByPlays ?? [])
    .filter((e) => [1, 3, 4, 7, 44].includes(e.ActionCD1) && /^\d+-\d+$/.test(e.Score ?? ""))
    .map((e) => {
      const [h, a] = (e.Score as string).split("-").map(Number) as [number, number];
      return { h, a, period: e.Period, rest: parseRest(e), player: e.PlayerID1 ?? null, ft: e.ActionCD1 === 7 };
    });
  return raw.sort((x, y) => x.h + x.a - (y.h + y.a));
}

/** 別の書き方のラン: 相手の得点が同じ間の区間の差 */
function independentRun(ev: { h: number; a: number }[], home: boolean): number {
  // 状態の列（最初は 0-0）。相手の得点が同じ状態が続く区間ごとに、自分の得点の増加を数える
  let best = 0;
  let startOwn = 0;
  let oppAtStart = 0;
  let own = 0;
  for (const e of ev) {
    const o = home ? e.h : e.a;
    const p = home ? e.a : e.h;
    if (p !== oppAtStart) {
      // 相手が得点した → 新しい区間は、この時点の自分の得点から
      oppAtStart = p;
      startOwn = own;
    }
    own = o;
    if (own - startOwn > best) best = own - startOwn;
  }
  return best;
}

type Stat = { games: number; reorderedGames: string[]; runMismatch: number; clutchMismatch: number; flowMismatch: number; incomplete: number; timeBackwards: number };
const tally: Stat = { games: 0, reorderedGames: [], runMismatch: 0, clutchMismatch: 0, flowMismatch: 0, incomplete: 0, timeBackwards: 0 };
const clutchTotals: number[] = new Array(CLUTCH_LENGTH).fill(0);
let maxRunValue = 0;
const chartReport: string[] = [];

const seasons = readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s) && (!onlySeason || s === onlySeason)).sort();
for (const season of seasons) {
  if (!existsSync(gamesDir(season, "premier"))) continue;
  for (const g of await readAllGames(season)) {
    if (!g.gameEndedFlg || !g.raw.PlayByPlays?.length) continue;
    tally.games += 1;
    const tag = `${season}/${g.scheduleKey}`;
    const seq = scoringSequence(g.raw.PlayByPlays);
    const last = seq.events[seq.events.length - 1];
    if (seq.skipped > 0 || !last || last.homeScore !== g.homeScore || last.awayScore !== g.awayScore) {
      tally.incomplete += 1;
      console.log(`  不完全: ${tag} skipped=${seq.skipped} last=${last?.homeScore}-${last?.awayScore} final=${g.homeScore}-${g.awayScore}`);
    }
    for (let i = 1; i < seq.events.length; i += 1) {
      if (seq.events[i]!.elapsedSec < seq.events[i - 1]!.elapsedSec) {
        tally.timeBackwards += 1;
        break;
      }
    }
    if (seq.reordered > 0) tally.reorderedGames.push(`${tag}(${seq.reordered})`);

    // 2. 累計得点だけで並べた列と一致
    const ind = independentEvents(g);
    const same =
      ind.length === seq.events.length &&
      ind.every((x, i) => {
        const e = seq.events[i]!;
        return x.h === e.homeScore && x.a === e.awayScore && x.period === e.period && x.rest === e.restSec && x.player === e.playerId && x.ft === e.freeThrow;
      });
    if (!same) {
      tally.flowMismatch += 1;
      console.log(`  得点の流れの食い違い: ${tag}`);
    }

    // 3. ラン
    const runs = maxRuns(seq.events);
    const indRuns = [independentRun(ind, true), independentRun(ind, false)];
    if ((runs[0]?.points ?? 0) !== indRuns[0] || (runs[1]?.points ?? 0) !== indRuns[1]) {
      tally.runMismatch += 1;
      console.log(`  ランの食い違い: ${tag} ${runs[0]?.points}/${runs[1]?.points} 別の書き方 ${indRuns.join("/")}`);
    }
    for (const r of runs) {
      if (r) {
        maxRunValue = Math.max(maxRunValue, r.points);
        if (r.fromSec > r.toSec || r.ownBefore < 0 || r.oppBefore < 0) tally.runMismatch += 1;
      }
    }

    // 4. クラッチ（別の書き方）
    const mine = clutchByPlayer(seq.events, g.homeScore, g.awayScore);
    const other = new Map<string, number[]>();
    {
      const states: [number, number][] = [[0, 0], ...ind.map((x) => [x.h, x.a] as [number, number])];
      const winnerHome = g.homeScore > g.awayScore ? true : g.homeScore < g.awayScore ? false : null;
      let decisive = -1;
      if (winnerHome !== null) {
        for (let s = 0; s < states.length; s += 1) {
          const m = winnerHome ? states[s]![0] - states[s]![1] : states[s]![1] - states[s]![0];
          if (m <= 0) decisive = s; // 状態 s の次の得点（イベント s）が、最後に点差が0以下だった状態からの得点
        }
      }
      ind.forEach((x, k) => {
        if (!x.player || x.period < 4) return;
        const [bh, ba] = states[k]!;
        const scoredHome = x.h > bh;
        const before = scoredHome ? bh - ba : ba - bh;
        const after = scoredHome ? x.h - x.a : x.a - x.h;
        const flags = [before <= 0 && after > 0, before < 0 && after === 0, k === decisive];
        CLUTCH_WINDOWS_SEC.forEach((w, wi) => {
          if (x.rest > w) return;
          flags.forEach((f, ki) => {
            if (!f) return;
            const arr = other.get(x.player!) ?? new Array<number>(CLUTCH_LENGTH).fill(0);
            arr[clutchIndex(wi, ki, x.ft)]! += 1;
            other.set(x.player!, arr);
          });
        });
      });
    }
    const keys = new Set([...mine.keys(), ...other.keys()]);
    let diff = false;
    for (const k of keys) if (JSON.stringify(mine.get(k) ?? null) !== JSON.stringify(other.get(k) ?? null)) diff = true;
    if (diff) {
      tally.clutchMismatch += 1;
      console.log(`  勝負所の食い違い: ${tag}`);
    }
    for (const arr of mine.values()) arr.forEach((v, i) => (clutchTotals[i]! += v));

    // 6. グラフ（同じ秒の並び替えをした試合だけ）
    if (seq.reordered > 0) {
      const periods = onCourtPeriodCount(g.season, g.quarterScores.home.length, g.raw.PlayByPlays);
      const chart = buildScoreTimeline(g.raw.PlayByPlays, { home: g.homeScore, away: g.awayScore }, periods);
      // グラフが描く点列の、リードの符号の変化の回数（0を挟む変化も1回と数える）と、正しい並びでの回数
      const signs = (diffs: number[]) => {
        let n = 0;
        let prev = 0;
        for (const d of diffs) {
          const s = Math.sign(d);
          if (s !== 0 && prev !== 0 && s !== prev) n += 1;
          if (s !== 0) prev = s;
        }
        return n;
      };
      const chartChanges = signs(chart.map((p) => p.diff));
      const rightChanges = signs(seq.events.map((e) => e.homeScore - e.awayScore));
      // 同じ x（経過秒）の点が複数あり、その中の点差の符号が揺れる箇所（縦線で逆転して見える）
      let spikes = 0;
      for (let i = 1; i < chart.length; i += 1) {
        if (chart[i]!.elapsedSec === chart[i - 1]!.elapsedSec && Math.sign(chart[i]!.diff) * Math.sign(chart[i - 1]!.diff) < 0) spikes += 1;
      }
      // 各秒の最後の点（次の秒に進むまで表示が残る値）が、正しい並びの各秒の最後の点と一致するか
      const lastOf = (pts: { elapsedSec: number; diff: number }[]) => {
        const m = new Map<number, number>();
        for (const p of pts) m.set(p.elapsedSec, p.diff);
        return m;
      };
      const chartLast = lastOf(chart);
      const rightLast = lastOf(seq.events.map((e) => ({ elapsedSec: e.elapsedSec, diff: e.homeScore - e.awayScore })));
      let wrongHold = 0;
      for (const [sec, d] of rightLast) if (chartLast.get(sec) !== d) wrongHold += 1;
      chartReport.push(`${tag}: リードの入れ替わり グラフ${chartChanges}回／正しい並び${rightChanges}回、同じ秒の中で符号が揺れる縦線 ${spikes}か所、次の秒まで残る値が違う秒 ${wrongHold}`);
    }
  }
}

console.log(`\n対象の終了済み試合: ${tally.games}`);
ok("得点の流れが完全（使わなかった得点0・最後の得点＝最終スコア）", tally.incomplete === 0, `${tally.incomplete}試合`);
ok("経過秒が逆行しない", tally.timeBackwards === 0, `${tally.timeBackwards}試合`);
ok("累計得点だけで並べた列と、得点の流れが一致", tally.flowMismatch === 0, `${tally.flowMismatch}試合`);
ok("最大のラン（別の書き方と一致）", tally.runMismatch === 0, `${tally.runMismatch}試合`);
ok("勝ち越し弾・同点弾・決勝弾（別の書き方と一致）", tally.clutchMismatch === 0, `${tally.clutchMismatch}試合`);
console.log(`\n同じ秒の並べ直しをした試合: ${tally.reorderedGames.length}試合 ${tally.reorderedGames.join(" ")}`);
console.log(`最大のランの最大: ${maxRunValue}点`);
console.log("勝負所の合計（窓5分・2分・1分 × {勝ち越し・同点・決勝弾} の [FG, FT]）:");
CLUTCH_WINDOWS_SEC.forEach((w, wi) => {
  const cells = [0, 1, 2].map((k) => `${["勝ち越し", "同点", "決勝弾"][k]} ${clutchTotals[clutchIndex(wi, k, false)]}+${clutchTotals[clutchIndex(wi, k, true)]}`);
  console.log(`  ${w / 60}分: ${cells.join(" / ")}`);
});
if (chartReport.length > 0) {
  console.log("\n試合詳細の得点推移グラフ（同じ秒の並びの食い違いのある試合）。報告のみ:");
  for (const line of chartReport) console.log(`  ${line}`);
}
void gameFilePath;
if (failures > 0) {
  console.error(`\n${failures}項目がNG`);
  process.exit(1);
}
console.log("\n全項目 ok");
