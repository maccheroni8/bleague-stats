// bleague.jp/roster/（クラブ別一覧、e=在籍中）+ roster_detail/（個人ページ）から選手マスタを
// 取得し、data/players-master.json に保存する（シーズン非依存の選手プロフィール。DESIGN.md 5章
// 参照）。このスクリプトが週次でカバーするのは「現役選手」のみ（e=在籍中の26クラブ一覧に載る
// 選手）。過去シーズンの退団済み選手の発掘・補完はscrape-season-rosters.ts（e=全選手を使った
// 一回限りのバックフィル）が別途担当する。両スクリプトが同じplayers-master.jsonを共同メンテする。
//
// 裏側JSON APIは存在しない（実機調査済み。game_detail/scheduleと違い、フィルタ操作も含めて
// 素のHTMLページがクエリパラメータ付きで返るだけ）ため、cheerioでHTMLをパースする。
//
// 仕組み:
//   一覧: https://www.bleague.jp/roster/?year={year}&club={teamId}&p=&c=&o=random&e=在籍中&tab=1
//     → クラブを絞ると在籍中選手が1ページに収まる（26クラブ分回せば全選手を網羅できる）。
//        取れるのは playerId・氏名・ポジションのみ
//   個人: https://www.bleague.jp/roster_detail/?PlayerID={id}
//     → 生年月日・身長／体重・リーグ登録国籍。一覧だけでは取れない項目をここで補う
//
// 登録区分（日本人/外国籍/帰化選手/アジア特別枠）について: bleague.jp上に明示的なラベルが
// 見当たらない（個人ページの「リーグ登録国籍」は単一の国名のみで、帰化選手も「日本」表記になり
// 生え抜き選手と区別できない。roster一覧の絞り込みセレクタも「日本/海外」の2値のみ。
// club_detail・roster一覧のHTML全文検索でも該当キーワードは見つからなかった）。
// そのため日本人/外国籍はnationalityから自動判定し、帰化選手/アジア特別枠は
// lib/playerClassificationOverrides.ts の手動リストで個別に上書きする（DESIGN.md参照）。
//
// 更新方針（DESIGN.md 8章）: 一覧ページは毎回26クラブ分取得してteamId/teamName/positionを
// 更新する（軽量・移籍を検知できる）。個人ページは「まだマスタに無い新規選手」だけ追加取得する
// （身長体重等の属性は変化しないため、既知選手を毎回取り直す必要が無い＝日次cronでも軽量に保てる）。
// --force を付けると全選手の個人ページを強制的に取り直す。
//
// 注意: 初回実行時は在籍中の全選手（300名超）の個人ページを新規取得するため、
// 2〜3秒間隔のレート制限により15〜20分程度かかる。日次cronに組み込む前に、
// 一度手動でフル実行して players-master.json を作っておくこと。
//
// 使い方:
//   npm run scrape:roster -- --season 2026-27
//   npm run scrape:roster -- --season 2026-27 --force

import path from "node:path";
import { load } from "cheerio";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, readJson, writeJson } from "./lib/storage.ts";
import { TEAM_NAMES } from "./lib/divisions.ts";
import { CLASSIFICATION_OVERRIDES } from "./lib/playerClassificationOverrides.ts";
import { downloadPlayerPhoto, downloadTeamLogos } from "./lib/mediaAssets.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { PlayerAwardEntry, PlayerMasterEntry } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

const MASTER_PATH = path.join(DATA_DIR, "players-master.json");

async function fetchHtml(url: string): Promise<string> {
  const res = await throttledFetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }
  return res.text();
}

export interface RosterListItem {
  playerId: string;
  name: string;
  position?: string;
}

export function parseRosterList(html: string): RosterListItem[] {
  const $ = load(html);
  const items: RosterListItem[] = [];
  $('a.playerInfo-player[href*="roster_detail"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const idMatch = /PlayerID=(\d+)/.exec(href);
    if (!idMatch) return;
    const name = $(el).find(".playerInfo-player-name").text().trim();
    const positionText = $(el).find(".playerInfo-player-position").text().replace(/\s+/g, " ").trim();
    // 例: "ポジション：PF #5" → "PF" / "ポジション：SG/SF #21" → "SG/SF"
    const positionMatch = /ポジション[：:]\s*([A-Z/]+)/.exec(positionText);
    items.push({ playerId: idMatch[1]!, name, position: positionMatch?.[1] });
  });
  return items;
}

async function fetchClubRoster(year: number, teamId: string): Promise<RosterListItem[]> {
  const url = `https://www.bleague.jp/roster/?year=${year}&club=${teamId}&p=&c=&o=random&e=${encodeURIComponent("在籍中")}&tab=1`;
  return parseRosterList(await fetchHtml(url));
}

function parseHeightWeight(text: string): { heightCm?: number; weightKg?: number } {
  const [heightPart, weightPart] = text.split("／");
  const heightMatch = heightPart ? /(\d+)/.exec(heightPart) : null;
  const weightMatch = weightPart ? /(\d+)/.exec(weightPart) : null;
  return {
    heightCm: heightMatch ? Number(heightMatch[1]) : undefined,
    weightKg: weightMatch ? Number(weightMatch[1]) : undefined,
  };
}

/** 例: "1998年9月2日｜27歳" → "1998-09-02" */
function parseBirthDate(text: string): string | undefined {
  const match = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(text);
  if (!match) return undefined;
  const [, y, m, d] = match as unknown as [string, string, string, string];
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

interface PlayerDetail {
  position?: string;
  nationality?: string;
  heightCm?: number;
  weightKg?: number;
  birthDate?: string;
}

function parsePlayerDetail(html: string): PlayerDetail {
  const $ = load(html);
  const detail: PlayerDetail = {};
  $("li.rosterDetail-kv-playerProfile-list-item").each((_, el) => {
    const spans = $(el).find("span");
    const label = $(spans[0]).text().trim();
    const value = $(spans[1]).text().trim();
    if (label === "ポジション") detail.position = value || undefined;
    else if (label === "生年月日") detail.birthDate = parseBirthDate(value);
    else if (label === "身長／体重") Object.assign(detail, parseHeightWeight(value));
    else if (label === "リーグ登録国籍") detail.nationality = value || undefined;
  });
  return detail;
}

/** 例: "得点王(B1)" → {name: "得点王", category: "B1"} / "レギュラーシーズンベストファイブ" → {name: "..."} (categoryなし) */
function parseAwardName(raw: string): { name: string; category?: string } {
  const match = /^(.*)\(([^()]+)\)$/.exec(raw.trim());
  if (match) return { name: match[1]!.trim(), category: match[2]!.trim() };
  return { name: raw.trim() };
}

/**
 * roster_detail/?PlayerID=ページの「受賞歴」セクション（.rosterDetail-awardHistory、
 * 見出し含めて受賞が無い選手はセクション自体が出力されない）をパースする。
 * DESIGN.md 46章参照
 */
function parseAwardHistory(html: string): PlayerAwardEntry[] {
  const $ = load(html);
  const awards: PlayerAwardEntry[] = [];
  $(".rosterDetail-awardHistory").each((_, el) => {
    const season = $(el).find(".rosterDetail-awardHistory-date").text().trim();
    const rawName = $(el).find(".rosterDetail-awardHistory-name").text().trim();
    if (!season || !rawName) return;
    awards.push({ season, ...parseAwardName(rawName) });
  });
  return awards;
}

interface PlayerPage {
  detail: PlayerDetail;
  awards: PlayerAwardEntry[];
}

/** 個人ページを1回取得し、プロフィール（detail）と受賞歴（awards）を同じHTMLから両方パースする */
export async function fetchPlayerPage(playerId: string): Promise<PlayerPage> {
  const html = await fetchHtml(`https://www.bleague.jp/roster_detail/?PlayerID=${playerId}`);
  return { detail: parsePlayerDetail(html), awards: parseAwardHistory(html) };
}

export async function scrapeRosterMaster(
  season: string,
  options: { force?: boolean } = {},
): Promise<PlayerMasterEntry[]> {
  const year = Number(season.split("-")[0]);
  const existing = (await readJson<PlayerMasterEntry[]>(MASTER_PATH)) ?? [];
  const byId = new Map(existing.map((p) => [p.playerId, p]));

  // ブランド刷新への追従を自動化するため毎回26クラブ分取得し直す（軽量なので週次実行でも問題ない）
  await downloadTeamLogos(season, throttledFetch);

  let newCount = 0;
  let movedCount = 0;

  for (const [teamId, teamName] of Object.entries(TEAM_NAMES)) {
    const items = await fetchClubRoster(year, teamId);
    console.log(`[roster] ${teamName}: ${items.length}名`);

    for (const item of items) {
      const entry = byId.get(item.playerId);
      if (!entry) {
        byId.set(item.playerId, { playerId: item.playerId, name: item.name, teamId, teamName, position: item.position });
        newCount += 1;
      } else {
        if (entry.teamId !== teamId) movedCount += 1;
        entry.name = item.name;
        entry.teamId = teamId;
        entry.teamName = teamName;
        entry.position = item.position ?? entry.position;
      }
    }
  }

  // 選手写真: 既に保存済みならdownloadPlayerPhoto内でスキップされるため、新規選手のみ実質取得される
  let photoCount = 0;
  for (const entry of byId.values()) {
    const saved = await downloadPlayerPhoto(entry.teamId, entry.playerId, season, throttledFetch, {
      force: options.force,
    });
    if (saved) photoCount += 1;
  }
  if (photoCount > 0) console.log(`[photo] ${photoCount}名分の写真を新規保存`);

  // birthDateが未取得＝個人ページ未取得の判定に使う（既存選手の属性は変化しないため再取得しない）
  const targets = [...byId.values()].filter((p) => options.force || !p.birthDate);
  console.log(`[roster] 個人ページ取得対象: ${targets.length}名（新規${newCount}名／移籍検知${movedCount}件）`);

  for (const entry of targets) {
    const { detail } = await fetchPlayerPage(entry.playerId);
    entry.position = detail.position ?? entry.position;
    entry.nationality = detail.nationality ?? entry.nationality;
    entry.heightCm = detail.heightCm ?? entry.heightCm;
    entry.weightKg = detail.weightKg ?? entry.weightKg;
    entry.birthDate = detail.birthDate ?? entry.birthDate;
  }

  // classificationはネットワーク取得不要（nationality + 手動上書きから算出）なので、
  // 新規/既存に関わらず毎回全選手に適用する。CLASSIFICATION_OVERRIDESの更新も次回実行で反映される
  for (const entry of byId.values()) {
    entry.classification = deriveClassification(entry);
  }

  return [...byId.values()].sort((a, b) => a.playerId.localeCompare(b.playerId));
}

export function deriveClassification(entry: PlayerMasterEntry): PlayerMasterEntry["classification"] {
  const override = CLASSIFICATION_OVERRIDES[entry.playerId];
  if (override) return override;
  if (!entry.nationality) return undefined;
  return entry.nationality === "日本" ? "日本人" : "外国籍";
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error("使い方: scrape-roster.ts --season 2026-27 [--force]");
    process.exitCode = 1;
    return;
  }
  const force = args.includes("--force");

  const master = await scrapeRosterMaster(season, { force });
  await writeJson(MASTER_PATH, master);
  console.log(`保存完了: ${MASTER_PATH}（${master.length}名）`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
