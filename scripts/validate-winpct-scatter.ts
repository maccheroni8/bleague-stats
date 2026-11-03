// 図解「勝率と登録区分別の得失点」の検証。人工データで線形回帰・平均・範囲を確かめ、今季の実データで
// Codex の調査値との一致、全チームスタッツ（試合ログの合計）・日本人と外国籍の得点の図との一致、
// 「外国籍・帰化・アジア＋日本人の得失点差＝チーム全体の得失点差」を確かめる。元データは読むだけ。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamGameLog } from "../shared/types";
import { buildWinPctScatter, linearFit, winPctAverages, winPctDomain, winPctRate, winPctX, type WinPctClass, type WinPctMetric } from "../src/lib/figureWinPct";
import { buildScoringScatter, scoringPerGame } from "../src/lib/figureScoring";

// --- 人工データ ---
{
  const fit = linearFit([1, 2, 3, 4], [2, 4, 6, 8])!;
  assert.ok(Math.abs(fit.slope - 2) < 1e-12 && Math.abs(fit.intercept) < 1e-12 && Math.abs(fit.r! - 1) < 1e-12, "完全な正の相関");
  assert.ok(Math.abs(linearFit([1, 2, 3], [3, 2, 1])!.r! + 1) < 1e-12, "完全な負の相関");
  assert.equal(linearFit([1, 1, 1], [1, 2, 3]), null, "xが全部同じなら直線を引かない");
  assert.equal(linearFit([1, 2, 3], [5, 5, 5])!.r, null, "yが全部同じなら r は出さない");
  assert.equal(linearFit([1], [1]), null);
  const d = winPctDomain([20, 30], "pts"); assert.deepEqual([d.min, d.max], [10, 60], "得点・失点は基本の範囲");
  assert.deepEqual([winPctDomain([70.2], "pts").max], [75], "はみ出すときだけ5刻みで広げる");
  const dd = winPctDomain([-5, 8], "diff"); assert.deepEqual([dd.min, dd.max], [-20, 20], "得失点差は ±20");
  assert.equal(winPctDomain([-21], "diff").min, -25);
  assert.equal(winPctDomain([20], "diff").max, 20, "ちょうど端の値では広げない");
  console.log("勝率×区分別得失点: 回帰・相関・軸の範囲 OK");
}

const mk = (o: Partial<TeamGameLog>): TeamGameLog => ({ scheduleKey: "k", date: "2026-10-01", opponentTeamId: "x", opponentTeamName: "X", isHome: true, teamScore: 80, opponentScore: 70, win: true, gameType: "regular", min: 200,
  japanesePoints: 40, foreignPoints: 30, naturalizedOrAsianPoints: 10, opponentJapanesePoints: 35, opponentForeignPoints: 25, opponentNaturalizedOrAsianPoints: 10, ...o } as TeamGameLog);
{
  const logs = new Map([["a", [mk({}), mk({ win: false, teamScore: 60, opponentScore: 66, japanesePoints: 30, foreignPoints: 20, naturalizedOrAsianPoints: 10, opponentJapanesePoints: 30, opponentForeignPoints: 26, opponentNaturalizedOrAsianPoints: 10 }), mk({ japanesePoints: undefined as unknown as number })]],
    ["b", [mk({ win: false })]]]);
  const m = buildWinPctScatter([{ teamId: "a", teamName: "A" }, { teamId: "b", teamName: "B" }, { teamId: "c", teamName: "C" }], logs, null, { season: "2026-27", category: "premier", range: { kind: "all" }, gameType: "regular" });
  const a = m.points.find(p => p.teamId === "a")!;
  assert.equal(a.games, 2, "区分別得点が欠けた試合は分母に入れない");
  assert.equal(winPctRate(a), 0.5);
  assert.equal(winPctX(a, "intl", "pts"), 35, "(40+35)/2 → 外国籍40・帰化10+外国籍20・帰化10 の平均");
  assert.equal(winPctX(a, "japanese", "opp"), 32.5);
  assert.equal(winPctX(a, "foreign", "diff"), (30 + 20 - 25 - 26) / 2);
  assert.deepEqual(m.omitted, ["c"], "試合の無いチームは除く");
  const avg = winPctAverages(m.points, "japanese", "pts")!;
  assert.ok(Math.abs(avg.x - (70 + 40) / 3) < 1e-12 && Math.abs(avg.winRate - 1 / 3) < 1e-12, "平均は合計÷試合数");
  console.log("勝率×区分別得失点: 集計・欠損・平均 OK");
}

// --- 実データ ---
const source = process.argv[2];
if (source) {
  const read = <T,>(file: string) => JSON.parse(gunzipSync(readFileSync(file)).toString()) as T;
  const CODEX: Record<string, number> = { "intl:pts": 0.578, "japanese:pts": -0.018, "intl:opp": -0.451, "japanese:opp": -0.397, "intl:diff": 0.742, "japanese:diff": 0.196 };
  for (const league of ["premier", "one"] as const) {
    const base = path.join(source, "2026-27", ...(league === "one" ? ["one"] : []));
    if (!existsSync(path.join(base, "teams.json.gz"))) { console.log(`勝率×区分別得失点: ${league} の導出データが無いので実データの確認を省略`); continue; }
    const teams = read<{ teamId: string; teamName: string; gamesPlayed: number }[]>(path.join(base, "teams.json.gz"));
    const all = new Map(teams.map(t => [t.teamId, read<TeamGameLog[]>(path.join(base, "team-games", `${t.teamId}.json.gz`))]));
    for (const [cutoff, check] of [["2026-11-01", league === "premier"], [undefined, false]] as const) {
      const logs = new Map([...all].map(([id, l]) => [id, cutoff ? l.filter(g => g.date <= cutoff) : l]));
      const query = { season: "2026-27", category: league, range: { kind: "all" } as const, gameType: "regular" as const };
      const m = buildWinPctScatter(teams, logs, null, query);
      const sc = buildScoringScatter(teams, logs, null, query);
      assert.equal(m.points.length, sc.points.length);
      for (const p of m.points) {
        const s = sc.points.find(x => x.teamId === p.teamId)!;
        assert.equal(p.games, s.games);
        for (const cls of ["intl", "japanese", "foreign"] as const) {
          assert.ok(Math.abs(winPctX(p, cls, "pts") - scoringPerGame(s, cls, "own")) < 1e-9, `${league} ${p.teamId} ${cls} 得点が日本人・外国籍の得点の図と一致`);
          assert.ok(Math.abs(winPctX(p, cls, "opp") - scoringPerGame(s, cls, "opp")) < 1e-9, `${league} ${p.teamId} ${cls} 失点`);
          assert.ok(Math.abs(winPctX(p, cls, "diff") - scoringPerGame(s, cls, "diff")) < 1e-9, `${league} ${p.teamId} ${cls} 差`);
        }
        // 区分の得失点差の合計＝チーム全体の得失点差（区分不明の得点が無いチームだけ厳密に一致。差は報告用に数える）
        const gap = winPctX(p, "intl", "diff") + winPctX(p, "japanese", "diff") - (p.ownPts - p.oppPts) / p.games;
        assert.ok(Math.abs(gap) < 1e-9, `${league} ${p.teamId} 外国籍・帰化・アジア＋日本人の得失点差＝チーム全体の得失点差（差 ${gap}）`);
        const t = logs.get(p.teamId)!.filter(g => g.gameType === "regular");
        assert.equal(p.wins, t.filter(g => g.win && Number.isFinite(g.japanesePoints)).length);
      }
      const line = (cls: WinPctClass, metric: WinPctMetric) => {
        const fit = linearFit(m.points.map(p => winPctX(p, cls, metric)), m.points.map(p => 100 * winPctRate(p)));
        return fit?.r ?? NaN;
      };
      const rs = (["intl", "japanese", "foreign"] as const).map(c => `${c}[${(["pts", "opp", "diff"] as const).map(k => line(c, k).toFixed(3)).join(" ")}]`).join(" ");
      console.log(`${league} ${cutoff ?? "最新"} (${m.points.length}チーム) r pts/opp/diff: ${rs}`);
      if (check) for (const cls of ["intl", "japanese"] as const) for (const k of ["pts", "opp", "diff"] as const)
        assert.equal(line(cls, k).toFixed(3).replace(/^(-?)0\./, "$1."), CODEX[`${cls}:${k}`]!.toFixed(3).replace(/^(-?)0\./, "$1.").replace(/^\+/, ""), `Codex の調査値と一致: ${cls} ${k}`);
    }
  }
}
console.log("勝率×区分別得失点: OK");
