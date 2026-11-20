// 表の上位3位の色付けの判定（topThreeIndexes）の検証（設計書438章）。npm run validate:top-three-tiers
import assert from "node:assert";
import { topThreeIndexes, topThreeRanks } from "../src/lib/topThreeTiers";

const id = (n: number | undefined) => n;
const set = (a: number[]) => [...a].sort().join(",");
const top = (vals: (number | undefined)[], better: "high" | "low") => set([...topThreeIndexes(vals, id, better)]);

// 多いほど良い: 上位3つ
assert.strictEqual(top([5, 9, 1, 7, 3], "high"), "0,1,3");
// 少ないほど良い
assert.strictEqual(top([5, 9, 1, 7, 3], "low"), "0,2,4");
// 同じ値は同じ順位（1位・2位・2位・4位なので、4位の値は入らない）
assert.strictEqual(top([10, 8, 8, 6, 1], "high"), "0,1,2");
// 同順位が3位をまたぐと全員入る
assert.strictEqual(top([10, 8, 7, 7, 7, 1], "high"), "0,1,2,3,4");
// 値の無い行は数えず、色も付けない
assert.strictEqual(top([undefined, 4, 3, 2, 1], "high"), "1,2,3");
assert.strictEqual(top([NaN, 4, 3, 2, 1], "low"), "2,3,4");
// 行が3つ以下なら全員
assert.strictEqual(top([1, 2], "high"), "0,1");
// 感度: 値を1つ変えると結果が変わる
assert.notStrictEqual(top([5, 9, 1, 7, 3], "high"), top([5, 9, 6, 7, 3], "high"));
// 順位（色の濃さ）: 1位・2位・2位・4位 → 1・2・2（4位は色なし）。同じ値は同じ濃さ
const ranks = (vals: number[], better: "high" | "low") => [...topThreeRanks(vals, id, better)].sort((a, b) => a[0] - b[0]).map(([i, r]) => `${i}:${r}`).join(",");
assert.strictEqual(ranks([10, 8, 8, 6, 1], "high"), "0:1,1:2,2:2");
assert.strictEqual(ranks([10, 8, 7, 7, 7, 1], "high"), "0:1,1:2,2:3,3:3,4:3");
assert.strictEqual(ranks([5, 9, 1, 7, 3], "low"), "0:3,2:1,4:2");
assert.strictEqual(ranks([4, 4, 4, 4], "high"), "0:1,1:1,2:1,3:1");
console.log("上位3位の色付けの判定: OK");
