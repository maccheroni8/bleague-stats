// LIVE TOV%・DEAD TOV%（src/components/BoxscoreTable.tsx のMiscタブ。shared/formulas.ts の tovPartPct）の照合スクリプト（検証専用）。
//
// LIVE TOV%＋DEAD TOV% が TOV%（tovPct）と一致するかを、試合の生データ（boxscore＋Yahoo!スポーツのPBP）から、
// 選手（シーズン合計）とチーム（シーズン合計）で確認する。一致しない分は、ライブ/デッドに分類できなかった
// ターンオーバー（ballType==="unknown"）と、個人に紐付かないチームターンオーバー（チームの行だけに出る）。
//
// 使い方: npm run validate:live-dead-tov -- --season 2025-26 [--rows 6]
//   （src/ のコードを使うため esbuild でまとめて実行する）

import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import { tovPartPct, tovPct } from "../shared/formulas.ts";
import { buildPlayerBoxscores, buildTeamTotalCounts, sumCountsList } from "../src/lib/boxscoreAggregate";
import type { BoxscoreCounts } from "../src/lib/boxscoreAggregate";
import type { YahooGamePbp } from "../shared/types.ts";

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback);
const season = argValue("--season", "2025-26");
const rows = Number(argValue("--rows", "6"));

const f1 = (n: number) => n.toFixed(2);
const shooting = (c: BoxscoreCounts) => ({ tov: c.tov, fga: c.pt2a + c.pt3a, fta: c.fta });

async function main() {
  const games = (await readAllGames(season)).filter((g) => g.gameEndedFlg);
  const teamAcc = new Map<string, { name: string; counts: BoxscoreCounts[]; unknown: number; teamTov: number; livePlayers: BoxscoreCounts[] }>();
  const playerAcc = new Map<string, { name: string; counts: BoxscoreCounts[] }>();
  let gamesWithYahoo = 0;
  for (const g of games) {
    const yahoo = await readJson<YahooGamePbp>(path.join(DATA_DIR, season, "yahoo", `${g.scheduleKey}.json`));
    if (!yahoo) continue;
    gamesWithYahoo++;
    const pbp = g.raw.PlayByPlays ?? [];
    for (const [teamInfo, ownRows] of [
      [g.homeTeam, g.raw.HomeBoxscores],
      [g.awayTeam, g.raw.AwayBoxscores],
    ] as const) {
      const players = buildPlayerBoxscores(ownRows, undefined, pbp, yahoo.turnovers);
      const total = buildTeamTotalCounts(ownRows, undefined);
      const sum = sumCountsList(players.map((p) => p.counts));
      const teamCounts: BoxscoreCounts = { ...total, liveTov: sum.liveTov, deadTov: sum.deadTov };
      const acc = teamAcc.get(teamInfo.id) ?? { name: teamInfo.name, counts: [], unknown: 0, teamTov: 0, livePlayers: [] };
      acc.counts.push(teamCounts);
      acc.unknown += yahoo.turnovers.filter((t) => t.teamId === teamInfo.id && !t.isTeamTurnover && t.ballType === "unknown").length;
      acc.teamTov += yahoo.turnovers.filter((t) => t.teamId === teamInfo.id && t.isTeamTurnover).length;
      teamAcc.set(teamInfo.id, acc);
      for (const p of players) {
        const pa = playerAcc.get(p.playerId) ?? { name: p.nameJ, counts: [] };
        pa.counts.push(p.counts);
        playerAcc.set(p.playerId, pa);
      }
    }
  }
  console.log(`${season}: 試合 ${games.length}、Yahoo!のPBPがある試合 ${gamesWithYahoo}`);

  // ---- チーム（シーズン合計）----
  console.log("\n【チーム（シーズン合計）】LIVE TOV% / DEAD TOV% / 合計 / TOV% / 差 | TOV, LIVE+DEAD, 分類不能, チームTOV(Yahoo)");
  let teamDiffMax = 0;
  const teamLines: string[] = [];
  for (const [, t] of teamAcc) {
    const c = sumCountsList(t.counts);
    const s = shooting(c);
    const live = tovPartPct(c.liveTov, s.tov, s.fga, s.fta);
    const dead = tovPartPct(c.deadTov, s.tov, s.fga, s.fta);
    const tv = tovPct(s.tov, s.fga, s.fta);
    teamDiffMax = Math.max(teamDiffMax, Math.abs(live + dead - tv));
    teamLines.push(`${t.name.padEnd(10)} ${f1(live)} / ${f1(dead)} / ${f1(live + dead)} / ${f1(tv)} / ${f1(live + dead - tv)} | ${s.tov}, ${c.liveTov + c.deadTov}, ${t.unknown}, ${t.teamTov}`);
  }
  teamLines.slice(0, rows).forEach((l) => console.log(l));
  console.log(`  全${teamAcc.size}チームの |LIVE+DEAD−TOV%| の最大: ${f1(teamDiffMax)}ポイント`);

  // ---- 選手（シーズン合計。TOVが多い順）----
  console.log("\n【選手（シーズン合計。TOV上位）】LIVE TOV% / DEAD TOV% / 合計 / TOV% / 差 | TOV, LIVE+DEAD");
  const playerRows = [...playerAcc.values()]
    .map((p) => ({ p, c: sumCountsList(p.counts) }))
    .sort((a, b) => b.c.tov - a.c.tov);
  playerRows.slice(0, rows).forEach(({ p, c }) => {
    const s = shooting(c);
    const live = tovPartPct(c.liveTov, s.tov, s.fga, s.fta);
    const dead = tovPartPct(c.deadTov, s.tov, s.fga, s.fta);
    const tv = tovPct(s.tov, s.fga, s.fta);
    console.log(`${p.name.padEnd(12)} ${f1(live)} / ${f1(dead)} / ${f1(live + dead)} / ${f1(tv)} / ${f1(live + dead - tv)} | ${s.tov}, ${c.liveTov + c.deadTov}`);
  });
  let exact = 0;
  let maxDiff = 0;
  let sumShort = 0;
  for (const { c } of playerRows) {
    const s = shooting(c);
    const d = tovPartPct(c.liveTov + c.deadTov, s.tov, s.fga, s.fta) - tovPct(s.tov, s.fga, s.fta);
    if (c.liveTov + c.deadTov === c.tov) exact++;
    else sumShort++;
    maxDiff = Math.max(maxDiff, Math.abs(d));
  }
  console.log(`  全${playerRows.length}選手のうち、LIVE+DEADがTOVと一致 ${exact}人、一致しない ${sumShort}人（|差|の最大 ${f1(maxDiff)}ポイント）`);
}

main();
