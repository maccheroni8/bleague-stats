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
// --force を付けると全選手の個人ページと写真を強制的に取り直す。
//
// 実行順（DESIGN.md 125章）: ロゴ → クラブ一覧 → 新規選手の個人ページ → 選手マスタを保存 → 写真。
// 写真取得は時間がかかるため、選手マスタ（新加入選手の登録区分・国籍等）を先に保存し、写真の成否や
// 時間切れに左右されないようにする。写真は現行ロースター（クラブ一覧に載っている選手）だけを対象に、
// 一覧ページの写真URLのバージョン番号（v=...）を data/player-photos-manifest.json に記録し、
// 未保存・番号の変化（移籍・新シーズン写真の公開）があった選手だけ取り直す。時間予算
// （PHOTO_TIME_BUDGET_MS）を超えた分は次回に回す。
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
import {
  downloadPlayerPhoto,
  downloadPlayerPhotoFromUrl,
  downloadTeamLogos,
  hasPlayerPhoto,
  playerPhotoUrl,
  previousSeason,
} from "./lib/mediaAssets.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { PlayerAwardEntry, PlayerMasterEntry } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

const MASTER_PATH = path.join(DATA_DIR, "players-master.json");
const PHOTO_MANIFEST_PATH = path.join(DATA_DIR, "player-photos-manifest.json");

// 写真取得に使う時間の上限。ワークフローのステップ上限（25分）から、ロゴ（約2.5分）・クラブ一覧
// （約1分）・新規選手の個人ページの時間を引いて余裕を残した値。超えた分は次回の実行に回す
const PHOTO_TIME_BUDGET_MS = 15 * 60 * 1000;

const RETRYABLE_ATTEMPTS = 3;

// bleague.jp側の一時的な502/503が稀に発生するため、5xxのみ間隔を空けてリトライする
// （4xxはリクエスト自体の問題なので即座にエラーにする）
async function fetchHtml(url: string, attempt = 1): Promise<string> {
  const res = await throttledFetch(url);
  if (!res.ok) {
    if (res.status >= 500 && attempt < RETRYABLE_ATTEMPTS) {
      console.warn(`[roster] GET ${url} が${res.status}（${attempt}回目）。5秒後にリトライします`);
      await new Promise((resolve) => setTimeout(resolve, 5000 * attempt));
      return fetchHtml(url, attempt + 1);
    }
    throw new Error(`GET ${url} failed: ${res.status}`);
  }
  return res.text();
}

export interface RosterListItem {
  playerId: string;
  name: string;
  position?: string;
  /**
   * 一覧ページの選手写真URL（data-src）から取り出した、写真のパス（"{TeamID}/{シーズン}"）と
   * バージョン番号（"v=1789593249/"の数字部分）。bleague.jp側で写真が未公開の選手は
   * バージョンが空文字（"v=/"）になる（2026-09-23に実際の取得結果（200/404）と一致することを確認済み）
   */
  photo?: { path: string; version: string };
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
    const photoSrc = $(el).find("img[data-src*='/files/user/roster/']").attr("data-src") ?? "";
    const photoMatch = /\/v=(\d*)\/files\/user\/roster\/(\d+\/[0-9-]+)\//.exec(photoSrc);
    items.push({
      playerId: idMatch[1]!,
      name,
      position: positionMatch?.[1],
      photo: photoMatch ? { path: photoMatch[2]!, version: photoMatch[1]! } : undefined,
    });
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

/** 現行ロースター（今回のクラブ一覧に載っていた選手）1人分。写真の同期に使う */
export interface CurrentRosterPlayer {
  playerId: string;
  name: string;
  teamId: string;
  /** 前回のマスタ上の所属（移籍を検知した場合のみ）。写真未公開時のフォールバックに使う */
  previousTeamId?: string;
  photo?: { path: string; version: string };
}

export async function scrapeRosterMaster(
  season: string,
  options: { force?: boolean } = {},
): Promise<{ master: PlayerMasterEntry[]; currentRoster: CurrentRosterPlayer[] }> {
  const year = Number(season.split("-")[0]);
  const existing = (await readJson<PlayerMasterEntry[]>(MASTER_PATH)) ?? [];
  const byId = new Map(existing.map((p) => [p.playerId, p]));

  // ブランド刷新への追従を自動化するため毎回26クラブ分取得し直す（軽量なので週次実行でも問題ない）
  await downloadTeamLogos(season, throttledFetch);

  let newCount = 0;
  let movedCount = 0;
  const currentRoster: CurrentRosterPlayer[] = [];

  for (const [teamId, teamName] of Object.entries(TEAM_NAMES)) {
    const items = await fetchClubRoster(year, teamId);
    console.log(`[roster] ${teamName}: ${items.length}名`);

    for (const item of items) {
      const entry = byId.get(item.playerId);
      let previousTeamId: string | undefined;
      if (!entry) {
        byId.set(item.playerId, { playerId: item.playerId, name: item.name, teamId, teamName, position: item.position });
        newCount += 1;
      } else {
        if (entry.teamId !== teamId) {
          movedCount += 1;
          previousTeamId = entry.teamId;
        }
        entry.name = item.name;
        entry.teamId = teamId;
        entry.teamName = teamName;
        entry.position = item.position ?? entry.position;
      }
      currentRoster.push({ playerId: item.playerId, name: item.name, teamId, previousTeamId, photo: item.photo });
    }
  }

  // birthDateが未取得＝個人ページ未取得の判定に使う（既存選手の属性は変化しないため再取得しない）
  const targets = [...byId.values()].filter((p) => options.force || !p.birthDate);
  console.log(`[roster] 個人ページ取得対象: ${targets.length}名（新規${newCount}名／移籍検知${movedCount}件）`);

  for (const entry of targets) {
    // 1人の個人ページの失敗で全体（選手マスタの保存）が止まらないよう、失敗は警告にとどめて次回に回す
    try {
      const { detail } = await fetchPlayerPage(entry.playerId);
      entry.position = detail.position ?? entry.position;
      entry.nationality = detail.nationality ?? entry.nationality;
      entry.heightCm = detail.heightCm ?? entry.heightCm;
      entry.weightKg = detail.weightKg ?? entry.weightKg;
      entry.birthDate = detail.birthDate ?? entry.birthDate;
    } catch (err) {
      console.warn(`[roster] ${entry.name}（${entry.playerId}）の個人ページ取得に失敗。次回再試行: ${String(err)}`);
    }
  }

  // classificationはネットワーク取得不要（nationality + 手動上書きから算出）なので、
  // 新規/既存に関わらず毎回全選手に適用する。CLASSIFICATION_OVERRIDESの更新も次回実行で反映される
  for (const entry of byId.values()) {
    entry.classification = deriveClassification(entry);
  }

  return {
    master: [...byId.values()].sort((a, b) => a.playerId.localeCompare(b.playerId)),
    currentRoster,
  };
}

/** data/player-photos-manifest.json の1件。保存済み写真の取得元（一覧ページ上のパスとバージョン） */
interface PhotoManifestEntry {
  path: string;
  version: string;
  fetchedAt: string;
}

/**
 * 現行ロースターの選手写真を同期する。一覧ページに公開済みの写真（バージョン番号あり）がある選手は、
 * 未保存・記録なし・パスかバージョンの変化があれば取り直す。未公開（バージョン空）の選手は、写真が
 * 1枚も無い場合だけ前シーズン等へのフォールバックで仮の写真を取る（記録は残さないため、公開後に
 * 番号が付いた時点で取り直される）。未保存 → 移籍 → その他の順に処理し、時間予算を超えたら次回に回す
 */
export async function syncRosterPhotos(
  currentRoster: CurrentRosterPlayer[],
  season: string,
  options: { force?: boolean; budgetMs?: number } = {},
): Promise<void> {
  const manifest = (await readJson<Record<string, PhotoManifestEntry>>(PHOTO_MANIFEST_PATH)) ?? {};
  const budgetMs = options.budgetMs ?? PHOTO_TIME_BUDGET_MS;
  const startedAt = Date.now();

  const needsFetch = (p: CurrentRosterPlayer): boolean => {
    if (!p.photo) return !hasPlayerPhoto(p.playerId);
    if (p.photo.version === "") return !hasPlayerPhoto(p.playerId);
    const recorded = manifest[p.playerId];
    return (
      options.force === true ||
      !hasPlayerPhoto(p.playerId) ||
      recorded?.path !== p.photo.path ||
      recorded?.version !== p.photo.version
    );
  };
  const priority = (p: CurrentRosterPlayer): number => (!hasPlayerPhoto(p.playerId) ? 0 : p.previousTeamId ? 1 : 2);
  const queue = currentRoster.filter(needsFetch).sort((a, b) => priority(a) - priority(b));
  const pendingPublication = currentRoster.filter((p) => p.photo?.version === "").length;
  console.log(
    `[photo] 現行ロースター${currentRoster.length}名中、取得対象${queue.length}名（公式で写真未公開${pendingPublication}名）`,
  );

  let saved = 0;
  let failed = 0;
  let processed = 0;
  for (const p of queue) {
    if (Date.now() - startedAt > budgetMs) {
      console.warn(`[photo] 時間予算（${Math.round(budgetMs / 60000)}分）に達したため、残り${queue.length - processed}名は次回に回します`);
      break;
    }
    processed += 1;
    const published = p.photo && p.photo.version !== "";
    let ok: boolean;
    if (published) {
      ok = await downloadPlayerPhotoFromUrl(p.playerId, playerPhotoUrl(p.photo!.path, p.playerId), throttledFetch);
      if (ok) manifest[p.playerId] = { path: p.photo!.path, version: p.photo!.version, fetchedAt: new Date().toISOString() };
    } else {
      // 未公開: 現所属の今季→前季、移籍選手は前所属の前季の順に試す（仮の写真。記録は残さない）
      ok = await downloadPlayerPhoto(p.teamId, p.playerId, season, throttledFetch);
      if (!ok && p.previousTeamId) {
        ok = await downloadPlayerPhotoFromUrl(
          p.playerId,
          playerPhotoUrl(`${p.previousTeamId}/${previousSeason(season)}`, p.playerId),
          throttledFetch,
        );
      }
    }
    if (ok) {
      saved += 1;
      console.log(`[photo] 保存: ${p.name}（${p.playerId}、${published ? `${p.photo!.path} v=${p.photo!.version}` : "未公開のため仮の写真"}）`);
    } else {
      failed += 1;
      console.warn(`[photo] 取得できず: ${p.name}（${p.playerId}）`);
    }
    // 途中で打ち切られても取得済みの分が無駄にならないよう、こまめに記録を保存する
    if (saved > 0 && saved % 20 === 0) await writeJson(PHOTO_MANIFEST_PATH, manifest);
  }
  await writeJson(PHOTO_MANIFEST_PATH, manifest);
  console.log(`[photo] 保存${saved}名／取得できず${failed}名／次回に回した${queue.length - processed}名`);
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

  const { master, currentRoster } = await scrapeRosterMaster(season, { force });
  // 写真より先に選手マスタを保存する（写真の失敗・時間切れで新加入選手の登録区分等が失われないように）
  await writeJson(MASTER_PATH, master);
  console.log(`保存完了: ${MASTER_PATH}（${master.length}名）`);

  await syncRosterPhotos(currentRoster, season, { force });
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
