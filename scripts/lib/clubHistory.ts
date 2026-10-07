// 選手ページ（roster_detail）の「クラブ所属履歴」を読む・保存する・取得対象を決める処理（DESIGN.md 214章）。
//
// - 読む: 選手ページの `.c-history-pc` の `<p>2021-22 西宮</p>`（スマホ表示用の `.c-history-sp` は同じ内容の重複なので読まない）。
//   B2・B3のクラブも載る。「シーズン クラブ略称」だけで、クラブID・カテゴリは載らない
// - 保存: data/player-club-history.json（元データ。コミットする）。読めた選手だけを足し、一度読めた選手は取り直さない
// - 取得対象: 元データだけで決まる（名簿とマスタ）。導出データ（player-careers など）には頼らない
//   （深夜実行は導出データを作る前に走るため）

import path from "node:path";
import { load } from "cheerio";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./storage.ts";
import type {
  ClubHistoryEntry,
  CurrentRosterFile,
  PlayerClubHistoryFile,
  PlayerMasterEntry,
  SeasonRostersFile,
} from "../../shared/types.ts";

export const CLUB_HISTORY_PATH = path.join(DATA_DIR, "player-club-history.json");

/** B.LEAGUE発足のシーズン。これ以前の経歴は選手ページに載らないので、このシーズンが初登録の選手は「初めての登録」を判定できない */
export const LEAGUE_FIRST_SEASON = "2016-17";

/**
 * 選手ページのHTMLから「クラブ所属履歴」を読む。履歴の欄そのものが無いとき（ページの作りが変わった・取得が不完全）は null。
 * 履歴は新しい順で載っているので、シーズンの昇順（同じシーズンは古い順）に並べ直す
 */
export function parseClubHistory(html: string): ClubHistoryEntry[] | null {
  const $ = load(html);
  let found = false;
  const entries: ClubHistoryEntry[] = [];
  $("li.rosterDetail-kv-playerProfile-list-item").each((_, el) => {
    const label = $(el).find("span").first().text().trim();
    if (label !== "クラブ所属履歴") return;
    found = true;
    $(el)
      .find(".c-history-pc p")
      .each((__, p) => {
        const m = /^(\d{4}-\d{2})\s+(.+)$/.exec($(p).text().replace(/\s+/g, " ").trim());
        if (m) entries.push({ season: m[1]!, club: m[2]!.trim() });
      });
  });
  if (!found || entries.length === 0) return null;
  return entries
    .reverse()
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.season.localeCompare(b.e.season) || a.i - b.i)
    .map((x) => x.e);
}

export async function readClubHistory(): Promise<PlayerClubHistoryFile> {
  return (await readJson<PlayerClubHistoryFile>(CLUB_HISTORY_PATH)) ?? { generatedAt: "", players: {} };
}

/** 履歴を足して保存する（既にある選手は取り直さないので上書きしない）。内容が変わったときだけ書く。足した人数を返す */
export async function addClubHistory(additions: Map<string, ClubHistoryEntry[]>): Promise<number> {
  const file = await readClubHistory();
  let added = 0;
  for (const [playerId, history] of additions) {
    if (file.players[playerId]) continue;
    file.players[playerId] = history;
    added += 1;
  }
  if (added === 0) return 0;
  const players = Object.fromEntries(Object.entries(file.players).sort(([a], [b]) => a.localeCompare(b)));
  await writeJsonIfChanged(CLUB_HISTORY_PATH, { generatedAt: new Date().toISOString(), players } as unknown as Record<string, unknown>);
  return added;
}

export interface ClubHistoryTarget {
  playerId: string;
  /** 名簿に最初に載ったシーズン */
  firstSeason: string;
}

/**
 * 所属履歴を取る対象: 名簿（シーズン別の選手一覧と、今の選手名簿）に最初に載ったシーズンが2017-18以降の、登録区分が日本人の選手。
 * 規程の新人選手は、外国籍・アジア特別枠・帰化選手に該当せず、初めてBリーグに登録された選手なので、年齢では絞らない（年齢は翌シーズン以降への延長の判定だけに使う）。
 * 登録区分は選手マスタ（`classification`）。マスタに無い・区分が不明の選手は、判定の側で「判定不能」にするので、ここでは対象に含める
 */
export function clubHistoryTargets(
  rosters: SeasonRostersFile,
  currentRoster: CurrentRosterFile | null,
  master: PlayerMasterEntry[],
): ClubHistoryTarget[] {
  const firstSeen = new Map<string, string>();
  for (const season of Object.keys(rosters).sort()) {
    for (const team of rosters[season]!) for (const id of team.playerIds) if (!firstSeen.has(id)) firstSeen.set(id, season);
  }
  if (currentRoster) for (const p of currentRoster.players) if (!firstSeen.has(p.playerId)) firstSeen.set(p.playerId, currentRoster.season);
  const classificationOf = new Map(master.map((p) => [p.playerId, p.classification]));
  const targets: ClubHistoryTarget[] = [];
  for (const [playerId, firstSeason] of firstSeen) {
    if (firstSeason <= LEAGUE_FIRST_SEASON) continue;
    const classification = classificationOf.get(playerId);
    if (classification !== undefined && classification !== "日本人") continue;
    targets.push({ playerId, firstSeason });
  }
  return targets.sort((a, b) => a.firstSeason.localeCompare(b.firstSeason) || a.playerId.localeCompare(b.playerId));
}
