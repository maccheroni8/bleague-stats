// 懲罰のリリース（bleague.jp のニュース「規約・規程違反による懲罰について」など）を取り、
// 根拠の本文を docs/foul-points/releases/{id}.txt に残し、出場停止の台帳 docs/foul-points/suspensions.json に下書きの行を足す。
// 反則ポイントの「出場停止」「コーチの退場（旧規程）」の元（DESIGN.md 416章）。手で実行する（自動更新のワークフローには入れない）。
//
// 使い方:
//   node --experimental-strip-types scripts/fetch-penalty-releases.ts            # 一覧の1〜2ページを見て、台帳に無い懲罰のリリースを取る
//   node --experimental-strip-types scripts/fetch-penalty-releases.ts --pages 5  # 一覧の1〜5ページを見る
//   node --experimental-strip-types scripts/fetch-penalty-releases.ts --ids-file list.json  # [{ "id": "142767" }, …] のリリースを取る（初回の一括取得）
//   node --experimental-strip-types scripts/fetch-penalty-releases.ts --reparse  # 取得済みの本文から下書きの行を作り直す（問い合わせない。確認済みの行は変えない）
//
// 問い合わせは scripts/lib/throttle.ts を通し、3.5秒の間隔をあける。取得済みの本文（releases/{id}.txt）は取り直さない。

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createThrottledFetch, formatRequestCounts } from "./lib/throttle.ts";
import { FOUL_POINTS_DOCS_DIR, RELEASES_DIR, isPenaltyTitle, parseNewsList, parseReleaseHtml, releaseFileText, readReleaseFile } from "./lib/penaltyReleaseFetch.ts";
import { draftLedgerRow, linkSameIncident, readLedger, readManualRows, writeLedger, type LedgerRow } from "./lib/penaltyLedger.ts";

const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(3500, USER_AGENT);
const NEWS_LIST_URL = "https://www.bleague.jp/news/";
const detailUrl = (id: string) => `https://www.bleague.jp/news_detail/id=${id}`;

async function fetchText(url: string): Promise<string> {
  const res = await throttledFetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function main() {
  const args = process.argv.slice(2);
  const pagesArg = args.indexOf("--pages");
  const pages = pagesArg >= 0 ? Number(args[pagesArg + 1]) : 2;
  const idsFileArg = args.indexOf("--ids-file");
  const reparse = args.includes("--reparse");
  await mkdir(RELEASES_DIR, { recursive: true });

  let ids: string[] = [];
  if (reparse) {
    ids = (await readdir(RELEASES_DIR)).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, ""));
  } else if (idsFileArg >= 0) {
    const list = JSON.parse(await readFile(args[idsFileArg + 1]!, "utf8")) as { id: string }[];
    ids = list.map((x) => String(x.id));
  } else {
    if (!(pages >= 1)) throw new Error("--pages は1以上");
    for (let p = 1; p <= pages; p++) {
      const html = await fetchText(p === 1 ? NEWS_LIST_URL : `${NEWS_LIST_URL}?pageID=${p}`);
      for (const item of parseNewsList(html)) if (isPenaltyTitle(item.title)) ids.push(item.id);
    }
  }

  const ledger = await readLedger();
  const manual = await readManualRows();
  // 作り直し: 本文から下書きし直す（手で確かめた行は manual.json から入れ直す）
  if (reparse) ledger.rows = [];
  const known = new Set(ledger.rows.map((r) => r.newsId));
  let fetched = 0;
  let drafted = 0;
  const failed: string[] = [];
  for (const id of [...new Set(ids)].sort((a, b) => Number(a) - Number(b))) {
    const file = path.join(RELEASES_DIR, `${id}.txt`);
    if (!existsSync(file)) {
      if (reparse) continue;
      try {
        const release = parseReleaseHtml(await fetchText(detailUrl(id)), id, detailUrl(id));
        await writeFile(file, releaseFileText(release));
        fetched++;
      } catch (err) {
        failed.push(`${id}（${(err as Error).message}）`);
        continue;
      }
    }
    if (known.has(id)) continue;
    const release = await readReleaseFile(file);
    const m = manual[id];
    const rows: LedgerRow[] = m
      ? m.rows.map((r) => ({ newsId: id, url: release.url, announced: release.date, ...r, status: r.suspensionGames === null ? "要確認" : "手で確認", reviewNote: `手で確認: ${m.reviewNote}` }) as LedgerRow)
      : draftLedgerRow(release);
    ledger.rows.push(...rows);
    known.add(id);
    drafted++;
  }
  linkSameIncident(ledger.rows);
  ledger.rows.sort((a, b) => Number(a.newsId) - Number(b.newsId) || a.person.localeCompare(b.person, "ja"));
  await writeLedger(ledger);
  console.log(`本文の取得 ${fetched}件・台帳の下書き ${drafted}件・${formatRequestCounts()}`);
  if (failed.length > 0) {
    console.error(`取れなかったリリース: ${failed.join("、")}`);
    process.exitCode = 1;
  }
  console.log(`台帳: ${path.relative(process.cwd(), path.join(FOUL_POINTS_DOCS_DIR, "suspensions.json"))}（読み取れなかった行は status が「要確認」。本文を確かめたら docs/foul-points/manual.json に行を書いて --reparse）`);
}

await main();
