// data/league-player-rankings.json（個人版「歴代記録」タブ、通算成績のみ）を生成する。
//
// data/{season}/player-games/{playerId}.json.gz を全B.PREMIERシーズン・全選手横断で読み込み、
// 通算成績（PLAYER_CAREER_TOTAL_DEFS）について、リーグ全選手中の順位を算出する。playerIdは
// シーズン・チームをまたいで不変なので、移籍・引退後の選手も含めplayerId単位でそのまま
// 合算・比較する。レギュラーシーズンのみ/プレーオフのみ/合算、ホーム/アウェイ/トータルの
// 組み合わせを算出する（scripts/aggregate-league-rankings.ts＝チーム版と同じ構成）。
// クラブレコード相当（1試合単位の最高記録）・シーズン単位の特殊記録は対象外
// （ユーザー指定、2026-09-04。別途Rankingsページの機能として検討予定）。
//
// チーム版と同じく、夜間実行（update-stats.yml のディープrecheck）で毎晩実行する（2026-09-25から。それまでは手動実行。
// 作った時刻以外が前回と同じならファイルを書き換えない。DESIGN.md 143-4）。B.PREMIERのみが対象（B.ONEは対象外）。
//
// 使い方:
//   npm run aggregate:league-player-rankings

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import { filterByGameType } from "../shared/gameType.ts";
import { AWARD_COUNT_KEYS } from "../shared/playerAwardKinds.ts";
import { PLAYER_CAREER_TOTAL_DEFS, buildPlayerCareerTotals } from "../shared/playerRecords.ts";
import type {
  LeaguePlayerCareerTopEntry,
  LeaguePlayerCareerTopFile,
  LeaguePlayerInfo,
  LeaguePlayerRankEntry,
  LeaguePlayerRankingsFile,
  LeaguePlayerRankingStatTable,
  LeagueRankingGameType,
  PlayerCareerCounts,
  PlayerCareersFile,
  PlayerGameLog,
  PlayerSummary,
} from "../shared/types.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;
const GAME_TYPES: LeagueRankingGameType[] = ["regular", "playoff", "both"];

function listSeasonDirs(): string[] {
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
}

interface PlayerSeasonLogs {
  season: string;
  logs: PlayerGameLog[];
}

/**
 * playerId単位で全シーズン分のPlayerGameLogを集める（出場なし＝min<=0の試合は除外。
 * src/lib/playerSeasonBoxscore.tsのsumPlayerGameLogs()と同じ方針）。あわせて、各選手の
 * 表示用情報（name/teamId/teamName）を、その選手が登場する最新シーズンのplayers.json
 * （PlayerSummary）から取得する。シーズンを昇順に走査しながら都度上書きするだけで、
 * 自然に「最新シーズンの値」が残る
 */
async function loadCareerData(): Promise<{
  byPlayer: Map<string, PlayerSeasonLogs[]>;
  info: Map<string, LeaguePlayerInfo>;
}> {
  const byPlayer = new Map<string, PlayerSeasonLogs[]>();
  const info = new Map<string, LeaguePlayerInfo>();

  for (const season of listSeasonDirs()) {
    const dir = path.join(DATA_DIR, season, "player-games");
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
      for (const file of files) {
        const playerId = file.replace(/\.json\.gz$/, "");
        const logs = await readJson<PlayerGameLog[]>(path.join(dir, `${playerId}.json`));
        if (!logs) continue;
        const real = logs.filter((g) => g.min > 0 && (g.gameType === "regular" || g.gameType === "playoff"));
        if (real.length === 0) continue;
        const arr = byPlayer.get(playerId) ?? [];
        arr.push({ season, logs: real });
        byPlayer.set(playerId, arr);
      }
    }

    const players = await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, "players.json"));
    if (players) {
      for (const p of players) {
        info.set(p.playerId, { name: p.name, teamId: p.teamId, teamName: p.teamName, latestSeason: season });
      }
    }
  }

  return { byPlayer, info };
}

/**
 * 選手間の順位。同じ値は同じ順位にし、次の順位はその分飛ばす（1位・2位・2位・4位。2026-09-25にユーザー指示で、
 * それまでの「同じ値も playerId 昇順で連番」から変更。チーム版と同じ。DESIGN.md 143-3）。同じ値の中の並びは playerId 昇順
 */
function buildRankTable(entries: { playerId: string; value: number }[]): Record<string, LeaguePlayerRankEntry> {
  const sorted = [...entries].sort((a, b) => b.value - a.value || Number(a.playerId) - Number(b.playerId));
  const totalPlayers = sorted.length;
  const table: Record<string, LeaguePlayerRankEntry> = {};
  let rank = 0;
  sorted.forEach((e, i) => {
    if (i === 0 || e.value !== sorted[i - 1]!.value) rank = i + 1;
    table[e.playerId] = { value: e.value, rank, totalPlayers };
  });
  return table;
}

function computeCareerRankings(byPlayer: Map<string, PlayerSeasonLogs[]>): Record<LeagueRankingGameType, LeaguePlayerRankingStatTable> {
  const career: Record<LeagueRankingGameType, LeaguePlayerRankingStatTable> = { regular: {}, playoff: {}, both: {} };

  for (const gameType of GAME_TYPES) {
    const collected = new Map<string, { playerId: string; value: number }[]>();

    for (const [playerId, seasons] of byPlayer) {
      const flat = seasons.flatMap((s) => s.logs);
      const filtered = filterByGameType(flat, gameType);
      if (filtered.length === 0) continue;

      const totals = buildPlayerCareerTotals(filtered);
      for (const def of PLAYER_CAREER_TOTAL_DEFS) {
        const arr = collected.get(def.key) ?? [];
        arr.push({ playerId, value: def.value(totals) });
        collected.set(def.key, arr);
      }
    }

    for (const [key, entries] of collected) career[gameType][key] = buildRankTable(entries);
  }

  return career;
}

/** byPlayerの各選手の試合ログを、指定venue（ホーム/アウェイ）のみに絞り込む。
 * venue===nullはそのまま（トータル、絞り込みなし） */
function filterByVenue(byPlayer: Map<string, PlayerSeasonLogs[]>, venue: "home" | "away" | null): Map<string, PlayerSeasonLogs[]> {
  if (venue === null) return byPlayer;
  const isHome = venue === "home";
  return new Map(
    [...byPlayer].map(([playerId, seasons]) => [
      playerId,
      seasons.map((s) => ({ season: s.season, logs: s.logs.filter((g) => g.isHome === isHome) })),
    ]),
  );
}

/** 画面（ランキング > 個人 > 通算記録）用に、項目・試合区分ごとの上位20位（同じ値はすべて）だけを取り出す */
const CAREER_TOP_N = 20;
function topOfCareer(
  table: Record<LeagueRankingGameType, LeaguePlayerRankingStatTable>,
): Record<LeagueRankingGameType, Record<string, LeaguePlayerCareerTopEntry[]>> {
  const out: Record<LeagueRankingGameType, Record<string, LeaguePlayerCareerTopEntry[]>> = { regular: {}, playoff: {}, both: {} };
  for (const gameType of GAME_TYPES) {
    for (const [key, byPlayer] of Object.entries(table[gameType])) {
      out[gameType][key] = Object.entries(byPlayer)
        .filter(([, e]) => e.rank <= CAREER_TOP_N)
        .map(([playerId, e]) => ({ playerId, value: e.value, rank: e.rank }))
        .sort((a, b) => a.rank - b.rank || Number(a.playerId) - Number(b.playerId));
    }
  }
  return out;
}

/** 回数・在籍の項目（ランキング > 個人 > 通算記録。通算出場試合は通算成績の「試合数」と重なるので入れない）。キーは PlayerCareerCounts */
const CAREER_COUNT_KEYS: (keyof PlayerCareerCounts)[] = ["titles", "divisionTitles", "finals", "postseasons", ...AWARD_COUNT_KEYS, "seasons", "clubs"];

/** 各選手の最新の累計（player-careers.json の、その選手が載っている最後のシーズンの値）の上位20位（同じ値はすべて） */
function topOfCareerCounts(careers: PlayerCareersFile | null, known: Map<string, LeaguePlayerInfo>): Record<string, LeaguePlayerCareerTopEntry[]> {
  const latest = new Map<string, PlayerCareerCounts>();
  for (const season of Object.keys(careers?.seasons ?? {}).sort()) {
    for (const [playerId, counts] of Object.entries(careers!.seasons[season]!)) latest.set(playerId, counts);
  }
  const out: Record<string, LeaguePlayerCareerTopEntry[]> = {};
  for (const key of CAREER_COUNT_KEYS) {
    // 表示用の情報（名前・チーム）が無い選手は出せないので対象外にする。0回の選手は並べない（受賞が少ない賞で、0回の同順位に全選手が入るのを避ける）
    const sorted = [...latest]
      .filter(([playerId]) => known.has(playerId))
      .map(([playerId, c]) => ({ playerId, value: c[key] ?? 0 }))
      .filter((e) => e.value > 0)
      .sort((a, b) => b.value - a.value || Number(a.playerId) - Number(b.playerId));
    const entries: LeaguePlayerCareerTopEntry[] = [];
    let rank = 0;
    sorted.forEach((e, i) => {
      if (i === 0 || e.value !== sorted[i - 1]!.value) rank = i + 1;
      if (rank <= CAREER_TOP_N) entries.push({ ...e, rank });
    });
    out[key] = entries;
  }
  return out;
}

async function main() {
  const { byPlayer, info } = await loadCareerData();
  console.log(`対象選手数（出場記録のある全選手、B.PREMIER）: ${byPlayer.size}`);

  const career = computeCareerRankings(byPlayer);
  const careerHome = computeCareerRankings(filterByVenue(byPlayer, "home"));
  const careerAway = computeCareerRankings(filterByVenue(byPlayer, "away"));

  for (const [label, r] of [
    ["total", career],
    ["home", careerHome],
    ["away", careerAway],
  ] as const) {
    console.log(`[${label}] career対象選手数(games基準/regular)=${Object.keys(r.regular.games ?? {}).length}`);
  }

  const file: LeaguePlayerRankingsFile = {
    generatedAt: new Date().toISOString(),
    players: Object.fromEntries(info),
    career,
    careerHome,
    careerAway,
  };

  // 通算記録の上位だけのファイル（画面はこちらを読む。DESIGN.md 192章）
  const top = { career: topOfCareer(career), careerHome: topOfCareer(careerHome), careerAway: topOfCareer(careerAway) };
  const careerCounts = topOfCareerCounts(await readJson<PlayerCareersFile>(path.join(DATA_DIR, "player-careers.json")), info);
  const topPlayers: Record<string, LeaguePlayerInfo> = {};
  for (const e of Object.values(careerCounts).flat()) topPlayers[e.playerId] = info.get(e.playerId)!;
  for (const t of Object.values(top)) {
    for (const byKey of Object.values(t)) {
      for (const entries of Object.values(byKey)) for (const e of entries) if (info.has(e.playerId)) topPlayers[e.playerId] = info.get(e.playerId)!;
    }
  }
  const topFile: LeaguePlayerCareerTopFile = { generatedAt: new Date().toISOString(), players: topPlayers, ...top, careerCounts };
  const topChanged = await writeJsonIfChanged(path.join(DATA_DIR, "league-player-career-top.json"), topFile as unknown as Record<string, unknown>);
  console.log(topChanged ? "data/league-player-career-top.jsonに保存しました" : "data/league-player-career-top.jsonは内容に変化が無いため書き換えませんでした");

  // 作った時刻以外が前回と同じなら書き換えない（夜間実行で変化の無い日にコミット・デプロイを起こさない。DESIGN.md 143-4）
  const changed = await writeJsonIfChanged(path.join(DATA_DIR, "league-player-rankings.json"), file as unknown as Record<string, unknown>);
  if (!changed) {
    console.log("\n内容に変化が無いため、data/league-player-rankings.jsonは書き換えませんでした");
    return;
  }
  console.log("\ndata/league-player-rankings.jsonに保存しました");
}

main();
