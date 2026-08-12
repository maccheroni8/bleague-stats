// ActionCD1の値ごとにPlayTextのサンプルを突き合わせて、実際の意味を確認する追加検証。
// verify-api.mjs で有効性を確認済みのホスト/latestidを使う。1リクエストのみ。

const SCHEDULE_KEY = "506099";
const LATEST_ID = "123";
const url = `http://b-league.s3.amazonaws.com/web_json/v2_genius_contexts/${SCHEDULE_KEY}/${LATEST_ID}.json`;

const res = await fetch(url, {
  headers: { "User-Agent": "Mozilla/5.0" },
});
const data = await res.json();

const byCode = {};
for (const ev of data.PlayByPlays) {
  const code = ev.ActionCD1;
  if (!byCode[code]) byCode[code] = new Set();
  if (ev.PlayText && ev.PlayText.trim()) byCode[code].add(ev.PlayText.trim());
}

console.log("=== ActionCD1 -> PlayTextサンプル（ユニーク文言） ===");
for (const code of Object.keys(byCode).sort((a, b) => Number(a) - Number(b))) {
  console.log(`${code}: ${[...byCode[code]].slice(0, 5).join(" / ")}`);
}

// 選手交代・タイムアウト・ファウルまわりの実データも数件生で見る
console.log("\n=== サンプルイベント（先頭20件） ===");
console.log(JSON.stringify(data.PlayByPlays.slice(0, 20), null, 2));
