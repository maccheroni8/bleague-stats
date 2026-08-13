// Phase 5バックフィル調査（続き）: 境界年の確定とActionCD1の意味検証（書き込みなし・使い捨て）。
//
// A1: 2019-20シーズンでgenius_contexts APIが200/403どちらか
// A2: 2021-22シーズンでPLUSMINUS/USG/ショット座標の有無
// A3: A1/A2の結果から「フィールドが揃っている最古のシーズン」を判定し、
//     そのシーズンの1試合でActionCD1ごとのPlayTextサンプルを出す（86/87/88の意味検証用）
//
// リクエスト間隔は2.5秒（DESIGN.md 2章のレート制限を厳守）。

const HOST = "http://b-league.s3.amazonaws.com";
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

async function fetchDaySchedule(year, mon, day, event) {
  const url = `https://www.bleague.jp/schedule/?data_format=json&year=${year}&mon=${mon}&day=${day}&event=${event}&club=&tab=1&ha=&fb=`;
  const res = await throttledFetch(url);
  if (!res.ok) return { ok: false, status: res.status, keys: [] };
  const data = await res.json();
  return { ok: true, status: res.status, keys: extractScheduleKeys(data.topics ?? []) };
}

async function findFirstScheduleKeys(year, mon, event, maxDays, count) {
  for (let day = 1; day <= maxDays; day++) {
    const dayStr = String(day).padStart(2, "0");
    const result = await fetchDaySchedule(year, mon, dayStr, event);
    console.log(`  [schedule] ${year}-${mon}-${dayStr} event=${event}: ${result.ok ? result.keys.length + "件" : "status=" + result.status}`);
    if (result.ok && result.keys.length > 0) {
      return result.keys.slice(0, count);
    }
  }
  return [];
}

async function fetchLatestId(scheduleKey) {
  const url = `${HOST}/web_json/v2_genius_contexts/${scheduleKey}/latestid`;
  const res = await throttledFetch(url);
  if (!res.ok) return { ok: false, status: res.status, latestId: null };
  const text = (await res.text()).trim();
  if (!/^\d+$/.test(text)) return { ok: true, status: res.status, latestId: null, raw: text };
  return { ok: true, status: res.status, latestId: Number(text) };
}

async function fetchGameContext(scheduleKey, latestId) {
  const url = `${HOST}/web_json/v2_genius_contexts/${scheduleKey}/${latestId}.json`;
  const res = await throttledFetch(url);
  if (!res.ok) return { ok: false, status: res.status, data: null };
  const data = await res.json();
  return { ok: true, status: res.status, data };
}

function inspectFields(data) {
  const homeBox = data.HomeBoxscores ?? [];
  const pbp = data.PlayByPlays ?? [];
  const samplePlayerRow = homeBox.find((r) => r.Category === 1 && r.PeriodCategory === 18);
  const firstShotEvent = pbp.find((e) => e.X !== undefined || e.Y !== undefined || e.AreaCD !== undefined);
  return {
    hasPlusMinus: samplePlayerRow ? samplePlayerRow.PLUSMINUS !== undefined : null,
    hasUSG: samplePlayerRow ? samplePlayerRow.USG !== undefined : null,
    hasEFF: samplePlayerRow ? samplePlayerRow.EFF !== undefined : null,
    hasShotCoords: !!firstShotEvent,
  };
}

async function probeApiAvailability(season, year, mon = "12") {
  console.log(`\n===== A1: ${season}シーズン genius_contexts API可用性（year=${year}, mon=${mon}）=====`);
  const keys = await findFirstScheduleKeys(year, mon, 2, 15, 2);
  if (keys.length === 0) {
    console.log(`  ⚠ ScheduleKeyが見つからなかった`);
    return { season, keys: [], results: [] };
  }
  console.log(`  対象ScheduleKey: ${keys.join(", ")}`);
  const results = [];
  for (const key of keys) {
    const r = await fetchLatestId(key);
    console.log(`  ScheduleKey=${key}: latestid status=${r.status}`);
    results.push({ key, status: r.status, latestId: r.latestId });
  }
  return { season, keys, results };
}

async function probeFieldPresence(season, year, mon = "12") {
  console.log(`\n===== A2: ${season}シーズン フィールド構成（year=${year}, mon=${mon}）=====`);
  const keys = await findFirstScheduleKeys(year, mon, 2, 15, 2);
  if (keys.length === 0) {
    console.log(`  ⚠ ScheduleKeyが見つからなかった`);
    return { season, sample: null };
  }
  console.log(`  対象ScheduleKey: ${keys.join(", ")}`);
  for (const key of keys) {
    const latestIdResult = await fetchLatestId(key);
    console.log(`  ScheduleKey=${key}: latestid status=${latestIdResult.status} value=${latestIdResult.latestId}`);
    if (!latestIdResult.ok || latestIdResult.latestId === null) continue;
    const contextResult = await fetchGameContext(key, latestIdResult.latestId);
    if (!contextResult.ok) {
      console.log(`    ⚠ 本体JSON取得失敗 status=${contextResult.status}`);
      continue;
    }
    const fields = inspectFields(contextResult.data);
    console.log(`    ${JSON.stringify(fields)}`);
    return { season, sample: { key, latestId: latestIdResult.latestId, fields, data: contextResult.data } };
  }
  return { season, sample: null };
}

function actionCdPlayTextReport(data) {
  const byCode = {};
  for (const ev of data.PlayByPlays ?? []) {
    const code = ev.ActionCD1;
    if (!byCode[code]) byCode[code] = new Set();
    if (ev.PlayText && ev.PlayText.trim()) byCode[code].add(ev.PlayText.trim());
  }
  const codes = Object.keys(byCode).map(Number).sort((a, b) => a - b);
  for (const code of codes) {
    console.log(`  ActionCD1=${code}: ${[...byCode[code]].slice(0, 5).join(" / ")}`);
  }
}

async function main() {
  const a1_2019 = await probeApiAvailability("2019-20", 2019);
  const a2_2021 = await probeFieldPresence("2021-22", 2021);

  console.log(`\n===== A3: ActionCD1とPlayTextの突き合わせ（フィールドが揃っている最古のシーズン） =====`);
  let target = null;
  if (a2_2021.sample && a2_2021.sample.fields.hasPlusMinus && a2_2021.sample.fields.hasShotCoords) {
    console.log(`  2021-22シーズンで既にPLUSMINUS/ショット座標が揃っているため、これを対象にする`);
    target = a2_2021.sample;
  } else {
    console.log(`  2021-22シーズンはフィールドが揃っていない（または取得失敗）ため、2022-23シーズンを対象にする`);
    const a2_2022 = await probeFieldPresence("2022-23", 2022);
    target = a2_2022.sample;
  }

  if (!target) {
    console.log(`  ⚠ 対象試合が見つからず、ActionCD1検証をスキップ`);
    return;
  }

  console.log(`  対象: ScheduleKey=${target.key} (latestid=${target.latestId})`);
  actionCdPlayTextReport(target.data);

  console.log(`\n===== 参考: A1(2019-20)の結果サマリ =====`);
  console.log(JSON.stringify(a1_2019, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
