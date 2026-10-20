// チーム詳細の「対戦相手別」（DESIGN.md 276章。src/lib/opponentSplit.ts）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  チーム
//  1. 相手ごとの合計（試合数・勝敗・各項目の合計）を全部足すと、「全体」の行と一致する（レギュラー・ポストシーズン・合算）
//  2. レギュラーシーズンの「全体」の行が、teams.json の同じ値と一致する（試合数・合計の主な項目・
//     Forced TOV の種類別〔奪った・された〕・Shooting のシュートの種類別・On-Court Foreign の人数別の秒数）
//  3. 「全体」の行の Periods が、試合ログの区間別の得点の合計と一致する
//
// 使い方: npm run validate:opponent-split。1つでも食い違いがあれば終了コード1
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { filterByGameType, type SeasonGameTypeFilter } from "../shared/gameType.ts";
import { buildOpponentSplitRows, foreignSplitData, pbpsOf, shootingSplitData, sumForcedTurnovers } from "../src/lib/opponentSplit.ts";
import { sumTeamGameLogs } from "../src/lib/teamStatsColumns.ts";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};

const seasons = readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
let ng = 0;
const fail = (msg: string) => {
  ng++;
  if (ng <= Number(process.env.NG_LIMIT ?? 30)) console.log("NG:", msg);
};

const TOTAL_KEYS = ["pts", "oppPts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf", "fd", "min", "poss", "pt2in", "fb", "pt2nd", "pft", "dunks"] as const;
const TEAMS_JSON_KEYS: [string, string][] = [
  ["pts", "pts"],
  ["fgm", "fgm"],
  ["fga", "fga"],
  ["tpm", "tpm"],
  ["tpa", "tpa"],
  ["ftm", "ftm"],
  ["fta", "fta"],
  ["oreb", "oreb"],
  ["dreb", "dreb"],
  ["reb", "reb"],
  ["ast", "ast"],
  ["tov", "tov"],
  ["stl", "stl"],
  ["blk", "blk"],
  ["pf", "pf"],
  ["fd", "foulsDrawn"],
  ["min", "min"],
];

let checkedTeams = 0;
let checkedForced = 0;
let checkedShots = 0;
let checkedForeign = 0;
for (const season of seasons) {
  const teams = rj(`${DATA}/${season}/teams.json`);
  if (!teams) continue;
  for (const t of teams) {
    const logs = rj(`${DATA}/${season}/team-games/${t.teamId}.json`);
    if (!logs) continue;
    checkedTeams++;
    // 1. 相手ごとの合計 = 全体
    for (const gameType of ["regular", "playoff", "both"] as SeasonGameTypeFilter[]) {
      const scoped = filterByGameType(logs, gameType);
      const { rows, total } = buildOpponentSplitRows(t.teamId, scoped);
      if (total.gamesPlayed !== scoped.length) fail(`${season} ${t.teamId} ${gameType}: 全体の試合数`);
      if (rows.reduce((s, r) => s + r.gamesPlayed, 0) !== total.gamesPlayed) fail(`${season} ${t.teamId} ${gameType}: 相手ごとの試合数の合計`);
      if (rows.reduce((s, r) => s + r.wins, 0) !== total.wins) fail(`${season} ${t.teamId} ${gameType}: 相手ごとの勝ちの合計`);
      const sum = sumTeamGameLogs(scoped);
      for (const k of TOTAL_KEYS) {
        const bySum = rows.reduce((s, r) => s + (r.totals[k] as number), 0);
        const whole = total.totals[k] as number;
        if (Math.abs(bySum - whole) > 1e-6 || Math.abs(whole - (sum[k] as number)) > 1e-6) fail(`${season} ${t.teamId} ${gameType}: ${k} 相手ごと ${bySum} 全体 ${whole}`);
      }
      // 3. Periods
      const sumFull = rows.reduce((s, r) => s + r.scoring.full.pts, 0);
      if (Math.abs(sumFull - total.scoring.full.pts) > 1e-6) fail(`${season} ${t.teamId} ${gameType}: Periods 試合の得点`);
    }
    // 2. teams.json との一致（レギュラーシーズン）
    const regular = filterByGameType(logs, "regular");
    const { rows: regularRows, total: regularTotal } = buildOpponentSplitRows(t.teamId, regular);
    if (regularTotal.gamesPlayed !== t.gamesPlayed) fail(`${season} ${t.teamId}: 試合数 ${regularTotal.gamesPlayed} teams.json ${t.gamesPlayed}`);
    for (const [k, tk] of TEAMS_JSON_KEYS) {
      const a = regularTotal.totals[k as keyof typeof regularTotal.totals] as number;
      const b = t.totals[tk] as number;
      if (Math.abs(a - b) > 1e-6) fail(`${season} ${t.teamId}: ${k} ${a} teams.json ${b}`);
    }
    // Forced TOV・Shooting（スポーツナビの記録があるシーズンだけ）
    if (t.forcedTurnovers || t.shotTypes) {
      const pbp = new Map<string, any>();
      for (const g of logs) {
        const p = rj(`${DATA}/${season}/yahoo/${g.scheduleKey}.json`);
        if (p) pbp.set(g.scheduleKey, p);
      }
      if (t.forcedTurnovers) {
        checkedForced++;
        const { forced, committed } = sumForcedTurnovers(pbpsOf(regular, pbp), t.teamId);
        for (const k of Object.keys(t.forcedTurnovers)) {
          if ((forced as any)[k] !== t.forcedTurnovers[k]) fail(`${season} ${t.teamId}: Forced ${k} ${(forced as any)[k]} teams.json ${t.forcedTurnovers[k]}`);
          if ((committed as any)[k] !== t.turnoversCommitted[k]) fail(`${season} ${t.teamId}: Committed ${k} ${(committed as any)[k]} teams.json ${t.turnoversCommitted[k]}`);
        }
        // 相手ごとの合計も全体に一致
        for (const k of Object.keys(forced) as (keyof typeof forced)[]) {
          const bySum = regularRows.reduce((s, r) => s + sumForcedTurnovers(pbpsOf(r.logs, pbp), t.teamId).forced[k], 0);
          if (bySum !== forced[k]) fail(`${season} ${t.teamId}: Forced ${k} 相手ごとの合計 ${bySum} 全体 ${forced[k]}`);
        }
      }
      if (t.shotTypes) {
        checkedShots++;
        const data = shootingSplitData([regularTotal, ...regularRows], pbp, t.teamId, "own");
        const whole = data.byKey.get(regularTotal.key)!;
        for (const type of new Set([...Object.keys(whole), ...Object.keys(t.shotTypes)])) {
          for (const split of ["twoPoint", "threePoint"] as const) {
            const a = whole[type]?.[split] ?? { made: 0, attempted: 0 };
            const b = t.shotTypes[type]?.[split] ?? { made: 0, attempted: 0 };
            if (a.made !== b.made || a.attempted !== b.attempted) fail(`${season} ${t.teamId}: Shooting ${type} ${split} ${a.made}/${a.attempted} teams.json ${b.made}/${b.attempted}`);
            const bySum = regularRows.reduce(
              (s, r) => ({ made: s.made + (data.byKey.get(r.key)?.[type]?.[split]?.made ?? 0), attempted: s.attempted + (data.byKey.get(r.key)?.[type]?.[split]?.attempted ?? 0) }),
              { made: 0, attempted: 0 },
            );
            if (bySum.made !== a.made || bySum.attempted !== a.attempted) fail(`${season} ${t.teamId}: Shooting ${type} ${split} 相手ごとの合計`);
          }
        }
      }
    }
    // On-Court Foreign
    if (t.foreignPlayerCourtSeconds) {
      checkedForeign++;
      const data = foreignSplitData([regularTotal], "own");
      const share = data.shares.get(regularTotal.key)!;
      const tj = t.foreignPlayerCourtSeconds as number[];
      for (let n = 0; n < 5; n++) if (share.seconds[n] !== (tj[n] ?? 0)) fail(`${season} ${t.teamId}: OC${n} ${share.seconds[n]} teams.json ${tj[n]}`);
    }
  }
}

console.log(`チーム・シーズン ${checkedTeams} 件を確認（Forced TOV ${checkedForced}・Shooting ${checkedShots}・On-Court Foreign ${checkedForeign}）`);
console.log(ng === 0 ? "OK: すべて一致" : `NG: ${ng} 件の食い違い`);
process.exit(ng === 0 ? 0 : 1);
