// ランキング > 個人 > 達成記録（DESIGN.md 223章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 導出データを作ったあと（`npm run build:data` のあと）に実行する。索引を使う集計（src/lib/thresholdQuery.ts）の結果を、
// 独立した元（選手の試合ログ player-games/、games-summary.json、players.json、registered-players.json）から素直に数え直した結果と比べる:
//  1. DD（2桁の部門数が2以上）の試合数が、シーズンの players.json の doubleDoubles（レギュラーシーズン）と全選手で一致する
//  2. 達成試合数: しきい値6通り × 試合区分3 × 条件4 × 範囲（通算・2025-26）。全選手の達成試合数・出場試合数・並び。達成率の並びと掲載基準（所属チームの試合数の85%）
//  （連続記録の名簿は、集計側は player-careers.json の seasons、数え直しは players.json＋registered-players.json と、別の元を使う）
//  3. 連続記録: しきい値5通り × 試合区分2 × 条件3。全選手の最長（長さ・開始と終了の試合・継続中）と、「継続中だけ」の長さ。名簿外のシーズンをはさむと途切れる
//  4. 年齢の記録: しきい値4通り × 試合区分3 × 条件2 × 最年少・最年長。全選手の年齢・試合
//  5. 前後半5分の特別な試合を含める指定、空のしきい値、感度（しきい値を1変えると結果が変わる）
//
// 使い方: npm run validate:threshold-query（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import type { GameSummary, PlayerCareersFile, PlayerGameLog, PlayerSummary } from "../shared/types.ts";
import { viewPlayerGameIndex, type PlayerGameIndexView } from "../src/lib/gameIndex.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS, type GameRecordConditions } from "../src/lib/gameRecordConditions.ts";
import type { StatConditionOp, StatConditionsState } from "../src/lib/statConditions.ts";
import {
  queryThresholdAge,
  queryThresholdCount,
  queryThresholdStreaks,
  type ThresholdAgeWhich,
  type ThresholdCountSort,
} from "../src/lib/thresholdQuery.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

/** 多数の比較を1つのチェックにまとめる */
class Group {
  total = 0;
  bad: string[] = [];
  constructor(readonly label: string) {}
  add(ok: boolean, detail: () => string): void {
    this.total += 1;
    if (!ok && this.bad.length < 5) this.bad.push(detail());
    if (!ok) this.badCount += 1;
  }
  badCount = 0;
  report(): void {
    check(`${this.label}（${this.total}件）`, this.badCount === 0, `${this.badCount}件の食い違い\n   ${this.bad.join("\n   ")}`);
  }
}

const ALL = 1_000_000;
type GameType = "regular" | "playoff" | "both";
const GAME_TYPES: GameType[] = ["regular", "playoff", "both"];
/** 前後半5分ずつの特別な試合（2016-17・2017-18のCS。DESIGN.md 220-4） */
const SHORT_KEYS = new Set(["1330", "1333", "2690", "2693"]);

// ---- 読み込み ----
const seasons = readdirSync(DATA_DIR)
  .filter((s) => /^\d{4}-\d{2}$/.test(s) && existsSync(path.join(DATA_DIR, s, "player-game-index.json.gz")))
  .sort();
const views: PlayerGameIndexView[] = [];
for (const s of seasons) views.push(viewPlayerGameIndex((await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, s, "player-game-index.json")))!));

interface Log extends PlayerGameLog {
  season: string;
  seasonIndex: number;
  playerId: string;
  teamId: string;
}
const logsByPlayer = new Map<string, Log[]>();
const present: Set<string>[] = []; // 名簿（players.json＋registered-players.json）
const birthById = new Map<string, string>();
const summaryOf = new Map<string, GameSummary>(); // season:key
const teamGames = new Map<string, number>(); // season:type:teamId（特別な試合を除く）
const doubleDoublesByJson = new Map<string, number>(); // season:playerId
for (let si = 0; si < seasons.length; si++) {
  const s = seasons[si]!;
  // 終了した試合だけ（進行中の試合は、要約にはあるが、索引・試合ログには入らない）
  const summaries = ((await readJson<GameSummary[]>(path.join(DATA_DIR, s, "games-summary.json"))) ?? []).filter(
    (x) => (x.gameType === "regular" || x.gameType === "playoff") && x.gameEndedFlg,
  );
  for (const x of summaries) {
    summaryOf.set(`${s}:${x.scheduleKey}`, x);
    if (SHORT_KEYS.has(x.scheduleKey)) continue;
    for (const t of [x.homeTeamId, x.awayTeamId]) {
      const k = `${s}:${x.gameType}:${t}`;
      teamGames.set(k, (teamGames.get(k) ?? 0) + 1);
    }
  }
  const players = (await readJson<PlayerSummary[]>(path.join(DATA_DIR, s, "players.json"))) ?? [];
  const registered = (await readJson<PlayerSummary[]>(path.join(DATA_DIR, s, "registered-players.json"))) ?? [];
  present.push(new Set([...players, ...registered].map((p) => p.playerId)));
  for (const p of [...players, ...registered]) if (p.birthDate && !birthById.has(p.playerId)) birthById.set(p.playerId, p.birthDate);
  for (const p of players) doubleDoublesByJson.set(`${s}:${p.playerId}`, p.totals.doubleDoubles);
  const dir = path.join(DATA_DIR, s, "player-games");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json.gz"))) {
    const id = f.replace(/\.json\.gz$/, "");
    for (const g of (await readJson<PlayerGameLog[]>(path.join(dir, `${id}.json`))) ?? []) {
      const sum = summaryOf.get(`${s}:${g.scheduleKey}`);
      if (g.min <= 0 || !sum) continue;
      const log: Log = { ...g, season: s, seasonIndex: si, playerId: id, teamId: g.isHome ? sum.homeTeamId : sum.awayTeamId };
      (logsByPlayer.get(id) ?? logsByPlayer.set(id, []).get(id)!).push(log);
    }
  }
}
for (const logs of logsByPlayer.values()) logs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.scheduleKey < b.scheduleKey ? -1 : a.scheduleKey > b.scheduleKey ? 1 : 0));
const currentIds = present[present.length - 1]!;
const careers = (await readJson<PlayerCareersFile>(path.join(DATA_DIR, "player-careers.json")))!;
const nameById = new Map<string, string>();
for (const v of views) for (const p of v.file.players) nameById.set(p[0], p[1]);
console.log(`シーズン ${seasons.length}、選手 ${logsByPlayer.size}、試合ログの行 ${[...logsByPlayer.values()].reduce((a, l) => a + l.length, 0)}`);

// ---- 独立した判定 ----
interface Cond {
  key: string;
  op: StatConditionOp;
  v: number;
}
interface Spec {
  label: string;
  match: "all" | "any";
  conds: Cond[];
}
const DD_KEYS = ["pts", "reb", "ast", "stl", "blk"] as const;
function valueOf(l: Log, key: string): number {
  if (key === "ddCats") return DD_KEYS.filter((k) => l[k] >= 10).length;
  if (key === "min") return Math.round(l.min * 60) / 60;
  return (l as unknown as Record<string, number>)[key]!;
}
const specHit = (l: Log, spec: Spec): boolean => {
  const f = (c: Cond) => (c.op === "gte" ? valueOf(l, c.key) >= c.v : valueOf(l, c.key) <= c.v);
  return spec.match === "any" ? spec.conds.some(f) : spec.conds.every(f);
};
const stateOf = (spec: Spec): StatConditionsState => ({
  match: spec.match,
  conditions: spec.conds.map((c, i) => ({ id: i + 1, key: c.key, op: c.op, value: String(c.v) })),
});
const ge = (key: string, v: number): Cond => ({ key, op: "gte", v });
const le = (key: string, v: number): Cond => ({ key, op: "lte", v });
const SPEC_PTS20: Spec = { label: "PTS≥20", match: "all", conds: [ge("pts", 20)] };
const SPEC_REB10: Spec = { label: "TR≥10", match: "all", conds: [ge("reb", 10)] };
const SPEC_TPM5: Spec = { label: "3PM≥5", match: "all", conds: [ge("tpm", 5)] };
const SPEC_DD: Spec = { label: "DD", match: "all", conds: [ge("ddCats", 2)] };
const SPEC_NOTOV: Spec = { label: "TOV≤0かつMIN≥20", match: "all", conds: [le("tov", 0), ge("min", 20)] };
const SPEC_ANY: Spec = { label: "PTS≥30またはAST≥10", match: "any", conds: [ge("pts", 30), ge("ast", 10)] };

const conds: { label: string; c: GameRecordConditions; ok: (l: Log) => boolean }[] = [
  { label: "条件なし", c: DEFAULT_GAME_RECORD_CONDITIONS, ok: () => true },
  { label: "勝った試合", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" }, ok: (l) => l.win },
  { label: "ホーム×負けた試合", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, homeAway: "home", result: "loss" }, ok: (l) => l.isHome && !l.win },
  { label: "延長あり", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, overtime: "any" }, ok: (l) => (l.overtimes ?? 0) >= 1 },
];
const typeOk = (l: Log, t: GameType) => (t === "both" ? true : l.gameType === t);
const isShort = (l: Log) => SHORT_KEYS.has(l.scheduleKey);

/** 独立した数え直しの対象の試合（種類・条件・特別な試合・シーズン） */
function logsFor(id: string, t: GameType, cond: (l: Log) => boolean, seasonSel: string | null, includeSpecial = false): Log[] {
  return (logsByPlayer.get(id) ?? []).filter((l) => (seasonSel === null || l.season === seasonSel) && typeOk(l, t) && cond(l) && (includeSpecial || !isShort(l)));
}

const base = (v: PlayerGameIndexView[], gameType: GameType, c: GameRecordConditions, spec: Spec, includeSpecial = false) => ({
  views: v,
  gameType,
  conditions: c,
  group: "all" as const,
  positions: [] as string[],
  rookies: null,
  threshold: stateOf(spec),
  includeSpecial,
  topN: ALL,
});

// ---- 1. DD ----
{
  const g = new Group("DD（2桁の部門数が2以上）の試合数が、players.json の doubleDoubles（レギュラーシーズン）と全選手で一致");
  for (let si = 0; si < seasons.length; si++) {
    const s = seasons[si]!;
    const res = queryThresholdCount({ ...base([views[si]!], "regular", DEFAULT_GAME_RECORD_CONDITIONS, SPEC_DD, true), sort: "count" })!;
    const mine = new Map(res.rows.map((r) => [r.playerId, r.count]));
    for (const [k, want] of doubleDoublesByJson) {
      if (!k.startsWith(`${s}:`)) continue;
      const id = k.slice(s.length + 1);
      g.add((mine.get(id) ?? 0) === want, () => `${k} json=${want} 索引=${mine.get(id) ?? 0}`);
    }
  }
  g.report();
}

// ---- 2. 達成試合数 ----
{
  const specs = [SPEC_PTS20, SPEC_REB10, SPEC_TPM5, SPEC_DD, SPEC_NOTOV, SPEC_ANY];
  const g = new Group("達成試合数: 全選手の達成試合数・出場試合数・並びが、試合ログの数え直しと一致（しきい値6 × 試合区分3 × 条件4 × 通算・2025-26）");
  const gRate = new Group("達成率: 掲載基準（所属チームの試合数の85%）を満たす選手だけが、達成率の高い順に並ぶ");
  let sampleTop = "";
  for (const spec of specs) {
    for (const t of GAME_TYPES) {
      for (const cond of conds) {
        for (const seasonSel of [null, "2025-26"]) {
          const vs = seasonSel === null ? views : [views[seasons.indexOf(seasonSel)]!];
          const res = queryThresholdCount({ ...base(vs, t, cond.c, spec), sort: "count" })!;
          // 独立した数え直し
          const expected = new Map<string, { n: number; g: number }>();
          for (const id of logsByPlayer.keys()) {
            const ls = logsFor(id, t, cond.ok, seasonSel);
            const n = ls.filter((l) => specHit(l, spec)).length;
            if (n > 0) expected.set(id, { n, g: ls.length });
          }
          const label = `${spec.label} ${t} ${cond.label} ${seasonSel ?? "通算"}`;
          g.add(
            res.rows.length === expected.size && res.rows.every((r) => expected.get(r.playerId)?.n === r.count && expected.get(r.playerId)?.g === r.games),
            () => `${label}: 索引 ${res.rows.length}人 / 数え直し ${expected.size}人`,
          );
          // 並び: 達成試合数の多い順→達成率の高い順→選手ID、順位は同じ達成試合数で同じ
          let orderOk = true;
          for (let i = 1; i < res.rows.length && orderOk; i++) {
            const a = res.rows[i - 1]!;
            const b = res.rows[i]!;
            orderOk = a.count > b.count || (a.count === b.count && (a.rate > b.rate || (a.rate === b.rate && a.playerId < b.playerId)));
            const wantRank = a.count === b.count ? a.rank : i + 1;
            if (b.rank !== wantRank) orderOk = false;
          }
          g.add(orderOk, () => `${label}: 並び・順位`);
          if (spec === SPEC_PTS20 && t === "both" && cond.label === "条件なし" && seasonSel === null) {
            sampleTop = res.rows.slice(0, 5).map((r) => `${nameById.get(r.playerId)} ${r.count}/${r.games}`).join(" / ");
          }
          // 達成率
          const rate = queryThresholdCount({ ...base(vs, t, cond.c, spec), sort: "rate" })!;
          const eligible = new Set<string>();
          for (const id of logsByPlayer.keys()) {
            let played = 0;
            let denom = 0;
            for (let si = 0; si < seasons.length; si++) {
              if (seasonSel !== null && seasons[si] !== seasonSel) continue;
              const ls = (logsByPlayer.get(id) ?? []).filter((l) => l.seasonIndex === si && typeOk(l, t) && !isShort(l));
              if (ls.length === 0) continue;
              played += ls.length;
              // シーズンの最後の試合のチームの、その試合区分の試合数。両方のときは両区分の合計
              const last = ls[ls.length - 1]!;
              denom += (["regular", "playoff"] as const).filter((tt) => t === "both" || t === tt).reduce((a, tt) => a + (teamGames.get(`${seasons[si]}:${tt}:${last.teamId}`) ?? 0), 0);
            }
            if (denom > 0 && played / denom >= 0.85) eligible.add(id);
          }
          const expRate = [...expected.entries()]
            .filter(([id]) => eligible.has(id))
            .map(([id, e]) => ({ id, n: e.n, r: e.n / e.g }))
            .sort((a, b) => b.r - a.r || b.n - a.n || (a.id < b.id ? -1 : 1));
          gRate.add(
            rate.rows.length === expRate.length && rate.rows.every((r, i) => r.playerId === expRate[i]!.id && r.value === expRate[i]!.r),
            () => `${label}: 達成率 索引 ${rate.rows.length}人 / 数え直し ${expRate.length}人`,
          );
        }
      }
    }
  }
  g.report();
  gRate.report();
  console.log(`   例（PTS≥20・通算・レギュラー+ポスト）: ${sampleTop}`);
}

// ---- 3. 連続記録 ----
{
  const specs = [SPEC_PTS20, { ...SPEC_PTS20, label: "PTS≥10", conds: [ge("pts", 10)] }, { ...SPEC_TPM5, label: "3PM≥1", conds: [ge("tpm", 1)] }, SPEC_DD, SPEC_NOTOV];
  const cs = conds.slice(0, 3);
  const g = new Group("連続記録: 全選手の最長（長さ・開始と終了の試合・継続中）が、試合ログの数え直しと一致（しきい値5 × 試合区分2 × 条件3）");
  const gOngoing = new Group("連続記録（継続中だけ）: 今続いている連続の長さと開始の試合が一致");
  const gap = new Group("名簿外のシーズンをはさむ連続は途切れる（試合ログで間のシーズンの名簿を見て数え直した結果と一致）");
  let gapCases = 0;
  const sample: string[] = [];
  for (const spec of specs) {
    for (const t of ["regular", "playoff"] as const) {
      for (const cond of cs) {
        const label = `${spec.label} ${t} ${cond.label}`;
        const q = { ...base(views, t, cond.c, spec), gameType: t, rosters: careers.seasons, currentIds, ongoingOnly: false };
        const best = queryThresholdStreaks(q)!;
        const cur = queryThresholdStreaks({ ...q, ongoingOnly: true })!;
        // 独立した数え直し
        const expBest = new Map<string, { len: number; start: string; end: string; ongoing: boolean }>();
        const expCur = new Map<string, { len: number; start: string; end: string }>();
        for (const id of logsByPlayer.keys()) {
          const ls = logsFor(id, t, cond.ok, null);
          let run: { len: number; start: Log; end: Log } | null = null;
          let b: typeof run = null;
          let prev: Log | null = null;
          for (const l of ls) {
            if (run && prev && l.seasonIndex - prev.seasonIndex > 1) {
              for (let k = prev.seasonIndex + 1; k < l.seasonIndex; k++) if (!present[k]!.has(id)) run = null;
            }
            if (specHit(l, spec)) {
              if (!run) run = { len: 0, start: l, end: l };
              run.len += 1;
              run.end = l;
              if (!b || run.len >= b.len) b = run;
            } else run = null;
            prev = l;
          }
          if (!b) continue;
          // 継続中: 今季の名簿の選手で、最後に見た試合から最新のシーズンまで名簿にいる
          let ongoing = !!run && run === b && currentIds.has(id);
          let runOngoing = !!run && currentIds.has(id);
          if (prev) for (let k = prev.seasonIndex + 1; k < seasons.length; k++) if (!present[k]!.has(id)) { ongoing = false; runOngoing = false; }
          expBest.set(id, { len: b.len, start: b.start.scheduleKey, end: b.end.scheduleKey, ongoing });
          if (run && runOngoing) expCur.set(id, { len: run.len, start: run.start.scheduleKey, end: run.end.scheduleKey });
        }
        g.add(
          best.rows.length === expBest.size &&
            best.rows.every((r) => {
              const e = expBest.get(r.playerId);
              return !!e && e.len === r.value && e.start === r.start.scheduleKey && e.end === r.end.scheduleKey && e.ongoing === r.ongoing;
            }),
          () => `${label}: 索引 ${best.rows.length}人 / 数え直し ${expBest.size}人 ${JSON.stringify(best.rows.filter((r) => { const e = expBest.get(r.playerId); return !e || e.len !== r.value || e.start !== r.start.scheduleKey || e.ongoing !== r.ongoing; }).slice(0, 2).map((r) => [r.playerId, r.value, r.start.scheduleKey, r.ongoing]))}`,
        );
        let orderOk = true;
        for (let i = 1; i < best.rows.length && orderOk; i++) {
          const a = best.rows[i - 1]!;
          const b2 = best.rows[i]!;
          orderOk = a.value > b2.value || (a.value === b2.value && a.playerId < b2.playerId);
          if (b2.rank !== (a.value === b2.value ? a.rank : i + 1)) orderOk = false;
        }
        g.add(orderOk, () => `${label}: 並び・順位`);
        gOngoing.add(
          cur.rows.length === expCur.size && cur.rows.every((r) => expCur.get(r.playerId)?.len === r.value && expCur.get(r.playerId)?.start === r.start.scheduleKey && r.ongoing),
          () => `${label}: 継続中 索引 ${cur.rows.length}人 / 数え直し ${expCur.size}人`,
        );
        if (spec.label === "PTS≥10" && t === "regular" && cond.label === "条件なし") sample.push(best.rows.slice(0, 6).map((r) => `${nameById.get(r.playerId)} ${r.value}${r.ongoing ? "（継続中）" : ""}`).join(" / "));
        // 名簿外のシーズンをはさむ連続: 途切れる規則を外した長さと比べ、違うのは「間に名簿外のシーズンがある」選手だけ
        const noGap = new Map<string, number>();
        for (const id of logsByPlayer.keys()) {
          let r = 0;
          let b = 0;
          for (const l of logsFor(id, t, cond.ok, null)) {
            if (specHit(l, spec)) b = Math.max(b, ++r);
            else r = 0;
          }
          if (b > 0) noGap.set(id, b);
        }
        for (const r of best.rows) {
          const withoutRule = noGap.get(r.playerId)!;
          if (withoutRule !== r.value) gapCases += 1;
          const ls = logsFor(r.playerId, t, cond.ok, null);
          const hasAbsent = ls.some((l, i) => i > 0 && l.seasonIndex - ls[i - 1]!.seasonIndex > 1 && Array.from({ length: l.seasonIndex - ls[i - 1]!.seasonIndex - 1 }, (_, k) => ls[i - 1]!.seasonIndex + 1 + k).some((k) => !present[k]!.has(r.playerId)));
          gap.add(withoutRule >= r.value && (withoutRule === r.value || hasAbsent), () => `${label} ${r.playerId}: 規則なし ${withoutRule} / 索引 ${r.value}`);
        }
      }
    }
  }
  g.report();
  gOngoing.report();
  gap.report();
  console.log(`   名簿外のシーズンをはさむ規則で長さが変わった選手（全パターンの合計）: ${gapCases}件`);
  check("感度: 名簿外のシーズンをはさむ規則で長さが変わる選手がいる", gapCases > 0, String(gapCases));
  console.log(`   例（PTS≥10・レギュラー・条件なし）: ${sample[0]}`);
}

// ---- 4. 年齢の記録 ----
{
  /** 試合当日の年齢を、shared/gameAge.ts とは別の書き方で出す（2月29日生まれは平年は2月28日に年を取る） */
  function ageAlt(birth: string, date: string): [number, number] {
    const [by, bm, bd] = birth.split("-").map(Number) as [number, number, number];
    const [gy, gm, gd] = date.split("-").map(Number) as [number, number, number];
    const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const bday = (y: number): Date => (bm === 2 && bd === 29 && !leap(y) ? new Date(Date.UTC(y, 1, 28)) : new Date(Date.UTC(y, bm - 1, bd)));
    const game = new Date(Date.UTC(gy, gm - 1, gd));
    let years = gy - by;
    let last = bday(gy);
    if (game < last) {
      years -= 1;
      last = bday(gy - 1);
    }
    return [years, Math.round((game.getTime() - last.getTime()) / 86400000)];
  }
  const specs = [SPEC_PTS20, { ...SPEC_PTS20, label: "PTS≥10", conds: [ge("pts", 10)] }, SPEC_TPM5, SPEC_DD];
  const g = new Group("年齢の記録: 全選手の達成時の年齢・試合が、試合ログと別の書き方の年齢計算で一致（しきい値4 × 試合区分3 × 条件2 × 最年少・最年長）");
  let unknownMax = 0;
  const sample: string[] = [];
  for (const spec of specs) {
    for (const t of GAME_TYPES) {
      for (const cond of conds.slice(0, 2)) {
        for (const which of ["young", "old"] as ThresholdAgeWhich[]) {
          const res = queryThresholdAge({ ...base(views, t, cond.c, spec), which })!;
          const exp = new Map<string, { age: [number, number]; key: string }>();
          let unknown = 0;
          for (const id of logsByPlayer.keys()) {
            const hits = logsFor(id, t, cond.ok, null).filter((l) => specHit(l, spec));
            if (hits.length === 0) continue;
            const pick = which === "young" ? hits[0]! : hits[hits.length - 1]!;
            const birth = birthById.get(id);
            if (!birth) {
              unknown += 1;
              continue;
            }
            exp.set(id, { age: ageAlt(birth, pick.date), key: pick.scheduleKey });
          }
          unknownMax = Math.max(unknownMax, unknown);
          const label = `${spec.label} ${t} ${cond.label} ${which}`;
          g.add(
            res.unknownBirth === unknown &&
              res.rows.length === exp.size &&
              res.rows.every((r) => {
                const e = exp.get(r.playerId);
                return !!e && e.age[0] === r.age.years && e.age[1] === r.age.days && e.key === r.scheduleKey;
              }),
            () => `${label}: 索引 ${res.rows.length}人（生年月日なし ${res.unknownBirth}）/ 数え直し ${exp.size}人（${unknown}）`,
          );
          let orderOk = true;
          for (let i = 1; i < res.rows.length && orderOk; i++) {
            const a = res.rows[i - 1]!;
            const b = res.rows[i]!;
            const d = which === "young" ? a.value - b.value : b.value - a.value;
            orderOk = d < 0 || (d === 0 && (a.date < b.date || (a.date === b.date && a.playerId < b.playerId)));
            if (b.rank !== (a.value === b.value ? a.rank : i + 1)) orderOk = false;
          }
          g.add(orderOk, () => `${label}: 並び・順位`);
          if (spec === SPEC_PTS20 && t === "both" && cond.label === "条件なし") sample.push(`${which}: ${res.rows.slice(0, 3).map((r) => `${nameById.get(r.playerId)} ${r.age.years}歳${r.age.days}日`).join(" / ")}`);
        }
      }
    }
  }
  g.report();
  console.log(`   生年月日が無く除いた選手は最大 ${unknownMax} 人。例（PTS≥20・合算）: ${sample.join(" ／ ")}`);
}

// ---- 5. 特別な試合・空のしきい値・感度 ----
{
  const spec: Spec = { label: "PTS≥10", match: "all", conds: [ge("pts", 10)] };
  const total = (r: ReturnType<typeof queryThresholdCount>) => r!.rows.reduce((a, x) => a + x.count, 0);
  const without = total(queryThresholdCount({ ...base(views, "playoff", DEFAULT_GAME_RECORD_CONDITIONS, spec), sort: "count" }));
  const withShort = total(queryThresholdCount({ ...base(views, "playoff", DEFAULT_GAME_RECORD_CONDITIONS, spec, true), sort: "count" }));
  let expectedShortHits = 0;
  for (const ls of logsByPlayer.values()) expectedShortHits += ls.filter((l) => l.gameType === "playoff" && isShort(l) && l.pts >= 10).length;
  check(`特別な試合を含めると、ポストシーズンのPTS≥10の達成が ${expectedShortHits} 件増える（除く ${without} → 含める ${withShort}）`, withShort - without === expectedShortHits && expectedShortHits > 0, `${withShort - without} / ${expectedShortHits}`);
  const flagged = new Set<string>();
  for (const v of views) for (let g = 0; g < v.file.games.key.length; g++) if ((v.file.games.flags[g]! & 2) !== 0) flagged.add(v.file.games.key[g]!);
  check("索引の特別な試合の旗が、この検証の4試合と一致", flagged.size === SHORT_KEYS.size && [...flagged].every((k) => SHORT_KEYS.has(k)), [...flagged].join(","));
  const emptyState: StatConditionsState = { match: "all", conditions: [{ id: 1, key: "pts", op: "gte", value: "" }] };
  check(
    "値の入っていないしきい値は null（集計しない）",
    queryThresholdCount({ ...base(views, "regular", DEFAULT_GAME_RECORD_CONDITIONS, spec), threshold: emptyState, sort: "count" }) === null &&
      queryThresholdAge({ ...base(views, "regular", DEFAULT_GAME_RECORD_CONDITIONS, spec), threshold: emptyState, which: "young" }) === null,
  );
  // 感度: しきい値を1つ変える・条件を取り違えると結果が変わる
  const a = queryThresholdCount({ ...base(views, "regular", DEFAULT_GAME_RECORD_CONDITIONS, SPEC_PTS20), sort: "count" })!;
  const b = queryThresholdCount({ ...base(views, "regular", DEFAULT_GAME_RECORD_CONDITIONS, { ...SPEC_PTS20, conds: [ge("pts", 21)] }), sort: "count" })!;
  const c = queryThresholdCount({ ...base(views, "regular", cond1(), SPEC_PTS20), sort: "count" })!;
  check("感度: しきい値を20→21にすると達成試合数の合計が減り、勝った試合に絞っても減る", total(b) < total(a) && total(c) < total(a), `${total(a)} / ${total(b)} / ${total(c)}`);
}

function cond1(): GameRecordConditions {
  return { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" };
}

console.log(failures === 0 ? "\nすべて ok" : `\n${failures} 件の食い違い`);
process.exit(failures === 0 ? 0 : 1);
