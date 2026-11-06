// 保存画像・画面の大見出しの文節分割（titlePhrases）と、選手の散布図の人数の行・置き場所の検証。人工データだけを使い、元データは読まない。
import assert from "node:assert/strict";
import { titlePhrases } from "../src/lib/titlePhrases";
import { chooseCountPlacement, playerCountLines } from "../src/lib/figurePlayerCounts";

// --- 見出しの文節 ---
const cases: string[] = ["相手のペイント内の2ポイント成功率ランキング", "各チームのトップスコアラー3人：PTS × 平均得点", "強制ターンオーバー（合計）ランキング", "アシストペアの得点ランキング"];
for (const title of cases) assert.equal(titlePhrases(title).join(""), title, `つなげると元に戻る: ${title}`);
assert.deepEqual(titlePhrases("相手のペイント内の2ポイント成功率ランキング"), ["相手の", "ペイント内の", "2ポイント成功率", "ランキング"]);
assert.deepEqual(titlePhrases("強制ターンオーバー（合計）ランキング"), ["強制ターンオーバー", "（合計）", "ランキング"]);
assert.deepEqual(titlePhrases("ランキング"), ["ランキング"], "助詞のない語は分けない");
assert.deepEqual(titlePhrases("ほとんど"), ["ほとんど"], "ひらがなの語の中は分けない");
assert.deepEqual(titlePhrases("A・B"), ["A・", "B"]);
// 表の日本語名はどれも途中で切れない: 助詞の直後以外では切らない
const titles = ["相手のペイント内の2ポイント成功率ランキング", "ペイント内の2ポイント成功率ランキング", "相手のフリースロー獲得率ランキング", "アシストされた得点の割合ランキング"];
for (const t of titles) {
  const phrases = titlePhrases(t);
  phrases.slice(0, -1).forEach((ph, i) => assert.ok(/[のとをがはでにへもや・）]$/.test(ph) || phrases[i + 1] === "ランキング", `切れ目は助詞の後ろか「ランキング」の前: ${ph}`));
}

// --- 人数の行 ---
const players = [
  { playerId: "a", classification: "日本人" as const }, { playerId: "b", classification: "日本人" as const }, { playerId: "c", classification: "外国籍" as const },
  { playerId: "d", classification: "帰化選手" as const }, { playerId: "e", classification: "アジア特別枠" as const }, { playerId: "f", classification: undefined },
];
assert.deepEqual(playerCountLines(["a", "b", "c", "d", "e"], players, null, "all"), ["表示 5人", "日本人 2人", "外国籍 1人", "帰化 1人", "アジア特別枠 1人"]);
assert.deepEqual(playerCountLines(["a", "c"], players, null, "all"), ["表示 2人", "日本人 1人", "外国籍 1人"], "いない区分は出さない");
assert.deepEqual(playerCountLines(["a", "b"], players, null, "日本人"), ["表示 2人", "日本人 2人"], "選んだ区分だけ");
assert.deepEqual(playerCountLines(["c", "d", "e"], players, null, "外国籍,アジア特別枠"), ["表示 3人", "外国籍 1人", "アジア特別枠 1人"]);
assert.deepEqual(playerCountLines(["c", "d", "e"], players, null, "外国籍・帰化・アジア"), ["表示 3人", "外国籍・帰化・アジア 3人"], "まとめの区分は合計");
assert.deepEqual(playerCountLines(["a"], players, null, "帰化"), ["表示 1人", "帰化 0人"], "選んだ区分は0人でも出す");
assert.deepEqual(playerCountLines(["a", "a", "b"], players, null, "all"), ["表示 2人", "日本人 2人"], "同じ選手は1人");

// --- 人数の枠の置き場所 ---
const plot = { width: 400, height: 400 }, box = { width: 100, height: 70 };
const hit = (pl: { left: number; top: number }, pts: { left: number; top: number }[], r = 16) => pts.filter(p => { const x = p.left / 100 * plot.width, y = p.top / 100 * plot.height; return x >= pl.left - r && x <= pl.left + box.width + r && y >= pl.top - r && y <= pl.top + box.height + r; }).length;
const none = chooseCountPlacement([], plot, box);
assert.deepEqual([none.left, none.top, none.overlaps], [plot.width - 6 - box.width, 6, 0], "点がなければ右上");
const crowdTop = Array.from({ length: 30 }, (_, i) => ({ left: 50 + (i % 10) * 5, top: 4 + Math.floor(i / 10) * 6 }));
const moved = chooseCountPlacement(crowdTop, plot, box);
assert.equal(moved.overlaps, 0); assert.equal(hit(moved, crowdTop), 0, "右上に点が集まっていれば避ける");
assert.ok(moved.left >= 6 - 1e-9 && moved.left + box.width <= plot.width - 6 + 1e-9 && moved.top >= 6 && moved.top + box.height <= plot.height - 6 + 1e-9, "図の中に収まる");
const dense = Array.from({ length: 150 }, (_, i) => ({ left: (i * 37) % 100, top: (i * 53) % 100 }));
const p3 = chooseCountPlacement(dense, plot, box);
assert.equal(p3.overlaps, hit(p3, dense), "重なる数は枠の範囲の点の数と一致");
const fullGrid = Array.from({ length: 400 }, (_, i) => ({ left: (i % 20) * 5 + 2, top: Math.floor(i / 20) * 5 + 2 }));
const p4 = chooseCountPlacement(fullGrid, plot, box);
assert.ok(p4.overlaps > 0, "全面に点があるときは重なりが最小の位置を返す");
console.log("図解の見出しの文節・選手の人数の行・人数の枠の置き場所 OK");
