// data/club-honors.json（teamId→獲得タイトル配列）を生成する（2026-08-16作成）。
//
// 3種類のデータソースを組み合わせる:
// 1. 年間優勝（Bリーグチャンピオンシップ優勝）: このプロジェクトが既に保存済みの試合データ
//    （data/{season}/games-summary.json）から、プレーオフの中で最も日付が新しい試合の勝者を
//    ファイナル決着とみなして機械的に導出する（bleague.jpへの追加アクセス不要）。
// 2. 地区優勝: bleague.jp/standings/?year={年}&tab=1（B1タブ）の地区別テーブルを取得し、
//    各地区の1位チームを地区優勝とする。地区制自体が毎シーズン変動している
//    （2016-17〜2019-20:東/中/西3地区、2020-21〜2021-22:東/西2地区、2022-23〜2024-25:
//    再び東/中/西3地区、2025-26:東/西2地区。Web調査で確認）ため、このプロジェクトが持つ
//    divisions.ts（2026-27時点のマスタ）は使わず、シーズンごとに実際のページを取得して判定する。
// 3. 国際大会（BCLアジア・EASL・前身のFIBAアジアチャンピオンズカップ）:
//    bleague.jpのクラブ詳細ページのachievementウィジェットは直近シーズンの反映が遅れることがある
//    （2026-08-16、長崎ヴェルカの2025-26年間優勝が未反映だった実例で確認済み）ため、season/年の
//    特定はWeb検索で複数の一次情報を突き合わせて確定し、ここでは手入力する（該当が5件のみのため）。
//
// クラブ詳細ページのachievementウィジェット（累計回数のみ・season情報なし）は、生成結果の
// 妥当性チェック用ログにのみ使う（fetchClubAchievementCounts）。B2年間優勝・B2地区優勝は
// 引き続きスコープ外（ユーザー依頼は年間優勝／地区優勝／国際大会／天皇杯のB1・B.PREMIER実績）。
//
// 4. 天皇杯優勝（全日本バスケットボール選手権大会）: 国際大会と同様、Web調査（Wikipedia「天皇杯・
//    皇后杯全日本バスケットボール選手権大会」＋公式アーカイブサイト zennihon{season}.
//    japanbasketball.jp/history/）で歴代優勝チームを確認し、手入力する（2026-08-22）。
//    天皇杯は暦年（1〜3月に決勝）で開催されるが、公式アーカイブサイト自体がB.LEAGUEの
//    シーズン表記（例: "2025-26"）をそのままサイト名に使っているため、season欄はB.LEAGUEの
//    シーズン表記と揃えている（暦年からの変換は不要）。2016年（第91回、B.LEAGUE開幕前）の
//    アイシン三河優勝はスコープ外。全件、bleague.jpのクラブ詳細ページachievementウィジェットの
//    「天皇杯優勝◯回」カウントと突き合わせて裏取り済み（詳細はdocs/DESIGN.md参照）。

import path from "node:path";
import { load } from "cheerio";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, readJson, writeJson } from "./lib/storage.ts";
import { TEAM_NAMES } from "./lib/divisions.ts";
import type { GameSummary } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

type HonorCategory = "overall" | "division" | "international" | "emperors_cup";

interface ClubHonor {
  competition: string;
  season: string;
  category: HonorCategory;
  note?: string;
}

// 試合データが揃っている全10シーズン（2026-27はまだ開幕前で対象外）
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
];

function seasonStartYear(season: string): number {
  return Number(season.slice(0, 4));
}

// ユーザー提供のクロスチェック用リスト（2026-08-16）
const EXPECTED_OVERALL_CHAMPIONS: Record<string, string | null> = {
  "2016-17": "栃木ブレックス", // teamId 703（宇都宮ブレックスの旧称）
  "2017-18": "アルバルク東京",
  "2018-19": "アルバルク東京",
  "2019-20": null, // 中止
  "2020-21": "千葉ジェッツ",
  "2021-22": "宇都宮ブレックス",
  "2022-23": "琉球ゴールデンキングス",
  "2023-24": "広島ドラゴンフライズ",
  "2024-25": "宇都宮ブレックス",
  "2025-26": "長崎ヴェルカ",
};

async function deriveOverallChampion(season: string): Promise<{ teamId: string; teamName: string } | null> {
  const games = await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"));
  if (!games) return null;
  const playoffGames = games.filter((g) => g.gameType === "playoff" && g.gameEndedFlg);
  if (playoffGames.length === 0) return null;

  const sorted = [...playoffGames].sort((a, b) =>
    a.date === b.date ? Number(b.scheduleKey) - Number(a.scheduleKey) : a.date < b.date ? 1 : -1,
  );
  const final = sorted[0];
  if (!final) return null;
  return final.homeScore > final.awayScore
    ? { teamId: final.homeTeamId, teamName: final.homeTeamName }
    : { teamId: final.awayTeamId, teamName: final.awayTeamName };
}

interface DivisionChampion {
  division: string;
  teamId: string;
  teamName: string;
}

async function fetchDivisionChampions(season: string): Promise<DivisionChampion[]> {
  const year = seasonStartYear(season);
  const url = `https://www.bleague.jp/standings/?year=${year}&tab=1`;
  const res = await throttledFetch(url);
  if (!res.ok) return [];
  const html = await res.text();
  const $ = load(html);
  const champions: DivisionChampion[] = [];

  $("h3.box-container").each((_, h3el) => {
    const heading = $(h3el).text().trim();
    if (!heading.endsWith("地区")) return;
    const table = $(h3el).nextAll(".table-scroll-container").first().find("table");
    const firstRow = table.find("tbody tr").first();
    const href = firstRow.find("a.team").attr("href") ?? "";
    const teamIdMatch = href.match(/TeamID=(\d+)/);
    const teamId = teamIdMatch?.[1];
    if (!teamId) return;
    const teamName = TEAM_NAMES[teamId] ?? firstRow.find(".team-name").text().trim();
    champions.push({ division: heading, teamId, teamName });
  });

  return champions;
}

// 国際大会（2026-08-16、複数の一次情報を突き合わせて確定。docs/DESIGN.md参照）
const INTERNATIONAL_HONORS: Array<{ teamId: string; competition: string; season: string; note: string }> = [
  {
    teamId: "706",
    competition: "FIBAアジアチャンピオンズカップ優勝",
    season: "2019",
    note: "BCL Asiaの前身大会。アルバルク東京クラブ公式実績にも記載あり",
  },
  {
    teamId: "704",
    competition: "EASL優勝",
    season: "2023-24",
    note: "EASL初代王者（千葉ジェッツがソウルSKナイツを72-69で下す）",
  },
  {
    teamId: "721",
    competition: "EASL優勝",
    season: "2024-25",
    note: "広島ドラゴンフライズ優勝",
  },
  {
    teamId: "703",
    competition: "バスケットボール チャンピオンズリーグ アジア（BCL Asia）優勝",
    season: "2025",
    note: "2025年6月14日決勝、宇都宮ブレックスが初優勝（大会自体は暦年表記）",
  },
  {
    teamId: "703",
    competition: "EASL優勝",
    season: "2025-26",
    note: "2026年3月22日決勝、宇都宮ブレックスが初優勝・Bリーグ勢3連覇達成",
  },
];

// 天皇杯優勝（2026-08-22、Wikipedia「天皇杯・皇后杯全日本バスケットボール選手権大会」＋
// zennihon{season}.japanbasketball.jp/history/ を突き合わせて確定。B.LEAGUE開幕（2016-17）
// 以降のみ対象。全件、各クラブのbleague.jpクラブ詳細ページachievementウィジェットの
// 「天皇杯優勝◯回」カウントと一致することを確認済み（千葉5・川崎2・東京SR1・琉球1・A東京1）
const EMPERORS_CUP_HONORS: Array<{ teamId: string; season: string; note: string }> = [
  { teamId: "704", season: "2016-17", note: "第92回。千葉ジェッツ初優勝" },
  { teamId: "704", season: "2017-18", note: "第93回。千葉ジェッツ連覇" },
  { teamId: "704", season: "2018-19", note: "第94回。千葉ジェッツ3連覇" },
  { teamId: "726", season: "2019-20", note: "第95回。当時のサンロッカーズ渋谷が優勝" },
  { teamId: "727", season: "2020-21", note: "第96回。川崎ブレイブサンダースが7大会ぶり4度目の優勝" },
  { teamId: "727", season: "2021-22", note: "第97回。川崎ブレイブサンダースがクラブ初の連覇（通算5度目）" },
  { teamId: "704", season: "2022-23", note: "第98回。千葉ジェッツが優勝（翌年と合わせ2連覇）" },
  { teamId: "704", season: "2023-24", note: "第99回。千葉ジェッツが2連覇達成（通算5度目）" },
  { teamId: "701", season: "2024-25", note: "第100回。琉球ゴールデンキングス初優勝" },
  { teamId: "706", season: "2025-26", note: "第101回。アルバルク東京が14大会ぶり3度目の優勝" },
];

interface ClubAchievementCount {
  name: string;
  count: string;
}

/** クラブ詳細ページの累計回数ウィジェット（season情報なし）。妥当性チェック用のみ */
async function fetchClubAchievementCounts(teamId: string): Promise<ClubAchievementCount[]> {
  const res = await throttledFetch(`https://www.bleague.jp/club_detail/?TeamID=${teamId}`);
  if (!res.ok) return [];
  const html = await res.text();
  const match = html.match(/<ul class="clubDetail-kv-achievement.*?<\/ul>/s);
  if (!match) return [];
  const $ = load(match[0]);
  const items: ClubAchievementCount[] = [];
  $(".clubDetail-kv-achievement-item").each((_, el) => {
    const name = $(el).find(".clubDetail-kv-achievement-name").text().trim();
    const count = $(el).find(".clubDetail-kv-achievement-win").text().trim();
    items.push({ name, count });
  });
  return items;
}

async function main() {
  const result: Record<string, ClubHonor[]> = {};
  for (const teamId of Object.keys(TEAM_NAMES)) result[teamId] = [];

  console.log("=== 1. 年間優勝を自前データから導出 ===");
  for (const season of SEASONS) {
    const champion = await deriveOverallChampion(season);
    const expected = EXPECTED_OVERALL_CHAMPIONS[season];
    if (!champion) {
      const note = expected ? `⚠️ 提供リストは「${expected}」だが試合データから導出できず` : "想定通り該当なし";
      console.log(`[${season}] チャンピオン無し（${note}）`);
      continue;
    }
    const isMatch = champion.teamName === expected || (expected === "栃木ブレックス" && champion.teamId === "703");
    console.log(
      `[${season}] ${champion.teamName} (teamId=${champion.teamId}) ${isMatch ? "✅一致" : `⚠️不一致（提供リスト: ${expected}）`}`,
    );
    const overallArr = result[champion.teamId] ?? (result[champion.teamId] = []);
    overallArr.push({ competition: "Bリーグチャンピオンシップ優勝", season, category: "overall" });
  }

  console.log("\n=== 2. 地区優勝をbleague.jp/standings/から取得 ===");
  for (const season of SEASONS) {
    const champions = await fetchDivisionChampions(season);
    console.log(`[${season}] ${champions.map((c) => `${c.division}:${c.teamName}`).join(" / ") || "取得失敗"}`);
    for (const c of champions) {
      const divisionArr = result[c.teamId] ?? (result[c.teamId] = []);
      divisionArr.push({ competition: `${c.division}優勝`, season, category: "division" });
    }
  }

  console.log("\n=== 3. 国際大会（手入力・複数一次情報で確認済み） ===");
  for (const h of INTERNATIONAL_HONORS) {
    const intlArr = result[h.teamId] ?? (result[h.teamId] = []);
    intlArr.push({ competition: h.competition, season: h.season, category: "international", note: h.note });
    console.log(`[${h.season}] ${TEAM_NAMES[h.teamId]}: ${h.competition}`);
  }

  console.log("\n=== 4. 天皇杯優勝（手入力・Wikipedia＋公式アーカイブサイトで確認済み） ===");
  for (const h of EMPERORS_CUP_HONORS) {
    if (!TEAM_NAMES[h.teamId]) {
      // B.PREMIER26クラブのマスタに存在しない優勝クラブ（B.ONE所属クラブ等）が
      // 将来出現した場合はここで検知できるようにしておく（現状の10シーズン分は全件マスタ内）
      console.log(`⚠️ teamId=${h.teamId}（${h.season}）はTEAM_NAMESに存在しません。手動確認が必要です`);
      continue;
    }
    const cupArr = result[h.teamId] ?? (result[h.teamId] = []);
    cupArr.push({ competition: "天皇杯優勝", season: h.season, category: "emperors_cup", note: h.note });
    console.log(`[${h.season}] ${TEAM_NAMES[h.teamId]}: 天皇杯優勝`);
  }

  await writeJson(path.join(DATA_DIR, "club-honors.json"), result);
  const total = Object.values(result).reduce((n, arr) => n + arr.length, 0);
  console.log(`\ndata/club-honors.jsonに保存しました（${total}件）`);

  console.log("\n=== 妥当性チェック: クラブ詳細ページの累計回数ウィジェットと突き合わせ ===");
  for (const teamId of Object.keys(TEAM_NAMES)) {
    const counts = await fetchClubAchievementCounts(teamId);
    const relevant = counts.filter((c) => /^(Bリーグチャンピオンシップ優勝|B1地区優勝|バスケットボール|EASL優勝|FIBA|天皇杯優勝)/.test(c.name));
    if (relevant.length === 0) continue;
    const derivedCount = (result[teamId] ?? []).length;
    const widgetTotal = relevant.reduce((n, c) => n + (Number(c.count.replace("回", "")) || 0), 0);
    const flag = derivedCount === widgetTotal ? "✅" : "⚠️";
    console.log(
      `${flag} ${TEAM_NAMES[teamId]}: 導出${derivedCount}件 / ウィジェット${widgetTotal}回 (${relevant.map((c) => `${c.name}${c.count}`).join(", ")})`,
    );
  }
}

main();
