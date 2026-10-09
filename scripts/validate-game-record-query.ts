// ランキングの1試合記録の「条件を付けたとき」の集計（src/lib/gameRecordQuery.ts。DESIGN.md 220章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（導出データを作ったあと、`npm run build:data` のあとに実行する）:
//  1. 条件なし（前後半5分の特別な試合を含める）の結果が、今の上位20位のファイルと一致する
//     個人: シーズンごとの player-game-records.json（全選手・日本人・外国籍）と全シーズンの league-player-game-records.json
//     チーム: 全シーズンの league-team-rankings.json（記録・ワースト・被記録・クォーター別）と、シーズンの全クラブの試合ログから作る一覧（seasonTeamRecordRows）
//  2. 試合の条件（勝敗・会場・対戦相手・延長・最終点差・試合中の点差・自チーム／対戦相手の地区・試合区分）の判定が、元の試合ログと地区の履歴から数え直した結果と一致する
//  3. 個人の登録区分・ルーキー（2016-17の行が無い）・ポジション・スタッツの条件（すべて／どれか）の判定が一致する
//  4. 順位（1・2・2・4）・並びの向き・同じ値の中の並び・N位までの切り方
//  5. 前後半5分の特別な試合の除外件数と、2016-17のPTSOFFTOの行（値がある）
//  6. 条件を1か所間違えると NG になること（感度の確認）
//
// 使い方: npm run validate:game-record-query（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { loadSeasonRecordGames, type RecordGame } from "./lib/playerGameRecordsTop.ts";
import { teamDivisionForSeason } from "./lib/divisions.ts";
import { type PlayerGameIndexFile, type TeamGameIndexFile } from "../shared/gameIndex.ts";
import { PLAYER_GAME_RECORD_STATS } from "../shared/playerGameRecords.ts";
import type {
  DivisionHistoryFile,
  GameSummary,
  LeagueRecordEntry,
  LeagueTeamRankingsFile,
  PlayerGameRecordsFile,
  LeaguePlayerGameRecordsFile,
  PlayerSummary,
  RookieEligibilityFile,
  TeamGameLog,
} from "../shared/types.ts";
import { viewPlayerGameIndex, viewTeamGameIndex, type PlayerGameIndexView, type TeamGameIndexView } from "../src/lib/gameIndex.ts";
import { gameOvertimes } from "../src/lib/gameFacts.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS, type GameRecordConditions } from "../src/lib/gameRecordConditions.ts";
import {
  PLAYER_STAT_CONDITION_ITEMS,
  playerQueryStats,
  queryPlayerGameRecords,
  queryTeamGameRecords,
  teamQueryStat,
  type PlayerQueryStat,
} from "../src/lib/gameRecordQuery.ts";
import { positionFilterValue } from "../src/lib/classificationFilter.ts";
import { matchesMargin } from "../src/lib/situational.ts";
import { DEFAULT_STAT_CONDITIONS, type StatConditionsState } from "../src/lib/statConditions.ts";
import {
  allTimeTeamRecordRows,
  parsePeriodItemKey,
  seasonTeamRecordRows,
  teamRecordItems,
  type TeamGameRecordRow,
  type TeamRecordGame,
  type TeamRecordMode,
} from "../src/lib/teamGameRecords.ts";
import { filterByGameType } from "../shared/gameType.ts";
import type { SeasonGameTypeFilter } from "../shared/gameType.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`ok ${label}`);
  } else {
    failures += 1;
    console.error(`NG ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}
/** 一覧の差を1つにまとめて報告する（件数が多いので、成功は数だけ出す） */
class Group {
  total = 0;
  bad = 0;
  samples: string[] = [];
  constructor(readonly label: string) {}
  add(ok: boolean, detail: () => string): void {
    this.total += 1;
    if (!ok) {
      this.bad += 1;
      if (this.samples.length < 4) this.samples.push(detail());
    }
  }
  report(): void {
    check(`${this.label}（${this.total}件）`, this.bad === 0, this.samples.join("\n   "));
  }
}

const ALL = 1_000_000;
const GAME_TYPES: SeasonGameTypeFilter[] = ["regular", "playoff", "both"];
const SPECIAL_KEYS = new Set(["1330", "1333", "2690", "2693"]);

// ---- 読み込み ----
const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name) && existsSync(path.join(DATA_DIR, e.name, "player-game-index.json.gz")))
  .map((e) => e.name)
  .sort();
check("索引のあるシーズンが2016-17〜", seasons.length >= 11 && seasons[0] === "2016-17", seasons.join(","));

const pViews: PlayerGameIndexView[] = [];
const tViews: TeamGameIndexView[] = [];
for (const s of seasons) {
  const pf = (await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, s, "player-game-index.json")))!;
  const tf = (await readJson<TeamGameIndexFile>(path.join(DATA_DIR, s, "team-game-index.json")))!;
  pViews.push(viewPlayerGameIndex(pf));
  tViews.push(viewTeamGameIndex(tf));
}
const pViewBySeason = new Map(pViews.map((v) => [v.season, v]));
const tViewBySeason = new Map(tViews.map((v) => [v.season, v]));

const history = (await readJson<DivisionHistoryFile>(path.join(DATA_DIR, "division-history.json")))!;
const rookies = (await readJson<RookieEligibilityFile>(path.join(DATA_DIR, "rookie-eligibility.json")))!;
const teamRankings = (await readJson<LeagueTeamRankingsFile>(path.join(DATA_DIR, "league-team-rankings.json")))!;
const leaguePlayerRecords = (await readJson<LeaguePlayerGameRecordsFile>(path.join(DATA_DIR, "league-player-game-records.json")))!;

const playerGamesBySeason = new Map<string, RecordGame[]>();
const teamGamesBySeason = new Map<string, TeamRecordGame[]>();
const positionOf = new Map<string, string | undefined>();
for (const season of seasons) {
  playerGamesBySeason.set(season, await loadSeasonRecordGames(season));
  const summaries = ((await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? []).filter((s) => s.gameType === "regular" || s.gameType === "playoff");
  const keys = new Set(summaries.map((s) => s.scheduleKey));
  const teamDir = path.join(DATA_DIR, season, "team-games");
  const games: TeamRecordGame[] = [];
  const teams = (await readJson<{ teamId: string; teamName: string }[]>(path.join(DATA_DIR, season, "teams.json"))) ?? [];
  const nameById = new Map(teams.map((t) => [t.teamId, t.teamName]));
  for (const f of readdirSync(teamDir).filter((x) => x.endsWith(".json.gz")).sort()) {
    const teamId = f.replace(/\.json\.gz$/, "");
    for (const log of (await readJson<TeamGameLog[]>(path.join(teamDir, `${teamId}.json`))) ?? []) {
      if ((log.gameType !== "regular" && log.gameType !== "playoff") || !keys.has(log.scheduleKey)) continue;
      games.push({ ...log, season, teamId, teamName: nameById.get(teamId) ?? teamId });
    }
  }
  teamGamesBySeason.set(season, games);
  for (const p of (await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, "players.json"))) ?? []) positionOf.set(`${season}:${p.playerId}`, p.position);
}
const allPlayerGames = seasons.flatMap((s) => playerGamesBySeason.get(s)!);
const allTeamGames = seasons.flatMap((s) => teamGamesBySeason.get(s)!);
console.log(`選手の試合 ${allPlayerGames.length}・チームの試合 ${allTeamGames.length}`);

// ---- 1. 条件なしが、今の上位20位のファイルと一致する ----
type Keyed = { rank: number; value: number; key: string };
const sortKeyed = (rows: Keyed[]) => [...rows].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
function sameRows(a: Keyed[], b: Keyed[]): boolean {
  return JSON.stringify(sortKeyed(a)) === JSON.stringify(sortKeyed(b));
}
const brief = (rows: Keyed[]) => JSON.stringify(sortKeyed(rows).slice(0, 4));

const g1p = new Group("個人 条件なし: シーズンの上位20位のファイルと一致（全選手・登録区分別 × 試合区分 × 36項目）");
const g1pAll = new Group("個人 条件なし: 全シーズンの上位20位のファイルと一致");
const recordStats = playerQueryStats("record");
for (const season of seasons) {
  const file = (await readJson<PlayerGameRecordsFile>(path.join(DATA_DIR, season, "player-game-records.json")))!;
  for (const gameType of GAME_TYPES) {
    for (const group of ["all", "日本人", "外国籍・帰化・アジア"] as const) {
      const tables = group === "all" ? file.byGameType : file.byClassification![group === "日本人" ? "jp" : "intl"];
      for (const stat of recordStats) {
        const rows = queryPlayerGameRecords({ views: [pViewBySeason.get(season)!], gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, group, positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat, includeSpecial: true }).rows;
        const mine = rows.map((r) => ({ rank: r.rank, value: r.value, key: `${r.scheduleKey}-${r.playerId}` }));
        const theirs = (tables[gameType][stat.key] ?? []).map((r) => ({ rank: r.rank, value: r.value, key: `${r.scheduleKey}-${r.playerId}` }));
        g1p.add(sameRows(mine, theirs), () => `${season} ${gameType} ${group} ${stat.key}: 索引 ${brief(mine)} / ファイル ${brief(theirs)}`);
      }
    }
  }
}
for (const gameType of GAME_TYPES) {
  for (const group of ["all", "日本人", "外国籍・帰化・アジア"] as const) {
    const tables = group === "all" ? leaguePlayerRecords.byGameType : leaguePlayerRecords.byClassification![group === "日本人" ? "jp" : "intl"];
    for (const stat of recordStats) {
      const rows = queryPlayerGameRecords({ views: pViews, gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, group, positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat, includeSpecial: true }).rows;
      const key = (r: { scheduleKey: string; playerId: string; season?: string }) => `${r.season}-${r.scheduleKey}-${r.playerId}`;
      const mine = rows.map((r) => ({ rank: r.rank, value: r.value, key: key(r) }));
      const theirs = (tables[gameType][stat.key] ?? []).map((r) => ({ rank: r.rank, value: r.value, key: key(r) }));
      g1pAll.add(sameRows(mine, theirs), () => `歴代 ${gameType} ${group} ${stat.key}: 索引 ${brief(mine)} / ファイル ${brief(theirs)}`);
    }
  }
}
g1p.report();
g1pAll.report();

const g1tAll = new Group("チーム 条件なし: 全シーズンの上位20位のファイルと一致（記録・ワースト・被記録・クォーター別 × 試合区分）");
const g1tSeason = new Group("チーム 条件なし: シーズンの全クラブの試合ログから作る一覧と一致");
for (const mode of ["record", "worst", "against"] as TeamRecordMode[]) {
  for (const item of teamRecordItems(mode)) {
    const stat = teamQueryStat(mode, item.key)!;
    for (const gameType of GAME_TYPES) {
      const mine = queryTeamGameRecords({ views: tViews, gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, statConditions: DEFAULT_STAT_CONDITIONS, stat, includeSpecial: true }).rows;
      const fileRows: TeamGameRecordRow[] = allTimeTeamRecordRows(teamRankings, null, mode, gameType, item.key, (id) => id);
      const key = (r: TeamGameRecordRow) => `${r.season}-${r.scheduleKey}-${r.teamId}-${JSON.stringify(r.detail ?? null)}`;
      const theirs = fileRows.map((r) => ({ rank: r.rank, value: r.value, key: key(r) }));
      g1tAll.add(sameRows(mine.map((r) => ({ rank: r.rank, value: r.value, key: key(r) })), theirs), () => `歴代 ${mode} ${gameType} ${item.key}: 索引 ${brief(mine.map((r) => ({ rank: r.rank, value: r.value, key: key(r) })))} / ファイル ${brief(theirs)}`);
    }
  }
}
for (const season of seasons) {
  const view = tViewBySeason.get(season)!;
  for (const mode of ["record", "worst", "against"] as TeamRecordMode[]) {
    for (const item of teamRecordItems(mode)) {
      const stat = teamQueryStat(mode, item.key)!;
      for (const gameType of GAME_TYPES) {
        const mine = queryTeamGameRecords({ views: [view], gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, statConditions: DEFAULT_STAT_CONDITIONS, stat, includeSpecial: true }).rows;
        const theirs = seasonTeamRecordRows(filterByGameType(teamGamesBySeason.get(season)!, gameType), mode, item.key);
        const key = (r: TeamGameRecordRow) => `${r.scheduleKey}-${r.teamId}-${JSON.stringify(r.detail ?? null)}`;
        const a = mine.map((r) => ({ rank: r.rank, value: r.value, key: key(r) }));
        const b = theirs.map((r) => ({ rank: r.rank, value: r.value, key: key(r) }));
        g1tSeason.add(sameRows(a, b), () => `${season} ${mode} ${gameType} ${item.key}: 索引 ${brief(a)} / ログ ${brief(b)}`);
      }
    }
  }
}
g1tAll.report();
g1tSeason.report();

// ---- 2. 試合の条件の判定を、元の試合ログから数え直す ----
const divisionOf = (teamId: string, season: string): string => teamDivisionForSeason(history, teamId, season, "premier") ?? "";
interface LogFacts {
  season: string;
  scheduleKey: string;
  gameType: "regular" | "playoff";
  win: boolean;
  isHome: boolean;
  teamId: string;
  opponentTeamId: string;
  overtimes: number;
  absMargin: number;
  maxLead?: number;
  maxDeficit?: number;
}
function matchesLog(f: LogFacts, c: GameRecordConditions, gameType: SeasonGameTypeFilter, includeSpecial: boolean): boolean {
  if (gameType !== "both" && f.gameType !== gameType) return false;
  if (!includeSpecial && SPECIAL_KEYS.has(f.scheduleKey)) return false;
  if (c.result && (c.result === "win") !== f.win) return false;
  if (c.homeAway && (c.homeAway === "home") !== f.isHome) return false;
  if (c.opponents.length > 0 && !c.opponents.includes(f.opponentTeamId)) return false;
  if (c.overtime === "none" && f.overtimes !== 0) return false;
  if (c.overtime === "any" && f.overtimes < 1) return false;
  if (c.overtime === "1" && f.overtimes !== 1) return false;
  if (c.overtime === "2" && f.overtimes !== 2) return false;
  if (c.overtime === "3" && f.overtimes < 3) return false;
  if (c.marginMin !== undefined && f.absMargin < c.marginMin) return false;
  if (c.marginMax !== undefined && f.absMargin > c.marginMax) return false;
  if (c.margin && !matchesMargin(f, c.margin)) return false;
  if (c.ownDivision && divisionOf(f.teamId, f.season) !== c.ownDivision) return false;
  if (c.oppDivision && divisionOf(f.opponentTeamId, f.season) !== c.oppDivision) return false;
  return true;
}
const playerLogFacts = (g: RecordGame): LogFacts => ({
  season: g.season,
  scheduleKey: g.scheduleKey,
  gameType: g.gameType as "regular" | "playoff",
  win: g.win,
  isHome: g.isHome,
  teamId: g.teamId,
  opponentTeamId: g.opponentTeamId,
  overtimes: gameOvertimes(g) ?? 0,
  absMargin: Math.abs(g.finalMargin ?? 0),
  maxLead: g.maxLead,
  maxDeficit: g.maxDeficit,
});
const teamLogFacts = (g: TeamRecordGame): LogFacts => ({
  season: g.season,
  scheduleKey: g.scheduleKey,
  gameType: g.gameType as "regular" | "playoff",
  win: g.win,
  isHome: g.isHome,
  teamId: g.teamId,
  opponentTeamId: g.opponentTeamId,
  overtimes: gameOvertimes(g) ?? 0,
  absMargin: Math.abs(g.teamScore - g.opponentScore),
  maxLead: g.maxLead,
  maxDeficit: g.maxDeficit,
});

const teamIdsInData = [...new Set(allTeamGames.map((g) => g.teamId))].sort();
const opponentPair = [teamIdsInData[0]!, teamIdsInData[5]!];
const conditionCases: { label: string; c: GameRecordConditions }[] = [
  { label: "勝った試合", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" } },
  { label: "負けた試合", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "loss" } },
  { label: "ホーム", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, homeAway: "home" } },
  { label: "アウェイ", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, homeAway: "away" } },
  { label: "対戦相手2クラブ", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, opponents: opponentPair } },
  { label: "延長なし", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, overtime: "none" } },
  { label: "延長あり", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, overtime: "any" } },
  { label: "延長1本", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, overtime: "1" } },
  { label: "延長2本", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, overtime: "2" } },
  { label: "延長3本以上", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, overtime: "3" } },
  { label: "最終点差 1〜5", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, marginMin: 1, marginMax: 5 } },
  { label: "最終点差 20以上", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, marginMin: 20 } },
  { label: "最終点差 3以下", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, marginMax: 3 } },
  { label: "最終点差 10〜5（該当なし）", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, marginMin: 10, marginMax: 5 } },
  { label: "20点以上リード", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, margin: "lead20" } },
  { label: "10点以上ビハインド", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, margin: "trail10" } },
  { label: "一度も10点差が開かない", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, margin: "close" } },
  { label: "自チーム 東地区", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, ownDivision: "east" } },
  { label: "自チーム 中地区", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, ownDivision: "central" } },
  { label: "自チーム 西地区", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, ownDivision: "west" } },
  { label: "対戦相手 東地区", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, oppDivision: "east" } },
  { label: "対戦相手 西地区", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, oppDivision: "west" } },
  { label: "自チーム 東 × 対戦相手 西", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, ownDivision: "east", oppDivision: "west" } },
  { label: "組み合わせ（勝ち・延長あり・アウェイ・対戦相手 西）", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win", overtime: "any", homeAway: "away", oppDivision: "west" } },
  { label: "組み合わせ（負け・点差5以下・10点以上リード）", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "loss", marginMax: 5, margin: "lead10" } },
];

const g2t = new Group("チーム 試合の条件: 該当する試合の集合が元のログと一致");
const g2p = new Group("個人 試合の条件: 該当する行の集合が元のログと一致");
const ptsDef = TEAM_PTS();
function TEAM_PTS() {
  return teamQueryStat("record", "pts")!;
}
const playerPts = playerQueryStats("record").find((s) => s.key === "pts")!;
for (const { label, c } of conditionCases) {
  for (const gameType of ["regular", "both"] as SeasonGameTypeFilter[]) {
    for (const includeSpecial of [true, false]) {
      // チーム
      const mineT = queryTeamGameRecords({ views: tViews, gameType, conditions: c, statConditions: DEFAULT_STAT_CONDITIONS, stat: ptsDef, includeSpecial, topN: ALL });
      const expT = allTeamGames.filter((g) => matchesLog(teamLogFacts(g), c, gameType, includeSpecial)).map((g) => `${g.season}-${g.scheduleKey}-${g.teamId}`).sort();
      const gotT = mineT.rows.map((r) => `${r.season}-${r.scheduleKey}-${r.teamId}`).sort();
      g2t.add(JSON.stringify(expT) === JSON.stringify(gotT), () => `${label} ${gameType} 特別試合${includeSpecial ? "含む" : "除く"}: 索引 ${gotT.length}件 / ログ ${expT.length}件`);
      // 個人
      const mineP = queryPlayerGameRecords({ views: pViews, gameType, conditions: c, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat: playerPts, includeSpecial, topN: ALL });
      const expP = allPlayerGames.filter((g) => matchesLog(playerLogFacts(g), c, gameType, includeSpecial)).map((g) => `${g.season}-${g.scheduleKey}-${g.playerId}`).sort();
      const gotP = mineP.rows.map((r) => `${r.season}-${r.scheduleKey}-${r.playerId}`).sort();
      g2p.add(JSON.stringify(expP) === JSON.stringify(gotP), () => `${label} ${gameType} 特別試合${includeSpecial ? "含む" : "除く"}: 索引 ${gotP.length}件 / ログ ${expP.length}件`);
    }
  }
}
g2t.report();
g2p.report();

// 地区は行ごとにその試合時点の地区で判定する（歴代）。地区が途中で変わったクラブの例を、シーズンを分けて確かめる
{
  const changed = new Map<string, Set<string>>();
  for (const s of seasons) for (const g of teamGamesBySeason.get(s)!) {
    const set = changed.get(g.teamId) ?? new Set<string>();
    set.add(divisionOf(g.teamId, s));
    changed.set(g.teamId, set);
  }
  const movers = [...changed].filter(([, set]) => set.size > 1).map(([id]) => id);
  check("歴代 地区: 所属地区が変わったクラブがある（地区の判定を確かめる例がある）", movers.length > 0);
  const id = movers[0]!;
  const byDiv = new Map<string, Set<string>>();
  for (const div of ["east", "central", "west"] as const) {
    const rows = queryTeamGameRecords({ views: tViews, gameType: "both", conditions: { ...DEFAULT_GAME_RECORD_CONDITIONS, ownDivision: div }, statConditions: DEFAULT_STAT_CONDITIONS, stat: ptsDef, includeSpecial: true, topN: ALL }).rows.filter((r) => r.teamId === id);
    byDiv.set(div, new Set(rows.map((r) => r.season)));
  }
  const ok = seasons.every((s) => {
    const div = divisionOf(id, s);
    return (["east", "central", "west"] as const).every((d) => (byDiv.get(d)!.has(s) ? div === d : div !== d || !teamGamesBySeason.get(s)!.some((g) => g.teamId === id)));
  });
  check(`歴代 地区: クラブ ${id} の行が、シーズンごとのそのときの地区でだけ出る（${seasons.map((s) => `${s}:${divisionOf(id, s) || "-"}`).join(" ")}）`, ok);
}

// ---- 3. 個人の登録区分・ルーキー・ポジション・スタッツの条件 ----
const rookieSet = (season: string) => new Set(rookies.seasons[season] ?? []);
const g3 = new Group("個人 登録区分・ルーキー・ポジション・スタッツの条件が元のログと一致");
for (const gameType of ["regular", "both"] as SeasonGameTypeFilter[]) {
  const typed = allPlayerGames.filter((g) => gameType === "both" || g.gameType === gameType);
  const run = (group: "all" | "日本人" | "外国籍・帰化・アジア" | "rookie", positions: string[], statConditions: StatConditionsState, extra: GameRecordConditions = DEFAULT_GAME_RECORD_CONDITIONS) =>
    queryPlayerGameRecords({ views: pViews, gameType, conditions: extra, group, positions, statConditions, rookies, stat: playerPts, includeSpecial: true, topN: ALL }).rows.map((r) => `${r.season}-${r.scheduleKey}-${r.playerId}`).sort();
  const expect = (pred: (g: RecordGame) => boolean) => typed.filter(pred).map((g) => `${g.season}-${g.scheduleKey}-${g.playerId}`).sort();
  const same = (a: string[], b: string[]) => JSON.stringify(a) === JSON.stringify(b);

  g3.add(same(run("日本人", [], DEFAULT_STAT_CONDITIONS), expect((g) => g.classKey === "jp")), () => `日本人 ${gameType}`);
  g3.add(same(run("外国籍・帰化・アジア", [], DEFAULT_STAT_CONDITIONS), expect((g) => g.classKey === "intl")), () => `外国籍・帰化・アジア ${gameType}`);
  const rookieRows = run("rookie", [], DEFAULT_STAT_CONDITIONS);
  g3.add(same(rookieRows, expect((g) => g.season > "2016-17" && rookieSet(g.season).has(g.playerId))), () => `ルーキー ${gameType}`);
  g3.add(!rookieRows.some((k) => k.startsWith("2016-17-")) && rookieRows.length > 0, () => `ルーキー ${gameType}: 2016-17の行が混ざる、または0件`);
  const rookieSeason = pViewBySeason.get("2016-17")!;
  g3.add(queryPlayerGameRecords({ views: [rookieSeason], gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "rookie", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat: playerPts, includeSpecial: true }).rows.length === 0, () => `ルーキー 2016-17だけを読んでも0件`);
  for (const positions of [["PG"], ["C/PF"], ["SG", "SF"], ["PG/SG", "SF/PF"]]) {
    const set = new Set(positions);
    g3.add(same(run("all", positions, DEFAULT_STAT_CONDITIONS), expect((g) => { const p = positionOf.get(`${g.season}:${g.playerId}`); return !!p && set.has(positionFilterValue(p)); })), () => `ポジション ${positions.join("・")} ${gameType}`);
  }
  // 組み合わせ（ルーキー × 勝敗 × ポジション）
  const comb: GameRecordConditions = { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" };
  g3.add(same(run("rookie", ["PG", "SG"], DEFAULT_STAT_CONDITIONS, comb), expect((g) => { const p = positionOf.get(`${g.season}:${g.playerId}`); return g.win && g.season > "2016-17" && rookieSet(g.season).has(g.playerId) && !!p && ["PG", "SG"].includes(positionFilterValue(p)); })), () => `ルーキー×勝ち×PG・SG ${gameType}`);
  // スタッツの条件
  const sc = (match: "all" | "any", conds: [string, "gte" | "lte", string][]): StatConditionsState => ({ match, conditions: conds.map(([key, op, value], i) => ({ id: i + 1, key, op, value })) });
  const fgPctRounded = (g: RecordGame) => Math.round((g.fgm / g.fga) * 1000) / 10;
  g3.add(same(run("all", [], sc("all", [["pts", "gte", "20"], ["fgPct", "gte", "50"]])), expect((g) => g.pts >= 20 && g.fga > 0 && fgPctRounded(g) >= 50)), () => `スタッツの条件（すべて: PTS≥20・FG%≥50）${gameType}`);
  g3.add(same(run("all", [], sc("any", [["min", "gte", "35"], ["pts", "gte", "35"]])), expect((g) => g.min >= 35 - 1e-9 || g.pts >= 35)), () => `スタッツの条件（どれか: MIN≥35 または PTS≥35）${gameType}`);
  g3.add(same(run("all", [], sc("all", [["tov", "lte", "0"], ["ast", "gte", "8"]])), expect((g) => g.tov <= 0 && g.ast >= 8)), () => `スタッツの条件（TOV≤0・AST≥8）${gameType}`);
  g3.add(same(run("all", [], sc("all", [["ptsOffTov", "gte", "10"]])), expect((g) => g.ptsOffTov >= 10)), () => `スタッツの条件（PTSOFFTO≥10。2016-17を含む）${gameType}`);
}
g3.report();
check("個人 スタッツの条件の項目に PTSOFFTO・TOV・PF がある", ["ptsOffTov", "tov", "pf"].every((k) => PLAYER_STAT_CONDITION_ITEMS.some((i) => i.key === k)));

// ---- 4. 順位・並びの向き・同じ値の中の並び・N位までの切り方 ----
const g4 = new Group("順位・並び・同じ値の中の並び・20位までの切り方");
function checkRanking<R extends { rank: number; value: number; date: string; scheduleKey: string; made?: number; attempted?: number }>(label: string, rows: R[], all: R[], lowerFirst: boolean, fraction: boolean, dateOldFirst: boolean): void {
  // all は topN=ALL の結果（全件・順位つき）。rows は topN=20 の結果
  const sortedOk = all.every((r, i) => i === 0 || (lowerFirst ? all[i - 1]!.value <= r.value : all[i - 1]!.value >= r.value));
  g4.add(sortedOk, () => `${label}: 値の向き`);
  const ranksOk = all.every((r, i) => r.rank === (i === 0 || r.value !== all[i - 1]!.value ? i + 1 : all[i - 1]!.rank));
  g4.add(ranksOk, () => `${label}: 順位が 1・2・2・4`);
  const cutoff = all.filter((r) => r.rank <= 20);
  g4.add(JSON.stringify(rows.map((r) => [r.rank, r.value, r.scheduleKey])) === JSON.stringify(cutoff.map((r) => [r.rank, r.value, r.scheduleKey])), () => `${label}: 20位までの切り方（${rows.length}件 / ${cutoff.length}件）`);
  g4.add(rows.length === 0 || (rows[rows.length - 1]!.rank <= 20 && (all[rows.length] === undefined || all[rows.length]!.rank > 20)), () => `${label}: 20位と同じ値をすべて含む`);
  const tiesOk = all.every((r, i) => {
    if (i === 0 || r.value !== all[i - 1]!.value) return true;
    const p = all[i - 1]!;
    if (fraction && (p.attempted ?? 0) !== (r.attempted ?? 0)) return (p.attempted ?? 0) > (r.attempted ?? 0);
    return dateOldFirst ? p.date <= r.date : p.date >= r.date;
  });
  g4.add(tiesOk, () => `${label}: 同じ値の中の並び（${fraction ? "試投数の多い順→" : ""}${dateOldFirst ? "古い" : "新しい"}試合から）`);
}
for (const stat of [...playerQueryStats("record"), ...playerQueryStats("worst")] as PlayerQueryStat[]) {
  const q = (topN: number) => queryPlayerGameRecords({ views: pViews, gameType: "both", conditions: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" }, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat, includeSpecial: false, topN });
  checkRanking(`個人 ${stat.key} ${stat.lowerFirst ? "少ない順" : "多い順"}`, q(20).rows, q(ALL).rows, stat.lowerFirst, !!stat.def.fraction, false);
}
for (const mode of ["record", "worst", "against"] as TeamRecordMode[]) {
  for (const item of teamRecordItems(mode)) {
    const stat = teamQueryStat(mode, item.key)!;
    const q = (topN: number) => queryTeamGameRecords({ views: tViews, gameType: "both", conditions: { ...DEFAULT_GAME_RECORD_CONDITIONS, homeAway: "away" }, statConditions: DEFAULT_STAT_CONDITIONS, stat, includeSpecial: false, topN });
    checkRanking(`チーム ${mode} ${item.key}`, q(20).rows, q(ALL).rows, stat.lowerFirst, !!stat.fraction, !!stat.period);
  }
}
g4.report();

// ---- 5. 前後半5分の特別な試合・2016-17のPTSOFFTO ----
{
  const flagged = new Set<string>();
  for (const v of tViews) v.file.games.key.forEach((k, g) => { if ((v.file.games.flags[g]! & 2) !== 0) flagged.add(k); });
  check("前後半5分の特別な試合の旗が、4試合（1330・1333・2690・2693）だけ", flagged.size === 4 && [...flagged].every((k) => SPECIAL_KEYS.has(k)), [...flagged].join(","));
  const tpmWorst = teamQueryStat("worst", "tpm")!;
  const withSp = queryTeamGameRecords({ views: tViews, gameType: "both", conditions: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" }, statConditions: DEFAULT_STAT_CONDITIONS, stat: tpmWorst, includeSpecial: true });
  const noSp = queryTeamGameRecords({ views: tViews, gameType: "both", conditions: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" }, statConditions: DEFAULT_STAT_CONDITIONS, stat: tpmWorst, includeSpecial: false });
  check("チーム ワースト 3PM（勝った試合）: 特別試合を含めると上位に特別試合が入り、除くと入らない（除いた件数は4）", withSp.rows.some((r) => SPECIAL_KEYS.has(r.scheduleKey)) && !noSp.rows.some((r) => SPECIAL_KEYS.has(r.scheduleKey)) && noSp.excludedSpecial === 4 && withSp.excludedSpecial === 0, `含む ${withSp.rows.length}件・除く ${noSp.rows.length}件・除いた ${noSp.excludedSpecial}`);
  const regularOnly = queryTeamGameRecords({ views: tViews, gameType: "regular", conditions: DEFAULT_GAME_RECORD_CONDITIONS, statConditions: DEFAULT_STAT_CONDITIONS, stat: tpmWorst, includeSpecial: false });
  check("レギュラーシーズンだけなら、特別試合（すべてポストシーズン）は除いた件数に出ない", regularOnly.excludedSpecial === 0);
  const personSp = queryPlayerGameRecords({ views: pViews, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat: playerPts, includeSpecial: false });
  const personAll = allPlayerGames.filter((g) => SPECIAL_KEYS.has(g.scheduleKey) && g.min > 0).length;
  check(`個人: 特別試合の行（${personAll}件）がすべて除かれる`, personSp.excludedSpecial === personAll, `${personSp.excludedSpecial} / ${personAll}`);

  const ptsOff = playerQueryStats("record").find((s) => s.key === "ptsOffTov")!;
  const resAll = queryPlayerGameRecords({ views: pViews, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat: ptsOff, includeSpecial: true, topN: ALL });
  check("個人 PTSOFFTO（歴代）: 2016-17の行も入る", resAll.rows.some((r) => r.season === "2016-17"));
  const expectedCount = allPlayerGames.length;
  check("個人 PTSOFFTO（歴代）: すべての行が入る", resAll.rows.length === expectedCount, `${resAll.rows.length} / ${expectedCount}`);
  const only1617 = queryPlayerGameRecords({ views: [pViewBySeason.get("2016-17")!], gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat: ptsOff, includeSpecial: true });
  check("個人 PTSOFFTO（2016-17）: 値のある行がある", only1617.rows.length > 0 && only1617.rows[0]!.value > 0);
  const pftWorst = teamQueryStat("worst", "ptsOffTov")!;
  const tAll = queryTeamGameRecords({ views: tViews, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, statConditions: DEFAULT_STAT_CONDITIONS, stat: pftWorst, includeSpecial: true, topN: ALL });
  check("チーム PTSOFFTO（歴代）: 2016-17の行も入る", tAll.rows.some((r) => r.season === "2016-17"));
}

// ---- 5b. 最大のランと、逆転勝利・逆転負けの最終スコア（DESIGN.md 221章） ----
{
  const runStat = teamQueryStat("record", "maxRun")!;
  const top = queryTeamGameRecords({ views: tViews, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, statConditions: DEFAULT_STAT_CONDITIONS, stat: runStat, includeSpecial: true });
  check("チーム 最大のラン（歴代）: 1位は29点（同点の2試合）", top.rows.filter((r) => r.rank === 1).length === 2 && top.rows[0]!.value === 29, brief(top.rows.map((r) => ({ rank: r.rank, value: r.value, key: r.scheduleKey }))));
  check(
    "チーム 最大のラン: 場所（経過秒・ラン前のスコア）と最終スコアが付き、ラン後のスコアが最終スコアを超えない",
    top.rows.every((r) => !!r.detail && r.detail.runFromSec !== undefined && r.detail.runFromSec <= r.detail.runToSec! && r.detail.runOwnBefore! + r.value <= r.detail.finalOwn && r.detail.runOppBefore! <= r.detail.finalOpp),
  );
  for (const key of ["comebackWin", "blownLeadLoss"]) {
    const st = teamQueryStat("record", key)!;
    const rows = queryTeamGameRecords({ views: tViews, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, statConditions: DEFAULT_STAT_CONDITIONS, stat: st, includeSpecial: true }).rows;
    const wantWin = key === "comebackWin";
    check(`チーム ${key}: 最終スコアが付き、勝敗と合う`, rows.length > 0 && rows.every((r) => !!r.detail && (wantWin ? r.detail.finalOwn > r.detail.finalOpp : r.detail.finalOwn < r.detail.finalOpp) && r.detail.runFromSec === undefined));
  }
  check("チーム 最大のラン以外の項目には添えない", queryTeamGameRecords({ views: tViews, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, statConditions: DEFAULT_STAT_CONDITIONS, stat: ptsDef, includeSpecial: true }).rows.every((r) => r.detail === undefined));
}

// ---- 6. 感度: 条件を1か所間違えると NG になる ----
{
  const c: GameRecordConditions = { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win", homeAway: "away" };
  const mine = queryTeamGameRecords({ views: tViews, gameType: "regular", conditions: c, statConditions: DEFAULT_STAT_CONDITIONS, stat: ptsDef, includeSpecial: true, topN: ALL }).rows.map((r) => `${r.season}-${r.scheduleKey}-${r.teamId}`).sort();
  const right = allTeamGames.filter((g) => matchesLog(teamLogFacts(g), c, "regular", true)).map((g) => `${g.season}-${g.scheduleKey}-${g.teamId}`).sort();
  const wrong = allTeamGames.filter((g) => matchesLog(teamLogFacts(g), { ...c, homeAway: "home" }, "regular", true)).map((g) => `${g.season}-${g.scheduleKey}-${g.teamId}`).sort();
  check("感度: 正しい条件では一致し、会場を取り違えると食い違う", JSON.stringify(mine) === JSON.stringify(right) && JSON.stringify(mine) !== JSON.stringify(wrong));
  const eps = PLAYER_GAME_RECORD_STATS.length;
  check(`個人の項目 ${eps} 件・ワースト ${playerQueryStats("worst").length} 件（成功率6・EFF・+/-・TOV）`, playerQueryStats("worst").map((s) => s.key).join(",") === "fgPct,2pPct,tpPct,ftPct,efgPct,tsPct,eff,plusMinus,tov");
}

if (failures > 0) {
  console.error(`\n${failures} 件の食い違いがあります`);
  process.exit(1);
}
console.log("\nすべて ok");
