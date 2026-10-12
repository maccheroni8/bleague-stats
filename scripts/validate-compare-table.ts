// 比較の表（src/pages/ComparePage.tsx の ComparisonTable。DESIGN.md 234章）の、値の無い項目を出さない判定と、G の横の勝敗の検証スクリプト
// （検証専用。CIには入れず、必要なときに手で実行する）。
//
// 確かめること: すべての対象で「-」の項目だけが外れる（片方だけにある項目は残す・対象を足すと戻る）／勝敗の数え方（勝＋敗＝試合数）／
// チーム・個人の「G」だけに勝敗が付き、リーグ平均・勝敗の無い対象には付かない／強調（最良の判定）に使う値は勝敗に影響されない。
//
// 使い方: npm run validate:compare-table（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  defsWithAnyValue,
  recordOfLogs,
  seasonBoxCompareDefs,
  teamCompareDefs,
  teamTotalsFromBoxTotals,
  type CompareColumnData,
  type TeamCompareColumnData,
} from "../src/lib/compareShared";
import type { ComparisonStatDef } from "../src/pages/ComparePage";
import { buildSeasonBoxscoreCtx, countDoubleTripleDoubles, sumPlayerGameLogs } from "../src/lib/playerSeasonBoxscore";
import { sumTeamGameLogs } from "../src/lib/teamStatsColumns";
import { sumCountsList, type BoxscoreCounts, type PlayTypeCounts } from "../src/lib/boxscoreAggregate";
import type { ColumnCtx } from "../src/components/BoxscoreTable";
import { resultOnlyCompareNote } from "../src/lib/resultOnlyGames";
import { EMPTY_TEAM_TOTALS } from "../shared/teamSeasonTotals";
import type { PlayerGameLog, PlayerSummary, TeamGameLog, TeamSummary } from "../shared/types";
import type { LeagueCompareFile } from "../src/lib/leagueAverage";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`NG ${label}\n   実際: ${a}\n   期待: ${e}`);
  } else {
    console.log(`ok ${label}`);
  }
}

// --- 値の無い項目の判定（ダミーの対象・項目で確かめる） ---
interface Item {
  id: string;
  values: Record<string, string>;
}
const def = (key: string): ComparisonStatDef<Item> => ({
  key,
  label: key,
  value: () => 0,
  format: (r) => r.values[key] ?? "-",
});
const defs = [def("a"), def("b"), def("c")];
const keys = (items: Item[]) => defsWithAnyValue(defs, items).map((d) => d.key);

const x: Item = { id: "x", values: { a: "1.0", b: "-", c: "-" } };
const y: Item = { id: "y", values: { a: "2.0", b: "3.0", c: "-" } };
eq("全員が「-」の項目 c は外れる", keys([x, y]), ["a", "b"]);
eq("片方だけに値がある項目 b は残る", keys([x, y]).includes("b"), true);
eq("対象が1つのときは、その対象が「-」の項目を外す", keys([x]), ["a"]);
eq("対象を足すと、値のある項目が戻る", keys([x, y]).includes("b") && !keys([x]).includes("b"), true);
eq("条件を変えて値が出れば戻る", keys([x, { ...x, values: { ...x.values, c: "5.0" } }]), ["a", "c"]);
eq("対象が無いときは項目が残らない", keys([]), []);
eq("「0.0」「0」は値として残す（「-」だけが無しの印）", defsWithAnyValue([def("z")], [{ id: "z", values: { z: "0.0" } }]).length, 1);

// --- 勝敗の数え方 ---
eq("勝敗 3勝3敗", recordOfLogs([{ win: true }, { win: false }, { win: true }, { win: false }, { win: false }, { win: true }]), { wins: 3, losses: 3 });
eq("勝敗 試合なし", recordOfLogs([]), { wins: 0, losses: 0 });
eq("勝敗 全勝", recordOfLogs([{ win: true }, { win: true }]), { wins: 2, losses: 0 });
for (const n of [0, 1, 7, 59, 60]) {
  const logs = Array.from({ length: n }, (_, i) => ({ win: i % 3 === 0 }));
  const r = recordOfLogs(logs);
  eq(`勝＋敗＝試合数（${n}試合）`, r.wins + r.losses, n);
}

// --- G の勝敗の添え方（チーム・個人の列定義） ---
const teamBox = { own: {}, opp: {}, ownCtx: {}, oppCtx: {} } as unknown as TeamCompareColumnData["boxTotals"];
const team = (over: Partial<TeamCompareColumnData>): TeamCompareColumnData => ({ key: "t", label: "t", boxTotals: teamBox, gamesCount: 6, ...over });
for (const tab of ["traditional", "advanced", "misc", "scoring"] as const) {
  for (const perspective of ["own", "opp", "diff"] as const) {
    const g = teamCompareDefs(tab, perspective, false)[0]!;
    eq(`チーム G の項目（${tab}・${perspective}）`, g.key, "g");
    eq(`チーム G の値は試合数のまま（${tab}・${perspective}）`, g.format(team({ record: { wins: 3, losses: 3 } })), "6");
    eq(`チーム G の勝敗（${tab}・${perspective}）`, g.suffix?.(team({ record: { wins: 3, losses: 3 } })), "（3-3）");
  }
}
const teamG = teamCompareDefs("traditional", "own", false)[0]!;
eq("チーム G: 勝敗の無い対象には付けない", teamG.suffix?.(team({})), undefined);
eq("チーム G: リーグ平均は「-」で勝敗も付けない", [teamG.format(team({ isLeague: true, record: { wins: 1, losses: 1 } })), teamG.suffix?.(team({ isLeague: true, record: { wins: 1, losses: 1 } }))], ["-", undefined]);
eq("チーム G: 試合数の項目以外には勝敗を付けない", teamCompareDefs("traditional", "own", false).slice(1).every((d) => d.suffix === undefined), true);

const ctxOf = (gamesPlayed: number) => ({ raw: { gamesPlayed, gamesStarted: 0 }, scaled: { gamesPlayed }, team: {}, seasonStartYear: 2025 }) as unknown as CompareColumnData["ctx"];
const player = (over: Partial<CompareColumnData>): CompareColumnData => ({ key: "p", label: "p", ctx: ctxOf(60), ...over });
for (const tab of ["traditional", "advanced", "misc", "scoring"] as const) {
  const pd = seasonBoxCompareDefs(tab, false);
  const g = pd.find((d) => d.key === "g")!;
  eq(`個人 G の値は試合数のまま（${tab}）`, g.format(player({ record: { wins: 35, losses: 25 } })), "60");
  eq(`個人 G の勝敗（${tab}）`, g.suffix?.(player({ record: { wins: 35, losses: 25 } })), "（35-25）");
  eq(`個人 G: 勝敗の無い対象には付けない（${tab}）`, g.suffix?.(player({})), undefined);
  eq(`個人 G 以外には勝敗を付けない（${tab}）`, pd.filter((d) => d.key !== "g").every((d) => d.suffix === undefined), true);
}

// --- 同じ値の項目を1つの名前にまとめた（DESIGN.md 236章）: 外した名前が比較の項目に残っていないこと ---
{
  const removed = ["pctpinp", "pctipa"];
  const labelsRemoved = ["%PinP", "%IPA"];
  for (const tab of ["traditional", "advanced", "misc", "scoring"] as const) {
    for (const perspective of ["own", "opp", "diff"] as const) {
      const defs = teamCompareDefs(tab, perspective, false);
      eq(`外した名前が残っていない（${tab}・${perspective}）`, defs.filter((d) => removed.includes(d.key) || labelsRemoved.includes(d.label)).length, 0);
      const keys = defs.map((d) => d.key);
      eq(`項目の重複が無い（${tab}・${perspective}）`, new Set(keys).size, keys.length);
    }
  }
  const scoring = teamCompareDefs("scoring", "own", false).map((d) => d.label);
  eq("残した名前がある（PITP%・%PAINT2A）", [scoring.includes("PITP%"), scoring.includes("%PAINT2A")], [true, true]);
}

// --- チームの比較: 強調が値の比較どおりであること（value を持たない列が無いこと。DESIGN.md 238章） ---
// 値を持たない列は全対象が0扱いになり、同値として先頭（左）の対象が強調される（POSS の不具合）。
// 対象を2つ作り、表に出る値（format）が違う項目は、強調に使う値（value）も違い、同じ向きに並ぶことを確かめる
{
  // 値が項目ごとに違う（比の項目も対象で変わる）ように、項目の番号と種から決まる擬似的な整数を入れる
  const filled = (seed: number): BoxscoreCounts => {
    const zero = sumCountsList([]) as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = { ...zero };
    // 2026-27 以降の新しい区分の項目は、ゼロでは項目が無いので足す
    for (const k of ["technicalFoulsCat1", "technicalFoulsCat2", "flagrantFouls", "disruptiveFouls"]) out[k] = 0;
    let i = 0;
    for (const k of Object.keys(out)) {
      if (typeof out[k] === "number") out[k] = ((i * 37 + seed * 101) % 29) + 5 + (k === "minSec" ? 1500 : 0);
      i += 1;
    }
    out.hasPlusMinus = true;
    return out as unknown as BoxscoreCounts;
  };
  const playType = (seed: number): PlayTypeCounts => ({ pft: 10 + seed, fb: 5 + seed * 2, pt2nd: 8 + seed * 3, pt2in: 20 + seed * 4 }) as unknown as PlayTypeCounts;
  const ctxOf2 = (own: BoxscoreCounts, seed: number, poss: number): ColumnCtx => ({
    own,
    ownPlayType: playType(seed),
    ratings: { poss, pace: 70 + seed, offRtg: 100 + seed * 3, defRtg: 105 + seed * 2, netRtg: seed - 5 },
    isPlayerRow: false,
    isTeamTotalRow: true,
    shotChartSupported: true,
    yahooPbpSupported: true,
  });
  const boxOf = (seed: number, poss: number): TeamCompareColumnData => {
    const own = filled(seed);
    const opp = filled(seed + 7);
    return {
      key: `t${seed}`,
      label: `t${seed}`,
      gamesCount: 10,
      boxTotals: { own, opp, ownCtx: ctxOf2(own, seed, poss), oppCtx: ctxOf2(opp, seed + 7, poss) } as unknown as TeamCompareColumnData["boxTotals"],
    };
  };
  // POSS が小さい対象を先頭（左）に置く（不具合の例: 長崎 72.8・宇都宮 74.6）
  const left = boxOf(1, 72.8);
  const right = boxOf(2, 74.6);
  const plain = /^[+-]?\d+(\.\d+)?%?$/;
  let checkedDefs = 0;
  const bad: string[] = [];
  for (const tab of ["traditional", "advanced", "misc", "scoring"] as const) {
    for (const perspective of ["own", "opp", "diff"] as const) {
      for (const foulSplit of [false, true]) {
        for (const d of teamCompareDefs(tab, perspective, foulSplit)) {
          if (d.noHighlight) continue;
          const fl = d.format(left);
          const fr = d.format(right);
          if (fl === "-" || fr === "-") continue;
          checkedDefs += 1;
          const vl = d.value(left);
          const vr = d.value(right);
          const where = `${tab}・${perspective}${foulSplit ? "・新ファウル区分" : ""} ${d.label}`;
          if (fl !== fr && vl === vr) {
            bad.push(`${where}: 表の値が違う（${fl} / ${fr}）のに強調の値が同じ（${vl}）`);
          } else if (plain.test(fl) && plain.test(fr) && parseFloat(fl) !== parseFloat(fr)) {
            if (parseFloat(fl) < parseFloat(fr) !== vl < vr) bad.push(`${where}: 表の値（${fl} / ${fr}）と強調の値（${vl} / ${vr}）の大小が逆`);
          }
        }
      }
    }
  }
  eq(`チームの比較: 強調する項目の値は、表の値と同じ大小（${checkedDefs}項目）`, bad.slice(0, 12), []);
  eq("チームの比較: 確かめた項目が十分にある", checkedDefs > 100, true);

  // テンポ（POSS・PACE）は強調しない（多いほうが良いものではない）。+/- の視点では両チームで同じ値のため値を出さず、全対象が「-」なら行ごと出ない
  for (const tab of ["advanced"] as const) {
    for (const foulSplit of [false, true]) {
      const ownDefs = new Map(teamCompareDefs(tab, "own", foulSplit).map((d) => [d.key, d]));
      const oppDefs = new Map(teamCompareDefs(tab, "opp", foulSplit).map((d) => [d.key, d]));
      const diffDefs = new Map(teamCompareDefs(tab, "diff", foulSplit).map((d) => [d.key, d]));
      for (const key of ["poss", "pace"]) {
        eq(`${key} は強調しない（自チーム・相手視点・+/-）`, [ownDefs.get(key)!.noHighlight, oppDefs.get(key)!.noHighlight, diffDefs.get(key)!.noHighlight], [true, true, true]);
        eq(`${key} は +/- の視点では値を出さない（両チームで同じ値のため）`, [diffDefs.get(key)!.format(left), diffDefs.get(key)!.format(right)], ["-", "-"]);
        eq(
          `${key} は +/- の視点では行ごと出ない`,
          defsWithAnyValue([diffDefs.get(key)!], [left, right]).length,
          0,
        );
        eq(`${key} は自チーム・相手視点では行が出る`, [defsWithAnyValue([ownDefs.get(key)!], [left, right]).length, defsWithAnyValue([oppDefs.get(key)!], [left, right]).length], [1, 1]);
      }
    }
    const ownDefs = new Map(teamCompareDefs(tab, "own", false).map((d) => [d.key, d]));
    eq("POSS の表の値（1試合平均）", [ownDefs.get("poss")!.format(left), ownDefs.get("poss")!.format(right)], ["72.8", "74.6"]);
  }
}

// --- 結果だけの試合の注記 ---
const ro = (home: string, away: string, hs: number, as: number, gameType: "regular" | "playoff" = "regular") =>
  ({ scheduleKey: "x", date: "2018-01-01", homeTeamId: home, homeTeamName: home, awayTeamId: away, awayTeamName: away, homeScore: hs, awayScore: as, gameType, reason: "no-boxscore" }) as never;
const rec = { wins: 43, losses: 16 };
eq("注記 公式の勝敗は結果だけの試合の勝敗を足す（A東京が勝った）", resultOnlyCompareNote([ro("706", "704", 67, 49)], "706", "regular", rec, true)?.includes("（44-16）"), true);
eq("注記 負けたチームは敗を足す", resultOnlyCompareNote([ro("706", "704", 67, 49)], "704", "regular", { wins: 46, losses: 13 }, true)?.includes("（46-14）"), true);
eq("注記 結果だけの試合が無いチーム", resultOnlyCompareNote([ro("706", "704", 67, 49)], "700", "regular", rec, true), undefined);
eq("注記 試合種別が違う（プレーオフの枠に、レギュラーの結果だけの試合は含まれない）", resultOnlyCompareNote([ro("706", "704", 67, 49)], "706", "playoff", rec, true), undefined);
eq("注記 合算の枠には含まれる", resultOnlyCompareNote([ro("706", "704", 67, 49)], "706", "both", rec, true) !== undefined, true);
eq("注記 条件で絞った枠には出さない（公式の勝敗と並べられない）", resultOnlyCompareNote([ro("706", "704", 67, 49)], "706", "regular", rec, false), undefined);
eq("注記 日程が取れていないとき", resultOnlyCompareNote(null, "706", "regular", rec, true), undefined);

// --- 追加項目（実データ） ---
const DATA = path.resolve("data");
const readGz = <T,>(file: string): T => JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8")) as T;
const seasonsOnDisk = existsSync(DATA) ? readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d) && existsSync(path.join(DATA, d, "teams.json.gz"))).sort() : [];
if (seasonsOnDisk.length === 0) {
  console.log("実データ（data/）が無いので、追加項目の実データの確認は飛ばします");
}

// 公式の記録で、選手の得点の合計がチーム得点と合わない試合（選手IDの無い得点。DESIGN.md 221-4章に既知の一覧）。
// 登録区分別・ベンチ／スタメンの合計＝PTS の確認では、これらの試合を除く（記録どおりの値のため。一覧以外で合わない試合があれば食い違いになる）
const KNOWN_PLAYER_SUM_GAPS = new Set(["2016-17:149", "2016-17:182", "2016-17:19", "2016-17:215", "2016-17:331", "2016-17:341", "2016-17:85", "2020-21:5858"]);

const NEAR = 1e-6;
const near = (a: number, b: number) => Math.abs(a - b) <= NEAR * Math.max(1, Math.abs(a), Math.abs(b));
let checked = 0;
const mismatches: string[] = [];
function expectNear(label: string, actual: number, expected: number) {
  checked += 1;
  if (!near(actual, expected)) mismatches.push(`${label}: 画面の値 ${actual} / 元データ ${expected}`);
}

const teamDefsFor = (tab: "advanced" | "misc" | "scoring", perspective: "own" | "opp" | "diff") => {
  const defs = teamCompareDefs(tab, perspective, false);
  return new Map(defs.map((d) => [d.key, d]));
};
const TEAM_TABS = ["advanced", "misc", "scoring"] as const;
const itemOf = (totals: ReturnType<typeof sumTeamGameLogs>, games: number, over: Partial<TeamCompareColumnData> = {}): TeamCompareColumnData => ({
  key: "t",
  label: "t",
  boxTotals: { own: {}, opp: {}, ownCtx: {}, oppCtx: {} } as unknown as TeamCompareColumnData["boxTotals"],
  gamesCount: games,
  logTotals: { totals, games },
  ...over,
});

for (const season of seasonsOnDisk) {
  const teams = readGz<TeamSummary[]>(path.join(DATA, season, "teams.json.gz"));
  const allLogs: TeamGameLog[] = [];
  for (const team of teams) {
    const file = path.join(DATA, season, "team-games", `${team.teamId}.json.gz`);
    if (!existsSync(file)) continue;
    const logs = readGz<TeamGameLog[]>(file).filter((g) => g.gameType === "regular");
    if (logs.length === 0) continue;
    allLogs.push(...logs);
    const totals = sumTeamGameLogs(logs);
    const item = itemOf(totals, logs.length);
    const a = team.advanced;
    const own = teamDefsFor("advanced", "own");
    const ownMisc = teamDefsFor("misc", "own");
    const ownScoring = teamDefsFor("scoring", "own");
    const oppAdv = teamDefsFor("advanced", "opp");
    const oppMisc = teamDefsFor("misc", "opp");
    const oppScoring = teamDefsFor("scoring", "opp");
    const v = (m: Map<string, ComparisonStatDef<TeamCompareColumnData>>, key: string) => m.get(key)!.value(item);
    const label = `${season} ${team.teamName}`;
    // ①チーム詳細・全チームスタッツと同じデータの値（自チーム）
    expectNear(`${label} FTR`, v(own, "ftr"), team.shooting.ftRate);
    expectNear(`${label} OR%`, v(own, "orbpct"), a.orbPct);
    expectNear(`${label} BENCH PTS`, v(ownMisc, "benchPts"), a.benchPointsPerGame);
    expectNear(`${label} STARTER PTS`, v(ownMisc, "starterPts"), a.starterPointsPerGame);
    expectNear(`${label} 日本人 PTS`, v(ownMisc, "japanesePts3"), a.japanesePointsPerGame);
    expectNear(`${label} 外国籍・帰化・アジア PTS`, v(ownMisc, "internationalPts3"), a.internationalPointsPerGame);
    expectNear(`${label} %日本人 PTS`, v(ownScoring, "pctjapanese3"), a.japanesePointsSharePct);
    expectNear(`${label} %外国籍・帰化・アジア PTS`, v(ownScoring, "pctinternational3"), a.foreignPointsSharePct + a.naturalizedOrAsianPointsSharePct);
    expectNear(`${label} %3P`, v(ownScoring, "pct3p"), a.threePointPointsSharePct);
    // ペイント内得点の割合は PITP% 1つにまとめた（旧 %PinP。チーム詳細の元データ paintPointsSharePct と同じ値。DESIGN.md 236章）
    expectNear(`${label} PITP%（旧 %PinP）`, v(ownScoring, "pitppct"), a.paintPointsSharePct);
    expectNear(`${label} %PoutP`, v(ownScoring, "pctpoutp"), a.midRangePointsSharePct);
    expectNear(`${label} %FT`, v(ownScoring, "pctft"), a.ftPointsSharePct);
    // ①opp
    expectNear(`${label} opp FTR`, v(oppAdv, "ftr"), team.opponentShooting.ftRate);
    expectNear(`${label} opp OR%`, v(oppAdv, "orbpct"), a.opponentOrbPct);
    expectNear(`${label} opp BENCH PTS`, v(oppMisc, "benchPts"), a.opponentBenchPointsPerGame);
    expectNear(`${label} opp STARTER PTS`, v(oppMisc, "starterPts"), a.opponentStarterPointsPerGame);
    expectNear(`${label} opp 日本人 PTS`, v(oppMisc, "japanesePts3"), a.opponentJapanesePointsPerGame);
    expectNear(`${label} opp 外国籍・帰化・アジア PTS`, v(oppMisc, "internationalPts3"), a.opponentInternationalPointsPerGame);
    expectNear(`${label} opp %3P`, v(oppScoring, "pct3p"), a.opponentThreePointPointsSharePct);
    expectNear(`${label} opp PITP%（旧 %PinP）`, v(oppScoring, "pitppct"), a.opponentPaintPointsSharePct);
    // ペイント内の試投の割合は %PAINT2A 1つにまとめた（旧 %IPA＝チーム詳細の 100×PAINT2A÷チームの FGA〔teams.json の totals.fga〕）
    {
      const fga = team.totals.fga;
      const oppFga = totals.oppFga;
      expectNear(`${label} %PAINT2A（旧 %IPA）`, v(ownScoring, "pctpaint2a"), (100 * totals.paint2a) / fga);
      expectNear(`${label} opp %PAINT2A（旧 opp %IPA）`, v(oppScoring, "pctpaint2a"), (100 * totals.oppPaint2a) / oppFga);
      expectNear(`${label} %OPA＋%PAINT2A＝100`, v(ownScoring, "pctopa") + v(ownScoring, "pctpaint2a"), 100);
    }
    expectNear(`${label} opp %PoutP`, v(oppScoring, "pctpoutp"), a.opponentMidRangePointsSharePct);
    expectNear(`${label} opp %FT`, v(oppScoring, "pctft"), a.opponentFtPointsSharePct);
    // ②合計（選手の得点の合計がチーム得点と合わない既知の試合を除く）
    const clean = logs.filter((g) => !KNOWN_PLAYER_SUM_GAPS.has(`${season}:${g.scheduleKey}`));
    const cleanItem = itemOf(sumTeamGameLogs(clean), clean.length);
    const cv = (m: Map<string, ComparisonStatDef<TeamCompareColumnData>>, key: string) => m.get(key)!.value(cleanItem);
    const cleanPts = sumTeamGameLogs(clean).pts / clean.length;
    expectNear(`${label} 日本人＋外国籍等＝PTS`, cv(ownMisc, "japanesePts3") + cv(ownMisc, "internationalPts3"), cleanPts);
    expectNear(`${label} ベンチ＋スタメン＝PTS`, cv(ownMisc, "benchPts") + cv(ownMisc, "starterPts"), cleanPts);
    expectNear(`${label} %日本人＋%外国籍等＝100`, cv(ownScoring, "pctjapanese3") + cv(ownScoring, "pctinternational3"), 100);
    expectNear(`${label} %ベンチ＋%スタメン＝100`, cv(ownScoring, "pctbenchpts") + cv(ownScoring, "pctstarterpts"), 100);
  }

  // ③リーグ平均（league-compare.json の平均から作る）と、全チームの試合ログの合計から出した値
  const leagueFile = path.join(DATA, season, "league-compare.json.gz");
  if (existsSync(leagueFile) && allLogs.length > 0) {
    const league = readGz<LeagueCompareFile>(leagueFile).totals.regular;
    if (league) {
      const fromLogs = itemOf(sumTeamGameLogs(allLogs), allLogs.length);
      const fromLeague = itemOf(teamTotalsFromBoxTotals(league), 1, { isLeague: true });
      for (const tab of TEAM_TABS) {
        for (const perspective of ["own", "opp"] as const) {
          const defs = teamDefsFor(tab, perspective);
          for (const key of ["ftr", "orbpct", "pitppct", "fbppct", "2ndptspct", "ptsofftovpct", "pctpaint2m", "pctpaint2a", "pctmid2m", "pctmid2a", "pct3p", "pctpoutp", "pctft", "pctopa"]) {
            const d = defs.get(key);
            if (!d) continue;
            // 画面に出る値（小数第1位まで）で比べる。2016-17・2020-21 は、ペイント内外の試投・成功だけ、平均の元（試合の生データ）と
            // 試合ログの集計で 0.01pt 未満の差がある（一部の試合の区分の取り方）。画面の値は同じ
            checked += 1;
            if (d.format(fromLeague) !== d.format(fromLogs)) {
              mismatches.push(`${season} リーグ平均 ${perspective} ${d.label}: 平均から ${d.format(fromLeague)} / 試合ログから ${d.format(fromLogs)}`);
            }
          }
        }
      }
      // 試合ログにしか無い項目は、リーグ平均では「-」
      const misc = teamDefsFor("misc", "own");
      eq(`${season} リーグ平均の BENCH PTS は「-」`, misc.get("benchPts")!.format(fromLeague), "-");
      eq(`${season} リーグ平均の日本人 PTS は「-」`, misc.get("japanesePts3")!.format(fromLeague), "-");
    }
  }

  // ④個人: DD2・TD3・FTR
  const players = readGz<PlayerSummary[]>(path.join(DATA, season, "players.json.gz"));
  const playerDefsTrad = new Map(seasonBoxCompareDefs("traditional", false).map((d) => [d.key, d]));
  const playerDefsAdv = new Map(seasonBoxCompareDefs("advanced", false).map((d) => [d.key, d]));
  for (const player of players) {
    const file = path.join(DATA, season, "player-games", `${player.playerId}.json.gz`);
    if (!existsSync(file)) continue;
    const logs = readGz<PlayerGameLog[]>(file).filter((g) => g.gameType === "regular" && g.min > 0);
    if (logs.length === 0) continue;
    const ctx = buildSeasonBoxscoreCtx(sumPlayerGameLogs(logs), EMPTY_TEAM_TOTALS, "perGame", Number(season.slice(0, 4)));
    const row: CompareColumnData = { key: "p", label: "p", ctx, ddtd: countDoubleTripleDoubles(logs) };
    const label = `${season} ${player.name}`;
    expectNear(`${label} DD2`, playerDefsTrad.get("dd2")!.value(row), player.totals.doubleDoubles);
    expectNear(`${label} TD3`, playerDefsTrad.get("td3")!.value(row), player.totals.tripleDoubles);
    expectNear(`${label} FTR`, playerDefsAdv.get("ftr")!.value(row), player.shooting.ftRate);
  }
}
if (seasonsOnDisk.length > 0) {
  eq(`追加項目の実データ（${seasonsOnDisk.length}シーズン・${checked}件）の食い違い`, mismatches.slice(0, 12), []);
  if (mismatches.length > 12) console.error(`  ほか ${mismatches.length - 12}件`);
}

if (failures > 0) {
  console.error(`\n${failures}件の食い違いがあります`);
  process.exit(1);
}
console.log("\nすべて一致しました");
