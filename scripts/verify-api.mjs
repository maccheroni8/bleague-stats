// DESIGN.md 2-1章の裏側JSON API（v2_genius_contexts）が実際に使えるか検証するスクリプト。
// 対象試合: ScheduleKey=506099
// 用途: b-league.s3.amazonaws.com / dev-bleague.s3.amazonaws.com のどちらが有効か、
//       latestid / {latestid}.json の実際のレスポンスを確認する（実装前の検証のみ、書き込みなし）。

const SCHEDULE_KEY = "506099";

const HOSTS = [
  "http://b-league.s3.amazonaws.com",
  "http://dev-bleague.s3.amazonaws.com",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAndReport(url) {
  console.log(`\n--- GET ${url} ---`);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
    });
    const text = await res.text();
    console.log(`status: ${res.status} ${res.statusText}`);
    console.log(`content-type: ${res.headers.get("content-type")}`);
    console.log(`content-length: ${text.length} bytes (body length)`);
    const preview = text.length > 500 ? text.slice(0, 500) + "...(truncated)" : text;
    console.log(`body preview:\n${preview}`);
    return { ok: res.status >= 200 && res.status < 300, status: res.status, text };
  } catch (err) {
    console.log(`ERROR: ${err.message}`);
    return { ok: false, status: null, text: null, error: err.message };
  }
}

async function main() {
  console.log(`ScheduleKey = ${SCHEDULE_KEY}`);
  console.log("Step 1: latestid を両ホストで確認");

  const latestIdResults = {};
  for (const host of HOSTS) {
    const url = `${host}/web_json/v2_genius_contexts/${SCHEDULE_KEY}/latestid`;
    latestIdResults[host] = await fetchAndReport(url);
    await sleep(2500); // 設計書の制約: リクエスト間隔2〜3秒
  }

  const validHost = HOSTS.find((h) => latestIdResults[h].ok);

  if (!validHost) {
    console.log("\n=== 結論: どちらのホストも latestid の取得に失敗しました ===");
    return;
  }

  console.log(`\n=== 有効なホスト: ${validHost} ===`);

  const latestIdRaw = latestIdResults[validHost].text.trim();
  console.log(`latestid (raw text) = "${latestIdRaw}"`);

  const latestId = latestIdRaw.replace(/[^0-9]/g, "");
  if (!latestId) {
    console.log("latestid を数値として抽出できませんでした。生のレスポンスを確認してください。");
    return;
  }

  console.log(`\nStep 2: ${latestId}.json を取得`);
  await sleep(2500);

  const jsonUrl = `${validHost}/web_json/v2_genius_contexts/${SCHEDULE_KEY}/${latestId}.json`;
  const jsonResult = await fetchAndReport(jsonUrl);

  if (!jsonResult.ok) {
    console.log("\n=== JSON本体の取得に失敗しました ===");
    return;
  }

  let data;
  try {
    data = JSON.parse(jsonResult.text);
  } catch (err) {
    console.log(`JSON parse error: ${err.message}`);
    return;
  }

  console.log("\n=== JSON構造の確認 ===");
  console.log("トップレベルキー:", Object.keys(data));

  for (const key of Object.keys(data)) {
    const val = data[key];
    if (Array.isArray(val)) {
      console.log(`\n[${key}] は配列。要素数=${val.length}`);
      if (val.length > 0) {
        console.log(`  1件目のキー:`, Object.keys(val[0]));
        console.log(`  1件目の中身:`, JSON.stringify(val[0], null, 2));
      }
    } else if (val && typeof val === "object") {
      console.log(`\n[${key}] はオブジェクト。キー:`, Object.keys(val));
      console.log(`  中身:`, JSON.stringify(val, null, 2));
    } else {
      console.log(`\n[${key}] =`, val);
    }
  }

  // ActionCD1 の値の種類を集計（PlayByPlays配列がある場合）
  const pbpKey = Object.keys(data).find((k) => /playbyplay/i.test(k));
  if (pbpKey && Array.isArray(data[pbpKey])) {
    const codeCounts = {};
    for (const ev of data[pbpKey]) {
      const code = ev.ActionCD1;
      codeCounts[code] = (codeCounts[code] || 0) + 1;
    }
    console.log(`\n=== ${pbpKey} の ActionCD1 値の種類と件数 ===`);
    console.log(
      Object.entries(codeCounts)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([code, count]) => `${code}: ${count}件`)
        .join("\n")
    );
  } else {
    console.log("\nPlayByPlays配列が見つかりませんでした（キー名を確認してください）。");
  }
}

main();
