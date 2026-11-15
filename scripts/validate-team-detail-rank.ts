// チーム詳細のチームスタッツの順位と色（DESIGN.md 406章）の検証。npm run build:data のあとに実行（外には問い合わせない）。
// 確かめること: ①順位がランキング（teamRankOf）と同じ・同じ値は同じ順位で次は飛ばす ②上位3位・下位3位の色が、良し悪しの向きに合う
// （少ないほど良い TOV・F は、少ないチームが上位・多いチームが下位。opp は反転）③良し悪しなしの項目（POSS・PACE・BENCH PTS など）は順位も色も付かない
// ④チームが6以下のときは色を付けない。使い方: npm run validate:team-detail-rank
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamGameLog } from "../shared/types";
import { filterByGameType } from "../shared/gameType";
import { teamRankOf, teamRanksOf } from "../src/lib/compareRank";
import { buildTeamCategoryColumns } from "../src/lib/teamSeasonRanking";
import { sumTeamGameLogs, type AllTeamsRow, type TeamPerspective } from "../src/lib/teamStatsColumns";

const DATA = path.resolve("data");
const read = (p: string) => JSON.parse(gunzipSync(fs.readFileSync(p)).toString("utf8"));

for (const season of ["2025-26", "2021-22"]) {
  const raw = read(path.join(DATA, season, "teams.json.gz"));
  const teams: Array<{ teamId: string }> = Array.isArray(raw) ? raw : raw.teams;
  const rows: AllTeamsRow[] = [];
  for (const t of teams) {
    const f = path.join(DATA, season, "team-games", `${t.teamId}.json.gz`);
    if (!fs.existsSync(f)) continue;
    const logs = filterByGameType(read(f) as TeamGameLog[], "regular");
    if (logs.length === 0) continue;
    const wins = logs.filter((g) => g.win).length;
    rows.push({ team: { teamId: t.teamId, teamName: "" }, gamesPlayed: logs.length, wins, losses: logs.length - wins, totals: sumTeamGameLogs(logs) });
  }
  assert(rows.length > 6, `${season}: チームが少ない`);
  for (const perspective of ["own", "opp"] as TeamPerspective[]) {
    for (const category of ["traditional", "advanced", "misc", "scoring"] as const) {
      const cols = buildTeamCategoryColumns(category, "perGame", perspective, true, true, false);
      for (const col of cols) {
        const ranks = teamRanksOf(rows, col, perspective);
        if (!ranks) continue;
        for (const [teamId, r] of ranks) {
          assert.equal(r.rank, teamRankOf(rows, col, perspective, teamId), `${season} ${perspective} ${col.key}: ランキングと同じ順位`);
          assert(r.rank >= 1 && r.rank <= r.total);
        }
        // 順位の向き: 1位の値が、良い方の端
        const list = [...ranks].map(([id, r]) => ({ r, v: Number(col.sortValue(rows.find((x) => x.team.teamId === id)!)) }));
        const top = list.filter((x) => x.r.rank === 1).map((x) => x.v)[0]!;
        const higher = col.higherIsBetter !== false;
        for (const x of list) assert(higher ? x.v <= top + 1e-9 : x.v >= top - 1e-9, `${season} ${perspective} ${col.key}: 1位が最良`);
        // 色: 上位3位以内が top・下位3位以内が bottom・重ならない
        for (const x of list) {
          if (x.r.tier === "top") assert(x.r.rank <= 3);
          if (x.r.tier === "bottom") assert(x.r.rank > 3);
        }
        // 全チームが同じ値でないとき、上位・下位の色が付く（OFF FOUL・CHARGE はピリオド別の索引から出すので、ここでは試合ログだけの 0 になる）
        if (new Set(list.map((x) => x.r.rank)).size > 3) assert(list.some((x) => x.r.tier === "top") && list.some((x) => x.r.tier === "bottom"), `${season} ${col.key}: 上位・下位の色が付く`);
      }
    }
  }
  // 少ないほど良い項目（TOV）は、少ないチームが上位（緑）・多いチームが下位（赤）。opp は反転
  const tovOwn = teamRanksOf(rows, buildTeamCategoryColumns("traditional", "perGame", "own", true, true, false).find((c) => c.key === "tov")!, "own")!;
  const tovOpp = teamRanksOf(rows, buildTeamCategoryColumns("traditional", "perGame", "opp", true, true, false).find((c) => c.key === "tov")!, "opp")!;
  const byTov = [...rows].sort((a, b) => a.totals.tov / a.gamesPlayed - b.totals.tov / b.gamesPlayed);
  assert.equal(tovOwn.get(byTov[0]!.team.teamId)!.tier, "top", `${season} TOV: 最少が上位（緑）`);
  assert.equal(tovOwn.get(byTov[byTov.length - 1]!.team.teamId)!.tier, "bottom", `${season} TOV: 最多が下位（赤）`);
  const byOppTov = [...rows].sort((a, b) => b.totals.oppTov / b.gamesPlayed - a.totals.oppTov / a.gamesPlayed);
  assert.equal(tovOpp.get(byOppTov[0]!.team.teamId)!.tier, "top", `${season} opp TOV: 相手のTOVが最多（奪った数が最多）が上位`);
  assert.equal(tovOpp.get(byOppTov[byOppTov.length - 1]!.team.teamId)!.tier, "bottom");
  // 良し悪しなし
  for (const key of ["poss", "pace"]) {
    const col = buildTeamCategoryColumns("advanced", "perGame", "own", true, true, false).find((c) => c.key === key)!;
    assert.equal(teamRanksOf(rows, col, "own"), null, `${key} は順位を付けない`);
  }
  assert.equal(teamRanksOf(rows, buildTeamCategoryColumns("misc", "perGame", "own", true, true, false).find((c) => c.key === "benchPts")!, "own"), null);
  // 6チーム以下は色なし
  const few = teamRanksOf(rows.slice(0, 6), buildTeamCategoryColumns("traditional", "perGame", "own", true, true, false).find((c) => c.key === "pts")!, "own")!;
  assert([...few.values()].every((r) => r.tier === null), "6チーム以下は色を付けない");
  console.log(`${season}: OK（${rows.length}チーム）`);
}
console.log("validate-team-detail-rank: OK");
