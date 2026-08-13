// Phase 5バックフィル調査: 過去シーズンでschedule JSON API・v2_genius_contexts APIが
// 使えるか、フィールド構成に境目があるかを確認する（書き込みなし・調査専用の使い捨てスクリプト）。
//
// 対象シーズン: 2022-23（ショットチャート導入と言われる年）・2020-21（EFF計算式境目）・
// 2018-19・2016-17（B.LEAGUE発足年）
//
// 手順: 各シーズンの12月について、日別schedule JSON APIを日数を絞って走査しScheduleKeyを収集
// → 見つかったキーのうち最大3件についてlatestid→本体JSONを取得し、フィールド有無を確認する。
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

async function findScheduleKeysForMonth(year, mon, event, maxDays, maxKeys) {
  const found = new Set();
  for (let day = 1; day <= maxDays && found.size < maxKeys; day++) {
    const dayStr = String(day).padStart(2, "0");
    const result = await fetchDaySchedule(year, mon, dayStr, event);
    if (!result.ok) {
      console.log(`  [schedule] ${year}-${mon}-${dayStr} event=${event}: HTTPエラー status=${result.status}`);
      continue;
    }
    for (const k of result.keys) found.add(k);
    console.log(`  [schedule] ${year}-${mon}-${dayStr} event=${event}: ${result.keys.length}件 累計${found.size}件`);
  }
  return [...found];
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

function inspectContext(data) {
  const pbp = data.PlayByPlays ?? [];
  const homeBox = data.HomeBoxscores ?? [];
  const firstShotEvent = pbp.find((e) => e.X !== undefined || e.Y !== undefined || e.AreaCD !== undefined);
  const samplePlayerRow = homeBox.find((r) => r.Category === 1 && r.PeriodCategory === 18);
  return {
    game: {
      exists: !!data.Game,
      maxPeriod: data.Game?.MaxPeriod,
      gameDateTime: data.Game?.GameDateTime,
      homeTeam: data.Game?.HomeTeamNameJ,
      awayTeam: data.Game?.AwayTeamNameJ,
      gameEndedFlg: data.Game?.GameEndedFlg,
    },
    playByPlays: {
      count: pbp.length,
      hasShotCoords: !!firstShotEvent,
      sampleActionCD1: [...new Set(pbp.slice(0, 30).map((e) => e.ActionCD1))],
    },
    boxscore: {
      homeRowCount: homeBox.length,
      hasPlusMinus: samplePlayerRow ? samplePlayerRow.PLUSMINUS !== undefined : null,
      hasUSG: samplePlayerRow ? samplePlayerRow.USG !== undefined : null,
      hasEFF: samplePlayerRow ? samplePlayerRow.EFF !== undefined : null,
      hasPOSS: samplePlayerRow ? samplePlayerRow.POSS !== undefined : null,
      samplePlayerRowKeys: samplePlayerRow ? Object.keys(samplePlayerRow) : null,
    },
  };
}

async function probeSeason(season, year, mon = "12", maxDays = 15, maxKeys = 3, event = 2) {
  console.log(`\n===== ${season}シーズン（year=${year}, mon=${mon}, event=${event}）=====`);
  let keys = await findScheduleKeysForMonth(year, mon, event, maxDays, maxKeys);

  if (keys.length === 0) {
    console.log(`  ${mon}月に試合が見つからなかったため、01月も試してみる`);
    keys = await findScheduleKeysForMonth(year, "01", event, maxDays, maxKeys);
  }

  if (keys.length === 0) {
    console.log(`  ⚠ ScheduleKeyが1件も見つからず（schedule JSON APIが機能していない可能性）`);
    return;
  }

  console.log(`  見つかったScheduleKey: ${keys.join(", ")}`);

  for (const key of keys) {
    const latestIdResult = await fetchLatestId(key);
    console.log(`\n  --- ScheduleKey=${key} latestid: status=${latestIdResult.status} value=${latestIdResult.latestId ?? latestIdResult.raw ?? "(null)"} ---`);
    if (!latestIdResult.ok || latestIdResult.latestId === null) {
      console.log(`    ⚠ latestid取得失敗。この試合はgenius_contexts APIで取得不可`);
      continue;
    }

    const contextResult = await fetchGameContext(key, latestIdResult.latestId);
    if (!contextResult.ok) {
      console.log(`    ⚠ 本体JSON取得失敗 status=${contextResult.status}`);
      continue;
    }

    const inspection = inspectContext(contextResult.data);
    console.log(`    Game: ${JSON.stringify(inspection.game)}`);
    console.log(`    PlayByPlays: ${JSON.stringify(inspection.playByPlays)}`);
    console.log(`    Boxscore: hasPlusMinus=${inspection.boxscore.hasPlusMinus} hasUSG=${inspection.boxscore.hasUSG} hasEFF=${inspection.boxscore.hasEFF} hasPOSS=${inspection.boxscore.hasPOSS}`);
    console.log(`    homeRowCount=${inspection.boxscore.homeRowCount}`);
    if (inspection.boxscore.samplePlayerRowKeys) {
      console.log(`    samplePlayerRowKeys: ${inspection.boxscore.samplePlayerRowKeys.join(",")}`);
    }
  }
}

async function main() {
  await probeSeason("2022-23", 2022);
  await probeSeason("2020-21", 2020);
  await probeSeason("2018-19", 2018);
  await probeSeason("2016-17", 2016);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
