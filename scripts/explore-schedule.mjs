// 試合日程ページからScheduleKeyを収集するための探索スクリプト（1リクエストのみ）。
const res = await fetch("https://www.bleague.jp/schedule/", {
  headers: { "User-Agent": "Mozilla/5.0" },
});
const html = await res.text();
console.log("status:", res.status, "length:", html.length);

const keyMatches = [...html.matchAll(/ScheduleKey=(\d+)/g)].map((m) => m[1]);
console.log("ScheduleKey matches:", [...new Set(keyMatches)].slice(0, 50));

const jsonHints = [...html.matchAll(/https?:\/\/[^"'\s]+\.json/g)].map((m) => m[0]);
console.log("json hints:", [...new Set(jsonHints)].slice(0, 20));

const apiHints = [...html.matchAll(/https?:\/\/[^"'\s]*api[^"'\s]*/gi)].map((m) => m[0]);
console.log("api hints:", [...new Set(apiHints)].slice(0, 20));
