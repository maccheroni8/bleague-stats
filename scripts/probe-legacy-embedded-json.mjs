// game_detail ページに埋め込まれた_contexts_s3id.data（完全なGeniusContext相当JSON）の仕組みが
// 2017-18・2018-19・2019-20の各シーズンでも機能するか検証する（使い捨て調査スクリプト）。
// 2016-17（ScheduleKey=170）と2019-20（ScheduleKey=4297）は別途検証済みなので対象外。

const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const MIN_INTERVAL_MS = 2500;
let lastRequestAt = 0;
async function throttledFetch(url) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
  return fetch(url, { headers: { "User-Agent": USER_AGENT } });
}

function extractScheduleKeys(topics) {
  const html = topics.join("");
  return [...new Set([...html.matchAll(/ScheduleKey=(\d+)/g)].map((m) => m[1]))];
}

async function findFirstScheduleKey(year, mon, event, maxDays) {
  for (let day = 1; day <= maxDays; day++) {
    const dayStr = String(day).padStart(2, "0");
    const url = `https://www.bleague.jp/schedule/?data_format=json&year=${year}&mon=${mon}&day=${dayStr}&event=${event}&club=&tab=1&ha=&fb=`;
    const res = await throttledFetch(url);
    if (!res.ok) continue;
    const data = await res.json();
    const keys = extractScheduleKeys(data.topics ?? []);
    if (keys.length > 0) return keys[0];
  }
  return null;
}

function extractEmbeddedContext(html) {
  const marker = "_contexts_s3id.data = ";
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const start = idx + marker.length;
  let i = start;
  while (html[i] !== "{") i++;
  let depth = 0,
    inStr = false,
    escape = false,
    j = i;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (escape) escape = false;
      else if (c === "\\") escape = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  return JSON.parse(html.slice(i, j));
}

async function verifyGame(label, scheduleKey) {
  console.log(`\n===== ${label} (ScheduleKey=${scheduleKey}) =====`);
  const res = await throttledFetch(`https://www.bleague.jp/game_detail/?ScheduleKey=${scheduleKey}`);
  if (!res.ok) {
    console.log(`  ⚠ HTTPエラー status=${res.status}`);
    return;
  }
  const html = await res.text();
  const data = extractEmbeddedContext(html);
  if (!data) {
    console.log(`  ⚠ _contexts_s3id.data が見つからない`);
    return;
  }
  console.log(`  Game.Year=${data.Game?.Year} ${data.Game?.HomeTeamNameJ} vs ${data.Game?.AwayTeamNameJ}`);
  console.log(`  PlayByPlays件数=${(data.PlayByPlays ?? []).length} HomeBoxscores件数=${(data.HomeBoxscores ?? []).length}`);

  const byCode = {};
  for (const ev of data.PlayByPlays ?? []) {
    const code = ev.ActionCD1;
    if (!byCode[code]) byCode[code] = new Set();
    if (ev.PlayText && ev.PlayText.trim()) byCode[code].add(ev.PlayText.trim());
  }
  for (const code of [1, 3, 4, 7, 8, 9, 10, 86, 87, 88]) {
    if (byCode[code]) console.log(`    ActionCD1=${code}: ${[...byCode[code]][0]}`);
    else console.log(`    ActionCD1=${code}: (このサンプルに出現なし)`);
  }
  const samplePlayerRow = (data.HomeBoxscores ?? []).find((r) => r.Category === 1);
  console.log(`  PLUSMINUS存在=${samplePlayerRow ? samplePlayerRow.PLUSMINUS !== undefined : "N/A"}`);
}

const key201718 = await findFirstScheduleKey(2017, "12", 2, 15);
console.log(`2017-18シーズンのScheduleKey: ${key201718}`);
if (key201718) await verifyGame("2017-18", key201718);

await verifyGame("2018-19", "3167");
await verifyGame("2019-20", "4297");
