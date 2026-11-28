// ラインナップ検索の人数ごと・組み合わせごとの行（src/lib/lineupSearch.ts の searchLineupSplit）と、
// 対戦相手別タブの勝敗に足す結果だけの試合（src/lib/opponentSplit.ts の withResultOnlyRecords）の検証。DESIGN.md 482章
//
// 1. 全員出場の行が今までの Players On（searchLineup "on"）、0人出場の行が Players Off（searchLineup "off"）と同じ
// 2. 人数の行の出場時間・数え上げを足すと、対象の試合（選んだ選手の誰かが出場した試合）の区間を素直に足した値と同じ
// 3. 組み合わせの行を足すと、その人数の行と同じ（出場時間・数え上げ）
// 4. Traditional・Advanced の列: 自チームの PTS が得失点タブの得点と同じ、opp の視点が自チームと相手を入れ替えた値、+/- が差
// 5. 対戦相手別: 人工の例（結果だけの試合しかない相手・既にある相手）と、2026-27 の全チームで「全体」の勝敗が teams.json の勝敗と同じ
//
// 使い方: npm run validate:lineup-split [-- --seasons 2016-17,2026-27]

import path from "node:path";
import { readdirSync, existsSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { masksOfCount, playerSecondsOf, searchLineup, searchLineupSplit, splitTotalsToResult, type LineupSplitTotals } from "../src/lib/lineupSearch.ts";
import { LINEUP_ADVANCED_COLUMNS, LINEUP_TRADITIONAL_COLUMNS, lineupStatValue } from "../src/lib/lineupSearchStats.ts";
import { buildOpponentSplitRows, withResultOnlyRecords } from "../src/lib/opponentSplit.ts";
import { resultOnlyLogsForTeam } from "../src/lib/resultOnlyGames.ts";
import { filterByGameType } from "../shared/gameType.ts";
import type { ScheduleFileExtended } from "../shared/resultOnlyGames.ts";
import type { TeamGameLog, TeamStintsFile, TeamSummary } from "../shared/types.ts";

const args = process.argv.slice(2);
const seasonsArg = args.includes("--seasons") ? args[args.indexOf("--seasons") + 1] : undefined;

let failures = 0;
let checks = 0;
function check(ok: boolean, message: () => string) {
  checks += 1;
  if (!ok) {
    failures += 1;
    if (failures <= 20) console.log("  NG: " + message());
  }
}

/** 対戦相手別の行で見る値（行の型は画面の部品の型を含むので、検証では必要な値だけを見る） */
interface SplitRowView {
  opponentTeamId: string | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  resultOnlyGames?: number;
  logs: unknown[];
}
function splitView(teamId: string, logs: TeamGameLog[], extra: TeamGameLog[]): { rows: SplitRowView[]; total: SplitRowView } {
  return withResultOnlyRecords(teamId, buildOpponentSplitRows(teamId, logs), extra) as unknown as { rows: SplitRowView[]; total: SplitRowView };
}

const sameTotals = (a: LineupSplitTotals, b: { seconds: number; own: number[]; opp: number[] }) =>
  a.seconds === b.seconds && a.own.every((v, i) => v === b.own[i]) && a.opp.every((v, i) => v === b.opp[i]);

async function checkSeason(season: string, regularKeys: Set<string>) {
  const dir = path.join(DATA_DIR, season, "team-stints");
  if (!existsSync(dir)) return;
  const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz") || f.endsWith(".json"));
  for (const f of files) {
    const file = await readJson<TeamStintsFile>(path.join(dir, f.replace(/\.gz$/, "")));
    if (!file) continue;
    const top = [...playerSecondsOf(file).entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const nKeys = file.countKeys.length;
    const configs = [
      { name: "全試合・全ピリオド", includeGame: () => true, periods: null as number[] | null },
      { name: "レギュラー・2Q", includeGame: (k: string) => regularKeys.has(k), periods: [2] },
      { name: "全試合・延長", includeGame: () => true, periods: [5, 6, 7, 8] },
    ];
    // 1〜5人（出場時間の上位から）と、出場時間の少ない選手を混ぜた組
    const picks = [top.slice(0, 1), top.slice(0, 2), top.slice(0, 3), top.slice(0, 5), [top[0]!, top[top.length - 1]!, top[Math.floor(top.length / 2)]!]];
    for (const cfg of configs) {
      for (const ids of picks) {
        const label = `${season} ${file.teamId} ${cfg.name} ${ids.length}人`;
        const split = searchLineupSplit(file, ids, cfg);
        const size = split.size;
        check(size === ids.length, () => `${label}: 人数 ${size}`);
        // 1. 今までの On・Off と同じ
        const on = searchLineup(file, ids, "on", cfg);
        const off = searchLineup(file, ids, "off", cfg);
        check(JSON.stringify(on) === JSON.stringify(splitTotalsToResult(split.byCount[size]!)), () => `${label}: 全員出場 ${JSON.stringify(splitTotalsToResult(split.byCount[size]!))} / On ${JSON.stringify(on)}`);
        check(JSON.stringify(off) === JSON.stringify(splitTotalsToResult(split.byCount[0]!)), () => `${label}: 0人出場 ${JSON.stringify(splitTotalsToResult(split.byCount[0]!))} / Off ${JSON.stringify(off)}`);
        // 2. 対象の試合の区間を素直に足す
        const selected = new Set(ids.map((id) => file.players.indexOf(id)));
        const appeared = new Set<number>();
        for (const row of file.rows) if (row[3]! > row[2]! && row.slice(4, 9).some((n) => selected.has(n))) appeared.add(row[0]!);
        const ref = { seconds: 0, own: new Array<number>(nKeys).fill(0), opp: new Array<number>(nKeys).fill(0) };
        for (const row of file.rows) {
          if (!appeared.has(row[0]!) || !cfg.includeGame(file.games[row[0]!]!)) continue;
          if (cfg.periods !== null && !cfg.periods.includes(row[1]!)) continue;
          ref.seconds += row[3]! - row[2]!;
          for (let k = 0; k < nKeys; k += 1) {
            ref.own[k]! += row[9 + k]!;
            ref.opp[k]! += row[9 + nKeys + k]!;
          }
        }
        const sum = { seconds: 0, own: new Array<number>(nKeys).fill(0), opp: new Array<number>(nKeys).fill(0) };
        for (const t of split.byCount) {
          sum.seconds += t.seconds;
          t.own.forEach((v, i) => (sum.own[i]! += v));
          t.opp.forEach((v, i) => (sum.opp[i]! += v));
        }
        check(sum.seconds === ref.seconds && sum.seconds === split.totalSeconds, () => `${label}: 人数の行の時間の合計 ${sum.seconds} / 対象の試合 ${ref.seconds}`);
        check(sum.own.every((v, i) => v === ref.own[i]) && sum.opp.every((v, i) => v === ref.opp[i]), () => `${label}: 人数の行の数え上げの合計が対象の試合と違う`);
        // 3. 組み合わせの合計＝人数の行
        for (let c = 1; c < size; c += 1) {
          const s = { seconds: 0, own: new Array<number>(nKeys).fill(0), opp: new Array<number>(nKeys).fill(0) };
          for (const m of masksOfCount(size, c)) {
            const t = split.byMask.get(m);
            if (!t) continue;
            s.seconds += t.seconds;
            t.own.forEach((v, i) => (s.own[i]! += v));
            t.opp.forEach((v, i) => (s.opp[i]! += v));
          }
          check(sameTotals(split.byCount[c]!, s), () => `${label}: ${c}人出場の組み合わせの合計が人数の行と違う`);
        }
        // 4. 列の値
        const t = split.byCount[size]!;
        if (t.games > 0) {
          const r = splitTotalsToResult(t);
          const pts = LINEUP_TRADITIONAL_COLUMNS.find((c) => c.key === "pts")!;
          check(lineupStatValue(pts, t, "total", "own") === r.ownPoints && lineupStatValue(pts, t, "total", "opp") === r.oppPoints, () => `${label}: PTS の列が得点・失点と違う`);
          check(lineupStatValue(pts, t, "total", "diff") === r.ownPoints - r.oppPoints, () => `${label}: PTS の +/- が得失点と違う`);
          const swapped: LineupSplitTotals = { ...t, own: t.opp, opp: t.own };
          for (const c of [...LINEUP_TRADITIONAL_COLUMNS, ...LINEUP_ADVANCED_COLUMNS]) {
            if (!c.opp) continue;
            const a = lineupStatValue(c, t, "perGame", "opp");
            const b = lineupStatValue(c, swapped, "perGame", "own");
            check(a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9), () => `${label}: ${c.label} の opp が入れ替えた自チームと違う（${a} / ${b}）`);
          }
          const ortg = LINEUP_ADVANCED_COLUMNS.find((c) => c.key === "ortg")!;
          const drtg = LINEUP_ADVANCED_COLUMNS.find((c) => c.key === "drtg")!;
          const close = (x: number | null, y: number | null) => (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) < 1e-9);
          const o = r.ownPoss > 0 ? (100 * r.ownPoints) / r.ownPoss : null;
          const d = r.oppPoss > 0 ? (100 * r.oppPoints) / r.oppPoss : null;
          check(close(lineupStatValue(ortg, t, "perGame", "own"), o) && close(lineupStatValue(drtg, t, "perGame", "own"), d), () => `${label}: ORtg・DRtg が得失点タブと違う`);
        }
      }
    }
  }
}

function syntheticOpponentSplit() {
  const log = (key: string, opp: string, win: boolean): TeamGameLog =>
    ({ scheduleKey: key, date: `2026-11-${key.padStart(2, "0")}`, gameType: "regular", isHome: true, win, teamScore: win ? 80 : 70, opponentScore: win ? 70 : 80, opponentTeamId: opp, opponentTeamName: `相手${opp}` }) as unknown as TeamGameLog;
  const logs = [log("1", "A", true), log("2", "A", false), log("3", "B", true)];
  const resultOnly = [log("4", "A", true), log("5", "C", true), log("6", "C", false)];
  const { rows, total } = splitView("T", logs, resultOnly);
  const a = rows.find((r) => r.opponentTeamId === "A")!;
  const b = rows.find((r) => r.opponentTeamId === "B")!;
  const c = rows.find((r) => r.opponentTeamId === "C")!;
  check(a.gamesPlayed === 2 && a.wins === 2 && a.losses === 1 && a.resultOnlyGames === 1, () => `人工の例: A ${JSON.stringify({ g: a.gamesPlayed, w: a.wins, l: a.losses, r: a.resultOnlyGames })}`);
  check(b.gamesPlayed === 1 && b.wins === 1 && b.losses === 0 && !b.resultOnlyGames, () => `人工の例: B ${JSON.stringify({ g: b.gamesPlayed, w: b.wins, l: b.losses })}`);
  check(!!c && c.gamesPlayed === 0 && c.wins === 1 && c.losses === 1 && c.logs.length === 0, () => `人工の例: 結果だけの相手 C の行`);
  check(total.gamesPlayed === 3 && total.wins === 4 && total.losses === 2 && total.resultOnlyGames === 3, () => `人工の例: 全体 ${JSON.stringify({ g: total.gamesPlayed, w: total.wins, l: total.losses })}`);
  const none = splitView("T", logs, []);
  check(none.total.wins === 2 && none.total.losses === 1, () => "人工の例: 結果だけの試合が無いとき勝敗が変わる");
}

async function realOpponentSplit(season: string) {
  const schedule = await readJson<ScheduleFileExtended>(path.join(DATA_DIR, season, "schedule.json"));
  const teams = await readJson<TeamSummary[] | { teams: TeamSummary[] }>(path.join(DATA_DIR, season, "teams.json"));
  if (!schedule || !teams) return;
  const list = Array.isArray(teams) ? teams : teams.teams;
  let n = 0;
  let withResultOnly = 0;
  for (const t of list) {
    const raw = await readJson<TeamGameLog[] | { games: TeamGameLog[] }>(path.join(DATA_DIR, season, "team-games", `${t.teamId}.json`));
    if (!raw) continue;
    const logs = Array.isArray(raw) ? raw : raw.games;
    const scoped = filterByGameType(logs, "regular");
    const extra = filterByGameType(resultOnlyLogsForTeam(schedule.resultOnlyGames, t.teamId, new Set(logs.map((l) => l.scheduleKey))), "regular");
    const { rows, total } = splitView(t.teamId, scoped, extra);
    n += 1;
    if (extra.length > 0) withResultOnly += 1;
    check(total.wins === t.wins && total.losses === t.losses, () => `${season} ${t.teamName}: 対戦相手別の全体 ${total.wins}-${total.losses} / teams.json ${t.wins}-${t.losses}`);
    check(total.gamesPlayed === scoped.length, () => `${season} ${t.teamName}: 全体の G が試合ログの数と違う`);
    const sumW = rows.reduce((s, r) => s + r.wins, 0);
    const sumL = rows.reduce((s, r) => s + r.losses, 0);
    check(sumW === total.wins && sumL === total.losses, () => `${season} ${t.teamName}: 相手ごとの勝敗の合計 ${sumW}-${sumL} / 全体 ${total.wins}-${total.losses}`);
  }
  console.log(`[5] ${season} 対戦相手別: ${n}チーム（結果だけの試合があるチーム ${withResultOnly}）`);
}

async function main() {
  const allSeasons = readdirSync(DATA_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
  const seasons = seasonsArg ? seasonsArg.split(",") : allSeasons;
  for (const season of seasons) {
    const before = checks;
    const summaryKeys = new Set<string>();
    for (const f of existsSync(path.join(DATA_DIR, season, "team-games")) ? readdirSync(path.join(DATA_DIR, season, "team-games")) : []) {
      const raw = await readJson<TeamGameLog[] | { games: TeamGameLog[] }>(path.join(DATA_DIR, season, "team-games", f.replace(/\.gz$/, "")));
      const logs = raw ? (Array.isArray(raw) ? raw : raw.games) : [];
      for (const l of logs) if (l.gameType === "regular") summaryKeys.add(l.scheduleKey);
    }
    await checkSeason(season, summaryKeys);
    console.log(`[1-4] ${season}: ${checks - before}件`);
  }
  syntheticOpponentSplit();
  await realOpponentSplit("2026-27");
  console.log(`確認 ${checks}件・NG ${failures}件`);
  if (failures > 0) process.exit(1);
}

main();
