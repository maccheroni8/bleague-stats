// data/player-careers.json（ランキングの個人「キャリア」カテゴリ）を生成する（DESIGN.md 145章）。
//
// 各シーズンに出場した選手について、そのシーズン終了時点までの累計の回数（在籍シーズン数・所属クラブ数・
// 出場試合数・ポストシーズン／ファイナル出場・優勝・地区優勝・個人賞）を持つ。対象は Bリーグ（2016-17）以降の
// B1／B.PREMIER の記録だけ（B.ONE・B2 は持っていないため数えない）。
//
// - 出場: 試合ログのうち出場時間がある試合（min > 0）。オールスター等は試合ログに含まれない
// - 所属チーム: 試合の要約（games-summary.json）のホーム/アウェイのうち、相手ではない方
// - ファイナル: 試合データにラウンドの区別が無いため、「そのシーズンのポストシーズン最後の試合の2チームどうしの
//   ポストシーズンの試合」とする。優勝チーム（club-honors.json の Bリーグチャンピオンシップ優勝）がその2チームに
//   含まれるシーズンだけ判定する（ポストシーズンの途中のシーズンで準決勝等をファイナルと取り違えないため）
// - 優勝・地区優勝: club-honors.json（overall・division）
// - 個人賞: player-awards.json のうち B2 の賞以外（MVP・ベストファイブ等の区分の無い賞は B1）
//
// 夜間実行で歴代記録の順位と一緒に作り直す。作った時刻以外が前回と同じならファイルを書き換えない。
//
// 使い方:
//   npm run aggregate:player-careers

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import type {
  ClubHonorsFile,
  GameSummary,
  PlayerAwardsFile,
  PlayerCareerCounts,
  PlayerCareersFile,
  PlayerGameLog,
} from "../shared/types.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;

function listSeasonDirs(): string[] {
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
}

/** ファイナルの試合（scheduleKey）。判定できないシーズンは空 */
function finalsScheduleKeys(summaries: GameSummary[], championTeamId: string | undefined): Set<string> {
  const playoff = summaries.filter((g) => g.gameType === "playoff");
  if (!championTeamId || playoff.length === 0) return new Set();
  const last = playoff.reduce((a, b) => (b.date > a.date || (b.date === a.date && Number(b.scheduleKey) > Number(a.scheduleKey)) ? b : a));
  const pair = new Set([last.homeTeamId, last.awayTeamId]);
  if (!pair.has(championTeamId)) return new Set();
  return new Set(playoff.filter((g) => pair.has(g.homeTeamId) && pair.has(g.awayTeamId)).map((g) => g.scheduleKey));
}

interface Running {
  seasons: Set<string>;
  clubs: Set<string>;
  games: number;
  postseasons: Set<string>;
  finals: Set<string>;
  titles: Set<string>;
  divisionTitles: Set<string>;
}

async function main() {
  const honors = (await readJson<ClubHonorsFile>(path.join(DATA_DIR, "club-honors.json"))) ?? {};
  const awards = (await readJson<PlayerAwardsFile>(path.join(DATA_DIR, "player-awards.json"))) ?? {};
  const championBySeason = new Map<string, string>();
  const divisionWinnersBySeason = new Map<string, Set<string>>();
  for (const [teamId, list] of Object.entries(honors)) {
    for (const h of list) {
      if (h.category === "overall") championBySeason.set(h.season, teamId);
      if (h.category === "division") {
        const set = divisionWinnersBySeason.get(h.season) ?? new Set<string>();
        set.add(teamId);
        divisionWinnersBySeason.set(h.season, set);
      }
    }
  }
  const awardsCountThrough = (playerId: string, season: string) =>
    (awards[playerId] ?? []).filter((a) => a.season <= season && a.category !== "B2").length;

  const running = new Map<string, Running>();
  const out: PlayerCareersFile["seasons"] = {};

  for (const season of listSeasonDirs()) {
    const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
    const summaryByKey = new Map(summaries.map((g) => [g.scheduleKey, g]));
    const finals = finalsScheduleKeys(summaries, championBySeason.get(season));
    const champion = championBySeason.get(season);
    const divisionWinners = divisionWinnersBySeason.get(season) ?? new Set<string>();

    const dir = path.join(DATA_DIR, season, "player-games");
    if (!existsSync(dir)) continue;
    const seasonOut: Record<string, PlayerCareerCounts> = {};
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
      const playerId = file.replace(/\.json\.gz$/, "");
      const logs = await readJson<PlayerGameLog[]>(path.join(dir, `${playerId}.json`));
      const played = (logs ?? []).filter((g) => g.min > 0 && (g.gameType === "regular" || g.gameType === "playoff"));
      if (played.length === 0) continue;

      const r = running.get(playerId) ?? {
        seasons: new Set(),
        clubs: new Set(),
        games: 0,
        postseasons: new Set(),
        finals: new Set(),
        titles: new Set(),
        divisionTitles: new Set(),
      };
      r.seasons.add(season);
      for (const g of played) {
        const summary = summaryByKey.get(g.scheduleKey);
        const ownTeamId = summary ? (summary.homeTeamId === g.opponentTeamId ? summary.awayTeamId : summary.homeTeamId) : undefined;
        if (ownTeamId) r.clubs.add(ownTeamId);
        if (g.gameType === "regular") r.games += 1;
        if (g.gameType === "playoff") r.postseasons.add(season);
        if (finals.has(g.scheduleKey)) {
          r.finals.add(season);
          if (ownTeamId === champion) r.titles.add(season);
        }
        if (ownTeamId && divisionWinners.has(ownTeamId)) r.divisionTitles.add(season);
      }
      running.set(playerId, r);
      seasonOut[playerId] = {
        seasons: r.seasons.size,
        clubs: r.clubs.size,
        games: r.games,
        postseasons: r.postseasons.size,
        finals: r.finals.size,
        titles: r.titles.size,
        divisionTitles: r.divisionTitles.size,
        awards: awardsCountThrough(playerId, season),
      };
    }
    out[season] = seasonOut;
    console.log(`${season}: ${Object.keys(seasonOut).length}名（ファイナル${finals.size}試合）`);
  }

  const file: PlayerCareersFile = { generatedAt: new Date().toISOString(), seasons: out };
  const changed = await writeJsonIfChanged(path.join(DATA_DIR, "player-careers.json"), file as unknown as Record<string, unknown>);
  console.log(changed ? "\ndata/player-careers.jsonに保存しました" : "\n内容に変化が無いため data/player-careers.json は書き換えませんでした");
}

main();
