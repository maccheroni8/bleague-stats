// 有効なキーそれぞれのJSON本体を取得し、MaxPeriod（延長戦有無）を確認する。
// リクエスト間隔は2.5秒空ける。

const HOST = "http://b-league.s3.amazonaws.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const valid = [
  { key: "505076", latestid: "126" },
  { key: "503882", latestid: "72" },
  { key: "506010", latestid: "114" },
  { key: "506095", latestid: "124" },
  { key: "506097", latestid: "131" },
  { key: "506098", latestid: "137" },
  { key: "506100", latestid: "139" },
  { key: "506101", latestid: "127" },
  { key: "505050", latestid: "111" },
  { key: "505100", latestid: "106" },
  { key: "505150", latestid: "125" },
  { key: "505200", latestid: "125" },
];

const results = [];

for (const { key, latestid } of valid) {
  const url = `${HOST}/web_json/v2_genius_contexts/${key}/${latestid}.json`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) {
      console.log(`${key}: status=${res.status} (skip)`);
      await sleep(2500);
      continue;
    }
    const data = await res.json();
    const g = data.Game;
    const info = {
      key,
      MaxPeriod: g.MaxPeriod,
      GameEndedFlg: g.GameEndedFlg,
      HomeTeamNameJ: g.HomeTeamNameJ,
      AwayTeamNameJ: g.AwayTeamNameJ,
      GameDateTime: g.GameDateTime,
      HomeTeamScore: g.HomeTeamScore,
      AwayTeamScore: g.AwayTeamScore,
      scoreFieldKeys: Object.keys(g).filter((k) => /TeamScore\d/.test(k)),
    };
    console.log(JSON.stringify(info));
    results.push({ ...info, hasOT: g.MaxPeriod > 4 });
  } catch (err) {
    console.log(`${key}: ERROR ${err.message}`);
  }
  await sleep(2500);
}

console.log("\n=== 延長戦(MaxPeriod>4)のある試合 ===");
console.log(JSON.stringify(results.filter((r) => r.hasOT), null, 2));
