// 複数試合をまとめて検証:
// 1) Category=2/3 ボックススコア行の違いを特定
// 2) OT試合のPeriodCategory=5(OT本体)/17(OT集計?)の中身を確認
// 3) 複数試合のPlayByPlaysからActionCD1の出現値を全て洗い出す

const HOST = "http://b-league.s3.amazonaws.com";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const games = [
  { key: "506099", note: "CS決勝(通常4Q)" },
  { key: "505076", note: "レギュラーシーズン(通常4Q)" },
  { key: "505288", note: "OT試合 川崎vsFE名古屋" },
  { key: "505118", note: "OT試合 秋田vs川崎" },
  { key: "506095", note: "レギュラーシーズン(通常4Q)" },
  { key: "506010", note: "オールスター？(通常4Q)" },
];

const allData = [];

for (const g of games) {
  const latestidRes = await fetch(`${HOST}/web_json/v2_genius_contexts/${g.key}/latestid`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const latestid = (await latestidRes.text()).trim();
  await sleep(2500);

  if (!/^\d+$/.test(latestid)) {
    console.log(`${g.key}: latestid取得失敗、スキップ`);
    continue;
  }

  const jsonRes = await fetch(`${HOST}/web_json/v2_genius_contexts/${g.key}/${latestid}.json`, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const data = await jsonRes.json();
  allData.push({ key: g.key, note: g.note, data });
  console.log(`${g.key} (${g.note}): 取得完了 latestid=${latestid} PBP件数=${data.PlayByPlays.length}`);
  await sleep(2500);
}

// --- 1) Category=2/3 の違い ---
console.log("\n\n========== Category=2/3 の違い ==========");
for (const { key, note, data } of allData) {
  const cat2 = data.HomeBoxscores.find((r) => r.Category === 2 && r.PeriodCategory === 18);
  const cat3 = data.HomeBoxscores.find((r) => r.Category === 3 && r.PeriodCategory === 18);
  console.log(`\n--- ${key} (${note}) ---`);
  console.log("Category=2 (PeriodCategory=18) サンプル:", cat2 ? JSON.stringify(cat2) : "該当なし");
  console.log("Category=3 (PeriodCategory=18) サンプル:", cat3 ? JSON.stringify(cat3) : "該当なし");
}

// --- 2) OT試合のPeriodCategory=5/17 の中身 ---
console.log("\n\n========== OT試合のPeriodCategory=5(OT本体)/17(集計?) ==========");
for (const { key, note, data } of allData) {
  const hasOT = data.HomeBoxscores.some((r) => r.PeriodCategory === 5);
  if (!hasOT) continue;
  console.log(`\n--- ${key} (${note}) ---`);
  const pc5 = data.Summaries.find((s) => s.PeriodCategory === 5);
  const pc17 = data.Summaries.find((s) => s.PeriodCategory === 17);
  const pc18 = data.Summaries.find((s) => s.PeriodCategory === 18);
  console.log("Summaries PeriodCategory=5 (第5C=OT):", JSON.stringify({
    HomeTeamPTM: pc5?.HomeTeamPTM, HomeTeamPTA: pc5?.HomeTeamPTA, AwayTeamPTM: pc5?.AwayTeamPTM, AwayTeamPTA: pc5?.AwayTeamPTA,
  }));
  console.log("Summaries PeriodCategory=17 (?):", JSON.stringify({
    HomeTeamPTM: pc17?.HomeTeamPTM, HomeTeamPTA: pc17?.HomeTeamPTA, AwayTeamPTM: pc17?.AwayTeamPTM, AwayTeamPTA: pc17?.AwayTeamPTA,
  }));
  console.log("Summaries PeriodCategory=18 (試合全体):", JSON.stringify({
    HomeTeamPTM: pc18?.HomeTeamPTM, HomeTeamPTA: pc18?.HomeTeamPTA, AwayTeamPTM: pc18?.AwayTeamPTM, AwayTeamPTA: pc18?.AwayTeamPTA,
  }));
}

// --- 3) ActionCD1 の全出現値 ---
console.log("\n\n========== 複数試合合算: ActionCD1 出現値とPlayTextサンプル ==========");
const byCode = {};
for (const { data } of allData) {
  for (const ev of data.PlayByPlays) {
    const code = ev.ActionCD1;
    if (!byCode[code]) byCode[code] = new Set();
    if (ev.PlayText && ev.PlayText.trim()) byCode[code].add(ev.PlayText.trim());
  }
}
for (const code of Object.keys(byCode).sort((a, b) => Number(a) - Number(b))) {
  console.log(`${code}: ${[...byCode[code]].slice(0, 3).join(" / ")}`);
}
console.log("\n出現コード一覧:", Object.keys(byCode).map(Number).sort((a, b) => a - b));
