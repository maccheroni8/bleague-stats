// 図解「歴代最強ラインナップ」（DESIGN.md 370章）の検証。導出データ（data/best-lineups-{2,3,4,5}.json。scripts/aggregate-best-lineups.ts）と、
// 画面の計算（src/lib/bestLineups.ts）を、既存の画面の計算と、独立した数え直しに突き合わせる:
//  1. 5人組: チーム詳細の5人組の表（src/lib/lineupsByCondition.ts）の値（時間・試合数・得点・失点・攻守のポゼッション）と、全クラブシーズン×試合区分3つで一致し、下限を満たす組がすべて入っている
//  2. 2人・3人: ランキングの「2人／3人の組み合わせ」の計算（src/lib/lineupRanking.ts の buildLineupRows。試合区分ごと）と一致（ランキングが外す前後半5分の特別な試合のあるチームは除く）
//  3. 2〜4人: 5人組の値（lineupsByCondition）から足し上げた時間・得点・失点・ポゼッションと一致し、下限を満たす組がすべて入っている（試合数は足し上げられないので見ない）
//  4. OC: 組の人数を、試合の日の登録区分（2025-26 以前は選手マスタの区分）から数え直した値と一致。数えられない組は -1
//  5. 対象数: 人数×試合区分×OC×下限ごとの組の数が、3 の独立の数え直しと一致（OC ごとの数の合計＋数えられない組＝すべて）
//  6. 画面の計算（人工データ）: 途中で区分が変わった組（OC が2つの行）の足し方・OC の絞り込み、同じ値の順位（小数第2位）、上位の境目の同率、強調クラブの最上位
//  7. 調査の照合: 調査で画面と照合した3組（設計書370章）の値と一致
//
// 使い方: npm run validate:best-lineups（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { compactStints } from "../shared/onCourtTotals.ts";
import { foreignCountInLineup } from "../shared/foreignOnCourt.ts";
import { makeClassifier, type SeasonRegistrationFile } from "../shared/registration.ts";
import { seasonRuleFor } from "../shared/seasonRules.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import { GAME_FLAG_SHORT } from "../shared/gameIndex.ts";
import {
  BEST_LINEUP_MIN_POSS_DEFAULT,
  BEST_LINEUP_MIN_POSS_OPTIONS,
  BEST_LINEUP_SIZES,
  bestLineupFileName,
  type BestLineupSize,
  type BestLineupsFile,
} from "../shared/bestLineups.ts";
import type { GameSummary, PlayerMasterEntry, SeasonRules, TeamStintsFile } from "../shared/types.ts";
import { lineupsByCondition } from "../src/lib/lineupsByCondition.ts";
import { buildLineupRows, type LineupSeasonData } from "../src/lib/lineupRanking.ts";
import { viewPlayerGameIndex } from "../src/lib/gameIndex.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS } from "../src/lib/gameRecordConditions.ts";
import {
  BEST_LINEUP_SLIDER,
  bestLineupGroups,
  bestLineupGroupsInSeason,
  clampBestLineupMin,
  highlightedBest,
  queryBestLineups,
  topBestLineups,
  type BestLineupGameType,
  type BestLineupGroup,
} from "../src/lib/bestLineups.ts";

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

const GAME_TYPES: BestLineupGameType[] = ["regular", "playoff", "both"];
const files = new Map<BestLineupSize, BestLineupsFile>();
for (const size of BEST_LINEUP_SIZES) {
  const f = await readJson<BestLineupsFile>(path.join(DATA_DIR, bestLineupFileName(size).replace(/\.gz$/, "")));
  if (!f) throw new Error(`${bestLineupFileName(size)} がありません。先に npm run build:data を実行してください`);
  files.set(size, f);
}
const groups = new Map<BestLineupSize, BestLineupGroup[]>([...files].map(([s, f]) => [s, bestLineupGroups(f)]));
const seasons = files.get(5)!.seasons;
console.log(`シーズン ${seasons.join("・")}`);
check(
  "対象のシーズンは 2016-17 から今季まで（収録している B.PREMIER の出場区間のあるシーズンすべて。372章）",
  seasons[0] === "2016-17" &&
    JSON.stringify(seasons) ===
      JSON.stringify(
        readdirSync(DATA_DIR)
          .filter((s) => /^\d{4}-\d{2}$/.test(s) && s >= "2016-17" && existsSync(path.join(DATA_DIR, s, "team-stints")))
          .sort(),
      ),
  seasons.join(","),
);

const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
const masterById = new Map(master.map((p) => [p.playerId, p]));
const rules = (await readJson<SeasonRules[]>(path.join(DATA_DIR, "season-rules.json"))) ?? [];

/** 組（シーズン:チーム:選手）→ 独立に数え直した値。[試合区分] = {sec, pts, opp, own, oppPoss}、OC */
interface Indep {
  sums: Record<"regular" | "playoff", number[]>;
  oc: Set<number>;
}
const indep = new Map<BestLineupSize, Map<string, Indep>>(BEST_LINEUP_SIZES.map((s) => [s, new Map()]));
const g1 = new Group("1. 5人組の値がチーム詳細の5人組の表と一致");
const g1all = new Group("1. 下限を満たす5人組（試合区分ごと）がすべて入っている");
const g2 = new Group("2. 2人・3人の値がランキングの組み合わせと一致");
const g4 = new Group("4. OC が登録区分からの数え直しと一致");
let shortTeams = 0;

function choose(ids: string[], k: number): string[][] {
  const out: string[][] = [];
  const rec = (start: number, cur: string[]) => {
    if (cur.length === k) return void out.push([...cur]);
    for (let i = start; i < ids.length; i++) rec(i + 1, [...cur, ids[i]!]);
  };
  rec(0, []);
  return out;
}

for (const season of seasons) {
  const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
  const typeOf = new Map(summaries.map((g) => [g.scheduleKey, g.gameType]));
  const dateOf = new Map(summaries.map((g) => [g.scheduleKey, g.date]));
  const registrations = await readJson<SeasonRegistrationFile>(path.join(DATA_DIR, season, "registrations.json"));
  const classifyAt = makeClassifier(season, registrations, masterById);
  const maxOnCourt = seasonRuleFor(rules, season, "premier")?.maxForeignOnCourt;
  const indexFile = (await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, season, "player-game-index.json")))!;
  const view = viewPlayerGameIndex(indexFile);
  const shortKeys = new Set(indexFile.games.key.filter((_, g) => (indexFile.games.flags[g]! & GAME_FLAG_SHORT) !== 0));
  const dir = path.join(DATA_DIR, season, "team-stints");
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort()) {
    const file = (await readJson<TeamStintsFile>(path.join(dir, name.replace(/\.gz$/, ""))))!;
    const teamId = file.teamId;
    const prefix = `${season}:${teamId}:`;
    // 1. 5人組（試合区分ごと）
    for (const gt of GAME_TYPES) {
      const screen = lineupsByCondition(file, { includeGame: (k) => (gt === "both" ? typeOf.get(k) === "regular" || typeOf.get(k) === "playoff" : typeOf.get(k) === gt), periods: null });
      const ours = new Map(queryBestLineups(groups.get(5)!, { gameType: gt, oc: null, minPoss: 0, sort: "min" }).filter((r) => r.row.group.key.startsWith(prefix)).map((r) => [r.row.group.key, r.row]));
      for (const l of screen.lineups) {
        const key = prefix + l.lineupKey;
        const o = ours.get(key);
        const qualifies = Math.min(l.ownPoss!, l.oppPoss!) >= BEST_LINEUP_MIN_POSS_OPTIONS[5][0]!;
        if (qualifies) g1all.add(!!o, () => `${gt} ${key} が無い`);
        if (!o) continue;
        const a = [o.seconds, o.games, o.ownPoints, o.oppPoints, o.ownPoss, o.oppPoss].join(",");
        const b = [l.secondsPlayed, l.gamesPlayed, l.ownPoints, l.oppPoints, l.ownPoss, l.oppPoss].join(",");
        g1.add(a === b, () => `${gt} ${key}: 図 ${a} / 画面 ${b}`);
      }
    }
    // 3・4 の独立の数え直し（区間ごとに5人の部分集合へ足す。OC は区間の試合の日の区分）
    for (const row of file.rows) {
      const key = file.games[row[0]!]!;
      const gt = typeOf.get(key);
      if (gt !== "regular" && gt !== "playoff") continue;
      const nk = file.countKeys.length;
      const pi = file.countKeys.indexOf("pts");
      const qi = file.countKeys.indexOf("poss");
      const vals = [row[3]! - row[2]!, row[9 + pi]!, row[9 + nk + pi]!, row[9 + qi]!, row[9 + nk + qi]!];
      const five = row.slice(4, 9).map((n) => file.players[n]!).sort();
      for (const size of BEST_LINEUP_SIZES) {
        for (const ids of size === 5 ? [five] : choose(five, size)) {
          const k = `${season}:${teamId}:${ids.join(",")}`;
          let e = indep.get(size)!.get(k);
          if (!e) {
            e = { sums: { regular: [0, 0, 0, 0, 0], playoff: [0, 0, 0, 0, 0] }, oc: new Set() };
            indep.get(size)!.set(k, e);
          }
          vals.forEach((v, i) => (e!.sums[gt][i]! += v));
          const c = foreignCountInLineup(ids, (id) => classifyAt(id, dateOf.get(key)));
          e.oc.add(c === null || (maxOnCourt !== undefined && c > maxOnCourt) ? -1 : c);
        }
      }
    }
    // 2. 2人・3人（ランキングの計算。前後半5分の特別な試合をランキングは外すので、その試合のあるチームは比べない）
    if (file.games.some((k) => shortKeys.has(k))) {
      shortTeams += 1;
      continue;
    }
    const data: LineupSeasonData[] = [{ view, stints: new Map([[teamId, compactStints(file)]]) }];
    for (const unit of ["duo", "trio"] as const) {
      const size: BestLineupSize = unit === "duo" ? 2 : 3;
      for (const gt of GAME_TYPES) {
        const rows = buildLineupRows({ data, unit, gameType: gt, conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], rookies: null, periods: null });
        const ours = new Map(queryBestLineups(groups.get(size)!, { gameType: gt, oc: null, minPoss: 0, sort: "min" }).filter((r) => r.row.group.key.startsWith(prefix)).map((r) => [r.row.group.key, r.row]));
        for (const r of rows) {
          const key = prefix + r.players.map((p) => p.id).sort().join(",");
          const o = ours.get(key);
          if (!o) {
            // 下限は全試合（合算）で判定するので、合算で下限未満なら無くてよい（レギュラー・ポストの漏れは 3 で確かめる）
            g2.add(gt !== "both" || Math.min(r.on.ownPoss, r.on.oppPoss) < BEST_LINEUP_MIN_POSS_OPTIONS[size][0]!, () => `${unit} ${gt} ${key} が無い`);
            continue;
          }
          const a = [o.seconds, o.games, o.ownPoints, o.oppPoints, o.ownPoss, o.oppPoss].join(",");
          const b = [r.on.seconds, r.on.games, r.on.ownPoints, r.on.oppPoints, r.on.ownPoss, r.on.oppPoss].join(",");
          g2.add(a === b, () => `${unit} ${gt} ${key}: 図 ${a} / ランキング ${b}`);
        }
      }
    }
  }
}
g1.report();
g1all.report();
g2.report();
console.log(`   （前後半5分の特別な試合があり、2 で比べなかったクラブシーズン: ${shortTeams}）`);

// 3・4・5
for (const size of BEST_LINEUP_SIZES) {
  const g3 = new Group(`3. ${size}人の値が区間からの独立の数え直しと一致`);
  const g3all = new Group(`3. ${size}人の下限を満たす組がすべて入っている`);
  const byKey = new Map(groups.get(size)!.map((g) => [g.key, g]));
  for (const [k, e] of indep.get(size)!) {
    const both = e.sums.regular.map((v, i) => v + e.sums.playoff[i]!);
    const qualifies = Math.min(both[3]!, both[4]!) >= BEST_LINEUP_MIN_POSS_OPTIONS[size][0]!;
    const g = byKey.get(k);
    if (qualifies) g3all.add(!!g, () => `${k} が無い`);
    else g3all.add(!g, () => `${k} は下限未満なのに入っている`);
    if (!g) continue;
    for (const gt of ["regular", "playoff"] as const) {
      const offset = gt === "regular" ? 0 : 6;
      const sums = [0, 2, 3, 4, 5].map((i) => g.parts.reduce((a, p) => a + p.sums[offset + i]!, 0));
      g3.add(sums.join(",") === e.sums[gt].join(","), () => `${gt} ${k}: 図 ${sums.join(",")} / 数え直し ${e.sums[gt].join(",")}`);
    }
    const ocs = [...e.oc].sort().join(",");
    g4.add(g.parts.map((p) => p.oc).sort().join(",") === ocs, () => `${k}: 図 ${g.parts.map((p) => p.oc).join(",")} / 数え直し ${ocs}`);
  }
  g3.report();
  g3all.report();
}
g4.report();

{
  const g5 = new Group("5. 人数×試合区分×OC×下限の対象数が独立の数え直しと一致");
  const lines: string[] = [];
  for (const size of BEST_LINEUP_SIZES) {
    const list = [...indep.get(size)!.values()];
    const ocValues = [...new Set(list.flatMap((e) => [...e.oc]))].filter((v) => v >= 0).sort();
    for (const gt of GAME_TYPES) {
      for (const min of BEST_LINEUP_MIN_POSS_OPTIONS[size]) {
        const sumOf = (e: Indep) => (gt === "both" ? e.sums.regular.map((v, i) => v + e.sums.playoff[i]!) : e.sums[gt]);
        // 独立の数え直しは、組の OC が1つの組だけを OC で分ける（2つ以上の組は 6 の人工データで確かめる）
        const passes = (e: Indep) => Math.min(sumOf(e)[3]!, sumOf(e)[4]!) >= min && (sumOf(e)[0]! > 0 || sumOf(e).some((v) => v !== 0));
        const all = list.filter(passes).length;
        const ours = queryBestLineups(groups.get(size)!, { gameType: gt, oc: null, minPoss: min, sort: "net" }).length;
        g5.add(all === ours, () => `${size}人 ${gt} ${min}: 図 ${ours} / 数え直し ${all}`);
        const perOc = ocValues.map((oc) => {
          const n = queryBestLineups(groups.get(size)!, { gameType: gt, oc, minPoss: min, sort: "net" }).length;
          const m = list.filter((e) => e.oc.size === 1 && e.oc.has(oc) && passes(e)).length;
          g5.add(n === m, () => `${size}人 ${gt} ${min} OC${oc}: 図 ${n} / 数え直し ${m}`);
          return n;
        });
        const uncounted = list.filter((e) => e.oc.size === 1 && e.oc.has(-1) && passes(e)).length;
        const mixed = list.filter((e) => e.oc.size > 1 && passes(e)).length;
        g5.add(mixed > 0 || perOc.reduce((a, b) => a + b, 0) + uncounted === ours, () => `${size}人 ${gt} ${min}: OC の合計 ${perOc.join("+")}+数えられない${uncounted} ≠ ${ours}`);
        lines.push(`   ${size}人 ${gt.padEnd(7)} ${String(min).padStart(4)}: すべて ${String(ours).padStart(4)}  ${ocValues.map((oc, i) => `OC${oc} ${perOc[i]}`).join("  ")}  数えられない ${uncounted}`);
      }
    }
  }
  g5.report();
  console.log(lines.join("\n"));
}

// 5-2. 範囲（歴代／シーズン）と下限のスライダー（371章）
{
  const g = new Group("5-2. 範囲を1シーズンにした対象数が独立の数え直しと一致（人数×シーズン×試合区分×下限〔スライダーの下端・最初の値・上端〕）");
  const lines: string[] = [];
  for (const size of BEST_LINEUP_SIZES) {
    const sl = BEST_LINEUP_SLIDER[size];
    const file = files.get(size)!;
    check(`5-2. ${size}人 スライダーの下端は導出データの下限（${file.minPoss}）と同じ・最初の値は範囲内で刻みの上`,
      sl.min === file.minPoss && sl.min === BEST_LINEUP_MIN_POSS_OPTIONS[size][0] && BEST_LINEUP_MIN_POSS_DEFAULT[size] >= sl.min && BEST_LINEUP_MIN_POSS_DEFAULT[size] <= sl.max
        && (BEST_LINEUP_MIN_POSS_DEFAULT[size] - sl.min) % sl.step === 0 && (sl.max - sl.min) % sl.step === 0, JSON.stringify(sl));
    check(`5-2. ${size}人 下限の丸め（下端未満は下端・上端超は上端）`, clampBestLineupMin(size, 0) === sl.min && clampBestLineupMin(size, 99999) === sl.max && clampBestLineupMin(size, BEST_LINEUP_MIN_POSS_DEFAULT[size]) === BEST_LINEUP_MIN_POSS_DEFAULT[size]);
    const list = [...indep.get(size)!.entries()];
    for (const season of seasons) {
      const inSeason = bestLineupGroupsInSeason(groups.get(size)!, season);
      g.add(inSeason.every((x) => x.season === season), () => `${size}人 ${season} に別のシーズンが混ざる`);
      for (const gt of GAME_TYPES) {
        for (const min of [sl.min, BEST_LINEUP_MIN_POSS_DEFAULT[size], sl.max]) {
          const ours = queryBestLineups(inSeason, { gameType: gt, oc: null, minPoss: min, sort: "net" }).length;
          const theirs = list.filter(([k, e]) => {
            if (!k.startsWith(`${season}:`)) return false;
            const sum = gt === "both" ? e.sums.regular.map((v, i) => v + e.sums.playoff[i]!) : e.sums[gt];
            return Math.min(sum[3]!, sum[4]!) >= min && (sum[0]! > 0 || sum.some((v) => v !== 0));
          }).length;
          g.add(ours === theirs, () => `${size}人 ${season} ${gt} ${min}: 図 ${ours} / 数え直し ${theirs}`);
          if (gt === "regular" && min === BEST_LINEUP_MIN_POSS_DEFAULT[size]) lines.push(`   ${size}人 ${season} 最初の値(${min}): ${ours}組`);
        }
      }
    }
    // 歴代＝シーズン別の合計（組はシーズンをまたがない）
    const all = queryBestLineups(groups.get(size)!, { gameType: "regular", oc: null, minPoss: BEST_LINEUP_MIN_POSS_DEFAULT[size], sort: "net" }).length;
    const sum = seasons.reduce((n, season) => n + queryBestLineups(bestLineupGroupsInSeason(groups.get(size)!, season), { gameType: "regular", oc: null, minPoss: BEST_LINEUP_MIN_POSS_DEFAULT[size], sort: "net" }).length, 0);
    check(`5-2. ${size}人 歴代の対象数＝シーズン別の合計`, all === sum, `${all} / ${sum}`);
  }
  g.report();
  console.log(lines.join("\n"));
}

// 6. 人工データ
{
  const fake: BestLineupsFile = {
    version: 1,
    size: 2,
    minPoss: 0,
    seasons: ["2026-27"],
    latestDates: {},
    teams: [[0, "A", "チームA"], [0, "B", "チームB"], [0, "C", "チームC"]],
    players: [["1", "一"], ["2", "二"], ["3", "三"], ["4", "四"]],
    rows: [
      // チームA 1・2: 途中で区分が変わり OC1 と OC2 に分かれた組
      [0, 0, 1, 1, 600, 3, 30, 20, 25, 25, 0, 0, 0, 0, 0, 0],
      [0, 0, 1, 2, 600, 2, 20, 30, 25, 25, 60, 1, 10, 5, 10, 10],
      // チームB 3・4: NetRtg が小数第2位で同じ（1/3 と 2/6）
      [1, 2, 3, 0, 300, 2, 101, 100, 300, 300, 0, 0, 0, 0, 0, 0],
      [2, 2, 3, 0, 300, 2, 202, 200, 600, 600, 0, 0, 0, 0, 0, 0],
    ],
  };
  const gs = bestLineupGroups(fake);
  const all = queryBestLineups(gs, { gameType: "regular", oc: null, minPoss: 0, sort: "net" });
  const a = all.find((r) => r.row.group.teamId === "A")!;
  check("6. 区分が変わった組は OC の部分を足して1行（すべて）", gs.length === 3 && a.row.seconds === 1200 && a.row.ownPoints === 50 && a.row.ownPoss === 50 && a.row.games === 5);
  const oc2 = queryBestLineups(gs, { gameType: "both", oc: 2, minPoss: 0, sort: "net" });
  check("6. OC で絞ると、その OC の部分だけの値", oc2.length === 1 && oc2[0]!.row.seconds === 660 && oc2[0]!.row.ownPoss === 35 && oc2[0]!.row.games === 3);
  check("6. 下限は絞った後の値で判定", queryBestLineups(gs, { gameType: "regular", oc: 1, minPoss: 26, sort: "net" }).length === 0);
  const b = all.filter((r) => r.row.group.teamId !== "A");
  check("6. 小数第2位で同じ値は同じ順位（次は飛ばす）", b.length === 2 && b[0]!.rank === b[1]!.rank && all.find((r) => r.row.group.teamId === "A")!.rank === 3, JSON.stringify(all.map((r) => [r.row.group.teamId, r.rank, r.row.net])));
  check("6. 上位の境目の同率はすべて出す", topBestLineups(all.filter((r) => r.row.group.teamId !== "A"), 1).length === 2);
  const def = queryBestLineups(gs, { gameType: "regular", oc: null, minPoss: 0, sort: "def" });
  check("6. DRtg は低い順", def[0]!.row.def! <= def[def.length - 1]!.row.def!);
  const top1 = topBestLineups(all, 1);
  const hb = highlightedBest(all, top1, ["C", "A", "Z"]);
  check("6. 強調クラブが表示中に無ければ最上位と全体の順位、組が無ければ null（表示中のクラブは出さない）", hb.length === 2 && hb[0]!.best?.row.group.teamId === "A" && hb[0]!.best.rank === 3 && hb[1]!.best === null, JSON.stringify(hb.map((h) => [h.teamId, h.best?.rank])));
}

// 7. 調査で画面と照合した組（レギュラーシーズン・試合全体。2026-11-07 の画面）
{
  const known = [
    { team: "729", season: "2022-23", min: "174:38", net: 45.2, off: 133.02, def: 87.81 },
    { team: "697", season: "2023-24", min: "217:41", net: 40.65, off: 144.7, def: 104.05 },
    { team: "720", season: "2024-25", min: "189:22", net: 26.66, off: 111.45, def: 84.78 },
  ];
  const all = queryBestLineups(groups.get(5)!, { gameType: "regular", oc: null, minPoss: 100, sort: "min" });
  for (const k of known) {
    const mm = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
    const hit = all.find((r) => r.row.group.teamId === k.team && r.row.group.season === k.season && mm(r.row.seconds) === k.min);
    const ok = !!hit && hit.row.net!.toFixed(2) === k.net.toFixed(2) && hit.row.off!.toFixed(2) === k.off.toFixed(2) && hit.row.def!.toFixed(2) === k.def.toFixed(2);
    check(`7. 調査の照合 ${k.season} ${k.team} ${k.min}`, ok, hit ? `${hit.row.net} ${hit.row.off} ${hit.row.def}` : "見つからない");
  }
}

if (failures > 0) {
  console.error(`\n${failures}件の検証が失敗しました`);
  process.exit(1);
}
console.log("\nすべての検証が通りました");
