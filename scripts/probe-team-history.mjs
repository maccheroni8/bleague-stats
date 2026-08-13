// bleague.jp/api/v1/club/ の裏側JSON API（getTeamsByYearAndEventAndDistrict）から
// 2016-17〜現行シーズンのB1/B.PREMIERクラブ一覧（TeamID+表示名）を機械的に収集し、
// 同一TeamIDで表示名がシーズンをまたいで変化している箇所を検出する（使い捨て調査スクリプト）。
// data/team-history.jsonのメンテナンス時に再実行する（新シーズンでの改称検出用）。
//
// 使い方: node scripts/probe-team-history.mjs

const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const MIN_INTERVAL_MS = 2500;
let lastRequestAt = 0;
async function throttledFetch(url) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  return fetch(url, { headers: { "User-Agent": USER_AGENT } });
}

const currentYear = new Date().getFullYear();
const years = [];
for (let y = 2016; y <= currentYear; y++) years.push(y);

const byYear = {};
for (const year of years) {
  const url = `https://www.bleague.jp/api/v1/club/?data_format=json&name=getTeamsByYearAndEventAndDistrict&year=${year}&event=2&district=0`;
  const res = await throttledFetch(url);
  const data = await res.json();
  byYear[year] = data.topics ?? [];
  console.log(`year=${year}: ${byYear[year].length}クラブ`);
}

const byTeamId = {};
for (const year of years) {
  for (const t of byYear[year]) {
    if (!byTeamId[t.TeamID]) byTeamId[t.TeamID] = {};
    byTeamId[t.TeamID][year] = { full: t.TeamNameJ, short: t.TeamShortNameJ };
  }
}

console.log("\n===== 名称変化があったTeamID（data/team-history.json要確認） =====");
for (const [teamId, yearsMap] of Object.entries(byTeamId)) {
  const fullNames = new Set(Object.values(yearsMap).map((v) => v.full));
  if (fullNames.size > 1) {
    console.log(`\nTeamID=${teamId}:`);
    for (const year of years) {
      if (yearsMap[year]) console.log(`  ${year}: ${yearsMap[year].full} (${yearsMap[year].short})`);
    }
  }
}
