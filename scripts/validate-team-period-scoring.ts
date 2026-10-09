// チームの区間別の得点（カテゴリタブ「Periods」。src/lib/teamPeriodScoring.ts。DESIGN.md 226章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（導出データを作ったあと、`npm run build:data` のあとに実行する。B.PREMIER の全シーズン）:
//  1. 区間の合計 = 試合の得点: 1Q〜4Q＋延長が、全試合・自チームと相手の両方で試合の得点と一致する／前半＝1Q+2Q・後半＝3Q+4Q／
//     延長の有無が overtimes と一致する／値を持たない試合は前後半5分の特別な試合（4試合）だけ
//  2. ピリオド別の索引（team-period-index）との一致: 1Q〜4Q・延長の得点が、全行（自チーム・相手）で一致する
//  3. 公式のクォーター別スコアとの一致: 試合の生データ（gamePeriodScores）から、ラインスコア（gameLinescore。第1延長・第2延長まで）が全試合で一致する
//     （公式のスコアが欠けてプレーバイプレーから補った区間は対象外にして、件数を出す）
//  4. 集計: 条件（すべて・勝ち・負け・ホーム・アウェイ・レギュラー・ポストシーズン・延長あり・延長なし）で絞った合計・平均が、1試合行の索引（team-game-index）の列から
//     別に数えた値と一致する／1Q〜後半の平均がクラブごとの period-averages.json と一致する／延長の平均は、生データで数えた延長のあった試合の数で割った値と一致する
//  5. 感度: 試合ログの値を1か所変えると、2が食い違いとして検出される
//
// 使い方: npm run validate:team-period-scoring [-- --season 2025-26]（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import { GAME_FLAG_PLAYOFF, GAME_FLAG_SHORT, type TeamGameIndexFile } from "../shared/gameIndex.ts";
import type { TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { PeriodAveragesFile, TeamGameLog } from "../shared/types.ts";
import { periodAverage, PERIOD_KEYS } from "../shared/teamPeriodRecords.ts";
import { gamePeriodScores } from "../src/lib/gamePeriods.ts";
import {
  aggregatePeriodScoring,
  gameLinescore,
  gamePeriodPair,
  periodScoringValue,
  type PeriodScoringKey,
} from "../src/lib/teamPeriodScoring.ts";

let failed = 0;
function report(name: string, mismatches: string[], checked: number, note = ""): void {
  const ok = mismatches.length === 0;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}（${checked.toLocaleString()}件${note ? `、${note}` : ""}）`);
  if (!ok) {
    failed += 1;
    for (const m of mismatches.slice(0, 8)) console.log(`       ${m}`);
    if (mismatches.length > 8) console.log(`       …ほか${mismatches.length - 8}件`);
  }
}

const seasonArg = process.argv.indexOf("--season") >= 0 ? process.argv[process.argv.indexOf("--season") + 1] : undefined;

async function readTeamLogs(season: string): Promise<Map<string, TeamGameLog[]>> {
  const dir = path.join(DATA_DIR, season, "team-games");
  const out = new Map<string, TeamGameLog[]>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json.gz"))) {
    const teamId = f.replace(/\.json\.gz$/, "");
    out.set(teamId, (await readJson<TeamGameLog[]>(path.join(dir, f.replace(/\.gz$/, "")))) ?? []);
  }
  return out;
}

const seasons = readdirSync(DATA_DIR)
  .filter((s) => /^\d{4}-\d{2}$/.test(s) && existsSync(path.join(DATA_DIR, s, "team-period-index.json.gz")))
  .filter((s) => !seasonArg || s === seasonArg)
  .sort();

const tally = {
  invariantRows: 0,
  indexValues: 0,
  officialGames: 0,
  officialSkipped: 0,
  aggregates: 0,
  averages: 0,
  otAverages: 0,
  sensitivity: 0,
};
const bad = {
  invariant: [] as string[],
  index: [] as string[],
  official: [] as string[],
  aggregate: [] as string[],
  average: [] as string[],
  otAverage: [] as string[],
};
let specialGames = 0;
let twoPlusOvertimeGames = 0;
let sensitivityDetected = 0;

for (const season of seasons) {
  const gi = await readJson<TeamGameIndexFile>(path.join(DATA_DIR, season, "team-game-index.json"));
  const pi = await readJson<TeamPeriodIndexFile>(path.join(DATA_DIR, season, "team-period-index.json"));
  const averages = await readJson<PeriodAveragesFile>(path.join(DATA_DIR, season, "period-averages.json"));
  if (!gi || !pi) throw new Error(`${season}: 索引がありません（先に npm run build:data）`);
  const logsByTeam = await readTeamLogs(season);
  const games = await readAllGames(season);
  const rawByKey = new Map(games.map((g) => [String(g.scheduleKey), g]));
  const counts = pi.rows.counts;
  const ptsOf = (key: "q1" | "q2" | "q3" | "q4" | "ot", row: number) => counts[`${key}.pts`]![row]!;
  const teamIds = gi.teams.map((t) => t[0]);
  const rowOf = new Map<string, number>(); // `${scheduleKey}:${teamId}` → 索引の行
  gi.games.key.forEach((key, n) => {
    rowOf.set(`${key}:${teamIds[gi.games.home[n]!]}`, n * 2);
    rowOf.set(`${key}:${teamIds[gi.games.away[n]!]}`, n * 2 + 1);
  });

  // 1・2・3: 試合ごと
  for (const [teamId, logs] of logsByTeam) {
    for (const g of logs) {
      const label = `${season} ${g.scheduleKey} ${teamId}`;
      const row = rowOf.get(`${g.scheduleKey}:${teamId}`);
      if (row === undefined) {
        bad.invariant.push(`${label}: 索引に行がありません`);
        continue;
      }
      tally.invariantRows += 1;
      const pairs = (["q1", "q2", "q3", "q4", "h1", "h2", "ot"] as PeriodScoringKey[]).map((k) => [k, gamePeriodPair(g, k)] as const);
      const at = (k: PeriodScoringKey) => pairs.find((p) => p[0] === k)![1];
      const isShort = (gi.games.flags[row >> 1]! & GAME_FLAG_SHORT) !== 0;
      if (!at("q1")) {
        if (!isShort) bad.invariant.push(`${label}: 前後半5分の特別な試合ではないのに区間の値がありません`);
        else specialGames += 0.5; // 2チーム分で1試合
        continue;
      }
      const ot = at("ot");
      const sumOwn = (["q1", "q2", "q3", "q4"] as const).reduce((a, k) => a + at(k)!.own, 0) + (ot?.own ?? 0);
      const sumOpp = (["q1", "q2", "q3", "q4"] as const).reduce((a, k) => a + at(k)!.opp, 0) + (ot?.opp ?? 0);
      if (sumOwn !== g.teamScore || sumOpp !== g.opponentScore) bad.invariant.push(`${label}: 区間の合計 ${sumOwn}-${sumOpp} が得点 ${g.teamScore}-${g.opponentScore} と違います`);
      if (at("h1")!.own !== at("q1")!.own + at("q2")!.own || at("h2")!.opp !== at("q3")!.opp + at("q4")!.opp) bad.invariant.push(`${label}: 前半・後半が1Q+2Q／3Q+4Qと違います`);
      if ((ot !== null) !== ((g.overtimes ?? 0) > 0)) bad.invariant.push(`${label}: 延長の有無（${ot !== null}）が overtimes（${g.overtimes}）と違います`);
      if (g.overtimes != null && g.overtimes >= 2) twoPlusOvertimeGames += 0.5; // 2チーム分で1試合

      // 2: ピリオド別の索引（自チームの行と相手の行）
      for (const [r, side] of [[row, "own"], [row ^ 1, "opp"]] as const) {
        for (const k of ["q1", "q2", "q3", "q4"] as const) {
          tally.indexValues += 1;
          if (at(k)![side] !== ptsOf(k, r)) bad.index.push(`${label} ${k} ${side}: ${at(k)![side]} ≠ 索引 ${ptsOf(k, r)}`);
        }
        tally.indexValues += 1;
        const indexOt = ptsOf("ot", r);
        if ((ot ? ot[side] : -1) !== indexOt) bad.index.push(`${label} ot ${side}: ${ot ? ot[side] : -1} ≠ 索引 ${indexOt}`);
      }

      // 3: 公式のクォーター別スコア（生データ）
      const raw = rawByKey.get(String(g.scheduleKey));
      if (!raw) continue;
      const line = gameLinescore(g, raw);
      if (!line) {
        bad.official.push(`${label}: ラインスコアがありません`);
        continue;
      }
      const official = gamePeriodScores(raw);
      const own = g.isHome ? official.home : official.away;
      const opp = g.isHome ? official.away : official.home;
      tally.officialGames += 0.5; // 2チーム分で1試合
      for (let q = 0; q < 4; q++) {
        if (line.fromPbp.includes(q + 1)) {
          tally.officialSkipped += 1;
          continue;
        }
        if (line.own[q] !== own[q] || line.opp[q] !== opp[q]) bad.official.push(`${label} ${q + 1}Q: ${line.own[q]}-${line.opp[q]} ≠ 公式 ${own[q]}-${opp[q]}`);
      }
      if (line.overtimes !== Math.max(0, own.length - 4)) bad.official.push(`${label}: 延長の本数 ${line.overtimes} ≠ 公式のピリオド数 ${own.length - 4}`);
      if (!line.ot) bad.official.push(`${label}: 延長ごとの得点を出せていません（延長 ${line.overtimes}本）`);
      else
        line.ot.forEach((p, i) => {
          if (p.own !== own[4 + i] || p.opp !== opp[4 + i]) bad.official.push(`${label} 延長${i + 1}: ${p.own}-${p.opp} ≠ 公式 ${own[4 + i]}-${opp[4 + i]}`);
        });
    }
  }

  // 4: 条件つきの集計（1試合行の索引から別に数える）
  const conditions: { name: string; keep: (n: number, side: 0 | 1) => boolean }[] = [
    { name: "すべて", keep: () => true },
    { name: "勝ち", keep: (n, s) => (s === 0 ? gi.games.homeScore[n]! > gi.games.awayScore[n]! : gi.games.awayScore[n]! > gi.games.homeScore[n]!) },
    { name: "負け", keep: (n, s) => (s === 0 ? gi.games.homeScore[n]! < gi.games.awayScore[n]! : gi.games.awayScore[n]! < gi.games.homeScore[n]!) },
    { name: "ホーム", keep: (_n, s) => s === 0 },
    { name: "アウェイ", keep: (_n, s) => s === 1 },
    { name: "レギュラー", keep: (n) => (gi.games.flags[n]! & GAME_FLAG_PLAYOFF) === 0 },
    { name: "ポストシーズン", keep: (n) => (gi.games.flags[n]! & GAME_FLAG_PLAYOFF) !== 0 },
    { name: "延長あり", keep: (n) => gi.games.overtimes[n]! > 0 },
    { name: "延長なし", keep: (n) => gi.games.overtimes[n]! === 0 },
  ];
  const sideLogPredicate = (name: string, g: TeamGameLog): boolean =>
    name === "すべて" ||
    (name === "勝ち" && g.win) ||
    (name === "負け" && !g.win) ||
    (name === "ホーム" && g.isHome) ||
    (name === "アウェイ" && !g.isHome) ||
    (name === "レギュラー" && g.gameType === "regular") ||
    (name === "ポストシーズン" && g.gameType === "playoff") ||
    (name === "延長あり" && (g.overtimes ?? 0) > 0) ||
    (name === "延長なし" && (g.overtimes ?? 0) === 0);
  for (const [teamId, logs] of logsByTeam) {
    for (const cond of conditions) {
      const agg = aggregatePeriodScoring(logs.filter((g) => sideLogPredicate(cond.name, g)));
      // 索引の列から別に数える（前後半5分の特別な試合は区間の値を持たない）
      const expected = { games: 0, q: [0, 1, 2, 3].map(() => ({ games: 0, own: 0, opp: 0 })), ot: { games: 0, own: 0, opp: 0 }, fullOwn: 0, fullOpp: 0 };
      for (let n = 0; n < gi.games.key.length; n++) {
        for (const side of [0, 1] as const) {
          if (teamIds[side === 0 ? gi.games.home[n]! : gi.games.away[n]!] !== teamId || !cond.keep(n, side)) continue;
          expected.games += 1;
          expected.fullOwn += side === 0 ? gi.games.homeScore[n]! : gi.games.awayScore[n]!;
          expected.fullOpp += side === 0 ? gi.games.awayScore[n]! : gi.games.homeScore[n]!;
          const r = n * 2 + side;
          const pk = ["p1", "p2", "p3", "p4"] as const;
          const ok = ["o1", "o2", "o3", "o4"] as const;
          if (gi.rows.stats[pk[0]]![r]! < 0) continue;
          let regOwn = 0;
          let regOpp = 0;
          for (let q = 0; q < 4; q++) {
            const a = gi.rows.stats[pk[q]!]![r]!;
            const b = gi.rows.stats[ok[q]!]![r]!;
            expected.q[q]!.games += 1;
            expected.q[q]!.own += a;
            expected.q[q]!.opp += b;
            regOwn += a;
            regOpp += b;
          }
          if (gi.games.overtimes[n]! > 0) {
            expected.ot.games += 1;
            expected.ot.own += (side === 0 ? gi.games.homeScore[n]! : gi.games.awayScore[n]!) - regOwn;
            expected.ot.opp += (side === 0 ? gi.games.awayScore[n]! : gi.games.homeScore[n]!) - regOpp;
          }
        }
      }
      tally.aggregates += 1;
      const same = (a: { games: number; own: number; opp: number }, b: { games: number; own: number; opp: number }) => a.games === b.games && a.own === b.own && a.opp === b.opp;
      const label = `${season} ${teamId} ${cond.name}`;
      if (agg.games !== expected.games || agg.full.own !== expected.fullOwn || agg.full.opp !== expected.fullOpp) bad.aggregate.push(`${label}: 試合全体が違います`);
      (["q1", "q2", "q3", "q4"] as const).forEach((k, i) => {
        if (!same(agg.periods[k], expected.q[i]!)) bad.aggregate.push(`${label} ${k}: ${JSON.stringify(agg.periods[k])} ≠ ${JSON.stringify(expected.q[i])}`);
      });
      if (!same(agg.periods.h1, { games: expected.q[0]!.games, own: expected.q[0]!.own + expected.q[1]!.own, opp: expected.q[0]!.opp + expected.q[1]!.opp }))
        bad.aggregate.push(`${label} h1が違います`);
      if (!same(agg.periods.h2, { games: expected.q[2]!.games, own: expected.q[2]!.own + expected.q[3]!.own, opp: expected.q[2]!.opp + expected.q[3]!.opp }))
        bad.aggregate.push(`${label} h2が違います`);
      if (!same(agg.periods.ot, expected.ot)) bad.aggregate.push(`${label} ot: ${JSON.stringify(agg.periods.ot)} ≠ ${JSON.stringify(expected.ot)}`);
    }

    // 1Q〜後半の平均 = period-averages.json（レギュラー）
    const regular = logs.filter((g) => g.gameType === "regular");
    const agg = aggregatePeriodScoring(regular);
    for (const k of PERIOD_KEYS) {
      const file = averages?.byGameType.regular?.[teamId]?.[k];
      const direct = periodAverage(regular, k);
      if (!file && !direct) continue;
      tally.averages += 1;
      const mine = periodScoringValue(agg.periods[k], "own", "perGame");
      const mineOpp = periodScoringValue(agg.periods[k], "opp", "perGame");
      if (!file || mine === null || mineOpp === null || Math.abs(mine - file.pts) > 1e-9 || Math.abs(mineOpp - file.oppPts) > 1e-9 || agg.periods[k].games !== file.games)
        bad.average.push(`${season} ${teamId} ${k}: ${mine} / ${mineOpp} ≠ period-averages ${file?.pts} / ${file?.oppPts}`);
    }
    // 延長の平均 = 延長の合計 ÷ 生データで数えた延長のあった試合の数
    let otGames = 0;
    let otOwn = 0;
    for (const g of logs) {
      const raw = rawByKey.get(String(g.scheduleKey));
      if (!raw || !gameLinescore(g, raw)) continue;
      const s = gamePeriodScores(raw);
      if (s.home.length <= 4) continue;
      otGames += 1;
      otOwn += (g.isHome ? s.home : s.away).slice(4).reduce((a, b) => a + b, 0);
    }
    const all = aggregatePeriodScoring(logs);
    tally.otAverages += 1;
    const avg = periodScoringValue(all.periods.ot, "own", "perGame");
    if (all.periods.ot.games !== otGames || (otGames > 0 ? Math.abs(avg! - otOwn / otGames) > 1e-9 : avg !== null))
      bad.otAverage.push(`${season} ${teamId}: OT ${all.periods.ot.games}試合・平均 ${avg} ≠ 生データ ${otGames}試合・${otGames > 0 ? otOwn / otGames : "-"}`);
  }

  // 5: 感度（1チームの1試合の2Qを +1 して、索引との照合が食い違いとして出る）
  const [firstTeam, firstLogs] = [...logsByTeam].find(([, l]) => l.some((g) => g.periodPoints)) ?? [];
  if (firstTeam && firstLogs) {
    const g = firstLogs.find((x) => x.periodPoints)!;
    const row = rowOf.get(`${g.scheduleKey}:${firstTeam}`)!;
    const broken = { ...g, periodPoints: g.periodPoints!.map((v, i) => (i === 1 && v != null ? v + 1 : v)) };
    tally.sensitivity += 1;
    const pair = gamePeriodPair(broken, "q2");
    if (pair && pair.own !== ptsOf("q2", row)) sensitivityDetected += 1;
  }
}

report("区間の合計＝試合の得点（自チーム・相手）、前半・後半、延長の有無", bad.invariant, tally.invariantRows, `前後半5分の特別な試合 ${Math.round(specialGames)}試合は区間の値なし`);
report("ピリオド別の索引（team-period-index）の1Q〜4Q・延長の得点と一致", bad.index, tally.indexValues);
report(
  "公式のクォーター別スコア（生データ）と、ラインスコア（1Q〜4Q・第1延長〜）が一致",
  bad.official,
  Math.round(tally.officialGames),
  `2延長以上の試合 ${Math.round(twoPlusOvertimeGames)}試合を含む。プレーバイプレーから補った区間 ${tally.officialSkipped}件は対象外`,
);
report("条件つきの合計・件数が、1試合行の索引から数えた値と一致（9条件×全クラブ）", bad.aggregate, tally.aggregates);
report("1Q〜後半の平均が period-averages.json と一致", bad.average, tally.averages);
report("延長の平均が、延長のあった試合の数で割った値と一致", bad.otAverage, tally.otAverages);
report("感度: 試合ログの2Qを+1すると、索引との照合で検出される", sensitivityDetected === tally.sensitivity ? [] : ["検出できていません"], tally.sensitivity);

if (failed > 0) {
  console.error(`\n${failed}項目が失敗しました`);
  process.exitCode = 1;
} else {
  console.log("\nすべて ok");
}
