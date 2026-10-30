// 在コート基準の再集計で足した材料（DESIGN.md 303章）の検算スクリプト（検証専用。集計の入口からは import しない）。`npm run build:data` のあとに実行する。
//  1. PTS10: players.json の points10Games＝レギュラーシーズンの出場した試合ログのうち PTS が10以上の数（9・10・11点の境目も見る）
//  2. Shooting: 同じ試合のホームの自チーム＝アウェイの相手（逆も）。teams.json の自チーム・相手・対象試合数＝レギュラーシーズンの試合ログの合計。リーグ全体の自チーム＝相手
//  3. FT・3P の連続成功: 試合の要約をつないだ結果（shared/shotStreaks.ts の chainShotStreaks）＝生のプレーバイプレーの試投を、記録が欠けた試合で区切って
//     直接並べた結果（最長・件数・始まりと終わりの試合）。全選手×シーズン×リーグ×試合区分×FT/3P。要約の本数＝公式の本数
//  4. On-Court Foreign（選手）: 全選手の自チームの人数別の秒数の合計＝チームの人数別の在コート秒数×5。相手の人数別も、自チームの区間が試合を覆う試合で
//     相手の人数別の秒数×5。本人の記録の人数別の合計＝プレーバイプレーの本人の記録（区間が試合を覆い、区分の分からない5人組の無い試合）
// 使い方: npm run validate:rebuild-materials
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { classifyGameType } from "./lib/gameType.ts";
import { PLAYER_EVENT_KEYS, onCourtPeriodCount, reconstructOnCourt, substitutionModelForSeason, totalGameSeconds } from "../shared/onCourt.ts";
import { chainShotStreaks, gameShotStreakSummary, shotSequence, type ShotStreakKind } from "../shared/shotStreaks.ts";
import { PLAYER_FOREIGN_OWN_LENGTH, foreignCountInLineup } from "../shared/foreignOnCourt.ts";
import { makeClassifier, type SeasonRegistrationFile } from "../shared/registration.ts";
import { seasonRuleFor } from "../shared/seasonRules.ts";
import type { PlayerMasterEntry, SeasonRules } from "../shared/types.ts";
import type { Category, PlayerForeignFile, PlayerGameLog, PlayerSummary, ShotTypeBreakdown, StoredGame, TeamGameLog, TeamSummary } from "../shared/types.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}
class Group {
  total = 0;
  badCount = 0;
  bad: string[] = [];
  readonly label: string;
  constructor(label: string) {
    this.label = label;
  }
  add(ok: boolean, detail: () => string): void {
    this.total += 1;
    if (!ok) {
      this.badCount += 1;
      if (this.bad.length < 5) this.bad.push(detail());
    }
  }
  report(): void {
    check(`${this.label}（${this.total}件）`, this.badCount === 0, `${this.badCount}件の食い違い\n   ${this.bad.join("\n   ")}`);
  }
}
const g1 = new Group("1. PTS10＝試合ログの PTS 10以上の出場試合の数");
const g2 = new Group("2. Shooting の自チーム・相手・対象試合数");
const g3 = new Group("3. 連続成功（要約をつないだ結果＝プレーバイプレーを直接並べた結果）");
const g3b = new Group("3. 連続成功の要約の本数＝公式の本数");
const g4 = new Group("4. On-Court Foreign（選手）の人数別の秒数・本人の記録");
const border = { p9: 0, p10: 0, p11: 0 };
const streakExamples: string[] = [];
let foreignCovered = 0;
const foreignLoss: string[] = [];
let foreignGames = 0;

async function readDir<T>(dir: string): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) if (f.endsWith(".json.gz")) out.set(f.replace(/\.json\.gz$/, ""), (await readJson<T>(path.join(dir, f.replace(/\.gz$/, ""))))!);
  return out;
}
const addShot = (into: ShotTypeBreakdown, add: ShotTypeBreakdown | undefined) => {
  for (const [k, v] of Object.entries(add ?? {})) {
    const t = (into[k] ??= { twoPoint: { made: 0, attempted: 0 }, threePoint: { made: 0, attempted: 0 } });
    t.twoPoint.made += v.twoPoint.made;
    t.twoPoint.attempted += v.twoPoint.attempted;
    t.threePoint.made += v.threePoint.made;
    t.threePoint.attempted += v.threePoint.attempted;
  }
};
const norm = (b: ShotTypeBreakdown | undefined) => JSON.stringify(Object.fromEntries(Object.entries(b ?? {}).filter(([, v]) => v.twoPoint.attempted + v.threePoint.attempted > 0).sort(([a], [c]) => a.localeCompare(c))));

/** 直接の数え方: 試投を時系列に並べ、記録が欠けた試合（null）で区切って、最長の連続と件数・始まりと終わりの試合 */
function directStreak(games: { key: string; seq: boolean[] | null }[]): { length: number; count: number; from: string; to: string } {
  let best = 0;
  let count = 0;
  let from = "";
  let to = "";
  let run = 0;
  let runFrom = "";
  let runTo = "";
  const close = () => {
    if (run > 0) {
      if (run > best) {
        best = run;
        count = 1;
        from = runFrom;
        to = runTo;
      } else if (run === best) count++;
    }
    run = 0;
  };
  for (const g of games) {
    if (!g.seq) {
      close();
      continue;
    }
    for (const made of g.seq) {
      if (made) {
        if (run === 0) runFrom = g.key;
        run++;
        runTo = g.key;
      } else close();
    }
  }
  close();
  return { length: best, count, from, to };
}

const seasons = readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
for (const season of seasons) {
  for (const category of ["premier", "one"] as Category[]) {
    const dir = path.join(DATA_DIR, seasonDirName(season, category));
    if (!existsSync(path.join(dir, "games")) || !existsSync(path.join(dir, "players.json.gz"))) continue;
    const players = (await readJson<PlayerSummary[]>(path.join(dir, "players.json"))) ?? [];
    const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
    const playerLogs = await readDir<PlayerGameLog[]>(path.join(dir, "player-games"));
    const teamLogs = await readDir<TeamGameLog[]>(path.join(dir, "team-games"));
    // 1. PTS10
    for (const p of players) {
      const logs = (playerLogs.get(p.playerId) ?? []).filter((l) => l.gameType === "regular" && l.min > 0);
      const want = logs.filter((l) => l.pts >= 10).length;
      for (const l of logs) {
        if (l.pts === 9) border.p9++;
        if (l.pts === 10) border.p10++;
        if (l.pts === 11) border.p11++;
      }
      g1.add(p.totals.points10Games === want, () => `${season} ${p.playerId} ${p.name}: players.json ${p.totals.points10Games} / 試合ログ ${want}`);
    }
    // 2. Shooting
    const leagueOwn: ShotTypeBreakdown = {};
    const leagueOpp: ShotTypeBreakdown = {};
    const teamLogOf = new Map<string, TeamGameLog>();
    for (const [tid, logs] of teamLogs) for (const l of logs) teamLogOf.set(`${tid}|${l.scheduleKey}`, l);
    for (const t of teams) {
      const logs = teamLogs.get(t.teamId) ?? [];
      const own: ShotTypeBreakdown = {};
      const opp: ShotTypeBreakdown = {};
      let games = 0;
      for (const l of logs) {
        if (!l.shotTypes) continue;
        const other = teamLogOf.get(`${l.opponentTeamId}|${l.scheduleKey}`);
        g2.add(norm(l.shotTypes) === norm(other?.opponentShotTypes) && norm(l.opponentShotTypes) === norm(other?.shotTypes), () => `${season} ${l.scheduleKey} ${t.teamId}: 自チームと相手の側が合わない`);
        if (l.gameType !== "regular") continue;
        games++;
        addShot(own, l.shotTypes);
        addShot(opp, l.opponentShotTypes);
      }
      if (t.shotTypeGames === undefined) {
        g2.add(games === 0, () => `${season} ${t.teamId}: 記録があるのに teams.json に対象試合数が無い`);
        continue;
      }
      addShot(leagueOwn, own);
      addShot(leagueOpp, opp);
      g2.add(t.shotTypeGames === games && norm(t.shotTypes) === norm(own) && norm(t.opponentShotTypes) === norm(opp), () => `${season} ${t.teamId}: teams.json ${t.shotTypeGames}試合 / 試合ログ ${games}試合、自チーム ${norm(t.shotTypes) === norm(own)}・相手 ${norm(t.opponentShotTypes) === norm(opp)}`);
    }
    if (Object.keys(leagueOwn).length > 0) g2.add(norm(leagueOwn) === norm(leagueOpp), () => `${season} リーグ全体の自チームと相手が合わない`);

    // 3・4 は生データから
    const games = (await readAllGames(season, category)).sort((a: StoredGame, b: StoredGame) => a.date.localeCompare(b.date) || a.raw.Game.GameDateTime.localeCompare(b.raw.Game.GameDateTime));
    const gameByKey = new Map(games.map((g) => [g.scheduleKey, g] as const));
    // 3. 連続成功
    for (const [pid, logs] of playerLogs) {
      const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || (gameByKey.get(a.scheduleKey)?.raw.Game.GameDateTime ?? "").localeCompare(gameByKey.get(b.scheduleKey)?.raw.Game.GameDateTime ?? ""));
      for (const gameType of ["regular", "playoff"] as const) {
        const list = sorted.filter((l) => l.gameType === gameType);
        if (list.length === 0) continue;
        for (const kind of ["ft", "tp"] as ShotStreakKind[]) {
          const fromSummary = chainShotStreaks(list.map((l) => ({ key: l.scheduleKey, summary: (kind === "ft" ? l.ftStreak : l.tpStreak) as never })));
          const direct = directStreak(
            list.map((l) => {
              const g = gameByKey.get(l.scheduleKey);
              if (!g) return { key: l.scheduleKey, seq: null };
              const rows = [...g.raw.HomeBoxscores, ...g.raw.AwayBoxscores];
              const summary = gameShotStreakSummary(g.raw.PlayByPlays, rows, pid, kind);
              const stored = kind === "ft" ? l.ftStreak : l.tpStreak;
              g3b.add(JSON.stringify(summary) === JSON.stringify(stored ?? null), () => `${season} ${l.scheduleKey} ${pid} ${kind}: 試合ログ ${JSON.stringify(stored)} / 生データ ${JSON.stringify(summary)}`);
              return { key: l.scheduleKey, seq: summary ? shotSequence(g.raw.PlayByPlays, pid, kind) : null };
            }),
          );
          const a = fromSummary.best;
          g3.add(
            (a?.length ?? 0) === direct.length && (a ? fromSummary.count : 0) === direct.count && (!a || (a.fromKey === direct.from && a.toKey === direct.to)),
            () => `${season} ${category} ${pid} ${gameType} ${kind}: 要約 ${JSON.stringify(fromSummary)} / 直接 ${JSON.stringify(direct)}`,
          );
          if (a && a.length >= 20 && streakExamples.length < 6) streakExamples.push(`${season} ${pid} ${kind} ${a.length}本（${a.fromKey}〜${a.toKey}、同じ長さ${fromSummary.count}件）`);
        }
      }
    }
    // 4. On-Court Foreign（選手）
    const foreign = await readJson<PlayerForeignFile>(path.join(dir, "player-foreign.json"));
    if (substitutionModelForSeason(season) === "modern") {
      check(`${season} ${category} player-foreign.json がある`, foreign !== null);
      if (!foreign) continue;
      const master = new Map(((await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? []).map((m) => [m.playerId, m] as const));
      const classifyAt = makeClassifier(season, await readJson<SeasonRegistrationFile>(path.join(dir, "registrations.json")), master);
      const maxOn = seasonRuleFor((await readJson<SeasonRules[]>(path.join(DATA_DIR, "season-rules.json"))) ?? [], season, category)?.maxForeignOnCourt;
      for (const g of games) {
        if (g.raw.PlayByPlays.length === 0) continue;
        foreignGames++;
        const periods = onCourtPeriodCount(g.season, g.quarterScores.home.length, g.raw.PlayByPlays);
        const rec = reconstructOnCourt(g.raw.PlayByPlays, g.raw.HomeBoxscores, g.raw.AwayBoxscores, g.homeTeam.id, g.awayTeam.id, periods, substitutionModelForSeason(g.season));
        const full = totalGameSeconds(periods);
        for (const home of [true, false]) {
          const tid = home ? g.homeTeam.id : g.awayTeam.id;
          const oid = home ? g.awayTeam.id : g.homeTeam.id;
          const tl = teamLogOf.get(`${tid}|${g.scheduleKey}`);
          if (!tl) continue;
          const pids = new Set(rec.lineupStints.filter((s) => s.teamId === tid).flatMap((s) => s.playerIds));
          const ownSec = [0, 0, 0, 0, 0];
          const oppSec = [0, 0, 0, 0, 0];
          for (const pid of pids) {
            const v = foreign.players[pid]?.[g.scheduleKey];
            for (const [b, arr] of Object.entries(v?.own ?? {})) ownSec[Number(b)]! += arr[0]!;
            for (const [b, arr] of Object.entries(v?.opp ?? {})) oppSec[Number(b)]! += arr[0]!;
          }
          const teamSec = tl.foreignCourtSeconds ?? [0, 0, 0, 0, 0];
          g4.add(ownSec.every((s, i) => s === 5 * teamSec[i]!), () => `${season} ${g.scheduleKey} ${tid}: 選手の合計 ${ownSec} / チーム×5 ${teamSec.map((x) => x * 5)}`);
          const ownCovered = rec.lineupStints.filter((s) => s.teamId === tid).reduce((a, s) => a + s.endSec - s.startSec, 0) === full;
          const oppCovered = rec.lineupStints.filter((s) => s.teamId === oid).reduce((a, s) => a + s.endSec - s.startSec, 0) === full;
          if (ownCovered) {
            const oppTeamSec = tl.opponentForeignCourtSeconds ?? [0, 0, 0, 0, 0];
            g4.add(oppSec.every((s, i) => s === 5 * oppTeamSec[i]!), () => `${season} ${g.scheduleKey} ${tid}: 相手の人数の選手の合計 ${oppSec} / 相手×5 ${oppTeamSec.map((x) => x * 5)}`);
          }
          // 本人の記録: 区間が両チームとも試合を覆い、人数別の秒数がすべての時間を数えている（区分の分からない5人組・規定超過が無い）試合
          const ownAll = teamSec.reduce((a, b) => a + b, 0) === full;
          const oppAll = (tl.opponentForeignCourtSeconds ?? []).reduce((a, b) => a + b, 0) === full;
          // さらに、チームの数え上げ（区間の合計）に漏れが無い（人数が5人でない0秒の瞬間の記録が無い）こと。漏れた記録はチームの値にも入らないので、本人の値にも入れない
          // 自チームの区間の own と、相手の区間の opp（相手から見た自チームの記録）の両方で確かめる
          const noLoss = [tid, oid].every((team) =>
            (["own", "opp"] as const).every((side) => {
              const sum: Record<string, number> = {};
              const holder = side === "own" ? team : team === tid ? oid : tid;
              for (const s of rec.lineupStints) if (s.teamId === holder) for (const pair of Object.values(s.countsByPeriod ?? {})) for (const [k, v] of Object.entries(pair[side])) sum[k] = (sum[k] ?? 0) + v;
              return Object.entries(rec.teamTotals?.[team] ?? {}).every(([k, v]) => k === "poss" || k === "implicitEnds" || (sum[k] ?? 0) === v);
            }),
          );
          if (!(ownCovered && oppCovered && ownAll && oppAll)) continue;
          // 0秒の区間も含め、区分の分からない5人組・規定の最大人数を超える5人組が無い（その5人組の間の記録は、チームの値と同じく数えないため）
          const allBucketed = rec.lineupStints.every((st) => {
            const n = foreignCountInLineup(st.playerIds, (id) => classifyAt(id, g.date));
            return n !== null && (maxOn === undefined || n <= maxOn);
          });
          if (!allBucketed) continue;
          if (!noLoss) {
            foreignLoss.push(`${season}:${g.scheduleKey}${home ? "H" : "A"}`);
            continue;
          }
          foreignCovered++;
          for (const pid of pids) {
            const want = new Array<number>(PLAYER_EVENT_KEYS.length).fill(0);
            for (const e of g.raw.PlayByPlays) {
              if (e.PlayerID1 !== pid || e.TeamID !== tid) continue;
              const c = e.ActionCD1;
              const add = (k: (typeof PLAYER_EVENT_KEYS)[number], n = 1) => (want[PLAYER_EVENT_KEYS.indexOf(k)]! += n);
              if (c === 1) { add("pts", 3); add("fgm"); add("fga"); add("tpm"); add("tpa"); }
              else if (c === 3 || c === 4 || c === 44) { add("pts", 2); add("fgm"); add("fga"); }
              else if (c === 2) { add("fga"); add("tpa"); }
              else if (c === 5 || c === 6) add("fga");
              else if (c === 7) { add("pts"); add("ftm"); add("fta"); }
              else if (c === 8) add("fta");
              else if (c === 9) add("dr");
              else if (c === 10) add("or");
              else if (c === 12) add("ast");
              else if (c === 13) add("tov");
            }
            const v = foreign.players[pid]?.[g.scheduleKey];
            for (const side of ["own", "opp"] as const) {
              const got = new Array<number>(PLAYER_EVENT_KEYS.length).fill(0);
              for (const arr of Object.values(v?.[side] ?? {})) for (let i = 0; i < PLAYER_EVENT_KEYS.length; i++) got[i]! += arr[1 + i]!;
              g4.add(got.every((x, i) => x === want[i]), () => `${season} ${g.scheduleKey} ${pid} ${side}: 人数別の合計 ${got} / プレーバイプレー ${want}`);
            }
            if (v) for (const arr of Object.values(v.own)) g4.add(arr.length === PLAYER_FOREIGN_OWN_LENGTH, () => `${season} ${g.scheduleKey} ${pid}: 長さ ${arr.length}`);
          }
        }
      }
    } else {
      check(`${season} ${category} 旧形式のシーズンには player-foreign.json が無い`, foreign === null);
    }
    void classifyGameType;
  }
}
for (const g of [g1, g2, g3, g3b, g4]) g.report();
console.log(`参考: PTS 9点 ${border.p9}・10点 ${border.p10}・11点 ${border.p11} の出場試合を含む。連続成功の例: ${streakExamples.join(" / ")}`);
console.log(`参考: On-Court Foreign（選手）の本人の記録を照合した試合×チーム ${foreignCovered}（PBP のある試合 ${foreignGames}）。チームの数え上げに漏れがあり対象外 ${foreignLoss.length}: ${foreignLoss.slice(0, 12).join(" ")}`);
if (failures > 0) {
  console.log(`\n${failures} 件の食い違い`);
  process.exit(1);
}
console.log("\nすべて ok");
