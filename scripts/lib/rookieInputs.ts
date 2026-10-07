// ルーキーの判定（shared/rookieEligibility.ts）の入力を、data/ から集める（集計 aggregate-rookie-eligibility.ts と、検証 validate-rookie-eligibility.ts が共有）。
// 導出データ（選手のキャリア・各シーズンの試合の要約・選手の試合ログ）を読むので、`npm run build:data` で作った後に使う。DESIGN.md 214・215章
//
// 最初のベンチ入り: 選手の試合ログ（B1。レギュラーシーズンの、出場時間0でもボックススコアに名前がある試合を含む）のうち日付が一番早い試合が、
// その試合の所属クラブ（試合の要約のホーム・アウェイのうち相手ではない方）の、レギュラーシーズンの終了した試合を日付・試合IDの順に並べた何試合目か
// 出場試合数: レギュラーシーズンの試合ログのうち、出場時間がある試合。所属チームの試合数は shared/rookieGames.ts の数え方
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./storage.ts";
import { readClubHistory } from "./clubHistory.ts";
import type { GameSummary, PlayerCareersFile, PlayerGameLog, PlayerMasterEntry } from "../../shared/types.ts";
import type { RookieInput, RookieSeasonGames } from "../../shared/rookieEligibility.ts";
import { teamGamesDuringTenure, type PlayerTeamGame } from "../../shared/rookieGames.ts";

interface SeasonFacts {
  /** 最初のベンチ入りがクラブの何試合目か（ベンチ入りが無ければ無し） */
  firstBenchNo?: number;
  gamesPlayed: number;
  teamGames: number;
}

/** シーズン → 選手ID → 最初のベンチ入り・出場試合数・所属チームの試合数 */
async function seasonFacts(season: string): Promise<Map<string, SeasonFacts>> {
  const result = new Map<string, SeasonFacts>();
  const summaries = ((await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? []).filter(
    (g) => g.gameType === "regular" && g.gameEndedFlg,
  );
  const byTeam = new Map<string, GameSummary[]>();
  for (const g of summaries) for (const t of [g.homeTeamId, g.awayTeamId]) (byTeam.get(t) ?? byTeam.set(t, []).get(t)!).push(g);
  const gameNoOf = new Map<string, number>(); // "チームID:scheduleKey" → 何試合目
  const teamGameDates = new Map<string, string[]>();
  for (const [teamId, games] of byTeam) {
    games
      .sort((a, b) => a.date.localeCompare(b.date) || Number(a.scheduleKey) - Number(b.scheduleKey))
      .forEach((g, i) => gameNoOf.set(`${teamId}:${g.scheduleKey}`, i + 1));
    teamGameDates.set(teamId, games.map((g) => g.date));
  }
  const summaryByKey = new Map(summaries.map((g) => [g.scheduleKey, g]));
  const dir = path.join(DATA_DIR, season, "player-games");
  if (!existsSync(dir)) return result;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
    const playerId = file.replace(/\.json\.gz$/, "");
    const logs = (await readJson<PlayerGameLog[]>(path.join(dir, `${playerId}.json`))) ?? [];
    let best: { date: string; no: number } | null = null;
    let gamesPlayed = 0;
    const tenure: PlayerTeamGame[] = [];
    for (const g of logs) {
      if (g.gameType !== "regular") continue;
      const s = summaryByKey.get(g.scheduleKey);
      if (!s) continue;
      const teamId = g.isHome ? s.homeTeamId : s.awayTeamId;
      tenure.push({ date: g.date, teamId });
      if (g.min > 0) gamesPlayed += 1;
      const no = gameNoOf.get(`${teamId}:${g.scheduleKey}`);
      if (no === undefined) continue;
      if (best === null || g.date < best.date || (g.date === best.date && no < best.no)) best = { date: g.date, no };
    }
    if (tenure.length === 0) continue;
    result.set(playerId, { firstBenchNo: best?.no, gamesPlayed, teamGames: teamGamesDuringTenure(tenure, teamGameDates) });
  }
  return result;
}

export interface RookieInputs {
  /** 選手ID → 判定の入力 */
  players: Map<string, RookieInput>;
  names: Map<string, string>;
  /** 履歴を取得できている選手の人数（履歴ファイル全体） */
  historyCount: number;
}

export async function loadRookieInputs(): Promise<RookieInputs> {
  const careers = (await readJson<PlayerCareersFile>(path.join(DATA_DIR, "player-careers.json")))?.seasons ?? {};
  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const history = await readClubHistory();
  const masterOf = new Map(master.map((p) => [p.playerId, p]));

  const seasons = Object.keys(careers).sort();
  const registered = new Map<string, string[]>();
  for (const season of seasons) for (const id of Object.keys(careers[season]!)) (registered.get(id) ?? registered.set(id, []).get(id)!).push(season);

  const facts = new Map<string, Map<string, SeasonFacts>>(); // 選手ID → シーズン → 最初のベンチ入り・出場試合数・所属チームの試合数
  for (const season of seasons) {
    for (const [id, f] of await seasonFacts(season)) (facts.get(id) ?? facts.set(id, new Map()).get(id)!).set(season, f);
  }

  const players = new Map<string, RookieInput>();
  for (const [id, regSeasons] of registered) {
    const byseason = facts.get(id) ?? new Map<string, SeasonFacts>();
    const firstBenchGameNo: Record<string, number | undefined> = {};
    const games: Record<string, RookieSeasonGames | undefined> = {};
    for (const [season, f] of byseason) {
      firstBenchGameNo[season] = f.firstBenchNo;
      games[season] = { gamesPlayed: f.gamesPlayed, teamGames: f.teamGames };
    }
    players.set(id, {
      classification: masterOf.get(id)?.classification,
      birthDate: masterOf.get(id)?.birthDate,
      registeredSeasons: regSeasons,
      history: history.players[id],
      firstBenchGameNo,
      games,
    });
  }
  return { players, names: new Map(master.map((p) => [p.playerId, p.name])), historyCount: Object.keys(history.players).length };
}
