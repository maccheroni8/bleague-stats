// 複数試合サンプル収集のため、候補ScheduleKeyのlatestidだけを軽量に確認する。
// リクエスト間隔は2.5秒空ける。有効なキーのみ後続でJSON本体を見る。

const HOST = "http://b-league.s3.amazonaws.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const candidates = [
  "505076", // 設計書記載の例
  "503882", "506010", // softbank lives由来
  "105982", "105988", "105989", "107617", "107622",
  "109541", "109542", "109543", "109544", "109551",
  "506095", "506096", "506097", "506098", "506100", "506101", // 506099近傍
  "505050", "505100", "505150", "505200", // 505076近傍レンジ探索
];

const valid = [];

for (const key of candidates) {
  const url = `${HOST}/web_json/v2_genius_contexts/${key}/latestid`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    const text = res.ok ? (await res.text()).trim() : null;
    console.log(`${key}: status=${res.status} latestid=${text}`);
    if (res.ok && /^\d+$/.test(text)) {
      valid.push({ key, latestid: text });
    }
  } catch (err) {
    console.log(`${key}: ERROR ${err.message}`);
  }
  await sleep(2500);
}

console.log("\n=== 有効なキー一覧 ===");
console.log(JSON.stringify(valid, null, 2));
