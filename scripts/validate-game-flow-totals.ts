// 最大リード・最大ランのチームスタッツ・日程への追加の検証（DESIGN.md 362章）。使い方: npm run validate:game-flow-totals（先に npm run build:data）
//  1. 試合ごとの値: 試合の生データ（プレーバイプレーの得点イベント）から数え直した最大リード・最大ラン（自チーム・相手）が、試合ログ・チームの1試合行の索引と一致する
//  2. 相手の最大ラン: 索引から作った「試合×チーム→相手の最大ラン」が、相手チームの試合ログの最大ランと一致する
//  3. 合計: チームスタッツの列（AVG LEAD・MAX LEAD・AVG RUN・MAX RUN。自チーム・opp・差）が、試合ログから手計算した値と一致する。
//     試合の流れの記録が無い試合（1810）は数えない
//  4. 日程: 日程の行に添える文（buildScheduleFlow）の最大リード・最大ランが、両チームの試合ログと一致する
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { StoredGame, TeamGameLog } from "../shared/types";
import { withChronologicalPlayByPlays } from "../shared/pbpOrder";
import { viewTeamGameIndex } from "../shared/gameIndexRead";
import { setOpponentRun } from "../src/lib/gameFlowTotals";
import { buildMiscColumns, sumTeamGameLogs, type AllTeamsRow } from "../src/lib/teamStatsColumns";
import { buildScheduleFlow, scheduleFlowTexts } from "../src/lib/scheduleFlow";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(p.endsWith(".gz") ? gunzipSync(readFileSync(p)).toString("utf8") : readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};
let failures = 0;
let ok = 0;
const check = (label: string, good: boolean, detail = "") => {
  if (good) ok += 1;
  else {
    failures += 1;
    if (failures <= 40) console.error(`NG ${label} ${detail}`);
  }
};

/** 生データから数え直す（得点イベントの累計スコアの並びで。モジュールの実装とは別の書き方） */
function recount(game: StoredGame): { homeLead: number; awayLead: number; homeRun: number; awayRun: number } | null {
  const events = withChronologicalPlayByPlays(game).raw.PlayByPlays.filter((e) => [1, 3, 4, 7, 44].includes(e.ActionCD1) && /^\d+-\d+$/.test(e.Score ?? ""));
  if (events.length === 0) return null;
  const pts = events.map((e) => {
    const [h, a] = e.Score!.split("-").map(Number);
    return { h: h!, a: a!, total: h! + a! };
  });
  pts.sort((x, y) => x.total - y.total || x.h - y.h);
  let homeLead = Math.max(0, game.homeScore - game.awayScore);
  let awayLead = Math.max(0, game.awayScore - game.homeScore);
  let ph = 0, pa = 0, runH = 0, runA = 0, bestH = 0, bestA = 0;
  for (const p of pts) {
    homeLead = Math.max(homeLead, p.h - p.a);
    awayLead = Math.max(awayLead, p.a - p.h);
    const dh = p.h - ph, da = p.a - pa;
    if (dh > 0 && da === 0) { runH += dh; runA = 0; }
    else if (da > 0 && dh === 0) { runA += da; runH = 0; }
    else { runH = 0; runA = 0; }
    bestH = Math.max(bestH, runH);
    bestA = Math.max(bestA, runA);
    ph = p.h; pa = p.a;
  }
  return { homeLead, awayLead, homeRun: bestH, awayRun: bestA };
}

const examples: string[] = [];
let gamesChecked = 0;
for (const [base, seasons] of [["", ["2025-26", "2026-27", "2017-18"]], ["/one", ["2026-27"]]] as const) {
  for (const season of seasons) {
    const dir = `${DATA}/${season}${base}`;
    const indexFile = rj(`${dir}/team-game-index.json`);
    if (!indexFile || !existsSync(`${dir}/team-games`)) continue;
    const view = viewTeamGameIndex(indexFile);
    const logsByTeam = new Map<string, TeamGameLog[]>();
    for (const f of readdirSync(`${dir}/team-games`)) logsByTeam.set(f.replace(/\.json(\.gz)?$/, ""), rj(`${dir}/team-games/${f}`) ?? []);
    // 2. 索引から作る相手の最大ラン（data.ts の fetchTeamGameLogs と同じ作り方）と、相手の試合ログの比較
    const oppRunFromIndex = new Map<string, number>();
    const stats = indexFile.rows.stats as { maxRun?: number[] };
    for (let g = 0; g < indexFile.games.key.length; g++) {
      const home = indexFile.teams[indexFile.games.home[g]!]![0];
      const away = indexFile.teams[indexFile.games.away[g]!]![0];
      const key = indexFile.games.key[g]!;
      const hr = stats.maxRun?.[g * 2] ?? -1, ar = stats.maxRun?.[g * 2 + 1] ?? -1;
      if (ar >= 0) oppRunFromIndex.set(`${key}|${home}`, ar);
      if (hr >= 0) oppRunFromIndex.set(`${key}|${away}`, hr);
    }
    let oppChecked = 0;
    for (const [teamId, logs] of logsByTeam) {
      for (const g of logs) {
        const opp = (logsByTeam.get(g.opponentTeamId) ?? []).find((x) => x.scheduleKey === g.scheduleKey);
        const fromIndex = oppRunFromIndex.get(`${g.scheduleKey}|${teamId}`);
        if (opp && opp.maxRun !== undefined) {
          check(`${season}${base} ${teamId} ${g.scheduleKey}: 相手の最大ラン（索引＝相手の試合ログ）`, fromIndex === opp.maxRun, `${fromIndex} ≠ ${opp.maxRun}`);
          oppChecked += 1;
        } else if (opp) check(`${season}${base} ${teamId} ${g.scheduleKey}: 流れの記録が無い試合に相手の最大ランが無い`, fromIndex === undefined);
        if (fromIndex !== undefined) setOpponentRun(g, fromIndex);
      }
    }
    // 1. 生データからの数え直し（シーズンの試合を間引いて）
    const keys = indexFile.games.key as string[];
    const step = season === "2017-18" ? 1 : 6;
    for (let g = 0; g < keys.length; g += step) {
      const game: StoredGame | null = rj(`${dir}/games/${keys[g]}.json`);
      if (!game) continue;
      const home = indexFile.teams[indexFile.games.home[g]!]![0];
      const away = indexFile.teams[indexFile.games.away[g]!]![0];
      const hl = (logsByTeam.get(home) ?? []).find((x) => x.scheduleKey === keys[g]);
      const al = (logsByTeam.get(away) ?? []).find((x) => x.scheduleKey === keys[g]);
      if (!hl || !al) continue;
      const rc = recount(game);
      if (!rc) {
        check(`${season}${base} ${keys[g]}: 流れの記録が無い試合は最大リード・最大ランが無い`, hl.maxLead === undefined && hl.maxRun === undefined);
        continue;
      }
      const same = hl.maxLead === rc.homeLead && hl.maxDeficit === rc.awayLead && al.maxLead === rc.awayLead && al.maxDeficit === rc.homeLead;
      check(`${season}${base} ${keys[g]}: 最大リード（生データ＝試合ログ）`, same, `ホーム ${hl.maxLead}/${rc.homeLead} アウェイ ${al.maxLead}/${rc.awayLead}`);
      check(`${season}${base} ${keys[g]}: 最大ラン（生データ＝試合ログ）`, hl.maxRun === rc.homeRun && al.maxRun === rc.awayRun, `ホーム ${hl.maxRun}/${rc.homeRun} アウェイ ${al.maxRun}/${rc.awayRun}`);
      // 4. 日程の添え書き
      const flow = buildScheduleFlow(view).get(keys[g]!);
      const text = flow ? scheduleFlowTexts(flow, "H", "A").join(" ") : "";
      check(`${season}${base} ${keys[g]}: 日程の添え書き`, text === `最大リード H ${rc.homeLead}／A ${rc.awayLead} 最大ラン H ${rc.homeRun}／A ${rc.awayRun}`, text);
      gamesChecked += 1;
      if (examples.length < 3 && season === "2025-26" && !base) examples.push(`試合${keys[g]}: ${home}/${away} → ${text}`);
    }
    // 3. 合計の列
    const cols = (p: "own" | "opp" | "diff") => new Map(buildMiscColumns("perGame", p, true, false).map((c) => [c.key, c]));
    for (const [teamId, allLogs] of logsByTeam) {
      const logs = allLogs.filter((x) => x.gameType === "regular");
      if (logs.length === 0) continue;
      const row: AllTeamsRow = { team: { teamId, teamName: teamId }, gamesPlayed: logs.length, wins: 0, losses: 0, totals: sumTeamGameLogs(logs) };
      const withLead = logs.filter((x) => x.maxLead !== undefined);
      const withRun = logs.filter((x) => x.maxRun !== undefined);
      const withOpp = logs.filter((x) => oppRunFromIndex.has(`${x.scheduleKey}|${teamId}`));
      const avg = (a: number[]) => (a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(2) : "-");
      const mx = (a: number[]) => (a.length ? String(Math.max(...a)) : "-");
      const own = cols("own"), opp = cols("opp"), diff = cols("diff");
      const L = withLead.map((x) => x.maxLead!), D = withLead.map((x) => x.maxDeficit!), R = withRun.map((x) => x.maxRun!);
      const OR = withOpp.map((x) => oppRunFromIndex.get(`${x.scheduleKey}|${teamId}`)!);
      const t = `${season}${base} ${teamId}`;
      check(`${t}: AVG LEAD 自チーム`, own.get("avglead")!.format(row) === avg(L), `${own.get("avglead")!.format(row)} ≠ ${avg(L)}`);
      check(`${t}: AVG LEAD opp（相手のリード）`, opp.get("avglead")!.format(row) === avg(D));
      check(`${t}: MAX LEAD 自チーム・opp`, own.get("maxlead")!.format(row) === mx(L) && opp.get("maxlead")!.format(row) === mx(D));
      check(`${t}: AVG RUN 自チーム`, own.get("avgrun")!.format(row) === avg(R), `${own.get("avgrun")!.format(row)} ≠ ${avg(R)}`);
      check(`${t}: AVG RUN opp（相手の最大ラン）`, opp.get("avgrun")!.format(row) === avg(OR), `${opp.get("avgrun")!.format(row)} ≠ ${avg(OR)}`);
      check(`${t}: MAX RUN 自チーム・opp`, own.get("maxrun")!.format(row) === mx(R) && opp.get("maxrun")!.format(row) === mx(OR));
      if (withLead.length > 0) {
        const d = L.reduce((s, v) => s + v, 0) / L.length - D.reduce((s, v) => s + v, 0) / D.length;
        check(`${t}: AVG LEAD 差`, diff.get("avglead")!.format(row) === (d > 0 ? "+" : "") + d.toFixed(2), diff.get("avglead")!.format(row));
      }
      if (season === "2017-18" && logs.some((x) => x.scheduleKey === "1810")) {
        check(`${t}: 1810 を数えない`, withLead.length === logs.length - 1 && row.totals.flow.leadGames === logs.length - 1);
        examples.push(`2017-18 ${teamId}: 1810 を除いた ${withLead.length}/${logs.length} 試合 → AVG LEAD ${own.get("avglead")!.format(row)}・MAX RUN ${own.get("maxrun")!.format(row)}`);
      }
    }
    void oppChecked;
  }
}
console.log(`\n確認: 試合 ${gamesChecked} 件を生データから数え直し。ok ${ok} 件`);
for (const e of examples) console.log(`  例 ${e}`);
if (failures > 0) {
  console.error(`\n${failures} 件の食い違い`);
  process.exitCode = 1;
} else console.log("\nすべて一致しました");
