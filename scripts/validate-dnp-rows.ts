// 出場していない選手（PlayTime が DNP）の行に成績が付いている試合を見つける検証スクリプト（検証専用。CIには入れず、手で実行する。DESIGN.md 277章）。
//
// 全シーズン・全試合（B.PREMIER・B.ONE）の生データ（元データ）の、選手の試合合計の行（PeriodCategory=18・Category=1）を見て、
// PlayTime が DNP なのに得点・リバウンド・アシスト・スティール・ブロック・ターンオーバー・ファウル・シュート・FTの試投が付いている行を数える。
// 今ある例外は ALLOWED（公式記録の誤りと判断済み）だけ。それ以外が見つかったら終了コード1で、試合ID・選手・付いている項目を出す。
// 集計は出場時間0の行の成績も合算する（players.json の PF など）ので、新しく出たら集計との食い違いの元になる。
//
// 使い方: npm run validate:dnp-rows
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";

/** 公式記録の誤りと判断済みの例外（season:scheduleKey → 理由）。増やすときは設計書277章に記録する */
const ALLOWED: Record<string, string> = {
  "2016-17:101": "千葉70-82A東京（2016-10-30）。出場なしの選手9人（千葉5人・A東京4人）にPF1が付いている。公式記録の誤り。277章",
};

const STAT_KEYS = ["Point", "RB_TOT", "AS", "ST", "BS", "TO", "FOUL", "PT2A", "PT3A", "FTA"] as const;
const DATA = path.resolve("data");
const rj = (p: string) => JSON.parse(gunzipSync(readFileSync(p)).toString("utf8"));

const found = new Map<string, string[]>();
let games = 0;
for (const season of readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  for (const sub of ["games", "one/games"]) {
    const dir = path.join(DATA, season, sub);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".json.gz"))) {
      games++;
      const game = rj(path.join(dir, f));
      const rows = [...(game.raw?.HomeBoxscores ?? []), ...(game.raw?.AwayBoxscores ?? [])];
      for (const r of rows) {
        // Category=1 が選手（2 はコーチ等の行で、チームのリバウンド・ターンオーバーが付くので対象外）
        if (r.PeriodCategory !== 18 || r.Category !== 1 || !r.PlayerID || r.PlayTime !== "DNP") continue;
        const items = STAT_KEYS.filter((k) => Number(r[k] ?? 0) > 0).map((k) => `${k}=${r[k]}`);
        if (items.length === 0) continue;
        const key = `${season}:${f.replace(".json.gz", "")}`;
        found.set(key, [...(found.get(key) ?? []), `${r.PlayerID}（${items.join(" ")}）`]);
      }
    }
  }
}

let ng = 0;
for (const [key, rows] of found) {
  if (ALLOWED[key]) {
    console.log(`許可済み: ${key} ${rows.length}行 — ${ALLOWED[key]}`);
    continue;
  }
  ng++;
  console.log(`NG: ${key} 出場なしの行に成績あり ${rows.length}行: ${rows.slice(0, 5).join("、")}`);
}
for (const key of Object.keys(ALLOWED)) if (!found.has(key)) console.log(`注意: 許可済みの ${key} は、今は該当する行がありません（公式が直した？）。ALLOWED から外してよいか確認`);
console.log(`${games} 試合を確認`);
console.log(ng === 0 ? "OK: 許可済み以外に、出場なしの行に成績が付いた試合はありません" : `NG: ${ng} 試合`);
process.exit(ng === 0 ? 0 : 1);
