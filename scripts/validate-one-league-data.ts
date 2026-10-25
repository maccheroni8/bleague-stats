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
import type { Category, DivisionHistoryFile, ScheduleFile } from "../shared/types.ts";

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

if (failed > 0) {
  console.error(`\n${failed}件の確認が通りませんでした`);
  process.exitCode = 1;
} else {
  console.log("\nすべての確認が通りました");
}
