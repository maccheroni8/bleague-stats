// data/division-history.json（Record<Category, Record<Season, Record<TeamID, Division>>>）を
// 生成する（2026-08-29作成）。
//
// scripts/lib/divisions.tsのTEAM_DIVISIONS/ONE_TEAM_DIVISIONSは「2026-27シーズン基準の単一
// スナップショット」で、過去シーズンのクラブ入れ替え・地区再編（東西2地区⇔東中西3地区の変動を
// 含む）を反映できないという既知の制約があった（DESIGN.md 11章・14-9章）。この制約を解消する
// ため、bleague.jp/standings/?year={年}&tab={1|2}の実際の地区別テーブルを全シーズン分機械的に
// 取得する。scrape-club-honors.tsのfetchDivisionChampions()（地区優勝＝各地区1位のみ抽出）と
// 同じページ・同じセレクタを使い、「1位だけでなく全チームを取る」ように拡張しただけ。
//
// 各シーズンのページには地区テーブルとは別に「ワイルドカード」（プレーオフ進出用の地区横断
// 順位表）が同時に存在し、同じチームが自分の地区テーブルとワイルドカードテーブルの両方に
// 重複して現れる。見出しが「地区」で終わるテーブルだけを対象にすることで、ワイルドカードは
// 自然に除外される（実機確認: 東地区/中地区/西地区/北地区/南地区はいずれも「地区」で終わり、
// 「ワイルドカード」は終わらないため、この判定だけで確実に区別できる）。
//
// B.ONE（tab=2、旧B2含む）も同じページ構造・同じセレクタで取得できることを実機確認済み
// （2016-17〜2019-20:東/中/西3地区+WC、2020-21〜2025-26:東/西2地区+WC［クラブ数はシーズンで
// 変動］、2026-27:北/東/中/西/南5地区・WCなし）。地区見出しの語彙（東西南北中）に応じた
// division値への変換テーブルさえ用意すれば、B.PREMIERと全く同じ関数で両カテゴリ扱える。

import path from "node:path";
import { load } from "cheerio";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, writeJson } from "./lib/storage.ts";
import { TEAM_DIVISIONS, ONE_TEAM_DIVISIONS } from "./lib/divisions.ts";
import type { Category, Division, DivisionHistoryFile } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

// 試合データが揃っている10シーズン＋開幕前だがスタンディングページ上は地区構成が既に
// 確認できる2026-27（scripts/lib/divisions.tsの既存マスタとの妥当性チェック用）
const SEASONS = [
  "2016-17",
  "2017-18",
  "2018-19",
  "2019-20",
  "2020-21",
  "2021-22",
  "2022-23",
  "2023-24",
  "2024-25",
  "2025-26",
  "2026-27",
];

function seasonStartYear(season: string): number {
  return Number(season.slice(0, 4));
}

const CATEGORY_TAB: Record<Category, number> = { premier: 1, one: 2 };

const DIVISION_LABELS: Record<string, Division> = {
  東地区: "east",
  西地区: "west",
  中地区: "central",
  北地区: "north",
  南地区: "south",
};

async function fetchSeasonDivisions(season: string, category: Category): Promise<Record<string, Division>> {
  const year = seasonStartYear(season);
  const tab = CATEGORY_TAB[category];
  const url = `https://www.bleague.jp/standings/?year=${year}&tab=${tab}`;
  const res = await throttledFetch(url);
  if (!res.ok) {
    console.log(`  ⚠️ [${season}/${category}] HTTP ${res.status}`);
    return {};
  }
  const html = await res.text();
  const $ = load(html);
  const result: Record<string, Division> = {};

  $("h3.box-container").each((_, h3el) => {
    const heading = $(h3el).text().trim();
    // 「ワイルドカード」等、地区テーブル以外は除外（見出しが「地区」で終わるものだけを対象にする）
    if (!heading.endsWith("地区")) return;
    const division = DIVISION_LABELS[heading];
    if (!division) {
      console.log(`  ⚠️ [${season}/${category}] 未知の地区見出し: "${heading}"`);
      return;
    }
    const table = $(h3el).nextAll(".table-scroll-container").first().find("table");
    table.find("tbody tr").each((_, tr) => {
      const href = $(tr).find("a.team").attr("href") ?? "";
      const teamIdMatch = href.match(/TeamID=(\d+)/);
      const teamId = teamIdMatch?.[1];
      if (!teamId) return;
      result[teamId] = division;
    });
  });

  return result;
}

function summarize(divisions: Record<string, Division>): string {
  const byDiv = new Map<Division, number>();
  for (const d of Object.values(divisions)) byDiv.set(d, (byDiv.get(d) ?? 0) + 1);
  const total = Object.keys(divisions).length;
  const breakdown = [...byDiv.entries()].map(([d, n]) => `${d}:${n}`).join(", ");
  return `${total}チーム (${breakdown})`;
}

function checkMatchWithExisting(label: string, expected: Record<string, Division>, actual: Record<string, Division>) {
  const expectedKeys = Object.keys(expected);
  const actualKeys = Object.keys(actual);
  let mismatches = 0;
  for (const teamId of expectedKeys) {
    if (actual[teamId] !== expected[teamId]) {
      mismatches++;
      console.log(`  ⚠️ ${label} teamId=${teamId}: 既存マスタ=${expected[teamId]} / 新規取得=${actual[teamId] ?? "(無し)"}`);
    }
  }
  const extra = actualKeys.filter((k) => !expectedKeys.includes(k));
  const missing = expectedKeys.filter((k) => !actualKeys.includes(k));
  if (extra.length > 0) console.log(`  ⚠️ ${label}: 既存マスタに無いteamIdが新規取得結果に${extra.length}件 (${extra.join(", ")})`);
  if (missing.length > 0) console.log(`  ⚠️ ${label}: 新規取得結果に無いteamIdが既存マスタに${missing.length}件 (${missing.join(", ")})`);
  const ok = mismatches === 0 && extra.length === 0 && missing.length === 0;
  console.log(`${ok ? "✅" : "⚠️"} ${label}: 既存${expectedKeys.length}件 / 新規${actualKeys.length}件 / 不一致${mismatches}件`);
}

async function main() {
  const result: DivisionHistoryFile = { premier: {}, one: {} };

  for (const category of ["premier", "one"] as Category[]) {
    console.log(`\n=== ${category} ===`);
    for (const season of SEASONS) {
      const divisions = await fetchSeasonDivisions(season, category);
      console.log(`[${season}] ${summarize(divisions)}`);
      result[category][season] = divisions;
    }
  }

  await writeJson(path.join(DATA_DIR, "division-history.json"), result);
  console.log("\ndata/division-history.jsonに保存しました");

  console.log("\n=== 妥当性チェック: 2026-27シーズンが既存divisions.tsマスタと一致するか ===");
  checkMatchWithExisting("premier", TEAM_DIVISIONS, result.premier["2026-27"] ?? {});
  checkMatchWithExisting("one", ONE_TEAM_DIVISIONS, result.one["2026-27"] ?? {});
}

main();
