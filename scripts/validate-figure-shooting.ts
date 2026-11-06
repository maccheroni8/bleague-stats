// 図解「シュート% × 試投数」（チーム・選手）と「得点 × アシスト」の検証。人工データで軸の範囲・試投数の下限・振り分けを確かめ、
// 実データでは、集計済みのシーズン成績（teams.json・players.json の合計と率）から独立に計算した値と、図の値が一致することを確かめる。元データは読むだけ。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { PlayerGameLog, PlayerSummary, TeamGameLog } from "../shared/types";
import { axisDomain, niceStep, totalBase } from "../src/lib/figureAxis";
import { buildPlayerFigurePoints, playerColumnValue, type PlayerFigurePoint } from "../src/lib/figurePlayerPoints";
import {
  buildShootTeams, ptsAstPoints, PTS_AST_BASE, shootTeamXBase, shootTeamYBase, SHOOT_DIFF_X_BASE, SHOOT_DIFF_Y_BASE, SHOOT_MIN_ATTEMPTS, SHOOT_X, SHOOT_X_BASE, SHOOT_X_COLUMN, SHOOT_Y, SHOOT_Y_BASE, SHOOT_Y_COLUMN, shootPlayerPoints, shootYDefined, teamColumnText,
  type ShootX, type ShootY,
} from "../src/lib/figureShooting";
import { FIGURES } from "../src/figures/catalog";
import { sumTeamGameLogs } from "../src/lib/teamStatsColumns";
import { filterByGameType } from "../shared/gameType";
import { filterGameLogs } from "../src/lib/situational";

// --- 軸の範囲 ---
{
  const base = { lo: 20, hi: 40, step: 5 };
  assert.deepEqual(axisDomain([22, 38], base).ticks, [20, 25, 30, 35, 40], "基本範囲に収まるなら基本範囲のまま");
  assert.deepEqual(axisDomain([], base).ticks, [20, 25, 30, 35, 40], "点がなくても基本範囲");
  const wide = axisDomain([12, 38, 47], base);
  assert.equal(wide.min, 10); assert.equal(wide.max, 50, "はみ出すときだけ、刻み幅の倍数で広げる");
  assert.deepEqual(axisDomain([40], base).ticks, [20, 25, 30, 35, 40], "ちょうど上端なら広げない");
  assert.equal(axisDomain([40.01], base).max, 45, "少しでも超えたら次の刻み");
  assert.equal(axisDomain([null, Number.NaN, 30], base).min, 20, "値のない点は無視");
  assert.equal(niceStep(18 * 60), 200); assert.equal(niceStep(100), 20);
  const t = totalBase({ lo: 0, hi: 8, step: 1 }, 10);
  assert.equal(t.lo, 0); assert.ok(t.hi >= 80 && t.hi <= 90 && t.step === 20 || t.hi >= 80, `合計の基本範囲は試合数倍 ${JSON.stringify(t)}`);
  const t60 = totalBase({ lo: 58, hi: 76, step: 2 }, 60);
  assert.ok(t60.lo <= 58 * 60 && t60.hi >= 76 * 60, "合計の基本範囲が1試合平均の範囲を含む");
  for (const y of SHOOT_Y) for (const who of ["team", "player"] as const) { const b = SHOOT_Y_BASE[who][y]; assert.ok(b.hi > b.lo && (b.hi - b.lo) % b.step === 0, `${who} ${y} 範囲が刻み幅の倍数`); }
  for (const x of SHOOT_X) for (const who of ["team", "player"] as const) { const b = SHOOT_X_BASE[who][x]; assert.ok(b.hi > b.lo && (b.hi - b.lo) % b.step === 0, `${who} ${x} 範囲が刻み幅の倍数`); }
  assert.equal(SHOOT_Y.length, 6); assert.equal(SHOOT_X.length, 4);
  assert.ok(FIGURES.some(f => f.id === "team-shooting" && f.entity === "team") && FIGURES.some(f => f.id === "player-shooting" && f.entity === "player") && FIGURES.some(f => f.id === "pts-ast" && f.entity === "player"), "図解に登録");
  for (const y of SHOOT_Y) { const b = SHOOT_DIFF_Y_BASE[y]; assert.ok(b.lo < 0 && b.hi > 0 && b.lo === -b.hi, `+/- の縦軸 ${y} は0を中心にした左右対称`); assert.equal(shootTeamYBase(y, "diff"), b); assert.equal(shootTeamYBase(y, "opp"), SHOOT_Y_BASE.team[y], "opp は自チームと同じ範囲"); }
  for (const x of SHOOT_X) { const b = SHOOT_DIFF_X_BASE[x]; assert.ok(b.lo < 0 && b.hi > 0 && b.lo === -b.hi, `+/- の横軸 ${x} は0を中心にした左右対称`); assert.equal(shootTeamXBase(x, "diff"), b); }
  assert.deepEqual(axisDomain([0.5, -3], SHOOT_DIFF_Y_BASE["3p"]).ticks.includes(0), true, "+/- の軸は0の目盛りを含む");
  // 得点・アシストの下限（1試合平均で判定。0は絞らない）
  console.log("シュート%・得点×アシスト: 軸の範囲（基本範囲・はみ出すときだけ広げる・合計は試合数倍）OK");
}

// --- 実データ ---
const source = process.argv[2];
if (source) {
  const read = (file: string) => JSON.parse(gunzipSync(readFileSync(file)).toString());
  const near = (a: number, b: number, label: string, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} と ${b}`);
  let sets = 0, teamChecks = 0, playerChecks = 0, inBaseTeam = 0, totalTeam = 0, inBasePlayer = 0, totalPlayer = 0;
  const keptByAxis = new Map<ShootX, { kept: number; all: number }>();
  for (const season of readdirSync(source).filter(s => /^\d{4}-\d{2}$/.test(s))) {
    for (const [category, base] of [["premier", path.join(source, season)], ["one", path.join(source, season, "one")]] as const) {
      const teamFile = path.join(base, "teams.json.gz"), playerFile = path.join(base, "players.json.gz");
      if (!existsSync(teamFile) || !existsSync(playerFile)) continue;
      const teams = read(teamFile) as { teamId: string; teamName: string; gamesPlayed: number; totals: Record<string, number>; shooting: Record<string, number> }[];
      const teamLogs = new Map<string, TeamGameLog[]>();
      for (const t of teams) { const f = path.join(base, "team-games", t.teamId + ".json.gz"); if (existsSync(f)) teamLogs.set(t.teamId, read(f)); }
      if (!teamLogs.size) continue;
      // --- チーム ---
      for (const mode of ["perGame", "total"] as const) {
        const model = buildShootTeams(teams, teamLogs, null, { season, category, range: { kind: "all" }, gameType: "regular", mode });
        for (const point of model.points) {
          const t = teams.find(x => x.teamId === point.teamId)!;
          if (!t.totals || !t.gamesPlayed) continue;
          const g = mode === "perGame" ? t.gamesPlayed : 1;
          const o = t.totals as Record<string, number>;
          const expectX: Record<ShootX, number> = { fga: o.fga! / g, "2pa": (o.fga! - o.tpa!) / g, "3pa": o.tpa! / g, fta: o.fta! / g };
          const expectY: Record<ShootY, number> = { fg: 100 * o.fgm! / o.fga!, "2p": 100 * (o.fgm! - o.tpm!) / (o.fga! - o.tpa!), "3p": 100 * o.tpm! / o.tpa!, ft: 100 * o.ftm! / o.fta!, efg: 100 * (o.fgm! + 0.5 * o.tpm!) / o.fga!, ts: 100 * o.pts! / (2 * (o.fga! + 0.44 * o.fta!)) };
          for (const x of SHOOT_X) near(point.x[x]!, expectX[x], `${season} ${category} ${point.teamId} ${x} ${mode}`, 1e-6);
          for (const y of SHOOT_Y) near(point.y[y]!, expectY[y], `${season} ${category} ${point.teamId} ${y}`, 1e-6);
          // 画面の書式は全チームスタッツの表と同じ列（小数第2位。合計は整数）
          assert.match(teamColumnText(point.row, SHOOT_Y_COLUMN["3p"], mode), /^\d+\.\d\d%$/);
          if (mode === "total") assert.match(teamColumnText(point.row, SHOOT_X_COLUMN["3pa"], mode), /^[\d,]+$/);
          teamChecks++;
          if (mode === "perGame" && point.games >= 20) for (const y of SHOOT_Y) { totalTeam++; const b = SHOOT_Y_BASE.team[y]; if (point.y[y]! >= b.lo && point.y[y]! <= b.hi) inBaseTeam++; }
          if (mode === "perGame" && point.games >= 20) for (const x of SHOOT_X) { totalTeam++; const b = SHOOT_X_BASE.team[x]; if (point.x[x]! >= b.lo && point.x[x]! <= b.hi) inBaseTeam++; }
        }
        // リーグ平均は各チームの合計の平均から出した値（ORtg × DRtg の図と同じ）
        if (model.league && model.points.length) {
          const mean = (key: string) => model.points.reduce((s, p) => s + (p.row.totals as unknown as Record<string, number>)[key]!, 0) / model.points.length;
          const games = model.points.reduce((s, p) => s + p.games, 0) / model.points.length;
          near(model.league.x["3pa"]!, mode === "perGame" ? mean("tpa") / games : mean("tpa"), `${season} ${category} リーグ平均3PA`, 1e-6);
          near(model.league.y["3p"]!, 100 * mean("tpm") / mean("tpa"), `${season} ${category} リーグ平均3P%`, 1e-6);
        }
      }
      // 視点 opp・+/-: 全チームスタッツと同じ視点（相手の値・自チームとの差）。合計の相手側から独立に計算し直す
      for (const mode of ["perGame", "total"] as const) for (const perspective of ["opp", "diff"] as const) {
        const model = buildShootTeams(teams, teamLogs, null, { season, category, range: { kind: "all" }, gameType: "regular", mode, perspective });
        for (const point of model.points) {
          const o = sumTeamGameLogs(filterByGameType(filterGameLogs(teamLogs.get(point.teamId)!, { range: { kind: "all" }, includePlayoffs: true }, undefined, undefined, undefined, undefined, category), "regular")) as unknown as Record<string, number>;
          const g = mode === "perGame" ? point.games : 1;
          const own = { fga: o.fga!, "2pa": o.fga! - o.tpa!, "3pa": o.tpa!, fta: o.fta!, fg: 100 * o.fgm! / o.fga!, "2p": 100 * (o.fgm! - o.tpm!) / (o.fga! - o.tpa!), "3p": 100 * o.tpm! / o.tpa!, ft: 100 * o.ftm! / o.fta!, efg: 100 * (o.fgm! + 0.5 * o.tpm!) / o.fga!, ts: 100 * o.pts! / (2 * (o.fga! + 0.44 * o.fta!)) };
          const op = { fga: o.oppFga!, "2pa": o.oppFga! - o.oppTpa!, "3pa": o.oppTpa!, fta: o.oppFta!, fg: 100 * o.oppFgm! / o.oppFga!, "2p": 100 * (o.oppFgm! - o.oppTpm!) / (o.oppFga! - o.oppTpa!), "3p": 100 * o.oppTpm! / o.oppTpa!, ft: 100 * o.oppFtm! / o.oppFta!, efg: 100 * (o.oppFgm! + 0.5 * o.oppTpm!) / o.oppFga!, ts: 100 * o.oppPts! / (2 * (o.oppFga! + 0.44 * o.oppFta!)) };
          for (const x of SHOOT_X) near(point.x[x]!, perspective === "opp" ? op[x] / g : (own[x] - op[x]) / g, `${season} ${category} ${point.teamId} ${perspective} ${x} ${mode}`, 1e-6);
          for (const y of SHOOT_Y) near(point.y[y]!, perspective === "opp" ? op[y] : own[y] - op[y], `${season} ${category} ${point.teamId} ${perspective} ${y}`, 1e-6);
          teamChecks++;
          if (mode === "perGame" && perspective === "diff" && point.games >= 20) {
            for (const y of SHOOT_Y) { totalTeam++; const b = SHOOT_DIFF_Y_BASE[y]; if (point.y[y]! >= b.lo && point.y[y]! <= b.hi) inBaseTeam++; }
            for (const x of SHOOT_X) { totalTeam++; const b = SHOOT_DIFF_X_BASE[x]; if (point.x[x]! >= b.lo && point.x[x]! <= b.hi) inBaseTeam++; }
          }
        }
      }
      // --- 選手 ---
      const players = read(playerFile) as (PlayerSummary & { totals: Record<string, number>; shooting: Record<string, number> })[];
      const playerLogs = new Map<string, PlayerGameLog[]>();
      for (const p of players) { const f = path.join(base, "player-games", p.playerId + ".json.gz"); if (existsSync(f)) playerLogs.set(p.playerId, read(f)); }
      const data = { players, teams, divisions: null, registrations: null, playerLogs, teamLogs };
      const points = buildPlayerFigurePoints(data as never, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all" });
      const ratioOf = new Map<string, PlayerFigurePoint>(points.map(p => [p.playerId, p]));
      for (const p of players) {
        const point = ratioOf.get(p.playerId);
        if (!point || !p.totals?.gamesPlayed) continue;
        const o = p.totals, s = p.shooting, g = o.gamesPlayed!;
        if (point.games !== g) continue; // 試合ログと集計の試合数が違う選手（記録の訂正の途中など）は比べない
        for (const mode of ["perGame", "total"] as const) {
          const d = mode === "perGame" ? g : 1;
          near(playerColumnValue(point, "pts", mode, season)!, o.pts! / d, `${season} ${p.playerId} PTS ${mode}`, 1e-6);
          near(playerColumnValue(point, "ast", mode, season)!, o.ast! / d, `${season} ${p.playerId} AST ${mode}`, 1e-6);
          near(playerColumnValue(point, "fga", mode, season)!, o.fga! / d, `${season} ${p.playerId} FGA ${mode}`, 1e-6);
          near(playerColumnValue(point, "2pa", mode, season)!, (o.fga! - o.tpa!) / d, `${season} ${p.playerId} 2PA ${mode}`, 1e-6);
          near(playerColumnValue(point, "3pa", mode, season)!, o.tpa! / d, `${season} ${p.playerId} 3PA ${mode}`, 1e-6);
          near(playerColumnValue(point, "fta", mode, season)!, o.fta! / d, `${season} ${p.playerId} FTA ${mode}`, 1e-6);
        }
        // 率は、集計済みの率（players.json の shooting）と同じ
        const pct = (key: string, expected: number | undefined, defined: boolean) => {
          const v = playerColumnValue(point, key, "perGame", season);
          if (!defined || expected === undefined) return;
          near(v!, expected, `${season} ${p.playerId} ${key}`, 1e-6);
        };
        pct("fgpct", s.fgPct, o.fga! > 0); pct("3ppct", s.tpPct, o.tpa! > 0); pct("ftpct", s.ftPct, o.fta! > 0); pct("2ppct", s.pt2Pct, o.fga! - o.tpa! > 0);
        pct("efg", s.efgPct, o.fga! > 0); pct("ts", s.tsPct, o.fga! > 0);
        // 縦軸の分母が0の選手は率を出さない
        assert.equal(shootYDefined(point, "3p"), o.tpa! > 0); assert.equal(shootYDefined(point, "ft"), o.fta! > 0); assert.equal(shootYDefined(point, "2p"), o.fga! - o.tpa! > 0);
        playerChecks++;
      }
      // 試投数の下限は1試合平均で判定し、合計に切り替えても同じ選手が残る。出場率の条件は USG% × PPP の図と同じ点（出場率）で判定する
      for (const x of SHOOT_X) for (const y of SHOOT_Y) {
        const min = SHOOT_MIN_ATTEMPTS[x].default;
        const eligible = points.filter(p => p.ratio >= 85);
        const avg = shootPlayerPoints(eligible, season, "perGame", x, y, min), tot = shootPlayerPoints(eligible, season, "total", x, y, min);
        assert.deepEqual(avg.map(s => s.p.id), tot.map(s => s.p.id), `${season} ${x}${y} 平均と合計で同じ選手`);
        for (const s of avg) assert.ok(s.perGameX >= min - 1e-9 && shootYDefined(s.p, y), "下限以上・分母あり");
        const excluded = eligible.filter(p => !avg.some(s => s.p.id === p.id));
        for (const p of excluded) assert.ok((playerColumnValue(p, SHOOT_X_COLUMN[x], "perGame", season) ?? 0) < min || !shootYDefined(p, y), "除かれた選手は下限未満か分母が0");
        const none = shootPlayerPoints(eligible, season, "perGame", x, y, 0);
        assert.ok(none.length >= avg.length, "下限を下げると増える");
        if (y === "3p" && x === "3pa" && eligible.length) { const k = keptByAxis.get(x) ?? { kept: 0, all: 0 }; k.kept += avg.length; k.all += none.length; keptByAxis.set(x, k); }
        if (season >= "2017-18" && y === "3p") for (const s of avg) { totalPlayer++; const b = SHOOT_Y_BASE.player[y]; if (s.y >= b.lo && s.y <= b.hi) inBasePlayer++; }
        if (season >= "2017-18") for (const s of avg) { totalPlayer++; const b = SHOOT_X_BASE.player[x]; if (s.perGameX >= b.lo && s.perGameX <= b.hi) inBasePlayer++; }
      }
      // 得点 × アシスト: 条件（出場率）を満たす選手の点
      const pa = ptsAstPoints(points.filter(p => p.ratio >= 85), season, "perGame");
      assert.equal(ptsAstPoints(points, season, "perGame", 0, 0).length, ptsAstPoints(points, season, "total", 0, 0).length, "下限0は絞らない");
      for (const [mp, ma] of [[10, 0], [0, 3], [12, 2]] as const) {
        const a = ptsAstPoints(points, season, "perGame", mp, ma), b = ptsAstPoints(points, season, "total", mp, ma);
        assert.deepEqual(a.map(s => s.p.id), b.map(s => s.p.id), `${season} 得点${mp}・アシスト${ma}の下限は、平均と合計で同じ選手`);
        for (const s of a) assert.ok(playerColumnValue(s.p, "pts", "perGame", season)! >= mp - 1e-9 && playerColumnValue(s.p, "ast", "perGame", season)! >= ma - 1e-9, "下限以上");
        for (const p of points) if (!a.some(s => s.p.id === p.id)) assert.ok(playerColumnValue(p, "pts", "perGame", season)! < mp || playerColumnValue(p, "ast", "perGame", season)! < ma, "除かれた選手は下限未満");
      }
      for (const s of pa) { assert.ok(Number.isFinite(s.x) && Number.isFinite(s.y)); totalPlayer++; if (s.y <= PTS_AST_BASE.pts.hi && s.x <= PTS_AST_BASE.ast.hi) inBasePlayer++; }
      sets++;
    }
  }
  assert.ok(sets > 0 && teamChecks > 0 && playerChecks > 0, "突き合わせる導出データが必要");
  assert.ok(inBaseTeam / totalTeam >= 0.97, `チームの基本範囲に収まる割合 ${(100 * inBaseTeam / totalTeam).toFixed(1)}%`);
  assert.ok(inBasePlayer / totalPlayer >= 0.97, `選手の基本範囲に収まる割合 ${(100 * inBasePlayer / totalPlayer).toFixed(1)}%`);
  const k = keptByAxis.get("3pa")!;
  console.log(`シュート%・得点×アシスト: ${sets}（シーズン×リーグ）・チーム${teamChecks}件・選手${playerChecks}人が集計済みの合計・率と一致。基本範囲に収まる割合 チーム${(100 * inBaseTeam / totalTeam).toFixed(1)}%・選手${(100 * inBasePlayer / totalPlayer).toFixed(1)}%。3PAの下限（初期値）で残る選手 ${(100 * k.kept / k.all).toFixed(0)}%（出場率85%以上のうち）OK`);
}
