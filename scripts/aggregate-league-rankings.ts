// data/league-team-rankings.json（Phase H7、2026-08-29）を生成する。
//
// data/{season}/team-games/{teamId}.json.gz を全B.PREMIERシーズン・全クラブ横断で読み込み、
// 通算成績（CAREER_TOTAL_DEFS）・クラブレコード（TEAM_RECORD_STATS）・シーズン単位の特殊記録
// （最多勝利数・最多連勝）それぞれについて、リーグ全クラブ中の順位を算出する。teamIdはクラブ
// 改称をまたいで不変（2-8章）なので、過去に降格・改称したクラブも含めteamId単位でそのまま
// 合算・比較する。レギュラーシーズンのみ/プレーオフのみ/合算の3パターンを算出する。
//
// npm run aggregateの日次サイクルには含めない。シーズン終了後等に手動実行するバッチ処理
// （ユーザー指定）。B.PREMIERのみが対象（既存の「通算成績」「クラブレコード」タブと同じ
// スコープ。B.ONEは対象外）。
//
// 使い方:
//   npm run aggregate:league-rankings

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJson } from "./lib/storage.ts";
import { filterByGameType } from "../shared/gameType.ts";
import { CAREER_TOTAL_DEFS, TEAM_RECORD_STATS, buildTeamCareerTotals, longestWinStreak } from "../shared/teamRecords.ts";
import type { LeagueRankingGameType, LeagueTeamRankEntry, LeagueTeamRankingsFile, TeamGameLog } from "../shared/types.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;
const GAME_TYPES: LeagueRankingGameType[] = ["regular", "playoff", "both"];

function listSeasonDirs(): string[] {
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
}

interface TeamSeasonLogs {
  season: string;
  logs: TeamGameLog[];
}

/**
 * teamId単位で全シーズン分のTeamGameLogを集める。オールスター/エキシビション専用の
 * 擬似チームID（B.LEAGUE ASIA ALL-STARS等）は、実データ調査で「そのteamIdのTeamGameLogは
 * 全件gameTypeが未分類（null）のまま」という特徴を持つことを確認済み（通常のB.PREMIERクラブは
 * 常にgameType===regular/playoffのいずれかで、これは既存のprocessTeams()の副産物であり
 * team-games自体のバグではない）。そのためgameTypeがregular/playoffの試合が1件も無いteamIdは
 * ここで除外する
 */
async function loadCareerDataByTeam(): Promise<Map<string, TeamSeasonLogs[]>> {
  const byTeam = new Map<string, TeamSeasonLogs[]>();
  for (const season of listSeasonDirs()) {
    const dir = path.join(DATA_DIR, season, "team-games");
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
    for (const file of files) {
      const teamId = file.replace(/\.json\.gz$/, "");
      const logs = await readJson<TeamGameLog[]>(path.join(dir, `${teamId}.json`));
      if (!logs) continue;
      const real = logs.filter((g) => g.gameType === "regular" || g.gameType === "playoff");
      if (real.length === 0) continue;
      const arr = byTeam.get(teamId) ?? [];
      arr.push({ season, logs: real });
      byTeam.set(teamId, arr);
    }
  }
  return byTeam;
}

function buildRankTable(entries: { teamId: string; value: number }[]): Record<string, LeagueTeamRankEntry> {
  const sorted = [...entries].sort((a, b) => b.value - a.value || Number(a.teamId) - Number(b.teamId));
  const totalTeams = sorted.length;
  const table: Record<string, LeagueTeamRankEntry> = {};
  sorted.forEach((e, i) => {
    table[e.teamId] = { value: e.value, rank: i + 1, totalTeams };
  });
  return table;
}

async function main() {
  const careerDataByTeam = await loadCareerDataByTeam();
  console.log(`対象クラブ数（オールスター等の擬似チームを除く）: ${careerDataByTeam.size}`);

  const career: Record<LeagueRankingGameType, Record<string, Record<string, LeagueTeamRankEntry>>> = {
    regular: {},
    playoff: {},
    both: {},
  };
  const clubRecord: Record<LeagueRankingGameType, Record<string, Record<string, LeagueTeamRankEntry>>> = {
    regular: {},
    playoff: {},
    both: {},
  };
  const seasonSpecial: Record<LeagueRankingGameType, Record<"wins" | "streak", Record<string, LeagueTeamRankEntry>>> = {
    regular: { wins: {}, streak: {} },
    playoff: { wins: {}, streak: {} },
    both: { wins: {}, streak: {} },
  };

  for (const gameType of GAME_TYPES) {
    const careerCollected = new Map<string, { teamId: string; value: number }[]>();
    const recordCollected = new Map<string, { teamId: string; value: number }[]>();
    const winsCollected: { teamId: string; value: number }[] = [];
    const streakCollected: { teamId: string; value: number }[] = [];

    for (const [teamId, seasons] of careerDataByTeam) {
      const flat = seasons.flatMap((s) => s.logs);
      const filtered = filterByGameType(flat, gameType);

      if (filtered.length > 0) {
        const totals = buildTeamCareerTotals(filtered);
        for (const def of CAREER_TOTAL_DEFS) {
          const arr = careerCollected.get(def.key) ?? [];
          arr.push({ teamId, value: def.value(totals) });
          careerCollected.set(def.key, arr);
        }

        for (const def of TEAM_RECORD_STATS) {
          const pool = def.filter ? filtered.filter(def.filter) : filtered;
          if (pool.length === 0) continue;
          const best = Math.max(...pool.map(def.value));
          const arr = recordCollected.get(def.key) ?? [];
          arr.push({ teamId, value: best });
          recordCollected.set(def.key, arr);
        }
      }

      // シーズン単位の特殊記録（最多勝利数・最多連勝）はシーズンごとに絞ってから求め、
      // その最高値をこのチームの代表値とする（bestTeamSeasonRecord()のvalueだけを使うのと同じ、
      // TeamDetailPage.tsxのclubSeasonAggregates/mostWinsSeasonRecord/longestStreakSeasonRecordと
      // 同じロジック）
      const seasonAggregates = seasons
        .map((s) => {
          const f = filterByGameType(s.logs, gameType);
          return { wins: f.filter((g) => g.win).length, streak: longestWinStreak(f), games: f.length };
        })
        .filter((a) => a.games > 0);
      if (seasonAggregates.length > 0) {
        winsCollected.push({ teamId, value: Math.max(...seasonAggregates.map((a) => a.wins)) });
        streakCollected.push({ teamId, value: Math.max(...seasonAggregates.map((a) => a.streak)) });
      }
    }

    for (const [key, entries] of careerCollected) career[gameType][key] = buildRankTable(entries);
    for (const [key, entries] of recordCollected) clubRecord[gameType][key] = buildRankTable(entries);
    seasonSpecial[gameType].wins = buildRankTable(winsCollected);
    seasonSpecial[gameType].streak = buildRankTable(streakCollected);

    console.log(
      `[${gameType}] career対象クラブ数(wins基準)=${Object.keys(career[gameType].wins ?? {}).length} / ` +
        `clubRecord対象クラブ数(pts基準)=${Object.keys(clubRecord[gameType].pts ?? {}).length} / ` +
        `seasonSpecial対象クラブ数(wins基準)=${Object.keys(seasonSpecial[gameType].wins).length}`,
    );
  }

  const file: LeagueTeamRankingsFile = {
    generatedAt: new Date().toISOString(),
    career,
    clubRecord,
    seasonSpecial,
  };

  await writeJson(path.join(DATA_DIR, "league-team-rankings.json"), file);
  console.log("\ndata/league-team-rankings.jsonに保存しました");
}

main();
