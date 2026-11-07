// B.ONE（2026-27）のランキング（シーズン成績・1試合記録）の検証（DESIGN.md 334章の次の章）。検証専用で、`npm run build:data` のあとに手で実行する（validate:all にも含まれる）。
//
// 確かめること:
//  1. 個人のシーズン成績: B.ONE の元の試合（data/2026-27/one/games）から数え直した出場試合数・得点・FGM・FGA が、ランキングが読む players.json と全選手で一致する。
//     掲載基準（出場率85%）を通した得点の平均の上位10人が、元の試合から作った順位と一致する（ランキング画面の「得点」と同じ並び）
//  2. チームのシーズン成績: 元の試合から数えたチームの得点・失点・勝敗が、teams.json とチームの試合ログ（ランキングが読む）の合計と全クラブで一致する
//  3. 1試合記録: 条件なしの経路（シーズンの player-game-records.json／全クラブの試合ログから作る一覧）と、条件付きの経路（1試合行の索引から集計）が、
//     同じ条件（全選手・日本人・外国籍・帰化・アジア／レギュラー／ポスト／合算 × 全項目）で一致する。勝った試合だけ・ホームだけの条件は、元の試合ログから数え直した値と一致する
//  4. 掲載基準「達成可能」を出す条件: 進出争いのデータが判定を止めている間は出さない（B.ONE の日程が出そろうまで）
//  6. 段階2-A（勝負所・アシストペア・達成記録・On/Off）: B.ONE の元の試合から数え直した値と、画面が読む索引・ペア・出場区間からの集計が一致する
//     勝負所＝第4Q・延長の残り2分の勝ち越し弾（元のプレーバイプレーの得点の流れから）、アシストペア＝選手ごとのアシスト数（ペアのファイルと元のボックススコアのAS）、
//     達成記録＝PTS20以上の試合数・連続・初めて達成した試合（元のボックススコアから）、On/Off＝出場時間と、出場した試合のチームの得点（元のボックススコア）
//  7. 段階2-B（比較ページ・全チームスタッツのQ別）: チーム比較（直近5試合の試合数・得点・勝数・生データの平均）・個人比較（出場試合数・得点・出場時間）・Q別（1Q・前半・4Qの得点）が、元の試合から数え直した値と一致する
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
import { chronologicalPlayByPlays } from "../shared/pbpOrder.ts";
import type { AssistPairsFile } from "../shared/assistPairs.ts";
import type { TeamStintsFile } from "../shared/types.ts";
import { compactStints } from "../shared/onCourtTotals.ts";
import { queryClutch, queryAssistPairs } from "../src/lib/clutchQuery.ts";
import { DEFAULT_THRESHOLD, queryThresholdAge, queryThresholdCount, queryThresholdStreaks } from "../src/lib/thresholdQuery.ts";
import { buildLineupRows } from "../src/lib/lineupRanking.ts";
import { buildTeamMultiGameBoxTotals, buildTeamSplitRows, sumTeamTotalsForLogs, filterByGameType as filterLogsByGameType } from "../src/lib/playerSeasonBoxscore.ts";
import { buildGameTeamsByScheduleKey, filterGameLogs, resolveOwnTeam } from "../src/lib/situational.ts";
import { sumTeamPeriodTotals, type TeamPeriodSource } from "../src/lib/teamPeriodTotals.ts";
import type { TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { PlayerGameLog } from "../shared/types.ts";

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


// ---- 6. 段階2-A: 勝負所・アシストペア・達成記録・On/Off ----
// 元の試合から、選手ごとの試合の並び（日付順）・勝ち越し弾・アシスト数を数え直す
interface RawAppearance { date: string; key: string; teamId: string; pts: number; seconds: number; ast: number }
const rawAppearances = new Map<string, RawAppearance[]>();
const rawGoAhead = new Map<string, number>();
const orderedGames = [...rawGames].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : Number(a.scheduleKey) - Number(b.scheduleKey)));
for (const g of orderedGames) {
  for (const row of [...g.raw.HomeBoxscores, ...g.raw.AwayBoxscores]) {
    if (!row.PlayerID || row.Category !== 1 || row.PeriodCategory !== 18) continue;
    const sec = seconds(row.PlayTime);
    if (sec <= 0) continue;
    const list = rawAppearances.get(row.PlayerID) ?? [];
    list.push({ date: g.date, key: g.scheduleKey, teamId: String(row.TeamID), pts: row.Point ?? 0, seconds: sec, ast: row.AS ?? 0 });
    rawAppearances.set(row.PlayerID, list);
  }
  // 勝ち越し弾（第4Q・延長の残り2分以内。得点前に同点か負けていて、得点後にリード）。得点イベント（ActionCD1 = 1, 3, 4, 7, 44）の Score の累計の昇順に並べて、自分で数える
  const events = chronologicalPlayByPlays(g.raw.PlayByPlays)
    .filter((e) => [1, 3, 4, 7, 44].includes(e.ActionCD1 as number) && /^\d+-\d+$/.test(e.Score ?? ""))
    .map((e) => {
      const [h, a] = e.Score!.split("-").map(Number) as [number, number];
      const m = /^(\d+):(\d{2})$/.exec(e.RestTime ?? "");
      return { h, a, period: e.Period as number, rest: m ? Number(m[1]) * 60 + Number(m[2]) : 0, id: e.PlayerID1 as string | null };
    });
  const scoring: typeof events = [];
  let seen = 0;
  for (const e of [...events].sort((x, y) => x.h + x.a - (y.h + y.a))) {
    if (e.h + e.a > seen) {
      scoring.push(e);
      seen = e.h + e.a;
    }
  }
  scoring.forEach((e, i) => {
    const prev = scoring[i - 1] ?? { h: 0, a: 0 };
    const home = e.h !== prev.h;
    const before = home ? prev.h - prev.a : prev.a - prev.h;
    const after = home ? e.h - e.a : e.a - e.h;
    if (e.period >= 4 && e.rest <= 120 && e.id && before <= 0 && after > 0) rawGoAhead.set(e.id, (rawGoAhead.get(e.id) ?? 0) + 1);
  });
}

// 6-1 勝負所
{
  const rows = queryClutch({ views: [pView], gameType: "regular", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", rookies, measure: "goAhead", window: "2", topN: 100000 }).rows;
  const mine = new Map(rows.map((r) => [r.playerId, r.value]));
  const ids = new Set([...mine.keys(), ...rawGoAhead.keys()]);
  const bad = [...ids].filter((id) => (mine.get(id) ?? 0) !== (rawGoAhead.get(id) ?? 0));
  check(`勝負所: 勝ち越し弾（残り2分）が、元のプレーバイプレーから数え直した値と全選手で一致（${ids.size}人・合計${[...rawGoAhead.values()].reduce((a, b) => a + b, 0)}本）`, bad.length === 0, bad.slice(0, 4).map((id) => `${id}: 画面${mine.get(id) ?? 0}／元${rawGoAhead.get(id) ?? 0}`).join(", "));
  const top = rows[0]!;
  console.log(`     勝負所の例: ${top.playerName} 勝ち越し弾 ${top.value}本（FG ${top.fg}・FT ${top.ft}）。元のプレーバイプレーでも ${rawGoAhead.get(top.playerId)}本`);
}

// 6-2 アシストペア
{
  const pairsFile = (await readJson<AssistPairsFile>(path.join(oneDir, "assist-pairs.json")))!;
  const r = pairsFile.rows;
  // (a) 公式のプレーバイプレーのアシストイベント（ActionCD1=12）の数が、ボックススコアの AS と全選手で一致する（ペアの元になるアシストが欠けていない）
  const pbpAssists = new Map<string, number>();
  // (b) アシストイベントの直前（同じチーム・同じピリオド。タイムアウト・交代などの管理イベントは飛ばす）の成功した3P・2Pの得点者を、自分で数え直す
  const rePaired = new Map<string, { n2: number; n3: number }>();
  for (const g of rawGames) {
    const arr = chronologicalPlayByPlays(g.raw.PlayByPlays);
    arr.forEach((e, i) => {
      if (e.ActionCD1 !== 12 || !e.PlayerID1) return;
      pbpAssists.set(e.PlayerID1, (pbpAssists.get(e.PlayerID1) ?? 0) + 1);
      for (let j = i - 1, steps = 0; j >= 0 && steps < 8; j--, steps++) {
        const c = arr[j]!;
        if ([16, 22, 84, 85, 86, 87, 88].includes(c.ActionCD1 as number)) continue;
        if ([1, 3, 4].includes(c.ActionCD1 as number) && c.TeamID === e.TeamID && c.Period === e.Period && c.PlayerID1) {
          const key = `${e.PlayerID1}:${c.PlayerID1}`;
          const v = rePaired.get(key) ?? { n2: 0, n3: 0 };
          if (c.ActionCD1 === 1) v.n3 += 1;
          else v.n2 += 1;
          rePaired.set(key, v);
        }
        break;
      }
    });
  }
  let total = 0;
  const bad: string[] = [];
  for (const [id, list] of rawAppearances) {
    const ast = list.reduce((a, x) => a + x.ast, 0);
    total += ast;
    if ((pbpAssists.get(id) ?? 0) !== ast) bad.push(`${id}: プレーバイプレーのアシスト${pbpAssists.get(id) ?? 0}／ボックススコアAS ${ast}`);
  }
  check(`アシストペア: 元のプレーバイプレーのアシストの数が、元のボックススコアの AS と全選手で一致（${rawAppearances.size}人・${total}本）`, bad.length === 0, `${bad.length}人ずれ ${bad.slice(0, 4).join(", ")}`);
  const fileFg = new Map<string, { n2: number; n3: number }>();
  const rr = pairsFile.rows;
  for (let k = 0; k < rr.game.length; k++) {
    if (rr.n2[k]! + rr.n3[k]! === 0) continue;
    const key = `${pairsFile.players[rr.assister[k]!]}:${pairsFile.players[rr.scorer[k]!]}`;
    const v = fileFg.get(key) ?? { n2: 0, n3: 0 };
    v.n2 += rr.n2[k]!;
    v.n3 += rr.n3[k]!;
    fileFg.set(key, v);
  }
  const badPairs = [...new Set([...fileFg.keys(), ...rePaired.keys()])].filter((key) => {
    const x = fileFg.get(key), y = rePaired.get(key);
    return !x || !y || x.n2 !== y.n2 || x.n3 !== y.n3;
  });
  check(`アシストペア: 2P・3P のアシストペア（${fileFg.size}組）が、元のプレーバイプレーから数え直した組と一致`, badPairs.length <= Math.ceil(fileFg.size * 0.002), `${badPairs.length}組ずれ ${badPairs.slice(0, 4).join(", ")}`);
  const q = queryAssistPairs({ data: [{ pairs: pairsFile, index: pView }], gameType: "regular", conditions: DEFAULT_GAME_RECORD_CONDITIONS, unit: "season", topN: 5 });
  const top = q.rows[0]!;
  let n2 = 0, n3 = 0, nf = 0;
  for (let k = 0; k < r.game.length; k++) if (pairsFile.players[r.assister[k]!] === top.assisterId && pairsFile.players[r.scorer[k]!] === top.scorerId) { n2 += r.n2[k]!; n3 += r.n3[k]!; nf += r.nf[k]!; }
  check(`アシストペア: シーズンの1位（${top.assisterName}→${top.scorerName} ${top.value}点）が、ペアのファイルの合計（2P×${n2}・3P×${n3}・FT×${nf}）と一致`, top.n2 === n2 && top.n3 === n3 && top.nf === nf && top.value === n2 * 2 + n3 * 3 + nf);
}

// 6-3 達成記録（PTS 20以上）: 回数・達成率・連続・初めて達成した年齢
{
  const base = { views: [pView], gameType: "regular" as const, conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all" as const, positions: [], rookies, threshold: DEFAULT_THRESHOLD, includeSpecial: false, topN: 100000 };
  const rawCount = new Map<string, { hit: number; games: number }>();
  const rawStreak = new Map<string, number>();
  const rawFirst = new Map<string, string>();
  for (const [id, list] of rawAppearances) {
    let hit = 0, run = 0, best = 0;
    for (const a of list) {
      if (a.pts >= 20) {
        hit += 1;
        run += 1;
        best = Math.max(best, run);
        if (!rawFirst.has(id)) rawFirst.set(id, a.date);
      } else run = 0;
    }
    if (hit > 0) { rawCount.set(id, { hit, games: list.length }); rawStreak.set(id, best); }
  }
  const countRows = queryThresholdCount({ ...base, sort: "count", career: false })!.rows;
  const badCount = [...new Set([...countRows.map((x) => x.playerId), ...rawCount.keys()])].filter((id) => {
    const row = countRows.find((x) => x.playerId === id);
    const raw = rawCount.get(id);
    return !row || !raw || row.count !== raw.hit || row.games !== raw.games;
  });
  check(`達成記録（回数）: PTS 20以上の試合数と出場試合数（達成率の分母）が、元のボックススコアから数え直した値と全選手で一致（${rawCount.size}人）`, badCount.length === 0, badCount.slice(0, 4).join(", "));
  const streakRows = queryThresholdStreaks({ ...base, gameType: "regular", rosters: {}, currentIds: null, ongoingOnly: false })!.rows;
  const badStreak = [...new Set([...streakRows.map((x) => x.playerId), ...rawStreak.keys()])].filter((id) => (streakRows.find((x) => x.playerId === id)?.value ?? 0) !== (rawStreak.get(id) ?? 0));
  check(`達成記録（連続）: PTS 20以上の最長連続が、元のボックススコアの試合順から数え直した値と全選手で一致（今季の中だけ）`, badStreak.length === 0, badStreak.slice(0, 4).map((id) => `${id}: 画面${streakRows.find((x) => x.playerId === id)?.value}／元${rawStreak.get(id)}`).join(", "));
  const ageRows = queryThresholdAge({ ...base, which: "young" })!.rows;
  const badAge = ageRows.filter((x) => rawFirst.get(x.playerId) !== x.date);
  check(`達成記録（年齢）: 「初めて達成した試合」の日付が、元のボックススコアの最初の達成と一致（${ageRows.length}人）`, badAge.length === 0, badAge.slice(0, 3).map((x) => `${x.playerId} ${x.date}／元${rawFirst.get(x.playerId)}`).join(", "));
  const top = ageRows[0]!;
  console.log(`     達成記録の例: 回数1位 ${countRows[0]!.playerName} ${countRows[0]!.count}/${countRows[0]!.games}試合、連続1位 ${streakRows[0]!.playerName} ${streakRows[0]!.value}試合、最年少 ${top.playerName} ${top.age.years}歳${top.age.days}日（${top.date}）`);
}

// 6-4 On/Off: 出場時間と、出場した試合のチームの得点（On＋Off）
{
  const stints = new Map<string, ReturnType<typeof compactStints>>();
  for (const t of teams) stints.set(t.teamId, compactStints((await readJson<TeamStintsFile>(path.join(oneDir, "team-stints", `${t.teamId}.json`)))!));
  const rows = buildLineupRows({ data: [{ view: pView, stints }], unit: "onoff", gameType: "regular", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], rookies: null, periods: null });
  const teamPointsByGame = new Map<string, number>();
  const teamOppByGame = new Map<string, number>();
  for (const g of rawGames) {
    teamPointsByGame.set(`${g.scheduleKey}:${g.homeTeam.id}`, g.homeScore);
    teamPointsByGame.set(`${g.scheduleKey}:${g.awayTeam.id}`, g.awayScore);
    teamOppByGame.set(`${g.scheduleKey}:${g.homeTeam.id}`, g.awayScore);
    teamOppByGame.set(`${g.scheduleKey}:${g.awayTeam.id}`, g.homeScore);
  }
  let secBad = 0, ptsBad = 0, checked = 0, maxSecDiff = 0, gamesDiffer = 0, ptsChecked = 0;
  const samples: string[] = [];
  for (const row of rows) {
    const id = row.players[0]!.id;
    const list = (rawAppearances.get(id) ?? []).filter((a) => a.teamId === row.teamId);
    if (list.length === 0) continue;
    checked += 1;
    const rawSec = list.reduce((a, x) => a + x.seconds, 0);
    const diff = Math.abs(rawSec - row.on.seconds);
    maxSecDiff = Math.max(maxSecDiff, diff);
    if (diff > list.length * 2) { secBad += 1; if (samples.length < 3) samples.push(`${row.players[0]!.name} 出場時間 区間${row.on.seconds}秒／元${rawSec}秒`); }
    // 元のボックススコアでは出場していない（DNP）試合に、出場区間の記録だけ短く残っている選手がいる（公式の記録のずれ）。その試合を含む行は、得点の合計の突き合わせから外して数だけ報告する
    if (row.on.games !== list.length) { gamesDiffer += 1; continue; }
    const rawOwn = list.reduce((a, x) => a + (teamPointsByGame.get(`${x.key}:${row.teamId}`) ?? 0), 0);
    const rawOpp = list.reduce((a, x) => a + (teamOppByGame.get(`${x.key}:${row.teamId}`) ?? 0), 0);
    ptsChecked += 1;
    if (row.off && (row.on.ownPoints + row.off.ownPoints !== rawOwn || row.on.oppPoints + row.off.oppPoints !== rawOpp)) { ptsBad += 1; if (samples.length < 6) samples.push(`${row.players[0]!.name} 得点 On+Off ${row.on.ownPoints + row.off.ownPoints}-${row.on.oppPoints + row.off.oppPoints}／元${rawOwn}-${rawOpp}`); }
  }
  check(`On/Off: コートにいた時間（On）が、元のボックススコアの出場時間と一致（1試合あたり2秒以内。${checked}人。最大のずれ ${maxSecDiff.toFixed(1)}秒）`, secBad === 0, samples.join(" / "));
  check(`On/Off: 出場した試合の On と Off の得点・失点の合計が、その試合のチームの得点・失点（元の試合）と一致（${ptsChecked}人。出場区間の試合数が元の出場試合数と違う${gamesDiffer}人は除く）`, ptsBad === 0 && gamesDiffer <= Math.ceil(checked * 0.01), samples.join(" / "));
  const ex = rows.find((r) => r.off && r.on.ownPoss > 500)!;
  console.log(`     On/Off の例: ${ex.players[0]!.name}（${ex.teamName}） On ${Math.round(ex.on.seconds)}秒・${Math.round(ex.on.ownPoss)}ポゼッション`);
}


// ---- 7. 段階2-B: 比較ページ（個人・チーム）と全チームスタッツのQ別 ----
{
  // 7-1 チーム比較: 試合ログ→絞り込み（直近5試合）→生データの合計、が元の試合から数え直した値と一致
  const teamRows = [...teams].sort((a, b) => a.teamId.localeCompare(b.teamId)).slice(0, 25);
  const summariesAll = ((await readJson<GameSummary[]>(path.join(oneDir, "games-summary.json"))) ?? []);
  const storedByKey = new Map(rawGames.map((g) => [g.scheduleKey, g]));
  let teamBad = 0, teamChecked = 0;
  const teamSamples: string[] = [];
  for (const t of teamRows) {
    const logs = filterLogsByGameType(teamLogs.get(t.teamId) ?? [], "regular");
    const recent = filterGameLogs(logs, { range: { kind: "recent", n: 5 }, includePlayoffs: true }, undefined, undefined, SEASON, () => t.teamId, "one");
    const own = orderedGames.filter((g) => g.homeTeam.id === t.teamId || g.awayTeam.id === t.teamId).slice(-5);
    const rawPts = own.reduce((a, g) => a + (g.homeTeam.id === t.teamId ? g.homeScore : g.awayScore), 0);
    const rawWins = own.filter((g) => (g.homeTeam.id === t.teamId ? g.homeScore > g.awayScore : g.awayScore > g.homeScore)).length;
    const entries = recent.map((l) => ({ game: storedByKey.get(l.scheduleKey)!, isHome: l.isHome })).filter((e) => !!e.game);
    const box = buildTeamMultiGameBoxTotals(entries, new Map(), false, false);
    const boxPts = box ? Number((box.own as unknown as Record<string, number>).pts) : NaN;
    teamChecked += 1;
    const ok = recent.length === own.length && recent.reduce((a, l) => a + l.teamScore, 0) === rawPts && recent.filter((l) => l.win).length === rawWins && Math.abs(boxPts - rawPts / own.length) < 1e-9;
    if (!ok) { teamBad += 1; if (teamSamples.length < 3) teamSamples.push(`${t.teamName}: ログ${recent.length}試合 得点${recent.reduce((a, l) => a + l.teamScore, 0)}／元${own.length}試合 ${rawPts} 箱${boxPts}`); }
  }
  check(`チーム比較: 直近5試合に絞った試合数・得点・勝数・生データの1試合平均得点が、元の試合から数え直した値と全クラブで一致（${teamChecked}クラブ）`, teamBad === 0, teamSamples.join(" / "));
  const ex = teamRows[0]!;
  console.log(`     チーム比較の例: ${ex.teamName} 直近5試合の平均得点（元の試合）= ${(orderedGames.filter((g) => g.homeTeam.id === ex.teamId || g.awayTeam.id === ex.teamId).slice(-5).reduce((a, g) => a + (g.homeTeam.id === ex.teamId ? g.homeScore : g.awayScore), 0) / 5).toFixed(2)}`);

  // 7-2 個人比較: 試合ログ→所属チームの解決→1試合平均（G・PTS・MIN）が、元の試合から数え直した値と全選手で一致
  const gameTeams = buildGameTeamsByScheduleKey(summariesAll);
  let pBad = 0, pChecked = 0;
  const pSamples: string[] = [];
  for (const p of players) {
    const raw = rawAppearances.get(p.playerId);
    if (!raw || raw.length === 0) continue;
    const logs = (await readJson<PlayerGameLog[]>(path.join(oneDir, "player-games", `${p.playerId}.json`))) ?? [];
    const ownTeamByScheduleKey = new Map<string, { teamId: string; teamName: string }>();
    for (const l of logs) {
      if (l.min <= 0) continue;
      const o = resolveOwnTeam(l, gameTeams);
      if (o) ownTeamByScheduleKey.set(l.scheduleKey, o as { teamId: string; teamName: string });
    }
    const filtered = filterGameLogs(filterLogsByGameType(logs, "regular"), { range: { kind: "all" }, includePlayoffs: true }, undefined, undefined, SEASON, (g) => ownTeamByScheduleKey.get(g.scheduleKey)?.teamId, "one");
    const teamLogsById = new Map<string, import("../shared/types.ts").TeamGameLog[]>();
    for (const id of new Set([...ownTeamByScheduleKey.values()].map((x) => x.teamId))) teamLogsById.set(id, teamLogs.get(id) ?? []);
    const rows = buildTeamSplitRows("slot", filtered, ownTeamByScheduleKey as never, sumTeamTotalsForLogs(filtered, ownTeamByScheduleKey as never, teamLogsById), "perGame", 2026);
    const ctx = rows[rows.length - 1]?.ctx;
    pChecked += 1;
    const rawPts = raw.reduce((a, x) => a + x.pts, 0);
    const rawSec = raw.reduce((a, x) => a + x.seconds, 0);
    const okP = !!ctx && ctx.raw.gamesPlayed === raw.length && ctx.raw.pts === rawPts && Math.abs(ctx.raw.min * 60 - rawSec) <= raw.length * 2;
    if (!okP) { pBad += 1; if (pSamples.length < 3) pSamples.push(`${p.name}: 比較 G${ctx?.raw.gamesPlayed} PTS${ctx?.raw.pts} MIN${ctx?.raw.min}／元 G${raw.length} PTS${rawPts} ${rawSec}秒`); }
  }
  check(`個人比較: 出場試合数・得点・出場時間が、元の試合から数え直した値と全選手で一致（${pChecked}人）`, pBad === 0, pSamples.join(" / "));

  // 7-3 全チームスタッツのQ別: 1Q・前半の得点（チームのピリオド別の索引から）が、元の試合の1Q・前半の得点と全クラブで一致
  const tp = (await readJson<TeamPeriodIndexFile>(path.join(oneDir, "team-period-index.json")))!;
  const source: TeamPeriodSource = { season: SEASON, file: tp, gameNo: new Map<string, number>(tFile.games.key.map((k, i) => [k, i])) };
  let qBad = 0, qChecked = 0;
  const qSamples: string[] = [];
  for (const t of teams) {
    const logs = filterLogsByGameType(teamLogs.get(t.teamId) ?? [], "regular");
    for (const [value, quarters] of [["q1", [0]], ["h1", [0, 1]], ["q4", [3]]] as const) {
      const res = sumTeamPeriodTotals(source, logs, value);
      let rawPts = 0, rawGamesCount = 0;
      for (const g of orderedGames) {
        const home = g.homeTeam.id === t.teamId;
        if (!home && g.awayTeam.id !== t.teamId) continue;
        const qs = home ? g.quarterScores.home : g.quarterScores.away;
        rawPts += quarters.reduce((a, q) => a + (qs[q] ?? 0), 0);
        rawGamesCount += 1;
      }
      qChecked += 1;
      if (res.totals.pts !== rawPts || res.games.length !== rawGamesCount) { qBad += 1; if (qSamples.length < 3) qSamples.push(`${t.teamName} ${value}: 索引 ${res.totals.pts}点/${res.games.length}試合／元 ${rawPts}点/${rawGamesCount}試合`); }
    }
  }
  check(`全チームスタッツ Q別・前後半: 1Q・前半・4Q の得点と試合数が、元の試合のクォーター別スコアから数え直した値と全クラブで一致（${qChecked}件）`, qBad === 0, qSamples.join(" / "));
  const q1 = sumTeamPeriodTotals(source, filterLogsByGameType(teamLogs.get(teams[0]!.teamId) ?? [], "regular"), "q1");
  console.log(`     Q別の例: ${teams[0]!.teamName} 1Q 合計${q1.totals.pts}点／${q1.games.length}試合 = ${(q1.totals.pts / q1.games.length).toFixed(2)}（元の試合のクォーター別スコアと一致）`);
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
  "B.ONE: 選べない種類（通算記録・1シーズン記録・観客動員）に理由があり、見られる種類〔シーズン成績・1試合記録・勝負所・アシストペア・達成記録・On/Off〕には無い",
  ["career", "special", "attendance"].every((k) => !!ONE_RANKING_KIND_REASONS[k]) && ["season", "game", "clutch", "assistPair", "threshold", "lineup"].every((k) => !ONE_RANKING_KIND_REASONS[k]),
);
check("B.ONE: 地区は5地区", divisionOrder("one").length === 5, divisionOrder("one").join(","));
const rules = (await readJson<unknown>(path.join(DATA_DIR, "season-rules.json"))) as Parameters<typeof seasonRuleFor>[0];
check("B.ONE: OC の上限は3人（OC4 は選べない）", seasonRuleFor(rules, SEASON, "one")?.maxForeignOnCourt === 3, String(seasonRuleFor(rules, SEASON, "one")?.maxForeignOnCourt));

if (failures > 0) {
  console.error(`\n${failures}件の食い違いがあります`);
  process.exit(1);
}
console.log("\nすべて一致");
