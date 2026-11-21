// 全チームスタッツの上位3・下位3の色（DESIGN.md 448章）の検証。npm run build:data のあとに実行（外には問い合わせない）。
// 確かめること: ①各列で色は上位3位以内（tier-top-1〜3）・下位3位以内（tier-bot-1〜3）の各チームだけ・1位と最下位が濃い番号1 ②少ないほど良い TOV・F は少ないチームが緑
// ③opp は反転 ④良し悪しなしの列（G・POSS・PACE・BENCH PTS など）・「-」のチーム・試合0のチームには付かない ⑤チームが6以下のときは色なし
// ⑥勝率は視点が opp でも反転しない。使い方: npm run validate:team-tier-colors
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamGameLog } from "../shared/types";
import { filterByGameType } from "../shared/gameType";
import { buildTeamCategoryColumns } from "../src/lib/teamSeasonRanking";
import { withTierColors } from "../src/lib/teamTierColors";
import { sumTeamGameLogs, type AllTeamsRow, type TeamPerspective } from "../src/lib/teamStatsColumns";

type Col = ReturnType<typeof buildTeamCategoryColumns>[number];
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
  const classesOf = (key: string, perspective: TeamPerspective, category: "traditional" | "advanced" | "misc" | "scoring" = "traditional") => {
    const cols = withTierColors<AllTeamsRow>(buildTeamCategoryColumns(category, "perGame", perspective, true, true, false), rows, perspective);
    const col = cols.find((c: Col) => c.key === key);
    assert(col, `${season} ${key}: 列が無い`);
    return { col, classes: new Map(rows.map((r) => [r.team.teamId, col.cellClass?.(r)] as const)), }
  };
  // ①②③: 実データで、色が付くチームは上位3・下位3だけ・1位が tier-top-1・最下位が tier-bot-1
  for (const perspective of ["own", "opp"] as TeamPerspective[]) {
    for (const key of ["pts", "fgpct", "tov", "f", "ast"]) {
      const { col, classes } = classesOf(key, perspective);
      const higherBetter = !(key === "tov" || key === "f") === (perspective === "own");
      const values = rows.map((r) => ({ id: r.team.teamId, v: Number(col.sortValue(r)) })).sort((a, b) => (higherBetter ? b.v - a.v : a.v - b.v));
      const best = classes.get(values[0]!.id) ?? "";
      const worst = classes.get(values[values.length - 1]!.id) ?? "";
      assert(best.includes("tier-top-1"), `${season} ${perspective} ${key}: いちばん良いチームが tier-top-1 でない（${best}）`);
      assert(worst.includes("tier-bot-1"), `${season} ${perspective} ${key}: いちばん悪いチームが tier-bot-1 でない（${worst}）`);
      const colored = [...classes.values()].filter(Boolean);
      assert(colored.length >= 6 && colored.length <= 12, `${season} ${perspective} ${key}: 色が付いたチーム数 ${colored.length}`);
    }
  }
  // ④ 良し悪しなし
  for (const key of ["g", "poss", "pace", "min"]) {
    const cols = withTierColors<AllTeamsRow>(
      [...buildTeamCategoryColumns("traditional", "perGame", "own", true, true, false), ...buildTeamCategoryColumns("advanced", "perGame", "own", true, true, false)],
      rows,
      "own",
    );
    const col = cols.find((c: Col) => c.key === key);
    if (col) assert(rows.every((r) => !col.cellClass?.(r)), `${season} ${key}: 良し悪しなしに色が付いた`);
  }
  // ⑤ 6チーム以下は色なし
  const few = rows.slice(0, 6);
  const fewCols = withTierColors<AllTeamsRow>(buildTeamCategoryColumns("traditional", "perGame", "own", true, true, false), few, "own");
  assert(fewCols.every((c: Col) => few.every((r) => !c.cellClass?.(r))), `${season}: 6チーム以下に色が付いた`);
  // 試合0・値の無いチームは色なし
  const withEmpty = [...rows, { team: { teamId: "none", teamName: "" }, gamesPlayed: 0, wins: 0, losses: 0, totals: sumTeamGameLogs([]) } as AllTeamsRow];
  const emptyCols = withTierColors<AllTeamsRow>(buildTeamCategoryColumns("traditional", "perGame", "own", true, true, false), withEmpty, "own");
  assert(emptyCols.every((c: Col) => !c.cellClass?.(withEmpty[withEmpty.length - 1]!)), `${season}: 試合0のチームに色が付いた`);
  console.log(`${season}: OK（${rows.length}チーム）`);
}
console.log("team-tier-colors: OK");
