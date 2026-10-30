// 出場中の材料（在コート基準の再集計。shared/playerOnCourt.ts・DESIGN.md 304章）の検算スクリプト（検証専用。集計の入口からは import しない）。
// `npm run build:data` のあとに実行する。生データから在コートを復元し直して、導出データ（選手・チームの試合ログ、選手のピリオド別の索引）と比べる:
//  1. 選手の試合ログの onCourt＝本人がいた区間の合計。同じチームの全選手の合計＝チームの出場区間の合計（stintTotals）× 5（秒・全項目）
//  2. On/Off: 試合ログから出した Off（stintTotals − onCourt を本人が出た試合で足す）と On が、ランキングの計算（shared/onCourtTotals.ts の onOffByPlayer。team-stints から）と
//     全シーズン・全チーム・全選手で一致（試合数・秒・全項目）
//  3. FGにつながったアシスト: ピリオドごとの対応付けの合計＝試合全体の対応付け（shared/assistedScoring.ts）の2P・3Pのアシスト。公式の AST 以下
//  4. 品質: リバウンドのビット＝試合詳細の個人 OR% を出せるか（src/lib/gameOrPct.ts）。全シーズン（旧形式も復元の上で）。割合のビットの件数を報告
//  5. Q別 +/-（2016-17〜2021-22）: 旗の付いた行の区間の合計＝試合ログの +/-（試合全体の復元）。全選手の区間の値の合計＝チームのその区間の得点差 × 5。出せないチームを報告
//  6. ピリオド別の索引の出場中の列（2020-21以降）: 区間の合計＝試合ログの onCourt（索引に持つ項目）
// 使い方: npm run validate:player-oncourt（src/ のコードを使うため esbuild でまとめて実行する）
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { STINT_COUNT_KEYS, onCourtPeriodCount, reconstructOnCourt, substitutionModelForSeason } from "../shared/onCourt.ts";
import { compactStints, onOffByPlayer } from "../shared/onCourtTotals.ts";
import { computeAssistedScoring } from "../shared/assistedScoring.ts";
import {
  ON_COURT_QUALITY_REBOUNDS,
  ON_COURT_QUALITY_SHARES,
  ON_COURT_VALUE_LENGTH,
  addOnCourtValues,
  emptyOnCourtValues,
  fgAssistsByPlayer,
  onCourtKeyIndex,
  playerOnCourtByPeriod,
  plusMinusOf,
  sumOverPeriods,
  teamOnCourtQuality,
} from "../shared/playerOnCourt.ts";
import {
  PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED,
  PLAYER_PERIOD_ONCOURT_OPP_KEYS,
  PLAYER_PERIOD_ONCOURT_OWN_KEYS,
  type PlayerPeriodIndexFile,
} from "../shared/periodIndex.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import { gamePeriodScores } from "../shared/gamePeriods.ts";
import type { Category, PlayerGameLog, StoredGame, TeamGameLog, TeamStintsFile } from "../shared/types.ts";
import { computeTeamOrPct } from "../src/lib/gameOrPct.ts";
import { buildTeamTotalCounts } from "../src/lib/boxscoreAggregate.ts";
import { onOffTotalsFromLogs } from "../src/lib/playerOnOffColumns.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}
class Group {
  total = 0;
  badCount = 0;
  bad: string[] = [];
  constructor(readonly label: string) {}
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

const g1 = new Group("1. 試合ログの onCourt＝区間の合計、チームの全選手の合計＝stintTotals×5");
const g2 = new Group("2. On/Off（試合ログから）＝ランキングの計算（team-stints）");
const g3 = new Group("3. FGにつながったアシスト（ピリオドごと＝試合全体、公式 AST 以下）");
const g4 = new Group("4. リバウンドの品質ビット＝試合詳細の個人 OR% を出せるか");
const g5 = new Group("5. Q別 +/-（旗の行の合計＝試合の +/-、全選手の区間の合計＝得点差×5）");
const g6 = new Group("6. ピリオド別の索引の出場中の列の合計＝試合ログの onCourt");
const g7 = new Group("7. on/off タブの値（src/lib/playerOnOffColumns.ts）＝ランキングの On/Off（秒・ORtg・DRtg・NetRtg）");
const uncoveredPeriods: string[] = [];
const sameArr = (a: readonly number[] | undefined, b: readonly number[] | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);

const seasons = readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
const qualityTally: Record<string, { teams: number; shares: number; rebounds: number; pmTeams: number; pm: number; pmNg: string[] }> = {};

async function readLogs<T>(dir: string): Promise<Map<string, T[]>> {
  const out = new Map<string, T[]>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json.gz")) continue;
    out.set(f.replace(/\.json\.gz$/, ""), (await readJson<T[]>(path.join(dir, f.replace(/\.gz$/, "")))) ?? []);
  }
  return out;
}

for (const season of seasons) {
  for (const category of ["premier", "one"] as Category[]) {
    const dir = path.join(DATA_DIR, seasonDirName(season, category));
    if (!existsSync(path.join(dir, "games"))) continue;
    const modern = substitutionModelForSeason(season) === "modern";
    const tally: (typeof qualityTally)[string] = { teams: 0, shares: 0, rebounds: 0, pmTeams: 0, pm: 0, pmNg: [] };
    qualityTally[`${category === "one" ? "B.ONE " : ""}${season}`] = tally;
    const playerLogs = await readLogs<PlayerGameLog>(path.join(dir, "player-games"));
    const teamLogs = await readLogs<TeamGameLog>(path.join(dir, "team-games"));
    const logOf = new Map<string, PlayerGameLog>();
    for (const [pid, logs] of playerLogs) for (const l of logs) logOf.set(`${pid}|${l.scheduleKey}`, l);
    const teamLogOf = new Map<string, TeamGameLog>();
    for (const [tid, logs] of teamLogs) for (const l of logs) teamLogOf.set(`${tid}|${l.scheduleKey}`, l);
    const games = (await readAllGames(season, category)).filter((g: StoredGame) => g.raw.PlayByPlays.length > 0);
    const gameIndex = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
    const periodIndex = await readJson<PlayerPeriodIndexFile>(path.join(dir, "player-period-index.json"));
    // ピリオド別の索引: (選手, 試合) → 区間の行
    const periodRowsOf = new Map<string, number[]>();
    if (gameIndex && periodIndex && periodIndex.indexRows === gameIndex.rows.player.length) {
      const pr = periodIndex.rows;
      for (let i = 0; i < pr.row.length; i++) {
        const r = pr.row[i]!;
        const k = `${gameIndex.players[gameIndex.rows.player[r]!]![0]}|${gameIndex.games.key[gameIndex.rows.game[r]!]}`;
        let list = periodRowsOf.get(k);
        if (!list) periodRowsOf.set(k, (list = []));
        list.push(i);
      }
    } else if (gameIndex) {
      check(`${season} ${category} ピリオド別の索引が読める`, false);
    }
    for (const game of games) {
      const periods = onCourtPeriodCount(game.season, game.quarterScores.home.length, game.raw.PlayByPlays);
      const rec = reconstructOnCourt(game.raw.PlayByPlays, game.raw.HomeBoxscores, game.raw.AwayBoxscores, game.homeTeam.id, game.awayTeam.id, periods, substitutionModelForSeason(game.season));
      const fgAst = fgAssistsByPlayer(game.raw.PlayByPlays);
      // 3. FGアシスト
      const whole = new Map<string, number>();
      for (const pair of computeAssistedScoring(game.raw.PlayByPlays).pairs.values()) whole.set(pair.assisterId, (whole.get(pair.assisterId) ?? 0) + pair.assisted2m + pair.assisted3m);
      for (const id of new Set([...whole.keys(), ...fgAst.keys()])) {
        const byPeriod = [...(fgAst.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0);
        const box = [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores].find((r) => r.Category === 1 && r.PeriodCategory === 18 && r.PlayerID === id)?.AS;
        const log = logOf.get(`${id}|${game.scheduleKey}`);
        g3.add(byPeriod === (whole.get(id) ?? 0) && (box === undefined || byPeriod <= box) && (!modern || !log || log.fgAssists === byPeriod), () => `${season} ${game.scheduleKey} ${id}: ピリオドごと ${byPeriod} / 試合全体 ${whole.get(id)} / AST ${box} / 試合ログ ${log?.fgAssists}`);
      }
      const scores = gamePeriodScores(game);
      for (const home of [true, false]) {
        const teamId = home ? game.homeTeam.id : game.awayTeam.id;
        const oppId = home ? game.awayTeam.id : game.homeTeam.id;
        const ownRows = home ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
        const oppRows = home ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
        const ownScore = home ? game.homeScore : game.awayScore;
        const oppScore = home ? game.awayScore : game.homeScore;
        const quality = teamOnCourtQuality(rec, teamId, oppId, ownRows, oppRows, ownScore, oppScore, periods);
        tally.teams += 1;
        if (quality & ON_COURT_QUALITY_SHARES) tally.shares += 1;
        if (quality & ON_COURT_QUALITY_REBOUNDS) tally.rebounds += 1;
        // 4. リバウンドの品質＝個人 OR% の判定
        const orRes = computeTeamOrPct({
          lineupStints: rec.lineupStints,
          teamId,
          opponentTeamId: oppId,
          boxOr: buildTeamTotalCounts(ownRows, undefined).oreb,
          boxOpponentDr: buildTeamTotalCounts(oppRows, undefined).dreb,
          periods: null,
        });
        g4.add(orRes.available === ((quality & ON_COURT_QUALITY_REBOUNDS) !== 0), () => `${season} ${game.scheduleKey} ${teamId}: OR% ${orRes.available} / ビット ${quality}`);
        const byPlayer = playerOnCourtByPeriod(rec.lineupStints, teamId, periods);
        const teamLog = teamLogOf.get(`${teamId}|${game.scheduleKey}`);
        if (modern && teamLog) {
          // 1. 試合ログ
          const sum = emptyOnCourtValues();
          for (const [pid, bp] of byPlayer) {
            const v = sumOverPeriods(bp);
            addOnCourtValues(sum, v);
            const log = logOf.get(`${pid}|${game.scheduleKey}`);
            const appeared = [...bp.values()].some((x) => x.some((y) => y !== 0));
            if (log) g1.add(appeared ? sameArr(log.onCourt, v) : log.onCourt === undefined, () => `${season} ${game.scheduleKey} ${pid}: 試合ログ ${JSON.stringify(log.onCourt)} / 区間 ${JSON.stringify(v)}`);
            else g1.add(!appeared, () => `${season} ${game.scheduleKey} ${pid}: 区間にいるのに試合ログが無い`);
          }
          g1.add(sameArr(sum, teamLog.stintTotals?.map((x) => x * 5)) && teamLog.onCourtQuality === quality, () => `${season} ${game.scheduleKey} ${teamId}: 選手の合計 ${JSON.stringify(sum)} / チーム×5 ${JSON.stringify(teamLog.stintTotals?.map((x) => x * 5))} / 品質 ${teamLog.onCourtQuality} ${quality}`);
          // 6. ピリオド別の索引
          for (const [pid, bp] of byPlayer) {
            const rows = periodRowsOf.get(`${pid}|${game.scheduleKey}`);
            const log = logOf.get(`${pid}|${game.scheduleKey}`);
            if (!rows || !periodIndex || !log?.onCourt) continue;
            const st = periodIndex.rows.stats;
            // 公式のピリオド別の記録では出場していない区間（索引の行が無い）に、復元では時間か記録がある選手は、合計が合わないので数えて報告だけする
            const rowPeriods = new Set(rows.map((i) => periodIndex.rows.period[i]!));
            const uncovered = [...bp].some(([p, v]) => v.some((x) => x !== 0) && !rowPeriods.has(p >= 5 ? 4 : p - 1));
            if (uncovered) {
              uncoveredPeriods.push(`${season}:${game.scheduleKey}:${pid}`);
              continue;
            }
            const keys = [["ocSec", 0], ...PLAYER_PERIOD_ONCOURT_OWN_KEYS.map((k) => [`ocOwn.${k}`, onCourtKeyIndex(k, "own")]), ...PLAYER_PERIOD_ONCOURT_OPP_KEYS.map((k) => [`ocOpp.${k}`, onCourtKeyIndex(k, "opp")])] as [string, number][];
            for (const [col, idx] of keys) {
              const fromIndex = rows.reduce((a, i) => a + (st[col]?.[i] ?? NaN), 0);
              // 区間の行が無いピリオド（出場していないのに5人組の区間の数え上げだけがある、などの端）を除いた比較にはしない。足りなければ食い違いとして報告する
              g6.add(fromIndex === log.onCourt[idx], () => `${season} ${game.scheduleKey} ${pid} ${col}: 索引 ${fromIndex} / 試合ログ ${log.onCourt![idx]} / 区間 ${[...bp.keys()]}`);
            }
          }
        }
        // 5. Q別 +/-（2016-17〜2021-22）
        if (Number(season.slice(0, 4)) < 2022 && periodIndex) {
          tally.pmTeams += 1;
          const flagged = [...byPlayer.keys()].some((pid) => (periodRowsOf.get(`${pid}|${game.scheduleKey}`) ?? []).some((i) => (periodIndex.rows.flags[i]! & PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED) !== 0));
          if (!flagged) {
            if (tally.pmNg.length < 12) tally.pmNg.push(`${game.scheduleKey}${home ? "H" : "A"}`);
            continue;
          }
          tally.pm += 1;
          const pmCol = periodIndex.rows.stats.plusMinus;
          for (const pid of byPlayer.keys()) {
            const rows = periodRowsOf.get(`${pid}|${game.scheduleKey}`) ?? [];
            const log = logOf.get(`${pid}|${game.scheduleKey}`);
            if (!log || rows.length === 0) continue;
            const sum = rows.reduce((a, i) => a + pmCol[i]!, 0);
            const allFlagged = rows.every((i) => (periodIndex.rows.flags[i]! & PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED) !== 0);
            g5.add(allFlagged && sum === log.plusMinus, () => `${season} ${game.scheduleKey} ${pid}: 区間の合計 ${sum} / 試合 ${log.plusMinus} / 旗 ${allFlagged}`);
          }
          for (let p = 1; p <= periods; p++) {
            let s = 0;
            for (const bp of byPlayer.values()) s += bp.get(p) ? plusMinusOf(bp.get(p)!) : 0;
            const own = (home ? scores.home : scores.away)[p - 1];
            const opp = (home ? scores.away : scores.home)[p - 1];
            if (own === undefined || opp === undefined) continue;
            g5.add(s === 5 * (own - opp), () => `${season} ${game.scheduleKey} ${teamId} ${p}Q: 選手の合計 ${s} / 得点差×5 ${5 * (own - opp)}`);
          }
        }
      }
    }
    // 2. On/Off＝ランキングの計算
    if (modern) {
      const stintDir = path.join(dir, "team-stints");
      for (const f of existsSync(stintDir) ? readdirSync(stintDir) : []) {
        const file = await readJson<TeamStintsFile>(path.join(stintDir, f.replace(/\.gz$/, "")));
        if (!file) continue;
        const c = compactStints(file);
        const keys = STINT_COUNT_KEYS as unknown as string[];
        const ranking = onOffByPlayer(c, { includeGame: () => true, periods: null, keys });
        for (const [pid, r] of ranking) {
          const on = emptyOnCourtValues();
          const off = emptyOnCourtValues();
          let onGames = 0;
          let offGames = 0;
          for (const l of playerLogs.get(pid) ?? []) {
            const t = teamLogOf.get(`${file.teamId}|${l.scheduleKey}`);
            if (!l.onCourt || !t?.stintTotals || !c.games.includes(l.scheduleKey)) continue;
            // その試合の所属がこのチームか（移籍した選手。ホーム／アウェイがチームの試合ログと同じなら同じチーム）
            if (t.isHome !== l.isHome) continue;
            addOnCourtValues(on, l.onCourt);
            if (l.onCourt.some((v) => v !== 0)) onGames += 1;
            // Off は、時間のある区間に出た試合だけ
            if (l.onCourt[0]! <= 0) continue;
            const o = t.stintTotals.map((v, i) => v - l.onCourt![i]!);
            addOnCourtValues(off, o);
            if (o.some((v) => v !== 0)) offGames += 1;
          }
          const want = (x: { games: number; seconds: number; own: number[]; opp: number[] }) => [x.seconds, ...x.own, ...x.opp];
          // 7. 画面の on/off タブと同じ関数で出した値（チーム詳細と同じく、このチームにいた試合だけ）
          const myLogs = (playerLogs.get(pid) ?? []).filter((l) => {
            const t = teamLogOf.get(`${file.teamId}|${l.scheduleKey}`);
            return !!t && t.isHome === l.isHome && c.games.includes(l.scheduleKey);
          });
          const tot = onOffTotalsFromLogs(myLogs, (l) => teamLogOf.get(`${file.teamId}|${l.scheduleKey}`));
          const rk = (x: { seconds: number; own: number[]; opp: number[] }) => {
            const pts = x.own[STINT_COUNT_KEYS.indexOf("pts")]!;
            const opts = x.opp[STINT_COUNT_KEYS.indexOf("pts")]!;
            const poss = x.own[STINT_COUNT_KEYS.indexOf("poss")]!;
            const oposs = x.opp[STINT_COUNT_KEYS.indexOf("poss")]!;
            return { sec: x.seconds, o: poss > 0 ? (100 * pts) / poss : null, d: oposs > 0 ? (100 * opts) / oposs : null };
          };
          const mine = (b: { seconds: number; ownPts: number; oppPts: number; ownPoss: number; oppPoss: number }) => ({
            sec: b.seconds,
            o: b.ownPoss > 0 ? (100 * b.ownPts) / b.ownPoss : null,
            d: b.oppPoss > 0 ? (100 * b.oppPts) / b.oppPoss : null,
          });
          if (tot) {
            const same = (a: ReturnType<typeof mine>, b: ReturnType<typeof rk>) => a.sec === b.sec && a.o === b.o && a.d === b.d;
            g7.add(same(mine(tot.on), rk(r.on)) && same(mine(tot.off), rk(r.off)), () => `${season} ${file.teamId} ${pid}: タブ ${JSON.stringify([mine(tot.on), mine(tot.off)])} / ランキング ${JSON.stringify([rk(r.on), rk(r.off)])}`);
          } else {
            g7.add(r.on.seconds === 0, () => `${season} ${file.teamId} ${pid}: タブは値なし / ランキング On ${r.on.seconds}秒`);
          }
          g2.add(sameArr(on, want(r.on)) && sameArr(off, want(r.off)) && onGames === r.on.games && offGames === r.off.games, () => `${season} ${file.teamId} ${pid}: On ${JSON.stringify(on)} ${onGames} / ${JSON.stringify(want(r.on))} ${r.on.games}; Off ${JSON.stringify(off)} ${offGames} / ${JSON.stringify(want(r.off))} ${r.off.games}`);
        }
      }
    }
  }
}
if (ON_COURT_VALUE_LENGTH !== 1 + STINT_COUNT_KEYS.length * 2) failures += 1;
for (const g of [g1, g2, g3, g4, g5, g6, g7]) g.report();
console.log(`（6の対象外: 公式のピリオド別の記録に無い区間に復元では出ていた選手×試合 ${uncoveredPeriods.length}件: ${uncoveredPeriods.slice(0, 10).join(" ")}）`);
for (const [k, t] of Object.entries(qualityTally)) {
  if (t.teams === 0) continue;
  console.log(
    `${k}: チーム×試合 ${t.teams}・割合を出せる ${t.shares}・リバウンド ${t.rebounds}${t.pmTeams ? `・Q別+/- ${t.pm}/${t.pmTeams}（出せない: ${t.pmNg.join(",")}${t.pmTeams - t.pm > t.pmNg.length ? " ほか" : ""}）` : ""}`,
  );
}
if (failures > 0) {
  console.log(`\n${failures} 件の食い違い`);
  process.exit(1);
}
console.log("\nすべて ok");
