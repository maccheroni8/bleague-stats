// Boxscores の Category / PeriodCategory / StartingFlg / PlayingFlg の実際の値分布、
// Summaries の PeriodCategory 一覧を確認する追加検証（1リクエストのみ）。

const SCHEDULE_KEY = "506099";
const LATEST_ID = "123";
const url = `http://b-league.s3.amazonaws.com/web_json/v2_genius_contexts/${SCHEDULE_KEY}/${LATEST_ID}.json`;

const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
const data = await res.json();

function uniq(arr) {
  return [...new Set(arr)];
}

console.log("=== HomeBoxscores: Category の値一覧 ===", uniq(data.HomeBoxscores.map((r) => r.Category)));
console.log("=== HomeBoxscores: PeriodCategory の値一覧 ===", uniq(data.HomeBoxscores.map((r) => r.PeriodCategory)));
console.log("=== HomeBoxscores: StartingFlg の値一覧 ===", uniq(data.HomeBoxscores.map((r) => r.StartingFlg)));
console.log("=== HomeBoxscores: PlayingFlg の値一覧 ===", uniq(data.HomeBoxscores.map((r) => r.PlayingFlg)));

// 実際にプレーした選手（PT2M+PT3M+FTMなどで判定せず、PlayTimeが"DNP"以外）のサンプル
const played = data.HomeBoxscores.find((r) => r.PeriodCategory === 18 && r.PlayTime && r.PlayTime !== "DNP" && r.Category === 1);
console.log("\n=== 出場選手サンプル(PeriodCategory=18想定) ===");
console.log(JSON.stringify(played, null, 2));

// チーム合計行らしきものを探す（PlayerID等が空 or Category違い）
const teamRow = data.HomeBoxscores.find((r) => r.PeriodCategory === 18 && (!r.PlayerID || r.Category !== 1));
console.log("\n=== チーム合計行らしきサンプル ===");
console.log(JSON.stringify(teamRow, null, 2));

console.log("\n=== Summaries: PeriodCategory 一覧 ===", data.Summaries.map((s) => s.PeriodCategory));

console.log("\n=== Game.GameDateTime 生値 ===", data.Game.GameDateTime);
const m = /\/Date\((\d+)([+-]\d+)?\)\//.exec(data.Game.GameDateTime);
if (m) {
  console.log("パース結果(UTC ms):", m[1], "→", new Date(Number(m[1])).toISOString());
}
