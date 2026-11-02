// ランキング（チーム）の名前の下の行「◯試合（◯勝◯敗）」の検証。npm run build:data のあとに実行（外のサイトには問い合わせない）。
// 全シーズンで、Shooting・Forced TOV の試合数（スポーツナビの記録がある試合）が teams.json の shotTypeGames・forcedTurnovers.gamesWithData と一致すること、
// レギュラーシーズン全体の勝敗が teams.json の wins/losses（結果だけの試合を除く）と一致すること、2P内訳の対象試合の勝敗が試合ログから数えた値と一致することを確かめる。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamGameLog } from "../shared/types";
import { filterByGameType } from "../shared/gameType";
import { paintOf, paintRecord, summarizePaintLogs, validPaint, paintPair } from "../src/lib/teamPaint2";
import { buildTeamCategoryColumns } from "../src/lib/teamSeasonRanking";
import { sumTeamGameLogs, type AllTeamsRow } from "../src/lib/teamStatsColumns";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { RankedList } from "../src/components/RankedList";
import { noGamesRanking, recordOfLogs, teamRecordText, yahooRecordByTeam } from "../src/lib/teamRankingRecord";

const DATA = path.resolve("data");
const read = (p: string) => JSON.parse(gunzipSync(fs.readFileSync(p)).toString("utf8"));

// 境界の事例
assert.equal(teamRecordText({ games: 5, wins: 4 }), "5試合（4勝1敗）");
assert.equal(teamRecordText({ games: 0, wins: 0 }), "0試合（0勝0敗）");
assert.deepEqual(recordOfLogs([{ win: true }, { win: false }, { win: true }]), { games: 3, wins: 2 });
assert.equal(yahooRecordByTeam(null).size, 0);

// 試合が0のチームは「-」・順位なしで末尾（少ないほうが上位の項目でも、昇順・降順のどちらでも）
{
  type Row = { id: string; gamesPlayed: number; v: number };
  const rows: Row[] = [
    { id: "zero", gamesPlayed: 0, v: 0 },
    { id: "a", gamesPlayed: 5, v: 70 },
    { id: "b", gamesPlayed: 5, v: 70 },
    { id: "c", gamesPlayed: 4, v: 80 },
  ];
  const fmt = (r: Row) => r.v.toFixed(2);
  for (const higherIsBetter of [false, true]) {
    const html = renderToStaticMarkup(
      h(MemoryRouter, null, h(RankedList<Row>, {
        rows,
        def: { key: "t", label: "T", value: (r) => r.v, format: fmt, higherIsBetter },
        ...noGamesRanking<Row>(fmt),
        rowKey: (r) => r.id,
        name: (r) => h("span", null, r.id),
        linkTo: () => undefined,
      })),
    );
    const cells = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => m[1]!).filter((x) => x.includes("rank-cell"));
    assert.equal(cells.length, 4);
    assert(cells[3]!.includes(">zero<"), "0試合のチームは末尾");
    assert(cells[3]!.includes(">-</td>"), "順位欄が「-」");
    assert(cells[3]!.includes('rank-value">-<'), "値が「-」（0.00 ではない）");
    assert(!/>0\.00</.test(html), "0.00 を出さない");
    assert(/rank-cell[^>]*>(1|2)</.test(cells[0]!), "ほかのチームには順位が付く");
  }
}

let seasons = 0;
let teamsChecked = 0;
for (const season of fs.readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  const teamsFile = path.join(DATA, season, "teams.json.gz");
  if (!fs.existsSync(teamsFile)) continue;
  const raw = read(teamsFile);
  const teams: Array<{ teamId: string; wins: number; losses: number; shotTypeGames?: number; shotTypes?: unknown; forcedTurnovers?: { gamesWithData: number } }> = Array.isArray(raw)
    ? raw
    : raw.teams;
  const logsByTeam = new Map<string, TeamGameLog[]>();
  for (const t of teams) {
    const f = path.join(DATA, season, "team-games", `${t.teamId}.json.gz`);
    if (fs.existsSync(f)) logsByTeam.set(t.teamId, read(f));
  }
  const yahoo = yahooRecordByTeam(logsByTeam);
  seasons++;
  for (const t of teams) {
    const logs = logsByTeam.get(t.teamId);
    if (!logs) continue;
    teamsChecked++;
    const regular: TeamGameLog[] = filterByGameType([...logs], "regular");
    const y = yahoo.get(t.teamId)!;
    if (t.shotTypes && t.shotTypeGames !== undefined) assert.equal(y.games, t.shotTypeGames, `${season} ${t.teamId} Shooting の試合数`);
    if (t.forcedTurnovers) assert.equal(y.games, t.forcedTurnovers.gamesWithData, `${season} ${t.teamId} Forced TOV の試合数`);
    // 勝敗は試合ログと同じ。teams.json の勝敗は結果だけの試合を含みうるので、含まないチーム・シーズンだけ突き合わせる
    const all = recordOfLogs(regular);
    if (t.wins + t.losses === regular.length) assert.equal(all.wins, t.wins, `${season} ${t.teamId} 勝ち数`);
    // 2P内訳: 対象試合の勝敗（視点ごと）
    const summary = summarizePaintLogs(regular);
    const own = regular.filter((g) => validPaint(paintPair(g).own));
    const opp = regular.filter((g) => validPaint(paintPair(g).opp));
    const both = regular.filter((g) => validPaint(paintPair(g).own) && validPaint(paintPair(g).opp));
    for (const [persp, set] of [["own", own], ["opp", opp], ["diff", both]] as const) {
      assert.deepEqual(paintRecord(summary, persp), recordOfLogs(set), `${season} ${t.teamId} 2P内訳 ${persp}`);
    }
    // 失点（opp PTS。自チーム視点だけ）は opp 視点の PTS と同じ値で、少ないほうが上位。平均・合計とも
    const row: AllTeamsRow = { team: { teamId: t.teamId, teamName: "" }, gamesPlayed: regular.length, wins: all.wins, losses: regular.length - all.wins, totals: sumTeamGameLogs(regular) };
    for (const mode of ["perGame", "total"] as const) {
      const ownCols = buildTeamCategoryColumns("traditional", mode, "own", true, true, false);
      const oppCols = buildTeamCategoryColumns("traditional", mode, "opp", true, true, false);
      const diffCols = buildTeamCategoryColumns("traditional", mode, "diff", true, true, false);
      const oppPts = ownCols.find((c) => c.key === "opppts")!;
      assert.equal(ownCols[ownCols.findIndex((c) => c.key === "pts") + 1]!.key, "opppts", "PTS の右に置く");
      assert.equal(oppPts.higherIsBetter, false);
      assert.equal(oppPts.sortValue(row), oppCols.find((c) => c.key === "pts")!.sortValue(row), `${season} ${t.teamId} 失点 ${mode}`);
      assert.equal(oppPts.format!(row), oppCols.find((c) => c.key === "pts")!.format!(row));
      assert(!oppCols.some((c) => c.key === "opppts") && !diffCols.some((c) => c.key === "opppts"), "opp・+/- 視点には出さない");
    }
    assert.equal(paintOf(summary), undefined, "withPaint を通していない合計には内訳は付かない");
  }
}
assert(seasons > 0 && teamsChecked > 0, "データが無い（先に npm run build:data）");
console.log(`validate-team-ranking-record: OK（${seasons}シーズン・${teamsChecked}チーム）`);
