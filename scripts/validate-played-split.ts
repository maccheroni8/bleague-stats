// 個人詳細の「出場有無」（出場した試合・出場しなかった試合。src/lib/playedSplit.ts）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  1. 全シーズン・全選手・各チームの表で、「出場した試合」＋「出場しなかった試合」の試合数・勝ち・得点の合計が、そのチームの所属期間の試合ログ
//     （試合区分で絞ったもの）と一致する。両方に入る試合・どちらにも入らない試合が無い
//  2. 「出場した試合」の試合数が、本人の出場した試合（出場時間 > 0・そのチームの試合）の数と一致する
//  3. 所属期間の外の試合が入っていない。シーズンの途中で移籍した選手は、チームごとに表が分かれ、各チームの試合だけが入る
//  4. 差の表記（diffText）の例
//
// 使い方: npm run validate:played-split。1つでも食い違いがあれば終了コード1
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import type { SeasonGameTypeFilter } from "../shared/gameType.ts";
import { filterByGameType } from "../shared/gameType.ts";
import type { GameSummary, PlayerGameLog, TeamGameLog } from "../shared/types.ts";
import { buildPlayedSplit, diffText, formatWinPct, formatWinPctDiff } from "../src/lib/playedSplit.ts";
import { buildGameTeamsByScheduleKey, resolveOwnTeam } from "../src/lib/situational.ts";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};

let ng = 0;
const fail = (msg: string) => {
  ng++;
  if (ng <= Number(process.env.NG_LIMIT ?? 30)) console.log("NG:", msg);
};

// 4. 差の表記
const cases: [string, string, string][] = [
  ["85.55", "84.00", "+1.55"],
  ["84.00", "85.55", "-1.55"],
  ["46.92%", "46.15%", "+0.77%"],
  ["200:52", "200:00", "+0:52"],
  ["200:00", "200:52", "-0:52"],
  ["1,234", "1,200", "+34"],
  ["+5.66", "+0.50", "+5.16"],
  ["-1.00", "+0.50", "-1.50"],
  ["12.00", "12.00", "0.00"],
  ["-", "12.00", "-"],
  ["12.00", "-", "-"],
  ["12.0%", "12.00", "-"],
];
for (const [a, b, want] of cases) {
  const got = diffText(a, b);
  if (got !== want) fail(`diffText(${a}, ${b}) = ${got}（期待 ${want}）`);
}
if (formatWinPct(44, 14) !== ".759" || formatWinPct(0, 0) !== "-" || formatWinPct(3, 0) !== "1.000") fail("formatWinPct");
if (formatWinPctDiff({ wins: 44, losses: 14 }, { wins: 1, losses: 1 }) !== "+.259") fail("formatWinPctDiff");

const sumPts = (logs: readonly TeamGameLog[]) => logs.reduce((s, g) => s + g.teamScore, 0);
const GAME_TYPES: SeasonGameTypeFilter[] = ["regular", "playoff", "both"];

const bases: { label: string; dir: string }[] = [];
for (const season of readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  bases.push({ label: season, dir: `${DATA}/${season}` });
  if (existsSync(`${DATA}/${season}/one`)) bases.push({ label: `${season}/one`, dir: `${DATA}/${season}/one` });
}

let checkedPlayers = 0;
let checkedBlocks = 0;
let transferred = 0;
let withNotPlayed = 0;
for (const { label, dir } of bases) {
  const summaries = rj(`${dir}/games-summary.json`) as GameSummary[] | null;
  if (!summaries || !existsSync(`${dir}/player-games`)) continue;
  const gameTeams = buildGameTeamsByScheduleKey(summaries);
  const ownTeamOf = (g: { scheduleKey: string; isHome: boolean }) => resolveOwnTeam(g, gameTeams);
  const teamLogsCache = new Map<string, TeamGameLog[]>();
  const teamLogs = (teamId: string): TeamGameLog[] | undefined => {
    if (!teamLogsCache.has(teamId)) teamLogsCache.set(teamId, rj(`${dir}/team-games/${teamId}.json`) ?? []);
    return teamLogsCache.get(teamId);
  };
  for (const f of readdirSync(`${dir}/player-games`)) {
    const playerId = f.replace(/\.json(\.gz)?$/, "");
    const logs = rj(`${dir}/player-games/${f.replace(/\.gz$/, "")}`) as PlayerGameLog[] | null;
    if (!logs || logs.length === 0) continue;
    checkedPlayers++;
    const teamIds = [...new Set(logs.map((g) => ownTeamOf(g)?.teamId).filter((x): x is string => !!x))];
    const teamLogsByTeamId = new Map<string, TeamGameLog[]>();
    for (const id of teamIds) teamLogsByTeamId.set(id, teamLogs(id)!);
    if (teamIds.length > 1) transferred++;
    for (const gameType of GAME_TYPES) {
      const blocks = buildPlayedSplit({ logs, gameType, ownTeamOf, teamLogsByTeamId });
      const seenTeams = new Set<string>();
      for (const b of blocks) {
        checkedBlocks++;
        const where = `${label} 選手${playerId} ${b.teamName} ${gameType}`;
        if (seenTeams.has(b.teamId)) fail(`${where}: チームの表が重複`);
        seenTeams.add(b.teamId);
        const all = filterByGameType(teamLogsByTeamId.get(b.teamId)!, gameType).filter((g) => g.date >= b.tenure.first && g.date <= b.tenure.last);
        const p = b.played;
        const n = b.notPlayed;
        if (n.gamesPlayed > 0) withNotPlayed++;
        // 1. 合計
        if (p.gamesPlayed + n.gamesPlayed !== all.length) fail(`${where}: 試合数 ${p.gamesPlayed}+${n.gamesPlayed} ≠ ${all.length}`);
        if (p.wins + n.wins !== all.filter((g) => g.win).length) fail(`${where}: 勝ち ${p.wins}+${n.wins}`);
        if (p.wins + p.losses !== p.gamesPlayed || n.wins + n.losses !== n.gamesPlayed) fail(`${where}: 勝敗の合計が試合数と違う`);
        if (sumPts(p.logs) + sumPts(n.logs) !== sumPts(all)) fail(`${where}: 得点の合計`);
        if (p.totals.pts + n.totals.pts !== all.reduce((s, g) => s + g.teamScore, 0)) fail(`${where}: totals.pts`);
        const keys = new Set(p.logs.map((g) => g.scheduleKey));
        if (n.logs.some((g) => keys.has(g.scheduleKey))) fail(`${where}: 両方に入る試合がある`);
        // 2. 出場した試合
        const playedRows = logs.filter((g) => g.min > 0 && ownTeamOf(g)?.teamId === b.teamId && (gameType === "both" || g.gameType === gameType));
        if (playedRows.length !== p.gamesPlayed) {
          const missing = playedRows.filter((g) => !all.some((t) => t.scheduleKey === g.scheduleKey)).length;
          fail(`${where}: 出場試合 ${playedRows.length} ≠ ${p.gamesPlayed}（チームの試合ログに無い ${missing}）`);
        }
        // 3. 所属期間の外
        if (n.logs.some((g) => g.date < b.tenure.first || g.date > b.tenure.last)) fail(`${where}: 所属期間の外の試合`);
      }
      // 移籍した選手: 出場した試合を持つチームごとに表がある
      const playedTeams = new Set(
        logs.filter((g) => g.min > 0 && (gameType === "both" || g.gameType === gameType)).map((g) => ownTeamOf(g)?.teamId).filter((x): x is string => !!x),
      );
      for (const t of playedTeams) if (!seenTeams.has(t)) fail(`${label} 選手${playerId} ${gameType}: 出場したチーム ${t} の表が無い`);
    }
  }
}
console.log(`選手・シーズン ${checkedPlayers}（うち移籍 ${transferred}）、チームの表 ${checkedBlocks}（出場しなかった試合のある表 ${withNotPlayed}）`);
if (ng > 0) {
  console.log(`食い違い ${ng} 件`);
  process.exit(1);
}
console.log("OK");
