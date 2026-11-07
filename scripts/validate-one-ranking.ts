// B.ONE（2026-27）のランキング（シーズン成績・1試合記録）の検証（DESIGN.md 334章の次の章）。検証専用で、`npm run build:data` のあとに手で実行する（validate:all にも含まれる）。
//
// 確かめること:
//  1. 個人のシーズン成績: B.ONE の元の試合（data/2026-27/one/games）から数え直した出場試合数・得点・FGM・FGA が、ランキングが読む players.json と全選手で一致する。
//     掲載基準（出場率85%）を通した得点の平均の上位10人が、元の試合から作った順位と一致する（ランキング画面の「得点」と同じ並び）
//  2. チームのシーズン成績: 元の試合から数えたチームの得点・失点・勝敗が、teams.json とチームの試合ログ（ランキングが読む）の合計と全クラブで一致する
//  3. 1試合記録: 条件なしの経路（シーズンの player-game-records.json／全クラブの試合ログから作る一覧）と、条件付きの経路（1試合行の索引から集計）が、
//     同じ条件（全選手・日本人・外国籍・帰化・アジア／レギュラー／ポスト／合算 × 全項目）で一致する。勝った試合だけ・ホームだけの条件は、元の試合ログから数え直した値と一致する
//  4. 掲載基準「達成可能」を出す条件: 進出争いのデータが判定を止めている間は出さない（B.ONE の日程が出そろうまで）
//  5. B.ONE で選べない種類・カテゴリに理由があり、リーグの範囲（地区5つ・OC上限3）が B.ONE のものになっている
//
// 使い方: npm run validate:one-ranking（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync } from "node:fs";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { isExhibitionGame } from "./lib/exhibitionGames.ts";
import { loadSeasonRecordGames } from "./lib/playerGameRecordsTop.ts";
import { classifyGameType } from "./lib/gameType.ts";
import { filterByGameType, type SeasonGameTypeFilter } from "../shared/gameType.ts";
import type { PlayerGameRecordsFile, PlayerSummary, PlayoffRaceFile, TeamGameLog, TeamSummary, GameSummary } from "../shared/types.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../shared/gameIndex.ts";
import { viewPlayerGameIndex, viewTeamGameIndex } from "../src/lib/gameIndex.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS } from "../src/lib/gameRecordConditions.ts";
import { playerQueryStats, queryPlayerGameRecords, queryTeamGameRecords, teamQueryStat } from "../src/lib/gameRecordQuery.ts";
import { seasonTeamRecordRows, teamRecordItems, type TeamGameRecordRow, type TeamRecordGame, type TeamRecordMode } from "../src/lib/teamGameRecords.ts";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions.ts";
import { filterEligiblePlayers } from "../src/lib/playerRankingEligibility.ts";
import { sumTeamGameLogs } from "../src/lib/teamStatsColumns.ts";
import { ONE_RANKING_KIND_REASONS, ONE_PAGE_AVAILABILITY } from "../src/lib/leagueAvailability.ts";
import { divisionOrder } from "../src/lib/divisionGroups.ts";
import { seasonRuleFor } from "../shared/seasonRules.ts";
import type { RookieEligibilityFile } from "../shared/types.ts";

const SEASON = "2026-27";
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok ${label}`);
  else {
    failures += 1;
    console.error(`NG ${label}${detail ? `\n   ${detail}` : ""}`);
  }
}

const oneDir = path.join(DATA_DIR, seasonDirName(SEASON, "one"));
if (!existsSync(path.join(oneDir, "players.json.gz"))) {
  console.log(`スキップ: ${SEASON} の B.ONE の導出データがありません（先に npm run build:data）`);
  process.exit(0);
}

// ---- 1・2. 元の試合から数え直す ----
const rawGames = (await readAllGames(SEASON, "one")).filter(
  (g) => g.gameEndedFlg && !isExhibitionGame(g.raw.Game.ConventionNameJ) && classifyGameType(g.raw.Game.ConventionNameJ) === "regular",
);
const seconds = (t: string | null | undefined): number => {
  const m = /^(\d+):(\d+)/.exec(t ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
interface Raw {
  gp: number;
  pts: number;
  fgm: number;
  fga: number;
}
const rawPlayers = new Map<string, Raw>();
const rawTeams = new Map<string, { games: number; wins: number; pts: number; oppPts: number }>();
for (const g of rawGames) {
  for (const row of [...g.raw.HomeBoxscores, ...g.raw.AwayBoxscores]) {
    // 試合全体の個人の行（Category=1・PeriodCategory=18。ピリオド別の行は数えない）
    if (!row.PlayerID || row.Category !== 1 || row.PeriodCategory !== 18) continue;
    const sec = seconds(row.PlayTime);
    if (sec <= 0) continue; // 出場時間0の行は数えない（289章）
    const r = rawPlayers.get(row.PlayerID) ?? { gp: 0, pts: 0, fgm: 0, fga: 0 };
    r.gp += 1;
    r.pts += row.Point ?? 0;
    r.fgm += (row.PT2M ?? 0) + (row.PT3M ?? 0);
    r.fga += (row.PT2A ?? 0) + (row.PT3A ?? 0);
    rawPlayers.set(row.PlayerID, r);
  }
  for (const [own, opp, ownScore, oppScore] of [
    [g.homeTeam.id, g.awayTeam.id, g.homeScore, g.awayScore],
    [g.awayTeam.id, g.homeTeam.id, g.awayScore, g.homeScore],
  ] as const) {
    void opp;
    const t = rawTeams.get(own) ?? { games: 0, wins: 0, pts: 0, oppPts: 0 };
    t.games += 1;
    t.wins += ownScore > oppScore ? 1 : 0;
    t.pts += ownScore;
    t.oppPts += oppScore;
    rawTeams.set(own, t);
  }
}
console.log(`元の試合 ${rawGames.length}試合・選手 ${rawPlayers.size}人・クラブ ${rawTeams.size}`);

const players = (await readJson<PlayerSummary[]>(path.join(oneDir, "players.json")))!;
const teams = (await readJson<TeamSummary[]>(path.join(oneDir, "teams.json")))!;
let playerBad = 0;
const playerSamples: string[] = [];
for (const p of players) {
  const raw = rawPlayers.get(p.playerId);
  const ok = !!raw && raw.gp === p.gamesPlayed && raw.pts === p.totals.pts && raw.fgm === p.totals.fgm && raw.fga === p.totals.fga;
  // 出場時間0だけの選手（players.json に行があっても出場0）は、元の試合に出場の行が無い
  const okNoGame = !raw && p.gamesPlayed === 0;
  if (!ok && !okNoGame) {
    playerBad += 1;
    if (playerSamples.length < 4) playerSamples.push(`${p.name}(${p.playerId}) players.json G${p.gamesPlayed} PTS${p.totals.pts} FGM${p.totals.fgm} FGA${p.totals.fga} / 元 ${JSON.stringify(raw)}`);
  }
}
check(`個人: 出場試合数・得点・FGM・FGA が元の試合から数え直した値と全選手で一致（${players.length}人）`, playerBad === 0, playerSamples.join("\n   "));
check("個人: 元の試合に出場した選手がすべて players.json にいる", [...rawPlayers.keys()].every((id) => players.some((p) => p.playerId === id)));

// 掲載基準（出場率85%）を通した得点の平均の上位。ランキング画面の「得点」（平均）と同じ並び
const teamGamesById = new Map(teams.map((t) => [t.teamId, t.gamesPlayed]));
const eligible = filterEligiblePlayers(players, teams, 0.85, "pts", 0);
const rankedByCode = [...eligible].sort((a, b) => b.totals.pts / b.gamesPlayed - a.totals.pts / a.gamesPlayed || a.playerId.localeCompare(b.playerId)).slice(0, 10);
const rawEligible = players
  .filter((p) => {
    const raw = rawPlayers.get(p.playerId);
    const tg = rawTeams.get(p.teamId)?.games ?? 0;
    return !!raw && tg > 0 && raw.gp / tg >= 0.85;
  })
  .map((p) => ({ id: p.playerId, avg: rawPlayers.get(p.playerId)!.pts / rawPlayers.get(p.playerId)!.gp }))
  .sort((a, b) => b.avg - a.avg || a.id.localeCompare(b.id))
  .slice(0, 10);
check(
  "個人: 得点の平均の上位10人（出場率85%以上）が、元の試合から作った順位と一致",
  JSON.stringify(rankedByCode.map((p) => p.playerId)) === JSON.stringify(rawEligible.map((r) => r.id)),
  `画面 ${rankedByCode.map((p) => `${p.name}${(p.totals.pts / p.gamesPlayed).toFixed(2)}`).join(",")} / 元 ${rawEligible.map((r) => `${r.id}:${r.avg.toFixed(2)}`).join(",")}`,
);
check("個人: クラブの試合数（掲載基準の分母）が元の試合の数え直しと一致", teams.every((t) => (rawTeams.get(t.teamId)?.games ?? 0) === (teamGamesById.get(t.teamId) ?? -1)));
console.log(`     ランキング1位の例: ${rankedByCode[0]!.name} ${rankedByCode[0]!.totals.pts}点/${rankedByCode[0]!.gamesPlayed}試合 = ${(rankedByCode[0]!.totals.pts / rankedByCode[0]!.gamesPlayed).toFixed(2)}（元の試合: ${rawPlayers.get(rankedByCode[0]!.playerId)!.pts}点/${rawPlayers.get(rankedByCode[0]!.playerId)!.gp}試合）`);

const teamLogs = new Map<string, TeamGameLog[]>();
for (const t of teams) teamLogs.set(t.teamId, (await readJson<TeamGameLog[]>(path.join(oneDir, "team-games", `${t.teamId}.json`))) ?? []);
let teamBad = 0;
const teamSamples: string[] = [];
for (const t of teams) {
  const raw = rawTeams.get(t.teamId);
  const logs = filterByGameType(teamLogs.get(t.teamId) ?? [], "regular");
  const sum = sumTeamGameLogs(logs);
  const wins = logs.filter((g) => g.win).length;
  const ok =
    !!raw && raw.games === logs.length && raw.wins === wins && raw.pts === sum.pts && raw.oppPts === sum.oppPts && raw.pts === t.totals.pts && raw.games === t.gamesPlayed && raw.wins === t.wins;
  if (!ok) {
    teamBad += 1;
    if (teamSamples.length < 4) teamSamples.push(`${t.teamName}: 元 ${JSON.stringify(raw)} / ログ ${logs.length}試合${wins}勝 得点${sum.pts} 失点${sum.oppPts} / teams.json ${t.gamesPlayed}試合${t.wins}勝 得点${t.totals.pts}`);
  }
}
check(`チーム: 試合数・勝利数・得点・失点が、元の試合・チームの試合ログ・teams.json で全クラブ一致（${teams.length}クラブ）`, teamBad === 0, teamSamples.join("\n   "));
const top = [...teams].sort((a, b) => b.totals.pts / b.gamesPlayed - a.totals.pts / a.gamesPlayed)[0]!;
console.log(`     チームの例: ${top.teamName} 得点 ${rawTeams.get(top.teamId)!.pts}点/${rawTeams.get(top.teamId)!.games}試合 = ${(rawTeams.get(top.teamId)!.pts / rawTeams.get(top.teamId)!.games).toFixed(2)}（ランキング: ${(sumTeamGameLogs(filterByGameType(teamLogs.get(top.teamId)!, "regular")).pts / filterByGameType(teamLogs.get(top.teamId)!, "regular").length).toFixed(2)}）`);

// ---- 3. 1試合記録: 条件なしの経路と、条件付きの経路（索引）が一致する ----
const pFile = (await readJson<PlayerGameIndexFile>(path.join(oneDir, "player-game-index.json")))!;
const tFile = (await readJson<TeamGameIndexFile>(path.join(oneDir, "team-game-index.json")))!;
const pView = viewPlayerGameIndex(pFile);
const tView = viewTeamGameIndex(tFile);
const rookies = (await readJson<RookieEligibilityFile>(path.join(DATA_DIR, "rookie-eligibility.json")))!;
const recordFile = (await readJson<PlayerGameRecordsFile>(path.join(oneDir, "player-game-records.json")))!;
const GAME_TYPES: SeasonGameTypeFilter[] = ["regular", "playoff", "both"];
type Keyed = { rank: number; value: number; key: string };
const sortKeyed = (rows: Keyed[]) => [...rows].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
const same = (a: Keyed[], b: Keyed[]) => JSON.stringify(sortKeyed(a)) === JSON.stringify(sortKeyed(b));
const brief = (rows: Keyed[]) => JSON.stringify(sortKeyed(rows).slice(0, 3));

let pTotal = 0;
let pBad = 0;
const pSamples: string[] = [];
for (const gameType of GAME_TYPES) {
  for (const group of ["all", "日本人", "外国籍・帰化・アジア"] as const) {
    const tables = group === "all" ? recordFile.byGameType : recordFile.byClassification![group === "日本人" ? "jp" : "intl"];
    for (const stat of playerQueryStats("record")) {
      const rows = queryPlayerGameRecords({ views: [pView], gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, group, positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies, stat, includeSpecial: true }).rows;
      const mine = rows.map((r) => ({ rank: r.rank, value: r.value, key: `${r.scheduleKey}-${r.playerId}` }));
      const theirs = (tables[gameType][stat.key] ?? []).map((r) => ({ rank: r.rank, value: r.value, key: `${r.scheduleKey}-${r.playerId}` }));
      pTotal += 1;
      if (!same(mine, theirs)) {
        pBad += 1;
        if (pSamples.length < 4) pSamples.push(`${gameType} ${group} ${stat.key}: 索引 ${brief(mine)} / ファイル ${brief(theirs)}`);
      }
    }
  }
}
check(`個人 1試合記録: 条件なし（上位20位のファイル）と条件付き（索引）が同じ条件で一致（${pTotal}件）`, pBad === 0, pSamples.join("\n   "));

const summaries = ((await readJson<GameSummary[]>(path.join(oneDir, "games-summary.json"))) ?? []).filter((s) => s.gameType === "regular" || s.gameType === "playoff");
const keys = new Set(summaries.map((s) => s.scheduleKey));
const teamGames: TeamRecordGame[] = teams.flatMap((t) =>
  (teamLogs.get(t.teamId) ?? []).filter((log) => (log.gameType === "regular" || log.gameType === "playoff") && keys.has(log.scheduleKey)).map((log) => ({ ...log, season: SEASON, teamId: t.teamId, teamName: t.teamName })),
);
let tTotal = 0;
let tBad = 0;
const tSamples: string[] = [];
for (const mode of ["record", "worst", "against"] as TeamRecordMode[]) {
  for (const item of teamRecordItems(mode)) {
    const stat = teamQueryStat(mode, item.key)!;
    for (const gameType of GAME_TYPES) {
      const mine = queryTeamGameRecords({ views: [tView], gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, statConditions: DEFAULT_STAT_CONDITIONS, stat, includeSpecial: true }).rows;
      const theirs = seasonTeamRecordRows(filterByGameType(teamGames, gameType), mode, item.key);
      const key = (r: TeamGameRecordRow) => `${r.scheduleKey}-${r.teamId}-${JSON.stringify(r.detail ?? null)}`;
      const a = mine.map((r) => ({ rank: r.rank, value: r.value, key: key(r) }));
      const b = theirs.map((r) => ({ rank: r.rank, value: r.value, key: key(r) }));
      tTotal += 1;
      if (!same(a, b)) {
        tBad += 1;
        if (tSamples.length < 4) tSamples.push(`${mode} ${gameType} ${item.key}: 索引 ${brief(a)} / ログ ${brief(b)}`);
      }
    }
  }
}
check(`チーム 1試合記録: 条件なし（全クラブの試合ログ）と条件付き（索引）が同じ条件で一致（${tTotal}件）`, tBad === 0, tSamples.join("\n   "));

// 勝った試合だけ・ホームだけの条件（索引）が、元の試合ログから数え直した値と一致する
const playerGames = await loadSeasonRecordGames(SEASON, "one");
for (const [label, cond, pred] of [
  ["勝った試合だけ", { result: "win" as const }, (g: { win: boolean; isHome: boolean }) => g.win],
  ["ホームだけ", { homeAway: "home" as const }, (g: { win: boolean; isHome: boolean }) => g.isHome],
]) {
  const stat = playerQueryStats("record").find((s) => s.key === "pts")!;
  const rows = queryPlayerGameRecords({
    views: [pView],
    gameType: "regular",
    conditions: { ...DEFAULT_GAME_RECORD_CONDITIONS, ...cond },
    group: "all",
    positions: [],
    statConditions: DEFAULT_STAT_CONDITIONS,
    rookies,
    stat,
    includeSpecial: true,
  }).rows;
  const best = Math.max(...playerGames.filter((g) => g.gameType === "regular" && pred(g)).map((g) => g.pts));
  check(`個人 1試合記録（${label}）: 得点の最高が、元の試合ログの最高（${best}点）と一致`, rows[0]?.value === best, `索引 ${rows[0]?.value}`);
}

// ---- 4. 「達成可能」を出す条件 ----
const race = await readJson<PlayoffRaceFile>(path.join(oneDir, "playoff-race.json"));
const short = (race?.teams ?? []).filter((t) => t.wins + t.losses + t.remaining !== 60);
check(
  "達成可能: 日程が60試合に足りないクラブがある間は、進出争いのデータが判定を止めている（＝B.ONE の「達成可能」を出さない）",
  short.length === 0 || !!race?.unavailableReason,
  `足りないクラブ ${short.length}・判定停止 ${race?.unavailableReason ?? "なし"}`,
);
console.log(`     日程が60試合に足りないクラブ: ${short.length}（${short.map((t) => `${t.teamName}${t.wins + t.losses + t.remaining}`).join("・")}）`);

// ---- 5. B.ONE の範囲 ----
check("B.ONE: ランキングは見られるページ", ONE_PAGE_AVAILABILITY.rankings.ready === true);
check(
  "B.ONE: 選べない種類（通算記録・1シーズン記録・観客動員・勝負所・アシストペア・達成記録・On/Off）すべてに理由がある",
  ["career", "special", "attendance", "clutch", "assistPair", "threshold", "lineup"].every((k) => !!ONE_RANKING_KIND_REASONS[k]) && !ONE_RANKING_KIND_REASONS.season && !ONE_RANKING_KIND_REASONS.game,
);
check("B.ONE: 地区は5地区", divisionOrder("one").length === 5, divisionOrder("one").join(","));
const rules = (await readJson<unknown>(path.join(DATA_DIR, "season-rules.json"))) as Parameters<typeof seasonRuleFor>[0];
check("B.ONE: OC の上限は3人（OC4 は選べない）", seasonRuleFor(rules, SEASON, "one")?.maxForeignOnCourt === 3, String(seasonRuleFor(rules, SEASON, "one")?.maxForeignOnCourt));

if (failures > 0) {
  console.error(`\n${failures}件の食い違いがあります`);
  process.exit(1);
}
console.log("\nすべて一致");
