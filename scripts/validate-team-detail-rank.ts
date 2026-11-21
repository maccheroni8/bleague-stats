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
import { isRankOnlyKey } from "../src/lib/rankDirection";
import { buildTeamCategoryColumns } from "../src/lib/teamSeasonRanking";
import { sumTeamGameLogs, type AllTeamsRow, type TeamPerspective } from "../src/lib/teamStatsColumns";

const DATA = path.resolve("data");
const read = (p: string) => JSON.parse(gunzipSync(fs.readFileSync(p)).toString("utf8"));

const rankOnlySeen = new Set<string>();
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
        const higher = isRankOnlyKey(col.key) || col.higherIsBetter !== false; // 色なし順位の項目は視点によらず多い順
        for (const x of list) assert(higher ? x.v <= top + 1e-9 : x.v >= top - 1e-9, `${season} ${perspective} ${col.key}: 1位が最良`);
        // 色なしで順位だけ出す項目（408章）は、色（tier）が常に無い
        if (isRankOnlyKey(col.key)) {
          assert(list.every((x) => x.r.tier === null), `${season} ${perspective} ${col.key}: 色なし`);
          rankOnlySeen.add(col.key);
          continue;
        }
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
  for (const key of ["g", "gs", "min", "usg"]) {
    for (const category of ["traditional", "advanced", "misc", "scoring"] as const) {
      const col = buildTeamCategoryColumns(category, "perGame", "own", true, true, false).find((c) => c.key === key);
      if (col) assert.equal(teamRanksOf(rows, col, "own"), null, `${key} は順位を付けない`);
    }
  }
  // シーズン別成績（rankAllNeutral）: 良し悪しなしの項目も、色なしで多い順の順位を出す（DESIGN.md 455章）
  for (const [category, key] of [["traditional", "min"], ["advanced", "poss"], ["advanced", "pace"]] as const) {
    const col = buildTeamCategoryColumns(category, "perGame", "own", true, true, false).find((c) => c.key === key)!;
    const ranks = teamRanksOf(rows, col, "own", true);
    assert(ranks && ranks.size > 0, `${season} ${key}: rankAllNeutral で順位が付く`);
    assert([...ranks!.values()].every((r) => r.tier === null), `${season} ${key}: 色は付けない`);
    const best = Math.max(...[...ranks!.keys()].map((id) => Number(col.sortValue(rows.find((x) => x.team.teamId === id)!))));
    const first = [...ranks!].filter(([, r]) => r.rank === 1).map(([id]) => Number(col.sortValue(rows.find((x) => x.team.teamId === id)!)));
    assert(first.every((v) => Math.abs(v - best) < 1e-9), `${season} ${key}: 多い順の1位`);
  }
  // 色つきの項目（PTS）は rankAllNeutral でも変わらない
  {
    const col = buildTeamCategoryColumns("traditional", "perGame", "own", true, true, false).find((c) => c.key === "pts")!;
    const a = teamRanksOf(rows, col, "own")!;
    const b = teamRanksOf(rows, col, "own", true)!;
    assert([...a].every(([id, r]) => b.get(id)?.rank === r.rank && b.get(id)?.tier === r.tier), `${season} pts: rankAllNeutral でも同じ`);
  }
  // 色なしで順位だけ出す項目: 多い順（1位が最大）。opp でも多い順
  for (const perspective of ["own", "opp"] as TeamPerspective[]) {
    const col = buildTeamCategoryColumns("misc", "perGame", perspective, true, true, false).find((c) => c.key === "benchPts")!;
    const ranks = teamRanksOf(rows, col, perspective);
    if (ranks) {
      const best = Math.max(...[...ranks.keys()].map((id) => Number(col.sortValue(rows.find((x) => x.team.teamId === id)!))));
      const first = [...ranks].filter(([, r]) => r.rank === 1).map(([id]) => Number(col.sortValue(rows.find((x) => x.team.teamId === id)!)));
      assert(first.every((v) => Math.abs(v - best) < 1e-9), `${season} ${perspective} benchPts: 多い順の1位`);
    }
  }
  // 6チーム以下は色なし
  const few = teamRanksOf(rows.slice(0, 6), buildTeamCategoryColumns("traditional", "perGame", "own", true, true, false).find((c) => c.key === "pts")!, "own")!;
  assert([...few.values()].every((r) => r.tier === null), "6チーム以下は色を付けない");
  console.log(`${season}: OK（${rows.length}チーム）`);
}
assert(["benchPts", "pct3p", "pctft"].every((k) => rankOnlySeen.has(k)), "色なし順位の項目を確かめた");
console.log("validate-team-detail-rank: OK");
