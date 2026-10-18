// 歴代記録の「1シーズン記録」のワースト側（最多敗戦数・最多連敗）を、試合の一覧（games-summary）から独立に数え直して照らし合わせる（DESIGN.md 269章）。
// 先に npm run build:data（または npm run aggregate:league-rankings）で data/league-team-rankings.json を作っておく。
import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { GameSummary } from "../shared/types.ts";
import type { LeagueSeasonWorstTop20 } from "../shared/leagueSeasonWorst.ts";
import type { ResultOnlyGameEntry } from "../shared/resultOnlyGames.ts";
import { SHORTENED_REGULAR_SEASONS } from "../shared/regularSeasonComplete.ts";

let failed = 0;
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "ok  " : "NG  "} ${label}`);
  if (!ok) failed += 1;
};

const file = await readJson<{ seasonWorstTop20?: LeagueSeasonWorstTop20 }>(path.join(DATA_DIR, "league-team-rankings.json"));
const worst = file?.seasonWorstTop20?.regular;
if (!worst) {
  console.log("seasonWorstTop20 がありません");
  process.exit(1);
}

const seasons = readdirSync(DATA_DIR).filter((n) => /^\d{4}-\d{2}$/.test(n)).sort();
// 試合の一覧から、クラブ・シーズンごとの敗戦数と最長連敗（結果だけの試合も数える）を数える
const stats: { teamId: string; season: string; losses: number; longestLoss: number }[] = [];
for (const season of seasons) {
  const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
  const schedule = await readJson<{ resultOnlyGames?: ResultOnlyGameEntry[] }>(path.join(DATA_DIR, season, "schedule.json"));
  const recorded = new Set(summaries.map((g) => g.scheduleKey));
  const games = [
    ...summaries.filter((g) => g.gameType === "regular" && g.gameEndedFlg),
    ...(schedule?.resultOnlyGames ?? []).filter((g) => g.gameType === "regular" && !recorded.has(g.scheduleKey)),
  ];
  const teams = new Set(games.flatMap((g) => [g.homeTeamId, g.awayTeamId]));
  for (const teamId of teams) {
    const mine = games
      .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
    let cur = 0;
    let longestLoss = 0;
    let lossesRecorded = 0;
    for (const g of mine) {
      const won = g.homeTeamId === teamId ? g.homeScore > g.awayScore : g.awayScore > g.homeScore;
      if (won) cur = 0;
      else {
        cur += 1;
        longestLoss = Math.max(longestLoss, cur);
        if (recorded.has(g.scheduleKey)) lossesRecorded += 1;
      }
    }
    // 敗戦数には結果だけの試合を足さない（クラブレコードと同じ）
    stats.push({ teamId, season, losses: lossesRecorded, longestLoss });
  }
}

const topLoss = [...stats].sort((a, b) => b.longestLoss - a.longestLoss)[0]!;
check(worst.lossStreak[0]?.value === topLoss.longestLoss, `最多連敗の1位が一覧からの数え直しと同じ（${topLoss.longestLoss}連敗）`);
let bad = 0;
for (const e of worst.lossStreak) {
  const s = stats.find((x) => x.teamId === e.teamId && x.season === e.season);
  if (!s || s.longestLoss !== e.value) bad += 1;
}
check(bad === 0, `最多連敗の上位${worst.lossStreak.length}件の値がすべて一致`);
const cutoff = worst.lossStreak.at(-1)!.value;
check(stats.filter((s) => s.longestLoss > cutoff).length === worst.lossStreak.filter((e) => e.value > cutoff).length, "最多連敗: 上位に入る回の取りこぼしが無い");

const counted = stats.filter((s) => !SHORTENED_REGULAR_SEASONS.includes(s.season));
check(worst.losses.every((e) => !SHORTENED_REGULAR_SEASONS.includes(e.season)), "最多敗戦数に短縮シーズン（2019-20〜2021-22）が入っていない");
bad = 0;
for (const e of worst.losses) {
  const s = stats.find((x) => x.teamId === e.teamId && x.season === e.season);
  if (!s || s.losses !== e.value) bad += 1;
}
check(bad === 0, `最多敗戦数の上位${worst.losses.length}件の値がすべて一致`);
const lossCutoff = worst.losses.at(-1)!.value;
const eligible = counted.filter((s) => s.losses > lossCutoff);
check(eligible.every((s) => worst.losses.some((e) => e.teamId === s.teamId && e.season === s.season)), "最多敗戦数: 上位に入る回の取りこぼしが無い（進行中のシーズンは除く）");

console.log(failed === 0 ? "\nすべて ok" : `\n${failed} 件 NG`);
process.exit(failed === 0 ? 0 : 1);
