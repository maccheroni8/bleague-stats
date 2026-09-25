// data/league-team-rankings.json（Phase H7、2026-08-29）を生成する。
//
// data/{season}/team-games/{teamId}.json.gz を全B.PREMIERシーズン・全クラブ横断で読み込み、
// 通算成績（CAREER_TOTAL_DEFS）・クラブレコード（TEAM_RECORD_STATS）・シーズン単位の特殊記録
// （最多勝利数・最多連勝）それぞれについて、リーグ全クラブ中の順位を算出する。teamIdはクラブ
// 改称をまたいで不変（2-8章）なので、過去に降格・改称したクラブも含めteamId単位でそのまま
// 合算・比較する。レギュラーシーズンのみ/プレーオフのみ/合算の3パターンを算出する。
//
// 夜間実行（update-stats.yml のディープrecheck）で aggregate.ts のあとに毎晩実行する（2026-09-25から。それまでは手動実行。
// 作った時刻以外が前回と同じならファイルを書き換えない。DESIGN.md 143-4）。手動でも npm run aggregate:league-rankings で実行できる。B.PREMIERのみが対象（既存の「通算成績」「クラブレコード」タブと同じ
// スコープ。B.ONEは対象外）。
//
// 使い方:
//   npm run aggregate:league-rankings

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import { filterByGameType } from "../shared/gameType.ts";
import { CAREER_TOTAL_DEFS, TEAM_RECORD_STATS, buildTeamCareerTotals, longestWinStreak } from "../shared/teamRecords.ts";
import {
  PERIOD_AVERAGE_STATS,
  PERIOD_KEYS,
  PERIOD_RECORD_KINDS,
  periodAverage,
  periodAverageStatKey,
  periodRecordStatKey,
  rankPeriodGames,
} from "../shared/teamPeriodRecords.ts";
import type {
  LeaguePeriodClubBestEntry,
  LeagueRankingGameType,
  LeagueRecordEntry,
  LeagueTeamRankEntry,
  LeagueTeamRankingsFile,
  TeamGameLog,
} from "../shared/types.ts";

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

/**
 * クラブ間の順位。同じ値は同じ順位にし、次の順位はその分飛ばす（1位・2位・2位・4位。2026-09-25にユーザー指示で、
 * それまでの「同じ値も teamId 昇順で連番」から変更。DESIGN.md 143-3）。同じ値の中の並びは teamId 昇順で決定的にする
 */
function buildRankTable(entries: { teamId: string; value: number }[], lowerIsBetter = false): Record<string, LeagueTeamRankEntry> {
  const sorted = [...entries].sort((a, b) => (lowerIsBetter ? a.value - b.value : b.value - a.value) || Number(a.teamId) - Number(b.teamId));
  const totalTeams = sorted.length;
  const table: Record<string, LeagueTeamRankEntry> = {};
  let rank = 0;
  sorted.forEach((e, i) => {
    if (i === 0 || e.value !== sorted[i - 1]!.value) rank = i + 1;
    table[e.teamId] = { value: e.value, rank, totalTeams };
  });
  return table;
}

interface CategoryRankings {
  career: Record<LeagueRankingGameType, Record<string, Record<string, LeagueTeamRankEntry>>>;
  clubRecord: Record<LeagueRankingGameType, Record<string, Record<string, LeagueTeamRankEntry>>>;
  seasonSpecial: Record<LeagueRankingGameType, Record<"wins" | "streak", Record<string, LeagueTeamRankEntry>>>;
}

/**
 * career/clubRecord/seasonSpecial（レギュラー/プレーオフ/合算×各項目）を、渡されたteamId別
 * 試合ログ（既にホーム/アウェイ等の絞り込みが済んでいる想定）から算出する。
 * 「歴代記録」タブのホーム/アウェイ/トータル切り替え（2026-08-29）用に、venue絞り込み前の
 * 入力を渡すだけで同じロジックを3回（トータル・ホーム・アウェイ）再利用できるよう関数化した
 */
function computeCategoryRankings(careerDataByTeam: Map<string, TeamSeasonLogs[]>): CategoryRankings {
  const career: CategoryRankings["career"] = { regular: {}, playoff: {}, both: {} };
  const clubRecord: CategoryRankings["clubRecord"] = { regular: {}, playoff: {}, both: {} };
  const seasonSpecial: CategoryRankings["seasonSpecial"] = {
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
          const values = pool.map(def.value);
          const best = def.lowerIsBetter ? Math.min(...values) : Math.max(...values);
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
    for (const [key, entries] of recordCollected) {
      const lowerIsBetter = TEAM_RECORD_STATS.find((def) => def.key === key)?.lowerIsBetter ?? false;
      clubRecord[gameType][key] = buildRankTable(entries, lowerIsBetter);
    }
    seasonSpecial[gameType].wins = buildRankTable(winsCollected);
    seasonSpecial[gameType].streak = buildRankTable(streakCollected);
  }

  return { career, clubRecord, seasonSpecial };
}

const TOP_N = 20;

type TeamGameLogWithSeason = TeamGameLog & { season: string };

interface RawRecordCandidate {
  value: number;
  teamId: string;
  season: string;
  scheduleKey?: string;
  date?: string;
  opponentTeamId?: string;
  isHome?: boolean;
}

/**
 * 「B.PREMIER（旧B1）レコード」用（Batch 5）。競技順位方式（同値は同順位、次の順位は
 * その分飛ばす）で上位20位までを返す（20位タイが複数あれば20位超の行数になりうる）。
 * 同値のタイブレークはteamId昇順→日付/シーズン昇順で決定的にする（既存のbuildRankTable()の
 * 「同値はteamId昇順」という方針を踏襲）
 */
function rankTopEntries(candidates: RawRecordCandidate[], lowerIsBetter: boolean): LeagueRecordEntry[] {
  const sorted = [...candidates].sort((a, b) => {
    const diff = lowerIsBetter ? a.value - b.value : b.value - a.value;
    if (diff !== 0) return diff;
    const teamDiff = Number(a.teamId) - Number(b.teamId);
    if (teamDiff !== 0) return teamDiff;
    return (a.date ?? a.season).localeCompare(b.date ?? b.season);
  });
  const result: LeagueRecordEntry[] = [];
  let rank = 0;
  let prevValue: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    if (prevValue === null || c.value !== prevValue) {
      rank = i + 1;
      prevValue = c.value;
    }
    if (rank > TOP_N) break;
    result.push({ rank, ...c });
  }
  return result;
}

/**
 * 「B.PREMIER（旧B1）レコード」タブ用（Batch 5）。career/clubRecord/seasonSpecial
 * （既存、各クラブの自己ベスト値でクラブ間を順位付け・クラブ数上限）とは異なり、
 * こちらは個々の試合・シーズンの記録をチーム横断でそのままトップ20化する
 * （同一クラブが複数回登場しうる）。対象はTEAM_RECORD_STATS・最多勝利数/最多連勝のみ
 * （通算成績・ホーム/アウェイ限定版は対象外、ユーザー指定）
 */
function computeTopRecords(careerDataByTeam: Map<string, TeamSeasonLogs[]>): {
  clubRecordTop20: LeagueTeamRankingsFile["clubRecordTop20"];
  seasonSpecialTop20: LeagueTeamRankingsFile["seasonSpecialTop20"];
} {
  const clubRecordTop20: LeagueTeamRankingsFile["clubRecordTop20"] = { regular: {}, playoff: {}, both: {} };
  const seasonSpecialTop20: LeagueTeamRankingsFile["seasonSpecialTop20"] = {
    regular: { wins: [], streak: [] },
    playoff: { wins: [], streak: [] },
    both: { wins: [], streak: [] },
  };

  for (const gameType of GAME_TYPES) {
    const recordCandidates = new Map<string, RawRecordCandidate[]>();
    const winsCandidates: RawRecordCandidate[] = [];
    const streakCandidates: RawRecordCandidate[] = [];

    for (const [teamId, seasons] of careerDataByTeam) {
      const flat: TeamGameLogWithSeason[] = seasons.flatMap((s) => s.logs.map((g) => ({ ...g, season: s.season })));
      const filtered = filterByGameType(flat, gameType) as TeamGameLogWithSeason[];

      for (const def of TEAM_RECORD_STATS) {
        const pool = def.filter ? filtered.filter(def.filter) : filtered;
        for (const g of pool) {
          const arr = recordCandidates.get(def.key) ?? [];
          arr.push({
            value: def.value(g),
            teamId,
            season: g.season,
            scheduleKey: g.scheduleKey,
            date: g.date,
            opponentTeamId: g.opponentTeamId,
            isHome: g.isHome,
          });
          recordCandidates.set(def.key, arr);
        }
      }

      for (const s of seasons) {
        const f = filterByGameType(s.logs, gameType);
        if (f.length === 0) continue;
        winsCandidates.push({ value: f.filter((g) => g.win).length, teamId, season: s.season });
        streakCandidates.push({ value: longestWinStreak(f), teamId, season: s.season });
      }
    }

    for (const def of TEAM_RECORD_STATS) {
      const candidates = recordCandidates.get(def.key) ?? [];
      clubRecordTop20[gameType][def.key] = rankTopEntries(candidates, def.lowerIsBetter ?? false);
    }
    seasonSpecialTop20[gameType].wins = rankTopEntries(winsCandidates, false);
    seasonSpecialTop20[gameType].streak = rankTopEntries(streakCandidates, false);
  }

  return { clubRecordTop20, seasonSpecialTop20 };
}

/**
 * クォーター別・前後半別（DESIGN.md 143章。延長戦は含めない）。記録側の3種（最多得点・最少失点・最大得失点差）×6区間について、
 * 各クラブの自己ベストでの順位（periodRecord）とリーグ史上の試合の上位20位（periodRecordTop20）、
 * 通算の区間別1試合平均の各クラブの順位（periodCareerAverage）を作る。ホーム/アウェイ限定版は作らない
 */
function computePeriodRankings(careerDataByTeam: Map<string, TeamSeasonLogs[]>): {
  periodRecord: NonNullable<LeagueTeamRankingsFile["periodRecord"]>;
  periodRecordTop20: NonNullable<LeagueTeamRankingsFile["periodRecordTop20"]>;
  periodCareerAverage: NonNullable<LeagueTeamRankingsFile["periodCareerAverage"]>;
} {
  const periodRecord: NonNullable<LeagueTeamRankingsFile["periodRecord"]> = { regular: {}, playoff: {}, both: {} };
  const periodRecordTop20: NonNullable<LeagueTeamRankingsFile["periodRecordTop20"]> = { regular: {}, playoff: {}, both: {} };
  const periodCareerAverage: NonNullable<LeagueTeamRankingsFile["periodCareerAverage"]> = { regular: {}, playoff: {}, both: {} };
  const recordKinds = PERIOD_RECORD_KINDS.filter((k) => k.mode === "record");

  for (const gameType of GAME_TYPES) {
    const teamLogs = [...careerDataByTeam].map(([teamId, seasons]) => ({
      teamId,
      logs: filterByGameType(
        seasons.flatMap((s) => s.logs.map((g) => ({ ...g, season: s.season }))),
        gameType,
      ) as TeamGameLogWithSeason[],
    }));

    for (const period of PERIOD_KEYS) {
      for (const kind of recordKinds) {
        const statKey = periodRecordStatKey(period, kind.key);
        const bests: { teamId: string; value: number; entry: Omit<LeaguePeriodClubBestEntry, "rank" | "totalTeams"> }[] = [];
        const candidates: (RawRecordCandidate & { ownPoints: number; oppPoints: number; fromPbp: boolean })[] = [];
        for (const { teamId, logs } of teamLogs) {
          const ranked = rankPeriodGames(logs, period, kind.key);
          if (ranked.length === 0) continue;
          const top = ranked[0]!;
          bests.push({
            teamId,
            value: top.value,
            entry: {
              value: top.value,
              scheduleKey: top.game.scheduleKey,
              season: top.game.season,
              date: top.game.date,
              opponentTeamId: top.game.opponentTeamId,
              isHome: top.game.isHome,
              ownPoints: top.score.pts,
              oppPoints: top.score.oppPts,
              otherGames: ranked.filter((r) => r.rank === 1).length - 1,
            },
          });
          for (const r of ranked) {
            candidates.push({
              value: r.value,
              teamId,
              season: r.game.season,
              scheduleKey: r.game.scheduleKey,
              date: r.game.date,
              opponentTeamId: r.game.opponentTeamId,
              isHome: r.game.isHome,
              ownPoints: r.score.pts,
              oppPoints: r.score.oppPts,
              fromPbp: r.score.fromPbp,
            });
          }
        }
        // クォーター別は同じ値のクラブが多いので、既存の通算成績・クラブレコード（teamId 順の連番）と違い、同じ値は同じ順位にする
        // （次の順位はその分飛ばす。同じ値の中は記録した日付の古い順）
        const sortedBests = [...bests].sort(
          (a, b) => (kind.lowerFirst ? a.value - b.value : b.value - a.value) || a.entry.date.localeCompare(b.entry.date),
        );
        const table: Record<string, LeaguePeriodClubBestEntry> = {};
        let rank = 0;
        sortedBests.forEach((b, i) => {
          if (i === 0 || b.value !== sortedBests[i - 1]!.value) rank = i + 1;
          table[b.teamId] = { ...b.entry, rank, totalTeams: sortedBests.length };
        });
        periodRecord[gameType][statKey] = table;
        periodRecordTop20[gameType][statKey] = rankTopEntries(candidates, kind.lowerFirst).map((e) => {
          // rankTopEntries は候補の追加の項目（区間の得点・失点）も引き継ぐ。fromPbp は補った試合だけ残す
          const { fromPbp, ...rest } = e as LeagueRecordEntry & { fromPbp?: boolean };
          return fromPbp ? { ...rest, fromPbp } : rest;
        });
      }

      const averages = teamLogs
        .map(({ teamId, logs }) => ({ teamId, avg: periodAverage(logs, period) }))
        .filter((a): a is { teamId: string; avg: NonNullable<typeof a.avg> } => a.avg !== null);
      for (const stat of PERIOD_AVERAGE_STATS) {
        periodCareerAverage[gameType][periodAverageStatKey(period, stat.key)] = buildRankTable(
          averages.map((a) => ({ teamId: a.teamId, value: a.avg[stat.key] })),
          stat.lowerFirst,
        );
      }
    }
  }
  return { periodRecord, periodRecordTop20, periodCareerAverage };
}

/** careerDataByTeamの各チームの試合ログを、指定venue（ホーム/アウェイ）のみに絞り込む。
 * venue===nullはそのまま（トータル、絞り込みなし） */
function filterCareerDataByVenue(
  careerDataByTeam: Map<string, TeamSeasonLogs[]>,
  venue: "home" | "away" | null,
): Map<string, TeamSeasonLogs[]> {
  if (venue === null) return careerDataByTeam;
  const isHome = venue === "home";
  return new Map(
    [...careerDataByTeam].map(([teamId, seasons]) => [
      teamId,
      seasons.map((s) => ({ season: s.season, logs: s.logs.filter((g) => g.isHome === isHome) })),
    ]),
  );
}

async function main() {
  const careerDataByTeam = await loadCareerDataByTeam();
  console.log(`対象クラブ数（オールスター等の擬似チームを除く）: ${careerDataByTeam.size}`);

  const total = computeCategoryRankings(careerDataByTeam);
  const home = computeCategoryRankings(filterCareerDataByVenue(careerDataByTeam, "home"));
  const away = computeCategoryRankings(filterCareerDataByVenue(careerDataByTeam, "away"));
  const { clubRecordTop20, seasonSpecialTop20 } = computeTopRecords(careerDataByTeam);
  const { periodRecord, periodRecordTop20, periodCareerAverage } = computePeriodRankings(careerDataByTeam);
  console.log(
    `[クォーター別レコード] 1Q最多得点の対象クラブ数(regular)=${Object.keys(periodRecord.regular["q1:mostPts"] ?? {}).length} / ` +
      `上位20位の件数(regular, 1Q最多得点)=${periodRecordTop20.regular["q1:mostPts"]?.length ?? 0}`,
  );
  console.log(
    `[B.PREMIERレコード] 得点トップ20件数(regular)=${clubRecordTop20.regular.pts?.length ?? 0} / ` +
      `最多勝利数トップ20件数(regular)=${seasonSpecialTop20.regular.wins.length}`,
  );

  for (const [label, r] of [
    ["total", total],
    ["home", home],
    ["away", away],
  ] as const) {
    console.log(
      `[${label}] career対象クラブ数(wins基準/regular)=${Object.keys(r.career.regular.wins ?? {}).length} / ` +
        `clubRecord対象クラブ数(pts基準/regular)=${Object.keys(r.clubRecord.regular.pts ?? {}).length} / ` +
        `seasonSpecial対象クラブ数(wins基準/regular)=${Object.keys(r.seasonSpecial.regular.wins).length}`,
    );
  }

  const file: LeagueTeamRankingsFile = {
    generatedAt: new Date().toISOString(),
    career: total.career,
    clubRecord: total.clubRecord,
    seasonSpecial: total.seasonSpecial,
    careerHome: home.career,
    careerAway: away.career,
    clubRecordHome: home.clubRecord,
    clubRecordAway: away.clubRecord,
    seasonSpecialHome: home.seasonSpecial,
    seasonSpecialAway: away.seasonSpecial,
    clubRecordTop20,
    seasonSpecialTop20,
    periodRecord,
    periodRecordTop20,
    periodCareerAverage,
  };

  // 作った時刻以外が前回と同じなら書き換えない（夜間実行で変化の無い日にコミット・デプロイを起こさない。DESIGN.md 143-4）
  const changed = await writeJsonIfChanged(path.join(DATA_DIR, "league-team-rankings.json"), file as unknown as Record<string, unknown>);
  if (!changed) {
    console.log("\n内容に変化が無いため、data/league-team-rankings.jsonは書き換えませんでした");
    return;
  }
  console.log("\ndata/league-team-rankings.jsonに保存しました");
}

main();
