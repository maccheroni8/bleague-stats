// 比較の表（src/pages/ComparePage.tsx の ComparisonTable。DESIGN.md 234章）の、値の無い項目を出さない判定と、G の横の勝敗の検証スクリプト
// （検証専用。CIには入れず、必要なときに手で実行する）。
//
// 確かめること: すべての対象で「-」の項目だけが外れる（片方だけにある項目は残す・対象を足すと戻る）／勝敗の数え方（勝＋敗＝試合数）／
// チーム・個人の「G」だけに勝敗が付き、リーグ平均・勝敗の無い対象には付かない／強調（最良の判定）に使う値は勝敗に影響されない。
//
// 使い方: npm run validate:compare-table（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { defsWithAnyValue, recordOfLogs, seasonBoxCompareDefs, teamCompareDefs, type CompareColumnData, type TeamCompareColumnData } from "../src/lib/compareShared";
import type { ComparisonStatDef } from "../src/pages/ComparePage";

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

if (failures > 0) {
  console.error(`\n${failures}件の食い違いがあります`);
  process.exit(1);
}
console.log("\nすべて一致しました");
