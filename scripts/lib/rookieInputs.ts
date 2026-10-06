// ルーキーの判定（shared/rookieEligibility.ts）の入力を、data/ から集める（集計 aggregate-rookie-eligibility.ts と、検証 validate-rookie-eligibility.ts が共有）。
// 導出データ（選手のキャリア・各シーズンの試合の要約・選手の試合ログ）を読むので、`npm run build:data` で作った後に使う。DESIGN.md 214章
//
// 最初のベンチ入り: 選手の試合ログ（B1。レギュラーシーズンの、出場時間0でもボックススコアに名前がある試合を含む）のうち日付が一番早い試合が、
// その試合の所属クラブ（試合の要約のホーム・アウェイのうち相手ではない方）の、レギュラーシーズンの終了した試合を日付・試合IDの順に並べた何試合目か

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./storage.ts";
import { readClubHistory } from "./clubHistory.ts";
import type { GameSummary, PlayerAwardsFile, PlayerCareersFile, PlayerGameLog, PlayerMasterEntry } from "../../shared/types.ts";
import type { RookieInput } from "../../shared/rookieEligibility.ts";

/** シーズン → 選手ID → 最初のベンチ入りがクラブの何試合目か */
async function firstBenchGameNumbers(season: string): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const summaries = ((await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? []).filter(
    (g) => g.gameType === "regular" && g.gameEndedFlg,
  );
  const byTeam = new Map<string, GameSummary[]>();
  for (const g of summaries) for (const t of [g.homeTeamId, g.awayTeamId]) (byTeam.get(t) ?? byTeam.set(t, []).get(t)!).push(g);
  const gameNoOf = new Map<string, number>(); // "チームID:scheduleKey" → 何試合目
  for (const [teamId, games] of byTeam) {
    games
      .sort((a, b) => a.date.localeCompare(b.date) || Number(a.scheduleKey) - Number(b.scheduleKey))
      .forEach((g, i) => gameNoOf.set(`${teamId}:${g.scheduleKey}`, i + 1));
  }
  const summaryByKey = new Map(summaries.map((g) => [g.scheduleKey, g]));
  const dir = path.join(DATA_DIR, season, "player-games");
  if (!existsSync(dir)) return result;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
    const playerId = file.replace(/\.json\.gz$/, "");
    const logs = (await readJson<PlayerGameLog[]>(path.join(dir, `${playerId}.json`))) ?? [];
    let best: { date: string; no: number } | null = null;
    for (const g of logs) {
      if (g.gameType !== "regular") continue;
      const s = summaryByKey.get(g.scheduleKey);
      if (!s) continue;
      const teamId = g.isHome ? s.homeTeamId : s.awayTeamId;
      const no = gameNoOf.get(`${teamId}:${g.scheduleKey}`);
      if (no === undefined) continue;
      if (best === null || g.date < best.date || (g.date === best.date && no < best.no)) best = { date: g.date, no };
    }
    if (best) result.set(playerId, best.no);
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
  const awards = (await readJson<PlayerAwardsFile>(path.join(DATA_DIR, "player-awards.json"))) ?? {};
  const history = await readClubHistory();
  const birthDateOf = new Map(master.map((p) => [p.playerId, p.birthDate]));

  const seasons = Object.keys(careers).sort();
  const registered = new Map<string, string[]>();
  for (const season of seasons) for (const id of Object.keys(careers[season]!)) (registered.get(id) ?? registered.set(id, []).get(id)!).push(season);

  const firstBench = new Map<string, Map<string, number>>(); // 選手ID → シーズン → 何試合目
  for (const season of seasons) {
    for (const [id, no] of await firstBenchGameNumbers(season)) (firstBench.get(id) ?? firstBench.set(id, new Map()).get(id)!).set(season, no);
  }

  const players = new Map<string, RookieInput>();
  for (const [id, regSeasons] of registered) {
    players.set(id, {
      birthDate: birthDateOf.get(id),
      registeredSeasons: regSeasons,
      history: history.players[id],
      firstBenchGameNo: Object.fromEntries(firstBench.get(id) ?? []),
      rookieAwardSeasons: new Set((awards[id] ?? []).filter((a) => a.name === "最優秀新人賞").map((a) => a.season)),
    });
  }
  return { players, names: new Map(master.map((p) => [p.playerId, p.name])), historyCount: Object.keys(history.players).length };
}
