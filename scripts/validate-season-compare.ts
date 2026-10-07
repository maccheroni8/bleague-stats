// ランキングの前シーズン比較（src/lib/seasonCompare.ts。DESIGN.md 218章）の純粋な部分の検証スクリプト（検証専用。CIには入れず、必要なときに手で実行する）。
//
// 確かめること: 前季の求め方／表示値どうしの差（桁・%・符号・桁区切り・「-」）／色の向き／順位の付け方（1・2・2・4）／
// 両シーズンにいる行だけが出ること／使えない条件の理由。
//
// 使い方: npm run validate:season-compare（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { buildCompare, compareUnsupportedReason, displayedDiff, diffTone, previousSeason, rankPositions } from "../src/lib/seasonCompare";

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

// 前季
eq("前季 2016-17 は無い", previousSeason("2016-17"), null);
eq("前季 2017-18", previousSeason("2017-18"), "2016-17");
eq("前季 2026-27", previousSeason("2026-27"), "2025-26");
eq("前季 最初のシーズンより前は無い", previousSeason("2015-16"), null);

// 表示値どうしの差
const d = (cur: string, prev: string) => {
  const r = displayedDiff(cur, prev);
  return r ? r.text : null;
};
eq("差 15.2-10.0", d("15.2", "10.0"), "+5.2");
eq("差 浮動小数点（0.3-0.1）", d("0.3", "0.1"), "+0.2");
eq("差 8.8-2.7", d("8.8", "2.7"), "+6.1");
eq("差 %はポイント", d("45.3%", "44.1%"), "+1.2pt");
eq("差 %の減少", d("33.0%", "40.5%"), "-7.5pt");
eq("差 桁区切り", d("1,053", "1,591"), "-538");
eq("差 桁区切り（増加）", d("1,591", "1,053"), "+538");
eq("差 負の値", d("-3.2", "1.0"), "-4.2");
eq("差 符号付きの値（+/-）", d("+3.2", "+1.1"), "+2.1");
eq("差 同じ値は符号なし", d("20.0", "20.0"), "0.0");
eq("差 DD2（達成率と回数を添えた表示）", d("45.0%（27/60）", "40.0%（24/60）"), "+5.0pt");
eq("差 回数", d("27回", "24回"), "+3");
eq("差 先頭の0が無い値", d(".550", ".500"), "+0.050");
eq("差 値が無い（-）", d("-", "1.0"), null);
eq("差 値が無い（前季が-）", d("1.0", "-"), null);
eq("差 表示の桁が違うとき（桁数の多い方に合わせる）", d("12.30", "10.1"), "+2.20");
// 表示値どうしの差は、画面の2つの値の引き算と必ず合う
for (const [c, p] of [["20.7", "17.1"], ["20.3", "16.1"], ["19.5", "17.0"], ["0.1", "0.3"], ["12.5", "12.4"]] as const) {
  eq(`差が表示値の引き算と一致 ${c}-${p}`, Number(d(c, p)), Number((Number(c) - Number(p)).toFixed(1)));
}

// 色の向き
eq("色 多い方が良い項目で増えた", diffTone(1.2, true), "good");
eq("色 多い方が良い項目で減った", diffTone(-1.2, undefined), "bad");
eq("色 少ない方が良い項目（TOV）で減った", diffTone(-0.4, false), "good");
eq("色 少ない方が良い項目（TOV）で増えた", diffTone(0.1, false), "bad");
eq("色 差が0", diffTone(0, false), "flat");

// 順位
eq("順位 1・2・2・4", rankPositions(["10.0", "9.0", "9.0", "8.0"]), [1, 2, 2, 4]);
eq("順位 全部同じ", rankPositions(["1", "1", "1"]), [1, 1, 1]);
// 両シーズンにいる行だけが出る。差は表示値どうし
type Row = { id: string; v: number };
const def = { value: (r: Row) => r.v, format: (r: Row) => r.v.toFixed(1), higherIsBetter: true };
const prevAll: Row[] = [{ id: "a", v: 20 }, { id: "b", v: 18 }, { id: "c", v: 15 }, { id: "d", v: 15 }, { id: "e", v: 10 }];
const full = buildCompare<Row, Row>({ currentRows: [{ id: "a", v: 22 }, { id: "c", v: 17 }, { id: "e", v: 12 }, { id: "z", v: 30 }], currentKey: (r) => r.id, currentDef: def, prevRows: prevAll, prevKey: (r) => r.id, prevDef: def });
eq("比較 前季にいない行は出ない", full.rows.map((r) => r.id), ["a", "c", "e"]);
eq("比較 差", ["a", "c", "e"].map((k) => full.entries.get(k)!.diffText), ["+2.0", "+2.0", "+2.0"]);
eq("比較 前季の値", ["a", "c", "e"].map((k) => full.entries.get(k)!.prevText), ["20.0", "15.0", "10.0"]);
const accepted = buildCompare<Row, Row>({ currentRows: [{ id: "a", v: 22 }, { id: "c", v: 17 }], currentKey: (r) => r.id, currentDef: def, prevRows: prevAll, prevKey: (r) => r.id, prevDef: def, accept: (r) => r.id !== "c" });
eq("比較 外した行は出ない", accepted.rows.map((r) => r.id), ["a"]);
const unreadable = buildCompare<Row, Row>({ currentRows: [{ id: "a", v: 22 }], currentKey: (r) => r.id, currentDef: { format: () => "-" }, prevRows: prevAll, prevKey: (r) => r.id, prevDef: def });
eq("比較 値が読めない行は出ない", unreadable.rows.length, 0);

// 使えない条件
const base = {
  season: "2025-26",
  categoryKind: "boxscore" as const,
  statKey: "pts",
  filter: { range: { kind: "all" as const } },
  gameType: "regular" as const,
  period: "all" as const,
  prevDivisions: ["east", "west"] as ("east" | "west")[],
};
eq("理由 使える", compareUnsupportedReason(base), null);
eq("理由 2016-17", compareUnsupportedReason({ ...base, season: "2016-17" })?.includes("2016-17では選べません"), true);
eq("理由 Profile・Career", compareUnsupportedReason({ ...base, categoryKind: "registered" })?.includes("登録していた選手全員"), true);
eq("理由 Shooting・Forced TOV は前季が2023-24以降のときだけ", [compareUnsupportedReason({ ...base, season: "2024-25", categoryKind: "seasonTotal" }), compareUnsupportedReason({ ...base, season: "2023-24", categoryKind: "seasonTotal" }) !== null], [null, true]);
eq("理由 Q別・前後半", compareUnsupportedReason({ ...base, period: "q1" })?.includes("Q別・前後半"), true);
eq("理由 期間指定", compareUnsupportedReason({ ...base, filter: { range: { kind: "dateRange", start: "2025-11-01", end: "2025-12-01" } } })?.includes("期間指定"), true);
eq("理由 直近N試合は使える", compareUnsupportedReason({ ...base, filter: { range: { kind: "recent", n: 5 } } }), null);
eq("理由 前季に無い地区", compareUnsupportedReason({ ...base, filter: { range: { kind: "all" }, ownDivision: "central" } })?.includes("中地区"), true);
eq("理由 前季にある地区", compareUnsupportedReason({ ...base, filter: { range: { kind: "all" }, ownDivision: "west" } }), null);
eq("理由 前季にポストシーズンが無い", compareUnsupportedReason({ ...base, season: "2020-21", gameType: "playoff" })?.includes("開催されなかった"), true);
eq("理由 前季の表に無いファウルの列", compareUnsupportedReason({ ...base, season: "2026-27", statKey: "tf1" })?.includes("表にない"), true);
eq("理由 前季の表にあるファウルの列", compareUnsupportedReason({ ...base, season: "2026-27", statKey: "pts" }), null);

if (failures > 0) {
  console.error(`\n${failures}件の食い違いがあります`);
  process.exit(1);
}
console.log("\nすべて一致");
