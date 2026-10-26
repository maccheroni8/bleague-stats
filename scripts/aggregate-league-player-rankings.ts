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
import { currentSeason } from "./lib/season.ts";
import { currentPlayerNames, normalizePlayerName } from "../shared/playerName.ts";
import { filterByGameType } from "../shared/gameType.ts";
import { CLASS_KEYS, classKeyOf, type ClassKey } from "../shared/classificationKey.ts";
import { makeClassifier, SPLIT_CLASSIFICATION_FIRST_SEASON, type Classification, type ClassifyAt, type SeasonRegistrationFile } from "../shared/registration.ts";
import { filterByClassification, SPLIT_CAREER_CLASSIFICATION, type PlayerSeasonLogs, SPLIT_CAREER_KEYS, type LeaguePlayerCareerTopFileWithSplit, type SplitCareerKey } from "../shared/careerTopSplit.ts";
import { AWARD_COUNT_KEYS } from "../shared/playerAwardKinds.ts";
import { PLAYER_CAREER_TOTAL_DEFS, buildPlayerCareerTotals } from "../shared/playerRecords.ts";
import type {
  LeaguePlayerCareerTopByClass,
  LeaguePlayerCareerTopEntry,
  LeaguePlayerInfo,
  LeaguePlayerRankEntry,
  LeaguePlayerRankingsFile,
  LeaguePlayerRankingStatTable,
  LeagueRankingGameType,
  PlayerCareerCounts,
  PlayerCareersFile,
  PlayerGameLog,
  PlayerMasterEntry,
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

  // 複数のシーズンをまたぐ表なので、選手名は選手マスタの今の登録名にそろえる（マスタに無い選手は最新のシーズンの名前。空白はそろえる。DESIGN.md 222-5）
  const names = currentPlayerNames((await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? []);
  for (const [id, p] of info) info.set(id, { ...p, name: names.get(id) ?? normalizePlayerName(p.name) });

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
        if (def.eligible && !def.eligible(totals)) continue;
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

/** 値の大きい順に順位をつけ（同じ値は同じ順位）、上位20位（同じ値はすべて）を返す。同じ値の中は playerId 昇順 */
function rankTop(items: { playerId: string; value: number }[]): LeaguePlayerCareerTopEntry[] {
  const sorted = [...items].sort((a, b) => b.value - a.value || Number(a.playerId) - Number(b.playerId));
  const entries: LeaguePlayerCareerTopEntry[] = [];
  let rank = 0;
  sorted.forEach((e, i) => {
    if (i === 0 || e.value !== sorted[i - 1]!.value) rank = i + 1;
    if (rank <= CAREER_TOP_N) entries.push({ ...e, rank });
  });
  return entries;
}

/**
 * include を渡すと、その選手だけの中で順位をつけ直した上位20位にする（登録区分ごと。DESIGN.md 197章）。
 * 渡さないときは、全選手の順位ファイルの順位のまま
 */
function topOfCareer(
  table: Record<LeagueRankingGameType, LeaguePlayerRankingStatTable>,
  include?: (playerId: string) => boolean,
): Record<LeagueRankingGameType, Record<string, LeaguePlayerCareerTopEntry[]>> {
  const out: Record<LeagueRankingGameType, Record<string, LeaguePlayerCareerTopEntry[]>> = { regular: {}, playoff: {}, both: {} };
  for (const gameType of GAME_TYPES) {
    for (const [key, byPlayer] of Object.entries(table[gameType])) {
      out[gameType][key] = include
        ? rankTop(Object.entries(byPlayer).filter(([playerId]) => include(playerId)).map(([playerId, e]) => ({ playerId, value: e.value })))
        : Object.entries(byPlayer)
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
function topOfCareerCounts(
  careers: PlayerCareersFile | null,
  known: Map<string, LeaguePlayerInfo>,
  include: (playerId: string) => boolean = () => true,
): Record<string, LeaguePlayerCareerTopEntry[]> {
  const latest = new Map<string, PlayerCareerCounts>();
  for (const season of Object.keys(careers?.seasons ?? {}).sort()) {
    for (const [playerId, counts] of Object.entries(careers!.seasons[season]!)) latest.set(playerId, counts);
  }
  const out: Record<string, LeaguePlayerCareerTopEntry[]> = {};
  for (const key of CAREER_COUNT_KEYS) {
    // 表示用の情報（名前・チーム）が無い選手は出せないので対象外にする。0回の選手は並べない（受賞が少ない賞で、0回の同順位に全選手が入るのを避ける）
    out[key] = rankTop(
      [...latest]
        .filter(([playerId]) => known.has(playerId) && include(playerId))
        .map(([playerId, c]) => ({ playerId, value: c[key] ?? 0 }))
        .filter((e) => e.value > 0),
    );
  }
  return out;
}

/**
 * 現役＝今季（season）の B.PREMIER か B.ONE の名簿に載っている選手のID（両リーグの players.json と registered-players.json。DESIGN.md 173・222・298章）。
 * 画面の現役の絞り込み（src/lib/activePlayers.ts）と同じ選手
 */
async function loadActivePlayerIds(season: string): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const dir of [path.join(DATA_DIR, season), path.join(DATA_DIR, season, "one")]) {
    for (const file of ["players.json", "registered-players.json"]) {
      for (const p of (await readJson<PlayerSummary[]>(path.join(dir, file))) ?? []) ids.add(p.playerId);
    }
  }
  return ids;
}

/** シーズンごとの区分の決め方（集計と同じ shared/registration.ts の makeClassifier。2026-27 以降は登録区分の記録、それより前は選手マスタ） */
async function loadClassifiers(seasons: readonly string[], master: PlayerMasterEntry[]): Promise<Map<string, ClassifyAt>> {
  const masterById = new Map(master.map((p) => [p.playerId, p]));
  const out = new Map<string, ClassifyAt>();
  for (const season of seasons) {
    const registrations = await readJson<SeasonRegistrationFile>(path.join(DATA_DIR, season, "registrations.json"));
    out.set(season, makeClassifier(season, registrations, masterById));
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
  const careers = await readJson<PlayerCareersFile>(path.join(DATA_DIR, "player-careers.json"));
  const careerCounts = topOfCareerCounts(careers, info);
  // 登録区分ごとに、その区分で出場した試合だけの通算で順位をつけ直した上位20位（試合ごとの区分。DESIGN.md 197・298章）。
  // 日本人・外国籍・帰化・アジアのまとめは全シーズン（2025-26 以前は選手マスタの区分）、分けた区分は 2026-27 以降の試合だけ。
  // 回数・在籍（試合で分けられない）は、日本人・まとめは選手マスタの区分の選手で数え、分けた区分は出さない
  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const classKeyById = new Map(master.map((p) => [p.playerId, classKeyOf(p.classification)]));
  const seasons = [...new Set([...byPlayer.values()].flatMap((list) => list.map((x) => x.season)))].sort();
  const classifiers = await loadClassifiers(seasons, master);
  const careerTables = (logs: Map<string, PlayerSeasonLogs[]>) => ({
    career: computeCareerRankings(logs),
    careerHome: computeCareerRankings(filterByVenue(logs, "home")),
    careerAway: computeCareerRankings(filterByVenue(logs, "away")),
  });
  const classMatch: Record<ClassKey | SplitCareerKey, (season: string, c: Classification | undefined) => boolean> = {
    jp: (_, c) => c === "日本人",
    intl: (_, c) => c !== undefined && c !== "日本人",
    foreign: (season, c) => season >= SPLIT_CLASSIFICATION_FIRST_SEASON && c === SPLIT_CAREER_CLASSIFICATION.foreign,
    naturalized: (season, c) => season >= SPLIT_CLASSIFICATION_FIRST_SEASON && c === SPLIT_CAREER_CLASSIFICATION.naturalized,
    asia: (season, c) => season >= SPLIT_CLASSIFICATION_FIRST_SEASON && c === SPLIT_CAREER_CLASSIFICATION.asia,
  };
  const tablesByClass = new Map<ClassKey | SplitCareerKey, ReturnType<typeof careerTables>>();
  for (const key of [...CLASS_KEYS, ...SPLIT_CAREER_KEYS]) tablesByClass.set(key, careerTables(filterByClassification(byPlayer, classifiers, classMatch[key])));
  const topOfClass = (key: ClassKey | SplitCareerKey, include?: (playerId: string) => boolean, countsInclude?: (playerId: string) => boolean): LeaguePlayerCareerTopByClass => {
    const t = tablesByClass.get(key)!;
    return {
      career: topOfCareer(t.career, include),
      careerHome: topOfCareer(t.careerHome, include),
      careerAway: topOfCareer(t.careerAway, include),
      careerCounts: countsInclude ? topOfCareerCounts(careers, info, countsInclude) : {},
    };
  };
  const all = () => true;
  const byClassification = {} as Record<ClassKey, LeaguePlayerCareerTopByClass>;
  for (const key of CLASS_KEYS) byClassification[key] = topOfClass(key, all, (playerId) => classKeyById.get(playerId) === key);
  const bySplitClass = {} as Record<SplitCareerKey, LeaguePlayerCareerTopByClass>;
  for (const key of SPLIT_CAREER_KEYS) bySplitClass[key] = topOfClass(key, all);
  // 現役（今季の B.PREMIER か B.ONE の名簿に載っている選手）だけの中での上位20位。画面の現役の絞り込み（src/lib/activePlayers.ts）と同じ選手
  const activeIds = await loadActivePlayerIds(currentSeason());
  console.log(`現役（${currentSeason()}の B.PREMIER・B.ONE の名簿）: ${activeIds.size}名`);
  const isActive = (playerId: string) => activeIds.has(playerId);
  const byActive = {} as Record<"all" | ClassKey, LeaguePlayerCareerTopByClass>;
  byActive.all = {
    career: topOfCareer(career, isActive),
    careerHome: topOfCareer(careerHome, isActive),
    careerAway: topOfCareer(careerAway, isActive),
    careerCounts: topOfCareerCounts(careers, info, isActive),
  };
  for (const key of CLASS_KEYS) byActive[key] = topOfClass(key, isActive, (playerId) => isActive(playerId) && classKeyById.get(playerId) === key);
  const byActiveSplitClass = {} as Record<SplitCareerKey, LeaguePlayerCareerTopByClass>;
  for (const key of SPLIT_CAREER_KEYS) byActiveSplitClass[key] = topOfClass(key, isActive);
  const topPlayers: Record<string, LeaguePlayerInfo> = {};
  const addPlayers = (entries: LeaguePlayerCareerTopEntry[]) => {
    for (const e of entries) if (info.has(e.playerId)) topPlayers[e.playerId] = info.get(e.playerId)!;
  };
  const addAll = (t: Record<LeagueRankingGameType, Record<string, LeaguePlayerCareerTopEntry[]>>) => {
    for (const byKey of Object.values(t)) for (const entries of Object.values(byKey)) addPlayers(entries);
  };
  addPlayers(Object.values(careerCounts).flat());
  for (const t of Object.values(top)) addAll(t);
  for (const c of Object.values(byClassification)) {
    addAll(c.career);
    addAll(c.careerHome);
    addAll(c.careerAway);
    addPlayers(Object.values(c.careerCounts).flat());
  }
  for (const c of [...Object.values(byActive), ...Object.values(bySplitClass), ...Object.values(byActiveSplitClass)]) {
    addAll(c.career);
    addAll(c.careerHome);
    addAll(c.careerAway);
    addPlayers(Object.values(c.careerCounts).flat());
  }
  const topFile: LeaguePlayerCareerTopFileWithSplit = {
    generatedAt: new Date().toISOString(),
    players: topPlayers,
    ...top,
    careerCounts,
    byClassification,
    byActive,
    bySplitClass,
    byActiveSplitClass,
  };
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
