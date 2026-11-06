// 全選手スタッツの個人DRtg（Dean Oliver方式。players.json の advanced.individualDrtg）の検証。
//
// 確かめること:
//  1. 2025-26 仙台の3人（カルバー・渡辺・トゥーレ）が、手で追った検算の値と一致する（NetRtg は丸める前の ORtg − DRtg）
//  2. 全シーズン・両リーグで、合計出場4分未満の選手は DRtg が無く（画面は「-」）、4分以上の選手は有限の値を持つ
//  3. 全選手（移籍した選手も）の分母は、本人が出場したレギュラーシーズンの試合だけの、その試合の所属チームの合計（playedTeamTotals。DESIGN.md 333章）。
//     試合ログ（player-games・team-games）から組み立て直した合計と一致し、DRtg・PPP（ORtg）・USG% がその合計で計算されている
//
// 使い方: npm run validate:individual-drtg（先に npm run build:data）。1つでも食い違いがあれば終了コード1

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { individualDefRtg, individualOffRtg, usagePct, type OliverBoxStats } from "../shared/formulas.ts";
import { EMPTY_TEAM_TOTALS, opponentOliverBox, sumTeamGameLogsFor, sumTeamSeasonTotals, teamOliverBox } from "../shared/teamSeasonTotals.ts";
import type { PlayerGameLog, PlayerSummary, StatTotals, TeamGameLog, TeamSeasonRawTotals } from "../shared/types.ts";
import { formatDecimal, formatSigned } from "../src/lib/format.ts";

const DATA = path.join(import.meta.dirname, "..", "data");
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok ${label}`);
  else {
    failures += 1;
    console.error(`NG ${label} ${detail}`);
  }
}

function readPlayers(file: string): PlayerSummary[] {
  const j = JSON.parse(gunzipSync(readFileSync(file)).toString()) as PlayerSummary[] | { players: PlayerSummary[] };
  return Array.isArray(j) ? j : j.players;
}

function readJson<T>(file: string): T {
  return JSON.parse(gunzipSync(readFileSync(file)).toString()) as T;
}

function toBox(t: StatTotals): OliverBoxStats {
  return { min: t.min, fgm: t.fgm, fga: t.fga, fg3m: t.tpm, ftm: t.ftm, fta: t.fta, pts: t.pts, ast: t.ast, oreb: t.oreb, dreb: t.dreb, tov: t.tov, stl: t.stl, blk: t.blk, pf: t.pf };
}

// 1. 仙台の3人（2025-26 レギュラーシーズン）
{
  const players = readPlayers(path.join(DATA, "2025-26", "players.json.gz"));
  const want: { id: string; name: string; drtg: number; drtgText: string; netText: string }[] = [
    { id: "51000531", name: "ジャレット・カルバー", drtg: 106.2096921376, drtgText: "106.21", netText: "+10.46" },
    { id: "30526", name: "渡辺 翔太", drtg: 113.9799477651, drtgText: "113.98", netText: "+8.10" },
    // トゥーレはチームの60試合のうち58試合に出場。分母を本人の出場試合にそろえて 104.10・+6.92 から変わった（DESIGN.md 333章。値は下の3で試合ログから組み立て直した分母とも一致）
    { id: "51000532", name: "ブーバカー・トゥーレ", drtg: 103.9435086663, drtgText: "103.94", netText: "+7.09" },
  ];
  for (const w of want) {
    const p = players.find((x) => x.playerId === w.id);
    const drtg = p?.advanced.individualDrtg;
    const ortg = p?.advanced.individualOrtg;
    check(`${w.name} DRtg ${w.drtgText}`, drtg !== undefined && Math.abs(drtg - w.drtg) < 1e-8 && formatDecimal(drtg) === w.drtgText, String(drtg));
    const net = ortg !== undefined && drtg !== undefined ? formatSigned(ortg - drtg) : "-";
    check(`${w.name} NetRtg ${w.netText}（丸める前の ORtg − DRtg）`, net === w.netText, net);
  }
}

// 2・3. 全シーズン・両リーグ
let seasons = 0;
let rows = 0;
let transferredChecked = 0;
let playedChecked = 0;
for (const season of readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  for (const file of [path.join(DATA, season, "players.json.gz"), path.join(DATA, season, "one", "players.json.gz")]) {
    if (!existsSync(file)) continue;
    seasons += 1;
    const short: string[] = [];
    const missing: string[] = [];
    const transferredMismatch: string[] = [];
    const totalsMismatch: string[] = [];
    const dir = path.dirname(file);
    const teamLogs = new Map<string, TeamGameLog[]>();
    const ownTeamByGame = new Map<string, string>();
    for (const f of readdirSync(path.join(dir, "team-games"))) {
      const id = f.replace(/\.json\.gz$/, "");
      const list = readJson<TeamGameLog[]>(path.join(dir, "team-games", f));
      teamLogs.set(id, list);
      for (const t of list) ownTeamByGame.set(`${t.scheduleKey}|${t.isHome}`, id);
    }
    const teamLogsOf = (id: string) => teamLogs.get(id) ?? [];
    for (const p of readPlayers(file)) {
      if (p.gamesPlayed === 0) continue;
      rows += 1;
      const drtg = p.advanced.individualDrtg;
      if (p.totals.min < 4) {
        if (drtg !== undefined) short.push(p.name);
      } else if (drtg === undefined || !Number.isFinite(drtg)) missing.push(p.name);
      // 試合ログから分母を組み立て直す: 本人が出場したレギュラーシーズンの試合を、その試合の所属チーム（試合ログの isHome と対戦相手で引く）ごとに足す
      const logs = readJson<PlayerGameLog[]>(path.join(dir, "player-games", `${p.playerId}.json.gz`)).filter((g) => g.min > 0 && g.gameType === "regular");
      const keysByTeam = new Map<string, Set<string>>();
      for (const g of logs) {
        const id = ownTeamByGame.get(`${g.scheduleKey}|${g.isHome}`);
        if (!id) continue;
        if (!keysByTeam.has(id)) keysByTeam.set(id, new Set());
        keysByTeam.get(id)!.add(g.scheduleKey);
      }
      const rebuilt = [...keysByTeam].reduce<TeamSeasonRawTotals>((acc, [id, keys]) => sumTeamSeasonTotals(acc, sumTeamGameLogsFor(teamLogsOf(id), keys)), { ...EMPTY_TEAM_TOTALS });
      const tt = p.playedTeamTotals;
      const totalsSame = !!tt && (Object.keys(rebuilt) as (keyof TeamSeasonRawTotals)[]).every((k) => Math.abs((tt[k] as number) - (rebuilt[k] as number)) < 1e-9);
      if (!totalsSame) totalsMismatch.push(p.name);
      if (tt && p.totals.min >= 4) {
        playedChecked += 1;
        if (keysByTeam.size > 1) transferredChecked += 1;
        const expect = individualDefRtg(toBox(p.totals), teamOliverBox(rebuilt), opponentOliverBox(rebuilt), rebuilt.poss);
        const expectOrtg = individualOffRtg(toBox(p.totals), teamOliverBox(rebuilt), opponentOliverBox(rebuilt));
        const expectUsg = usagePct(p.totals, rebuilt);
        const ok =
          expect !== undefined && drtg !== undefined && Math.abs(expect - drtg) < 1e-9 &&
          (expectOrtg === undefined ? p.advanced.individualOrtg === undefined : p.advanced.individualOrtg !== undefined && Math.abs(expectOrtg - p.advanced.individualOrtg) < 1e-9) &&
          // PPP は一般的な式 PTS ÷ (FGA + 0.44×FTA + TOV)（DESIGN.md 334章）。分母が0なら値なし
          (p.totals.fga + 0.44 * p.totals.fta + p.totals.tov > 0 ? p.advanced.ppp !== undefined && Math.abs(p.totals.pts / (p.totals.fga + 0.44 * p.totals.fta + p.totals.tov) - p.advanced.ppp) < 1e-9 : p.advanced.ppp === undefined) &&
          Math.abs(expectUsg - p.advanced.usagePct) < 1e-9;
        if (!ok) transferredMismatch.push(`${p.name} DRtg ${drtg}/${expect} ORtg ${p.advanced.individualOrtg}/${expectOrtg} PPP ${p.advanced.ppp} USG ${p.advanced.usagePct}/${expectUsg}`);
      }
    }
    const label = path.relative(DATA, file);
    check(`${label}: 4分未満は DRtg なし`, short.length === 0, short.join("、"));
    check(`${label}: 4分以上は DRtg あり`, missing.length === 0, missing.join("、"));
    check(`${label}: 分母（playedTeamTotals）が、本人が出場した試合の所属チームの合計と一致`, totalsMismatch.length === 0, totalsMismatch.slice(0, 10).join("、"));
    check(`${label}: DRtg・PPP・USG% が本人の出場試合の分母で計算されている`, transferredMismatch.length === 0, transferredMismatch.slice(0, 5).join("、"));
  }
}
console.log(`${seasons} ファイル・${rows} 人（分母を確かめた ${playedChecked} 人、うち移籍 ${transferredChecked} 人）を確認`);
check("移籍した選手の確認が1人以上ある", transferredChecked > 0);

if (failures > 0) {
  console.error(`NG: ${failures} 件の食い違い`);
  process.exit(1);
}
console.log("OK: 個人DRtg");
