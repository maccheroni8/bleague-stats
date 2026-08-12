// OT試合の得点フィールド構造を確認する。
// KEY=505288 (2026/03/14 川崎vsFE名古屋, W[OT]85-79), KEY=505118 (2026/01/24 川崎vs秋田, W[OT]98-89)

const HOST = "http://b-league.s3.amazonaws.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const keys = ["505288", "505118"];

for (const key of keys) {
  const latestidUrl = `${HOST}/web_json/v2_genius_contexts/${key}/latestid`;
  const latestidRes = await fetch(latestidUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  const latestid = (await latestidRes.text()).trim();
  console.log(`\n${key}: latestid status=${latestidRes.status} latestid=${latestid}`);

  await sleep(2500);

  if (!/^\d+$/.test(latestid)) {
    console.log(`${key}: latestid取得失敗、スキップ`);
    continue;
  }

  const jsonUrl = `${HOST}/web_json/v2_genius_contexts/${key}/${latestid}.json`;
  const jsonRes = await fetch(jsonUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  const data = await jsonRes.json();
  const g = data.Game;

  console.log(`${key}: status=${jsonRes.status}`);
  console.log(`  HomeTeamNameJ=${g.HomeTeamNameJ} AwayTeamNameJ=${g.AwayTeamNameJ}`);
  console.log(`  MaxPeriod=${g.MaxPeriod} GameCurrentPeriod=${g.GameCurrentPeriod}`);
  console.log(`  HomeTeamScore=${g.HomeTeamScore} AwayTeamScore=${g.AwayTeamScore}`);
  const scoreKeys = Object.keys(g).filter((k) => /TeamScore\d/.test(k)).sort();
  console.log(`  スコアフィールド一覧:`, scoreKeys);
  for (const k of scoreKeys) console.log(`    ${k} = ${g[k]}`);

  // HomeBoxscores/AwayBoxscoresのPeriodCategoryにOT(5)が含まれるか確認
  const homePeriodCats = [...new Set(data.HomeBoxscores.map((r) => r.PeriodCategory))].sort((a, b) => a - b);
  console.log(`  HomeBoxscores PeriodCategory一覧:`, homePeriodCats);

  // Summaries側も確認
  const summaryPeriodCats = data.Summaries.map((s) => s.PeriodCategory);
  console.log(`  Summaries PeriodCategory一覧:`, summaryPeriodCats);

  await sleep(2500);
}
