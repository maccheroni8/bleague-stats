// B.ONE（旧B2を含む。内部のカテゴリは "one"）の元データが B.PREMIER と混ざっていないかと、B.ONE のクラブのロゴ・色がそろっているかの検証（DESIGN.md 14章）。
// データだけで動く（外のサイトに問い合わせない）。
//
// 1. data/{season}/one/games の試合: 大会名に B.PREMIER（B1）の名前が無い（2026-27 以降は「B.LEAGUE ONE」）、
//    ホーム・アウェーとも、そのシーズンの B.ONE の地区表（division-history.json の one）にあるクラブ。オールスター等は除く
// 2. data/{season}/games（B.PREMIER）の試合に、B.ONE・B2 の大会名が無い
// 3. 同じシーズンで、B.PREMIER と B.ONE の試合番号・日程の試合番号が重ならない
// 4. B.ONE の試合があるシーズンには、B.ONE の日程（one/schedule.json）があり、試合は日程の試合番号に含まれる
// 5. 2026-27 の B.ONE の25クラブ（ONE_TEAM_DIVISIONS）すべてに、ロゴのコード・ロゴのファイルがある。B.PREMIER に在籍したことの無いクラブは色もある。
//    ロゴのコードは重ならない
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, listStoredScheduleKeys, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { isExhibitionGame } from "./lib/exhibitionGames.ts";
import { ONE_TEAM_DIVISIONS } from "./lib/divisions.ts";
import { TEAM_LOGO_CODES } from "./lib/teamLogoCodes.ts";
import type { Category, DivisionHistoryFile, HeadToHeadTeamRow, PlayoffRaceFile, ScheduleFile, StandingsSnapshot, TeamGameLog } from "../shared/types.ts";
import { teamShortName } from "../shared/teamNames.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}

const PREMIER_NAME = /PREMIER|B1/;
const ONE_NAME = /B\.LEAGUE ONE|B2/;

const history = (await readJson<DivisionHistoryFile>(path.join(DATA_DIR, "division-history.json")))!;
const seasons = readdirSync(DATA_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();

async function scheduleKeys(season: string, category: Category): Promise<Set<string> | null> {
  const s = await readJson<ScheduleFile & { cancelledGames?: { scheduleKey: string }[]; resultOnlyGames?: { scheduleKey: string }[] }>(
    path.join(DATA_DIR, seasonDirName(season, category), "schedule.json"),
  );
  if (!s) return null;
  return new Set([
    ...s.scheduleKeys,
    ...(s.upcomingGames ?? []).map((g) => g.scheduleKey),
    ...(s.cancelledGames ?? []).map((g) => g.scheduleKey),
    ...(s.resultOnlyGames ?? []).map((g) => g.scheduleKey),
  ]);
}

let oneSeasons = 0;
for (const season of seasons) {
  if (!existsSync(path.join(DATA_DIR, season, "one", "games"))) continue;
  oneSeasons += 1;
  const games = await readAllGames(season, "one");
  const teams = new Set(Object.keys(history.one?.[season] ?? {}));
  const league = games.filter((g) => !isExhibitionGame(g.raw.Game.ConventionNameJ));
  const wrongName = league.filter((g) => {
    const name = g.raw.Game.ConventionNameJ;
    return PREMIER_NAME.test(name) || !ONE_NAME.test(name) || (season >= "2026-27" && !name.includes("B.LEAGUE ONE"));
  });
  check(`${season} B.ONE: 大会名が B.ONE（B2）の試合だけ（${league.length}試合）`, wrongName.length === 0, wrongName.slice(0, 5).map((g) => `${g.scheduleKey} ${g.raw.Game.ConventionNameJ}`).join(", "));
  const outside = league.filter((g) => !teams.has(g.homeTeam.id) || !teams.has(g.awayTeam.id));
  check(`${season} B.ONE: 両チームがその季の B.ONE の地区表にある`, teams.size > 0 && outside.length === 0, outside.slice(0, 5).map((g) => `${g.scheduleKey} ${g.homeTeam.name}-${g.awayTeam.name}`).join(", "));

  // オールスター等（isExhibitionGame）は両方の日程に載ることがある（2025-26 のオールスター・ASIA CROSS TOURNAMENT）ので、重なりの確認から外す
  const exhibitionKeys = new Set(games.filter((g) => isExhibitionGame(g.raw.Game.ConventionNameJ)).map((g) => g.scheduleKey));
  const premierKeys = await listStoredScheduleKeys(season, "premier");
  const overlap = league.filter((g) => premierKeys.has(g.scheduleKey));
  check(`${season}: B.PREMIER と B.ONE の試合番号が重ならない（オールスター等を除く）`, overlap.length === 0, overlap.map((g) => g.scheduleKey).join(", "));

  const oneSchedule = await scheduleKeys(season, "one");
  check(`${season} B.ONE: 日程（one/schedule.json）がある`, oneSchedule !== null);
  if (oneSchedule) {
    const missing = league.filter((g) => !oneSchedule.has(g.scheduleKey));
    check(`${season} B.ONE: 試合はすべて B.ONE の日程に載っている`, missing.length === 0, missing.slice(0, 5).map((g) => g.scheduleKey).join(", "));
    const premierSchedule = (await scheduleKeys(season, "premier")) ?? new Set<string>();
    const both = [...oneSchedule].filter((k) => premierSchedule.has(k) && !exhibitionKeys.has(k));
    check(`${season}: B.PREMIER と B.ONE の日程の試合番号が重ならない（オールスター等を除く）`, both.length === 0, both.slice(0, 10).join(", "));
  }
}
check("B.ONE の試合があるシーズンが1つ以上ある", oneSeasons > 0);

// 2. B.PREMIER 側に B.ONE の試合が紛れていない
for (const season of seasons) {
  if (!existsSync(path.join(DATA_DIR, season, "games"))) continue;
  const games = await readAllGames(season, "premier");
  const wrong = games.filter((g) => /B\.LEAGUE ONE|B2リーグ|B2 PLAYOFFS|B2プレーオフ/.test(g.raw.Game.ConventionNameJ ?? ""));
  check(`${season} B.PREMIER: B.ONE・B2 の試合が混ざっていない（${games.length}試合）`, wrong.length === 0, wrong.slice(0, 5).map((g) => `${g.scheduleKey} ${g.raw.Game.ConventionNameJ}`).join(", "));
}

// 5. B.ONE のクラブのロゴ・色
{
  const colors = (await readJson<Record<string, { primary: string; secondary: string }>>(path.join(DATA_DIR, "team-colors.json"))) ?? {};
  const everPremier = new Set(Object.values(history.premier ?? {}).flatMap((t) => Object.keys(t)));
  const ids = Object.keys(ONE_TEAM_DIVISIONS);
  const noCode = ids.filter((id) => !TEAM_LOGO_CODES[id]);
  check(`B.ONE の${ids.length}クラブすべてにロゴのコードがある`, ids.length === 25 && noCode.length === 0, noCode.join(", "));
  const noFile = ids.filter((id) => !existsSync(path.join(DATA_DIR, "logos", `${id}.png`)));
  check("B.ONE のクラブすべてにロゴのファイルがある", noFile.length === 0, noFile.join(", "));
  const noColor = ids.filter((id) => !everPremier.has(id) && !colors[id]);
  check("B.PREMIER に在籍したことの無い B.ONE のクラブすべてに色がある", noColor.length === 0, noColor.join(", "));
  const codes = Object.values(TEAM_LOGO_CODES);
  const dup = codes.filter((c, i) => codes.indexOf(c) !== i);
  check("ロゴのコードが重ならない", dup.length === 0, dup.join(", "));
}

// 6. B.ONE の導出データ（npm run build:data のあと。2026-27 以降。DESIGN.md 295章）
{
  const season = "2026-27";
  const dir = path.join(DATA_DIR, season, "one");
  if (existsSync(path.join(dir, "games"))) {
    const need = [
      "players.json.gz", "teams.json.gz", "standings-history.json.gz", "head-to-head.json.gz", "assist-pairs.json.gz", "playoff-race.json.gz",
      "registered-players.json.gz", "league-compare.json.gz", "player-game-index.json.gz", "team-game-index.json.gz",
      "player-period-index.json.gz", "team-period-index.json.gz", "team-tts.json.gz", "player-game-records.json.gz",
    ];
    const missing = need.filter((f) => !existsSync(path.join(dir, f)));
    check(`${season} B.ONE: 導出データがそろっている（${need.length}種類）`, missing.length === 0, missing.join(", "));

    const standings = (await readJson<StandingsSnapshot[]>(path.join(dir, "standings-history.json"))) ?? [];
    const latest = standings.at(-1);
    const teams = latest?.teams ?? [];
    const byDivision = new Map<string, number>();
    for (const t of teams) byDivision.set(t.division ?? "-", (byDivision.get(t.division ?? "-") ?? 0) + 1);
    check(`${season} B.ONE: 順位表は25クラブ・5地区×5クラブ`, teams.length === 25 && byDivision.size === 5 && [...byDivision.values()].every((n) => n === 5), JSON.stringify([...byDivision]));
    const pool = teams.filter((t) => (t.divisionRank ?? 99) > 2);
    const poolRanks = pool.map((t) => t.wildcardRank).filter((r): r is number => r !== undefined).sort((a, b) => a - b);
    check(`${season} B.ONE: ワイルドカードの順位は各地区3位以下の15クラブだけに 1〜15`, pool.length === 15 && poolRanks.join(",") === Array.from({ length: 15 }, (_, i) => i + 1).join(","), poolRanks.join(","));
    check(`${season} B.ONE: 各地区1・2位にはワイルドカードの順位が無い`, teams.filter((t) => (t.divisionRank ?? 99) <= 2).every((t) => t.wildcardRank === undefined));

    const race = await readJson<PlayoffRaceFile>(path.join(dir, "playoff-race.json"));
    check(`${season} B.ONE: 進出争いは B.ONE の形式（one-2026）で25クラブ`, race?.format === "one-2026" && race.teams.length === 25, `${race?.format} ${race?.teams.length}`);
    if (race && !race.unavailableReason) {
      const clinched = race.teams.filter((t) => t.clinchedPlayoffs).length;
      check(`${season} B.ONE: 進出確定は16クラブ以下`, clinched <= 16, String(clinched));
    } else {
      console.log(`     ${season} B.ONE: 進出争いの判定は出していない（${race?.unavailableReason ?? "ファイルなし"}）`);
    }

    const h2h = (await readJson<HeadToHeadTeamRow[]>(path.join(dir, "head-to-head.json"))) ?? [];
    const badDiv = h2h.filter((r) => {
      const d = r.vsDivision ?? {};
      const w = Object.values(d).reduce((n, x) => n + (x?.wins ?? 0), 0);
      const l = Object.values(d).reduce((n, x) => n + (x?.losses ?? 0), 0);
      return Object.keys(d).some((k) => !["north", "east", "central", "west", "south"].includes(k)) || w !== r.overall.wins || l !== r.overall.losses;
    });
    check(`${season} B.ONE: 地区ごとの対戦成績の合計が全体の勝敗と一致（${h2h.length}クラブ）`, h2h.length === 25 && badDiv.length === 0, badDiv.map((r) => r.teamId).join(", "));

    // オンザコートの上限（B.ONE は3人）を超える人数の時間が無い
    const over: string[] = [];
    for (const f of readdirSync(path.join(dir, "team-games")).filter((x) => x.endsWith(".json.gz"))) {
      for (const log of (await readJson<TeamGameLog[]>(path.join(dir, "team-games", f.replace(/\.gz$/, "")))) ?? []) {
        const secs = log.foreignCourtSeconds ?? [];
        if (secs.slice(4).some((v) => v > 0)) over.push(`${log.scheduleKey}`);
      }
    }
    check(`${season} B.ONE: オンザコートの人数が上限（3人）を超える時間が無い`, over.length === 0, over.slice(0, 5).join(", "));

    const shortless = Object.keys(ONE_TEAM_DIVISIONS).filter((id) => teamShortName(id, "?") === "?");
    check(`${season} B.ONE: 25クラブすべてに略称がある`, shortless.length === 0, shortless.join(", "));
  }
}

if (failed > 0) {
  console.error(`\n${failed}件の確認が通りませんでした`);
  process.exitCode = 1;
} else {
  console.log("\nすべての確認が通りました");
}
