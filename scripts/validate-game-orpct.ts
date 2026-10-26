// 試合詳細の個人 OR%・内訳集計の %OR（src/lib/gameOrPct.ts。設計書300章）の検算スクリプト（検証専用。集計の入口からは import しない）。
//
// 画面の補助関数（在コートの復元の区間 lineupStints の own.or・opp.dr を本人が出場中の区間について足す）の値を、
// PBP を1行ずつたどる独立した数え上げ（IN／OUT で在籍を更新し、リバウンドの瞬間に攻撃側の5人へ1件ずつ加える）と、全出場選手・全期間の選び方
// （試合・1Q〜4Q・前半・後半・延長）で突き合わせる。あわせて:
//  - 期待値（2020-21 5854・B.ONE 507159）、内訳 %OR（5854 宇都宮）
//  - 期間を選ぶと値が変わること・分母0で「-」になること
//  - 旧形式（3000）・PBP なし（1810）・チーム合計が合わない場合に「出せない」理由が出ること
//  - 全試合の走査（--all）: 2020-21 以降の B.PREMIER・B.ONE で、チームごとに出せない試合の数と理由
// 使い方: npm run validate:game-orpct（src/ のコードを使うため esbuild でまとめて実行する）。--all で全試合の走査も行う
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { onCourtPeriodCount, reconstructOnCourt, substitutionModelForSeason } from "../shared/onCourt.ts";
import { withChronologicalPlayByPlays } from "../shared/pbpOrder.ts";
import { buildPlayerBoxscores, buildTeamTotalCounts } from "../src/lib/boxscoreAggregate.ts";
import { buildPeriodRangeOptions } from "../src/lib/periodRange.ts";
import { computeTeamOrPct, orShare, personalOrPct, type TeamOrPct } from "../src/lib/gameOrPct.ts";
import { DATA_DIR, readAllGames } from "./lib/storage.ts";
import type { StoredGame } from "../shared/types.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

function loadGame(season: string, key: string, league: "premier" | "one" = "premier"): StoredGame {
  const file = path.join(DATA_DIR, season, league === "one" ? "one" : "", "games", `${key}.json.gz`);
  return withChronologicalPlayByPlays(JSON.parse(gunzipSync(readFileSync(file)).toString())) as StoredGame;
}

function reconstruct(game: StoredGame) {
  const raw = game.raw;
  return reconstructOnCourt(
    raw.PlayByPlays,
    raw.HomeBoxscores,
    raw.AwayBoxscores,
    game.homeTeam.id,
    game.awayTeam.id,
    onCourtPeriodCount(game.season, game.quarterScores.home.length, raw.PlayByPlays),
    substitutionModelForSeason(game.season),
  );
}

/** 画面と同じ入力でチームの個人 OR% の分母を出す */
function teamOrPctOf(game: StoredGame, stints: ReturnType<typeof reconstruct>["lineupStints"], home: boolean, periods: number[] | null): TeamOrPct {
  const own = home ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
  const opp = home ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
  return computeTeamOrPct({
    lineupStints: stints,
    teamId: own[0]?.TeamID ?? "",
    opponentTeamId: opp[0]?.TeamID ?? "",
    boxOr: buildTeamTotalCounts(own, undefined).oreb,
    boxOpponentDr: buildTeamTotalCounts(opp, undefined).dreb,
    periods,
  });
}

/** 独立した数え上げ: PBP を1行ずつたどる（区間の関数・時刻による区間判定は使わない）。期間を指定できる */
function independentDenominators(game: StoredGame, periods: number[] | null) {
  const model = substitutionModelForSeason(game.season);
  if (model !== "modern") throw new Error("新形式のみ");
  const home = game.homeTeam.id;
  const away = game.awayTeam.id;
  const active: Record<string, Set<string>> = { [home]: new Set(), [away]: new Set() };
  const out = new Map<string, { ownOr: number; oppDr: number }>();
  let notFive = 0;
  for (const e of game.raw.PlayByPlays) {
    const t = e.TeamID;
    if (!t || !active[t]) continue;
    const c = e.ActionCD1;
    if (c === 86 && e.PlayerID1) active[t]!.add(e.PlayerID1);
    if (c === 87 && e.PlayerID1) active[t]!.delete(e.PlayerID1);
    const isOr = c === 10 || c === 19;
    const isDr = c === 9 || c === 18;
    if (!isOr && !isDr) continue;
    const attacking = isOr ? t : t === home ? away : home;
    if (active[attacking]!.size !== 5 || active[attacking === home ? away : home]!.size !== 5) notFive += 1;
    if (periods !== null && !periods.includes(e.Period)) continue;
    for (const id of active[attacking]!) {
      const cur = out.get(id) ?? { ownOr: 0, oppDr: 0 };
      if (isOr) cur.ownOr += 1;
      else cur.oppDr += 1;
      out.set(id, cur);
    }
  }
  return { denominators: out, notFive };
}

function compareGame(season: string, key: string, league: "premier" | "one" = "premier"): { game: StoredGame; stints: ReturnType<typeof reconstruct>["lineupStints"] } {
  const game = loadGame(season, key, league);
  const rec = reconstruct(game);
  const periodsTotal = onCourtPeriodCount(game.season, game.quarterScores.home.length, game.raw.PlayByPlays);
  const options = buildPeriodRangeOptions(periodsTotal);
  let compared = 0;
  let bad: string[] = [];
  for (const option of options) {
    const indep = independentDenominators(game, option.periods);
    for (const home of [true, false]) {
      const res = teamOrPctOf(game, rec.lineupStints, home, option.periods);
      if (!res.available) {
        bad.push(`${option.label} ${home ? "home" : "away"} 出せない(${res.reason})`);
        continue;
      }
      const rows = (home ? game.raw.HomeBoxscores : game.raw.AwayBoxscores);
      for (const p of buildPlayerBoxscores(rows, option, game.raw.PlayByPlays)) {
        if (p.dnp) continue;
        const a = res.byPlayer.get(p.playerId) ?? { ownOr: 0, oppDr: 0 };
        const b = indep.denominators.get(p.playerId) ?? { ownOr: 0, oppDr: 0 };
        compared += 1;
        if (a.ownOr !== b.ownOr || a.oppDr !== b.oppDr) bad.push(`${option.label} ${p.nameJ ?? p.playerId}: 画面 ${JSON.stringify(a)} / 独立 ${JSON.stringify(b)}`);
      }
    }
  }
  check(`${league} ${season}:${key} 全期間・全選手で独立の数え上げと分母が一致（${compared}件 / 期間${options.length}通り）`, bad.length === 0 && compared > 0, bad.slice(0, 5).join("\n   "));
  return { game, stints: rec.lineupStints };
}

function pctOf(game: StoredGame, stints: ReturnType<typeof reconstruct>["lineupStints"], nameIncludes: string, periods: number[] | null = null): number | null {
  for (const home of [true, false]) {
    const rows = home ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
    const res = teamOrPctOf(game, stints, home, periods);
    if (!res.available) continue;
    const option = periods === null ? undefined : { value: "all" as const, label: "", periods };
    const p = buildPlayerBoxscores(rows, option, game.raw.PlayByPlays).find((x) => (x.nameJ ?? "").includes(nameIncludes));
    if (p) return personalOrPct(p.counts.oreb, res.byPlayer.get(p.playerId));
  }
  throw new Error(`選手が見つからない: ${nameIncludes}`);
}

const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

// --- 2020-21 5854・B.ONE 507159 ---
const g5854 = compareGame("2020-21", "5854");
const g507159 = compareGame("2026-27", "507159", "one");
check("5854 ジェフ・ギブス 15.0%", round1(pctOf(g5854.game, g5854.stints, "ギブス")) === 15.0, String(pctOf(g5854.game, g5854.stints, "ギブス")));
check("5854 ジャック・クーリー 21.9%", round1(pctOf(g5854.game, g5854.stints, "クーリー")) === 21.9, String(pctOf(g5854.game, g5854.stints, "クーリー")));
check("507159 ジェイコブ・ポラコヴィッチ 25.0%", round1(pctOf(g507159.game, g507159.stints, "ポラコヴィッチ")) === 25.0, String(pctOf(g507159.game, g507159.stints, "ポラコヴィッチ")));
check("507159 アルナルド・トロ 16.7%", round1(pctOf(g507159.game, g507159.stints, "トロ")) === 16.7, String(pctOf(g507159.game, g507159.stints, "トロ")));

// --- 期間を選ぶと変わる・分母0で「-」 ---
{
  const all = pctOf(g5854.game, g5854.stints, "ギブス");
  const q1 = pctOf(g5854.game, g5854.stints, "ギブス", [1]);
  const h1 = pctOf(g5854.game, g5854.stints, "ギブス", [1, 2]);
  const h2 = pctOf(g5854.game, g5854.stints, "ギブス", [3, 4]);
  check("5854 ギブスの OR% は期間で変わる（試合・1Q・前半・後半）", new Set([all, q1, h1, h2].map((v) => (v === null ? "-" : v.toFixed(4)))).size >= 3, JSON.stringify({ all, q1, h1, h2 }));
  check("分母0（本人が出場していない期間）は null（画面では「-」）", personalOrPct(0, { ownOr: 0, oppDr: 0 }) === null && personalOrPct(2, undefined) === null);
}

// --- 内訳 %OR（5854 宇都宮: スタメン 33.3%・ベンチ 41.7%） ---
{
  const g = g5854.game;
  const utsunomiya = g.homeTeam.name.includes("宇都宮") ? g.raw.HomeBoxscores : g.raw.AwayBoxscores;
  const teamOr = buildTeamTotalCounts(utsunomiya, undefined).oreb;
  const players = buildPlayerBoxscores(utsunomiya, undefined, g.raw.PlayByPlays);
  const starters = players.filter((p) => utsunomiya.find((r) => r.PlayerID === p.playerId && r.Category === 1 && r.StartingFlg === 1));
  const sOr = starters.reduce((a, p) => a + p.counts.oreb, 0);
  const bOr = players.filter((p) => !starters.includes(p)).reduce((a, p) => a + p.counts.oreb, 0);
  check("5854 宇都宮 チームOR=12（選手9＋チーム3）", teamOr === 12, String(teamOr));
  check("5854 宇都宮 内訳 %OR スタメン 33.3%・ベンチ 41.7%", round1(orShare(sOr, teamOr)) === 33.3 && round1(orShare(bOr, teamOr)) === 41.7, `${orShare(sOr, teamOr)} ${orShare(bOr, teamOr)}`);
  check("チームOR 0 は null（画面では「-」）", orShare(0, 0) === null);
}

// --- 出せない場合 ---
{
  const game = loadGame("2018-19", "3000");
  const rec = reconstruct(game);
  const res = teamOrPctOf(game, rec.lineupStints, true, null);
  check("旧形式（2018-19 3000）は legacy", !res.available && res.reason === "legacy", JSON.stringify(res));
  const none = teamOrPctOf(g5854.game, [], true, null);
  check("PBP なし（区間が空）は noPbp", !none.available && none.reason === "noPbp");
  const own = g5854.game.raw.HomeBoxscores;
  const opp = g5854.game.raw.AwayBoxscores;
  const bad = computeTeamOrPct({
    lineupStints: g5854.stints,
    teamId: own[0]?.TeamID ?? "",
    opponentTeamId: opp[0]?.TeamID ?? "",
    boxOr: buildTeamTotalCounts(own, undefined).oreb + 1,
    boxOpponentDr: buildTeamTotalCounts(opp, undefined).dreb,
    periods: null,
  });
  check("チームの OR がボックススコアと合わなければ mismatch", !bad.available && bad.reason === "mismatch");
  const cut = g5854.stints.map((s) => ({ ...s, playerIds: s.playerIds.slice(0, 4) }));
  const four = teamOrPctOf(g5854.game, cut, true, null);
  check("リバウンドを数えた区間が5人でなければ mismatch", !four.available && four.reason === "mismatch");
  const g1810 = loadGame("2017-18", "1810");
  check("1810 は PBP なし（区間が空）", g1810.raw.PlayByPlays.length === 0);
}

// --- 全試合の走査（--all） ---
if (process.argv.includes("--all")) {
  for (const league of ["premier", "one"] as const) {
    const seasons = readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s) && s >= "2020-21");
    for (const season of seasons) {
      let games = 0;
      const unavailable: Record<string, string[]> = {};
      let list: StoredGame[] = [];
      try {
        list = await readAllGames(season, league);
      } catch {
        continue;
      }
      for (const game of list) {
        if (game.raw.PlayByPlays.length === 0) continue;
        games += 1;
        const rec = reconstruct(game);
        for (const home of [true, false]) {
          const res = teamOrPctOf(game, rec.lineupStints, home, null);
          if (!res.available) (unavailable[res.reason] ??= []).push(`${game.scheduleKey}${home ? "H" : "A"}`);
        }
      }
      console.log(`${league} ${season}: PBPのある試合 ${games} / 出せないチーム ${Object.entries(unavailable).map(([k, v]) => `${k} ${v.length}（${v.slice(0, 8).join(",")}）`).join("、") || "なし"}`);
    }
  }
}

if (failures > 0) {
  console.log(`\n${failures} 件の食い違い`);
  process.exit(1);
}
console.log("\nすべて ok");
