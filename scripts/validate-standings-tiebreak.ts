// 順位表のタイブレーク（shared/standingsRank.ts。DESIGN.md 87章・229章）の検証。
// 公式の順位表の突き合わせ（実際のシーズン）は scripts/verify-official-standings.ts（手で実行）。ここでは小さな例で規則を確かめる。
import { rankStandingsTeams, recordHeadToHeadResult, type HeadToHeadTable, type StandingsCompareEntry } from "../shared/standingsRank.ts";
import { safeDiv } from "../shared/formulas.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}

type Game = [home: string, away: string, homeScore: number, awayScore: number];

/** 試合の一覧から、全クラブの成績と直接対決の表を作る */
function league(games: Game[]): { teams: StandingsCompareEntry[]; table: HeadToHeadTable } {
  const table: HeadToHeadTable = new Map();
  const acc = new Map<string, { wins: number; losses: number; pf: number; pa: number }>();
  const ens = (id: string) => {
    let a = acc.get(id);
    if (!a) {
      a = { wins: 0, losses: 0, pf: 0, pa: 0 };
      acc.set(id, a);
    }
    return a;
  };
  for (const [home, away, hs, as] of games) {
    const h = ens(home);
    const a = ens(away);
    h.pf += hs;
    h.pa += as;
    a.pf += as;
    a.pa += hs;
    const homeWin = hs > as;
    if (homeWin) {
      h.wins++;
      a.losses++;
    } else {
      a.wins++;
      h.losses++;
    }
    recordHeadToHeadResult(table, home, away, homeWin, hs, as);
    recordHeadToHeadResult(table, away, home, !homeWin, as, hs);
  }
  const teams = [...acc].map(([teamId, a]) => ({
    teamId,
    wins: a.wins,
    losses: a.losses,
    winPct: safeDiv(a.wins, a.wins + a.losses),
    pointsFor: a.pf,
    pointDiff: a.pf - a.pa,
  }));
  return { teams, table };
}
const order = (teams: StandingsCompareEntry[], table: HeadToHeadTable) => rankStandingsTeams(teams, table).map((t) => t.teamId).join(",");

// 1. グループ内で一部しか対戦していなくても、行われた試合で直接対決を使う（シーズン中。2026-27の東地区の実例の形）。
//    4クラブが1勝1敗で、グループ内の対戦は 北海道(702)が仙台(692)に勝った1試合だけ。
//    全体の得失点差は 仙台 +30 > 北海道 +9 > 富山 +5 > 横浜 -5。直接対決を使うと北海道が先頭になる
{
  const g: Game[] = [
    ["702", "692", 80, 70],
    ["692", "x1", 100, 60],
    ["x4", "702", 80, 79],
    ["694", "x3", 85, 80],
    ["x2", "694", 90, 80],
    ["696", "x5", 70, 75],
    ["x6", "696", 60, 70],
  ];
  const { teams, table } = league(g);
  const grp = teams.filter((t) => ["702", "692", "694", "696"].includes(t.teamId));
  check("例1の前提: 4クラブとも1勝1敗", grp.length === 4 && grp.every((t) => t.winPct === 0.5));
  const r = order(grp, table);
  check("一部しか対戦していなくても直接対決で優劣がつく（北海道が先頭、残りは全体の得失点差順）", r === "702,692,696,694", r);
}

// 2. グループ内に1試合も無ければ、全体の得失点差で決める
{
  const g: Game[] = [
    ["a", "x", 90, 70],
    ["b", "y", 85, 70],
  ];
  const { teams, table } = league(g);
  const grp = teams.filter((t) => ["a", "b"].includes(t.teamId));
  check("グループ内に対戦が無ければ全体の得失点差で決める（a +20 が b +15 の上）", order(grp, table) === "a,b", order(grp, table));
}

// 3. 未対戦のクラブは直接対決の勝率0として扱う（2026-27の東地区の A千葉・川崎・千葉J の形）。
//    c1-c2 は1勝1敗（得失点差は c2 が +29）、c3 は両方と未対戦。全体の得失点差は c3(0) が c1(-29) より良いが、c3 は最後
{
  const g: Game[] = [
    ["c1", "c2", 80, 79],
    ["c2", "c1", 90, 60],
    ["c3", "z1", 100, 50],
    ["z2", "c3", 100, 50],
  ];
  const { teams, table } = league(g);
  const grp = teams.filter((t) => ["c1", "c2", "c3"].includes(t.teamId));
  check("例3の前提: 3クラブとも1勝1敗", grp.length === 3 && grp.every((t) => t.winPct === 0.5));
  const r = order(grp, table);
  check("対戦した2クラブ（c2 > c1）が、未対戦のクラブ（c3）より上", r === "c2,c1,c3", r);
}

// 4. ワイルドカードのプール: 3クラブの循環。全体（3クラブで同率）では X > Z > Y、プール（X・Z だけ）なら Z > X
{
  const g: Game[] = [
    ["X", "Y", 100, 80], // X が Y に +20
    ["Y", "Z", 90, 80], // Y が Z に +10
    ["Z", "X", 85, 80], // Z が X に +5
  ];
  const { teams, table } = league(g);
  const all = order(teams, table);
  const pool = order(teams.filter((t) => t.teamId !== "Y"), table);
  check("3クラブ全員で判定すると X > Z > Y（直接対決の得失点差）", all === "X,Z,Y", all);
  check("プール（Y を除く）で判定し直すと、Z が X の上（直接対決）", pool === "Z,X", pool);
}

// 5. 3クラブ以上の再帰: 優劣がついたクラブを確定させ、残りで(1)から判定し直す
//    p が q・r に2勝ずつ（p が先頭に確定）。q と r は1勝1敗で、q の直接対決の得失点差が大きい
{
  const g: Game[] = [
    ["p", "q", 80, 70],
    ["q", "p", 70, 80],
    ["p", "r", 80, 70],
    ["r", "p", 70, 80],
    ["q", "r", 90, 60],
    ["r", "q", 71, 70],
    // 全員4勝4敗にそろえる外の試合
    ["p", "w1", 50, 60],
    ["p", "w2", 50, 60],
    ["p", "w3", 50, 60],
    ["p", "w4", 50, 60],
    ["q", "w5", 80, 70],
    ["q", "w6", 80, 70],
    ["q", "w7", 80, 70],
    ["q", "w8", 50, 60],
    ["r", "w9", 80, 70],
    ["r", "w10", 80, 70],
    ["r", "w11", 80, 70],
    ["r", "w12", 50, 60],
  ];
  const { teams, table } = league(g);
  const grp = teams.filter((t) => ["p", "q", "r"].includes(t.teamId));
  check("例5の前提: 3クラブとも4勝4敗", grp.length === 3 && grp.every((t) => t.wins === 4 && t.losses === 4));
  const r = order(grp, table);
  check("優劣がついた p が先頭に確定し、残りの q・r を判定し直す（q が上）", r === "p,q,r", r);
}

if (failed > 0) {
  console.error(`\n${failed}件のNG`);
  process.exitCode = 1;
} else {
  console.log("\nすべてok");
}
