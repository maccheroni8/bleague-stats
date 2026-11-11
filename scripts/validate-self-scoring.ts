// Self2M・Self3M・SelfFTM とアシストあり／セルフの割合の検証（DESIGN.md 361章）。使い方: npm run validate:self-scoring（先に npm run build:data）
//  1. 列の並び: 全チームスタッツ・選手の Scoring で、AST の右に Self、種類ごとに「アシストあり→セルフ」が隣り合い、%PTS ASTED の右に %PTS Self。
//     全チームスタッツの Scoring の表には割合の列を出さない（帯グラフで見せる）。Scoring 以外には出ない
//  2. チームの値: 試合の生データ（ボックススコアのチーム合計の 2PM・3PM・FTM と、プレーバイプレーから数え直したアシスト付きの数）から手計算した
//     Self と、画面の列（sumTeamGameLogs → チームの列）の値が、自チーム・相手とも一致する。試合の流れの記録が無い試合（1810）は除く
//  3. 選手の値: 生データの本人の行と数え直したアシストから手計算した Self と、選手の列の値が一致する
//  4. 割合: アシストあり＋セルフ＝100%（得点全体は、得点の合計が PTS と一致する）
//  5. 1810: 2017-18 の該当チームは、Self が1810を除いた値になり、平均の試合数も1少ない
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { BoxscoreRow, PlayerGameLog, StoredGame, TeamGameLog } from "../shared/types";
import { computeAssistedScoring } from "../shared/assistedScoring";
import { gameDetailColumnsFor } from "../src/components/BoxscoreTable";
import { SEASON_SCORING_COLUMNS, buildSeasonBoxscoreCtx, sumPlayerGameLogs, EMPTY_TEAM_TOTALS } from "../src/lib/playerSeasonBoxscore";
import { buildScoringColumns, sumTeamGameLogs, withoutSelfPctColumns, teamShotMadeSource, type AllTeamsRow } from "../src/lib/teamStatsColumns";
import "../src/lib/playerSelfColumns";
import { selfCountsOf, selfSplitOf, SELF_PCT_DEFS } from "../src/lib/selfScoring";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(p.endsWith(".gz") ? gunzipSync(readFileSync(p)).toString("utf8") : readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};
let failures = 0;
let okCount = 0;
const fail = (m: string) => {
  failures += 1;
  if (failures <= 40) console.error(`NG ${m}`);
};
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) okCount += 1;
  else fail(`${label} ${detail}`);
};

// 1. 並び
{
  const want = ["ast2m", "ast3m", "astftm", "self2m", "self3m", "selfftm", "pct2pmast", "pct2pmself", "pct3pmast", "pct3pmself", "pctfgmast", "pctfgmself", "pctftmast", "pctftmself", "pctptsasted", "pctptsself"];
  const sliceOf = (keys: string[]) => keys.slice(keys.indexOf("ast2m"), keys.indexOf("pctptsself") + 1);
  const lists: [string, string[]][] = [
    ["全チームスタッツ（列の元）", buildScoringColumns("perGame", "own", true, true).map((c: { key: string }) => c.key)],
    ["選手", SEASON_SCORING_COLUMNS.map((c: { key: string }) => c.key)],
    ["試合詳細", gameDetailColumnsFor("scoring", false).map((c: { key: string }) => c.key)],
  ];
  for (const [name, keys] of lists) {
    const got = sliceOf(keys);
    // 試合詳細は PC が %PTS ASTED と %PTS Self の間に入らない（PC は別に足す）ので、そのまま比べる
    check(`${name}: Scoring の並び`, got.join() === want.join(), got.join(","));
  }
  const tableKeys = withoutSelfPctColumns(buildScoringColumns("perGame", "own", true, true)).map((c: { key: string }) => c.key);
  check("全チームスタッツの Scoring の表: 割合の列が無く、本数は残る", !tableKeys.some((k) => /^pct(2pm|3pm|fgm|ftm)(ast|self)$/.test(k) || k === "pctptsself") && tableKeys.includes("self2m") && tableKeys.includes("pctptsasted"));
  for (const tab of ["traditional", "advanced", "misc"] as const) {
    check(`試合詳細 ${tab} に Self が出ていない`, !gameDetailColumnsFor(tab, false).some((c: { key: string }) => c.key.includes("self")));
  }
}

// 2〜5. 値
type Counts = { m2: number; m3: number; mf: number; a2: number; a3: number; af: number };
const teamRowOf = (logs: TeamGameLog[]): AllTeamsRow => ({ team: { teamId: "t", teamName: "t" }, gamesPlayed: logs.length, wins: 0, losses: 0, totals: sumTeamGameLogs(logs) });
const examples: string[] = [];
let teamGamesChecked = 0;
let playersChecked = 0;
for (const [base, seasons] of [["", ["2025-26", "2026-27", "2017-18", "2021-22"]], ["/one", ["2026-27"]]] as const) {
  for (const season of seasons) {
    const dir = `${DATA}/${season}${base}`;
    if (!existsSync(`${dir}/team-games`)) continue;
    const gameCache = new Map<string, StoredGame | null>();
    const getGame = (key: string) => {
      if (!gameCache.has(key)) gameCache.set(key, rj(`${dir}/games/${key}.json`));
      return gameCache.get(key)!;
    };
    // 生データからの手計算（チーム別）
    const rawCounts = (game: StoredGame): Map<string, Counts> | null => {
      if (game.raw.PlayByPlays.length === 0) return null;
      // チーム合計の行の TeamID は空のシーズンがあるので、ホーム・アウェイの別でチームを決める
      const sides: [BoxscoreRow[], string][] = [[game.raw.HomeBoxscores, game.homeTeam.id], [game.raw.AwayBoxscores, game.awayTeam.id]];
      const teamOf = new Map<string, string>();
      const out = new Map<string, Counts>();
      for (const [rows, tid] of sides) {
        for (const r of rows.filter((x) => x.Category === 1 && x.PlayerID)) teamOf.set(r.PlayerID, tid);
        const t = rows.find((x) => x.Category === 3 && x.PeriodCategory === 18);
        if (t) out.set(tid, { m2: t.PT2M, m3: t.PT3M, mf: t.FTM, a2: 0, a3: 0, af: 0 });
      }
      for (const [pid, c] of computeAssistedScoring(game.raw.PlayByPlays).byScorer) {
        const t = out.get(teamOf.get(pid) ?? "");
        if (!t) continue;
        t.a2 += c.assisted2m;
        t.a3 += c.assisted3m;
        t.af += c.assistedFtm;
      }
      return out;
    };
    const teamFiles = readdirSync(`${dir}/team-games`).sort();
    const perTeam = new Map<string, TeamGameLog[]>();
    for (const f of teamFiles) perTeam.set(f.replace(/\.json(\.gz)?$/, ""), rj(`${dir}/team-games/${f}`) ?? []);
    const picked = season === "2017-18" ? teamFiles : teamFiles.filter((_, i) => i % 3 === 0);
    for (const f of picked) {
      const teamId = f.replace(/\.json(\.gz)?$/, "");
      const logs = (perTeam.get(teamId) ?? []).filter((g) => g.gameType === "regular");
      if (logs.length === 0) continue;
      // 試合ごと（先頭の数試合＋1810）
      const sample = logs.filter((g, i) => i < 6 || g.scheduleKey === "1810");
      for (const g of sample) {
        const game = getGame(g.scheduleKey);
        if (!game) continue;
        const row = teamRowOf([g]);
        const own = selfCountsOf(teamShotMadeSource(row.totals, false));
        const opp = selfCountsOf(teamShotMadeSource(row.totals, true));
        const rc = rawCounts(game);
        if (!rc) {
          // 試合の流れの記録が無い試合は、Self の材料から除かれる（本数0・平均の試合数0）
          check(`${season}${base} ${teamId} ${g.scheduleKey}: 流れの記録が無い試合は除く`, own.self2 === 0 && own.self3 === 0 && own.selfFt === 0 && row.totals.noFlowGames === 1);
          continue;
        }
        const mine = rc.get(teamId);
        const theirs = [...rc.entries()].find(([id]) => id !== teamId)?.[1];
        if (!mine || !theirs) continue;
        const want = (c: Counts) => [c.m2 - c.a2, c.m3 - c.a3, c.mf - c.af].join();
        check(`${season}${base} ${teamId} ${g.scheduleKey}: 自チームの Self`, [own.self2, own.self3, own.selfFt].join() === want(mine), `${[own.self2, own.self3, own.selfFt].join()} ≠ ${want(mine)}`);
        check(`${season}${base} ${teamId} ${g.scheduleKey}: 相手の Self`, [opp.self2, opp.self3, opp.selfFt].join() === want(theirs), `${[opp.self2, opp.self3, opp.selfFt].join()} ≠ ${want(theirs)}`);
        teamGamesChecked += 1;
        if (examples.length < 3 && season === "2025-26" && !base) examples.push(`${season} ${teamId} ${g.scheduleKey}: Self2M ${own.self2}・Self3M ${own.self3}・SelfFTM ${own.selfFt}（生データ: 2PM ${mine.m2}−${mine.a2}、3PM ${mine.m3}−${mine.a3}、FTM ${mine.mf}−${mine.af}）`);
      }
      // シーズンの合計: 画面の列の値＝流れの記録がある試合の手計算の合計 ÷ その試合数
      const row = teamRowOf(logs);
      const withFlow = logs.filter((g) => g.maxLead !== undefined);
      let s2 = 0;
      for (const g of withFlow) {
        const game = getGame(g.scheduleKey);
        const rc = game ? rawCounts(game) : null;
        const c = rc?.get(teamId);
        if (c) s2 += c.m2 - c.a2;
      }
      const cols = new Map<string, { format: (r: AllTeamsRow) => string }>(buildScoringColumns("perGame", "own", true, true).map((c) => [c.key, c]));
      const shown = cols.get("self2m")!.format(row);
      const wantAvg = withFlow.length > 0 ? (s2 / withFlow.length).toFixed(2) : "0.00";
      check(`${season}${base} ${teamId}: シーズンの Self2M（1試合平均）`, shown === wantAvg, `${shown} ≠ ${wantAvg}`);
      // 割合: アシストあり＋セルフ＝100%（成功が1本でもあれば）。得点全体は得点の合計が PTS（除いた試合を除く）と一致
      for (const opp of [false, true]) {
        const src = teamShotMadeSource(row.totals, opp);
        for (const d of SELF_PCT_DEFS) {
          const sp = selfSplitOf(src, d.kind);
          check(`${season}${base} ${teamId}: ${d.kind} アシストあり＋セルフ＝全体`, sp.ast + sp.self === sp.total);
        }
        const pts = selfSplitOf(src, "pts");
        const wantPts = withFlow.reduce((a, g) => a + (opp ? g.opponentScore : g.teamScore), 0);
        check(`${season}${base} ${teamId}: 得点全体の合計が PTS（除いた試合を除く）と一致`, pts.total === wantPts, `${pts.total} ≠ ${wantPts}`);
      }
      if (season === "2017-18" && logs.some((g) => g.scheduleKey === "1810")) {
        check(`2017-18 ${teamId}: 1810 を除いた試合数`, row.totals.noFlowGames === 1 && withFlow.length === logs.length - 1);
        examples.push(`2017-18 ${teamId}: 1810 を除いた ${withFlow.length}/${logs.length} 試合で Self2M 平均 ${shown}`);
      }
    }
    // 選手
    if (!existsSync(`${dir}/player-games`)) continue;
    const pf = readdirSync(`${dir}/player-games`).sort();
    const pPick = season === "2017-18" ? pf : pf.filter((_, i) => i % 40 === 0);
    const scol = new Map<string, (typeof SEASON_SCORING_COLUMNS)[number]>(SEASON_SCORING_COLUMNS.map((c) => [c.key, c]));
    for (const f of pPick) {
      const pid = f.replace(/\.json(\.gz)?$/, "");
      const logs: PlayerGameLog[] = (rj(`${dir}/player-games/${f}`) ?? []).filter((g: PlayerGameLog) => g.gameType === "regular");
      if (logs.length === 0) continue;
      const raw = sumPlayerGameLogs(logs);
      const ctx = buildSeasonBoxscoreCtx(raw, EMPTY_TEAM_TOTALS, "total", Number(season.slice(0, 4)));
      // 生データから: 本人の行（PeriodCategory 18）の 2PM と、数え直したアシスト付き
      let w2 = 0, w3 = 0, wf = 0, played = 0, noFlowPts = 0;
      for (const g of logs) {
        const game = getGame(g.scheduleKey);
        if (!game) continue;
        const rows = [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores].filter((r) => r.Category === 1 && r.PlayerID === pid && r.PeriodCategory === 18);
        const r = rows[0];
        if (!r || r.PlayTime === "DNP") continue;
        if (game.raw.PlayByPlays.length === 0) {
          noFlowPts += r.Point;
          continue;
        }
        const a = computeAssistedScoring(game.raw.PlayByPlays).byScorer.get(pid);
        w2 += r.PT2M - (a?.assisted2m ?? 0);
        w3 += r.PT3M - (a?.assisted3m ?? 0);
        wf += r.FTM - (a?.assistedFtm ?? 0);
        played += 1;
      }
      if (played === 0 && noFlowPts === 0) continue;
      const shown = [scol.get("self2m")!.format(ctx, "total"), scol.get("self3m")!.format(ctx, "total"), scol.get("selfftm")!.format(ctx, "total")];
      if (noFlowPts > 0) {
        check(`${season}${base} 選手 ${pid}: 流れの記録が無い試合で点を取った選手は「-」`, shown.every((s) => s === "-"), shown.join());
      } else {
        check(`${season}${base} 選手 ${pid}: Self2M・Self3M・SelfFTM`, shown.join() === [w2, w3, wf].join(), `${shown.join()} ≠ ${[w2, w3, wf].join()}`);
        const t2 = w2 + (raw.assisted2m ?? 0);
        const pct = scol.get("pct2pmself")!.format(ctx, "total");
        const wantPct = t2 > 0 ? `${((100 * w2) / t2).toFixed(2)}%` : "-";
        check(`${season}${base} 選手 ${pid}: 2PM %Self`, pct === wantPct, `${pct} ≠ ${wantPct}`);
        playersChecked += 1;
        if (examples.length < 6 && season === "2025-26" && !base && played > 20) examples.push(`${season} 選手 ${pid}: Self2M ${w2}・Self3M ${w3}・SelfFTM ${wf}（${played}試合。画面 ${shown.join("／")}）`);
      }
    }
  }
}

console.log(`\n確認: チームの試合 ${teamGamesChecked} 件、選手 ${playersChecked} 人。ok ${okCount} 件`);
for (const e of examples) console.log(`  例 ${e}`);
if (failures > 0) {
  console.error(`\n${failures} 件の食い違い`);
  process.exitCode = 1;
} else console.log("\nすべて一致しました");
