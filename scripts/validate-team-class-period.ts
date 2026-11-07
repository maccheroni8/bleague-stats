// 登録区分とQ別・前後半・延長を一緒に選んだときの、チームの成績（src/lib/teamClassSplit.ts の sumClassTotals / classSideValues の区間つき）の検証
// （検証専用。CIには入れず、手で実行する。`npm run build:data` のあとに実行する）。DESIGN.md 344章。
//
// 確かめること:
//  1. 選手のピリオド別の行を、この検証の中で独立に（索引の行→チームの行・区分を引き直して）手で足した値と、区間つきの値が一致する
//     （日本人・外国籍・帰化・アジア特別枠・外国籍等のまとめ／1Q〜4Q・前半・後半・延長）
//  2. 日本人＋外国籍等＋区分なし ＝ チームのピリオド別の索引の値（得点。試合ごと・区間ごと）
//  3. 区間つきで数える試合が、チームの区間別（sumTeamPeriodTotals）と同じ試合
//  4. 1Q＋2Q＋3Q＋4Q＋延長 ＝ 試合全体の値（前後半5分の特別な試合・手入力の試合を除く）
//  5. 区間を選ばないとき（試合全体）の値が変わっていないことは、作業中に変更前の関数と全シーズン・全チームで比べて確かめた（344章）。ここでは 4. で試合全体との関係を見る
//  6. 感度: 索引を1か所壊すと食い違いとして検出される
// B.PREMIER と B.ONE の両方。使い方: npm run validate:team-class-period [シーズン…]。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import { PERIOD_ATOMS, type PlayerPeriodIndexFile, type TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { TeamGameLog, TeamSummary } from "../shared/types.ts";
import { buildClassSplitSource, classSideValues, sumClassTotals, type TeamClassSelection } from "../src/lib/teamClassSplit";
import { PERIOD_ATOM_INDEXES, type GameRecordPeriod } from "../src/lib/periodIndex";
import { ROW_FLAG_HOME } from "../shared/gameIndex.ts";

/** 公式の記録で、選手の行の合計がチームの合計と合わない既知の試合（validate-team-class-split.ts の KNOWN_GAPS と同じ。得点が2点ずれる）。キー: 「シーズン チームID 試合キー」 */
const KNOWN_GAPS = new Set(["2016-17 706 182", "2016-17 706 341", "2016-17 726 331", "2016-17 700 215", "2016-17 702 85", "2016-17 694 19", "2016-17 694 149"]);
const knownSeen = new Set<string>();
let ng = 0;
const first: string[] = [];
function bad(m: string): void {
  ng += 1;
  if (first.length < 15) first.push(m);
}

const PERIODS: GameRecordPeriod[] = ["q1", "q2", "q3", "q4", "h1", "h2", "ot"];
/** 手で足して比べる列: 区間つきの値の項目名 → ピリオド別の索引の列 */
const HAND_COLS: [string, string][] = [
  ["pts", "pts"],
  ["fgm", "fgm"],
  ["fga", "fga"],
  ["tpm", "tpm"],
  ["ast", "ast"],
  ["reb", "reb"],
  ["tov", "tov"],
  ["pf", "pf"],
  ["pt2in", "pt2in"],
  ["paint2m", "paint2m"],
  ["min", "minSec"],
];
/** 区分の選び方（独立に引くための番号の集まり。0 日本人・1 外国籍・2 帰化・3 アジア特別枠・4 区分が1つの索引の外国籍等・5 区分なし） */
const SELECTIONS: [string, TeamClassSelection, number[]][] = [
  ["jp", "jp", [0]],
  ["intl", "intl", [1, 2, 3, 4]],
  ["foreign", "foreign", [1]],
  ["natAsia", "natAsia", [2, 3]],
  ["foreign+asia", [1, 3], [1, 3]],
];

function classOf(index: PlayerGameIndexFile, i: number): number {
  const code = index.rows.cls?.[i];
  if (code !== undefined) return code >= 0 && code <= 3 ? code : 5;
  const key = index.players[index.rows.player[i]!]![5];
  return key === "jp" ? 0 : key === "intl" ? 4 : 5;
}

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a));
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  let handCells = 0;
  let teamCompared = 0;
  let gamesCompared = 0;
  let wholeCompared = 0;
  let sensitivity: (() => boolean) | null = null;

  for (const season of seasons) {
    if (only.length > 0 && !only.includes(season)) continue;
    for (const dir of [path.join(DATA_DIR, season), path.join(DATA_DIR, season, "one")]) {
      const label = dir.endsWith(`${path.sep}one`) ? `${season} B.ONE` : season;
      const index = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
      const pIdx = await readJson<PlayerPeriodIndexFile>(path.join(dir, "player-period-index.json"));
      const tIdx = await readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json"));
      const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
      if (!index) continue;
      const source = buildClassSplitSource(index, pIdx);
      // 旧い形式の索引（ピリオド別が無い）では区間つきを出さない（null）
      if (!pIdx || pIdx.indexRows !== index.rows.player.length) {
        if (source.atom !== null) bad(`${label} ピリオド別の索引が合わないのに区間つきの値を作っている`);
        continue;
      }
      if (source.atom === null) {
        bad(`${label} 区間つきの値を作れていない`);
        continue;
      }
      // 1. 独立に手で足す: key = チームの行|区分の番号|区間 → 列ごとの合計
      const hand = new Map<string, Float64Array>();
      const pr = pIdx.rows;
      for (let k = 0; k < pr.row.length; k++) {
        const i = pr.row[k]!;
        const teamRow = index.rows.game[i]! * 2 + ((index.rows.flags[i]! & ROW_FLAG_HOME) !== 0 ? 0 : 1);
        const key = `${teamRow}|${classOf(index, i)}|${pr.period[k]}`;
        let a = hand.get(key);
        if (!a) hand.set(key, (a = new Float64Array(HAND_COLS.length)));
        HAND_COLS.forEach(([, col], c) => (a![c]! += pr.stats[col as keyof typeof pr.stats][k]!));
      }
      const handSum = (teamRow: number, nums: number[], atoms: readonly number[], c: number): number => {
        let v = 0;
        for (const n of nums) for (const a of atoms) v += hand.get(`${teamRow}|${n}|${a}`)?.[c] ?? 0;
        return v;
      };
      const periodsHere = source.detailed ? SELECTIONS : SELECTIONS.filter(([n]) => n === "jp" || n === "intl");
      for (const t of teams) {
        const logs = (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? [];
        for (const g of logs) {
          const no = source.gameNo.get(g.scheduleKey);
          if (no === undefined) continue;
          const row = no * 2 + (g.isHome ? 0 : 1);
          for (const [name, sel, nums] of periodsHere) {
            for (const p of PERIODS) {
              const atoms = PERIOD_ATOM_INDEXES[p];
              const v = classSideValues(source, row, sel, atoms) as unknown as Record<string, number>;
              HAND_COLS.forEach(([field], c) => {
                handCells += 1;
                const want = field === "min" ? handSum(row, nums, atoms, c) / 60 : handSum(row, nums, atoms, c);
                if (Math.abs(v[field]! - want) > 1e-9) bad(`${label} ${t.teamId} ${g.scheduleKey} ${name} ${p} ${field}: ${v[field]} ≠ 手計算 ${want}`);
              });
            }
          }
          // 2. 日本人＋外国籍等＋区分なし ＝ チームの索引の得点
          if (tIdx) {
            for (const p of PERIODS) {
              const atoms = PERIOD_ATOM_INDEXES[p];
              const team = atoms.reduce((s, a) => s + Math.max(0, tIdx.rows.counts[`${PERIOD_ATOMS[a]}.pts`]?.[row] ?? -1), 0);
              const has = atoms.some((a) => (tIdx.rows.counts[`${PERIOD_ATOMS[a]}.pts`]?.[row] ?? -1) >= 0);
              const sum =
                classSideValues(source, row, "jp", atoms).pts + classSideValues(source, row, "intl", atoms).pts + classSideValues(source, row, "none", atoms).pts;
              if (has) {
                teamCompared += 1;
                if (sum !== team && KNOWN_GAPS.has(`${label} ${t.teamId} ${g.scheduleKey}`)) knownSeen.add(`${label} ${t.teamId} ${g.scheduleKey}`);
                else if (sum !== team) bad(`${label} ${t.teamId} ${g.scheduleKey} ${p} 得点: 区分の合計 ${sum} ≠ チーム ${team}`);
              }
            }
          }
        }
        // 3. 数える試合
        for (const p of PERIODS) {
          const { games } = sumClassTotals(source, logs, "jp", p);
          const want = logs.filter((g) => {
            const no = source.gameNo.get(g.scheduleKey);
            if (no === undefined || !tIdx) return false;
            const atoms = PERIOD_ATOM_INDEXES[p];
            const ok = (r: number) => atoms.some((a) => (tIdx.rows.counts[`${PERIOD_ATOMS[a]}.pts`]?.[r] ?? -1) >= 0);
            return ok(no * 2) && ok(no * 2 + 1);
          });
          gamesCompared += 1;
          if (games.length !== want.length) bad(`${label} ${t.teamId} ${p} 数えた試合 ${games.length} ≠ チームの区間別 ${want.length}`);
        }
        // 4. 区間の合計＝試合全体（1Q〜4Q がそろった試合だけ。前後半5分の特別な試合・手入力の試合は除く）
        const q1 = new Set(sumClassTotals(source, logs, "jp", "q1").games.map((g) => g.scheduleKey));
        const q4 = new Set(sumClassTotals(source, logs, "jp", "q4").games.map((g) => g.scheduleKey));
        const full = logs.filter((g) => q1.has(g.scheduleKey) && q4.has(g.scheduleKey));
        for (const sel of ["jp", "intl"] as const) {
          let partsPts = 0;
          for (const p of ["q1", "q2", "q3", "q4", "ot"] as const) partsPts += sumClassTotals(source, full, sel, p).totals.pts;
          const wholePts = sumClassTotals(source, full, sel).totals.pts;
          wholeCompared += 1;
          if (partsPts !== wholePts) bad(`${label} ${t.teamId} ${sel} 1Q〜4Q＋延長の合計 ${partsPts} ≠ 試合全体 ${wholePts}`);
        }
      }
      // 6. 感度用
      if (!sensitivity && teams[0]) {
        const logs = (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${teams[0].teamId}.json`))) ?? [];
        const g = logs.find((l) => source.gameNo.has(l.scheduleKey));
        if (g) {
          const no = source.gameNo.get(g.scheduleKey)!;
          const row = no * 2 + (g.isHome ? 0 : 1);
          sensitivity = () => {
            const before = classSideValues(source, row, "jp", [0]).pts;
            const handBefore = handSumFor(hand, row, [0], [0]);
            const ok = before === handBefore;
            for (let i = 0; i < source.atom!.length; i++) source.atom![i]! += 1;
            const after = classSideValues(source, row, "jp", [0]).pts;
            return ok && after !== handBefore;
          };
        }
      }
    }
  }
  function handSumFor(hand: Map<string, Float64Array>, teamRow: number, nums: number[], atoms: number[]): number {
    let v = 0;
    for (const n of nums) for (const a of atoms) v += hand.get(`${teamRow}|${n}|${a}`)?.[0] ?? 0;
    return v;
  }
  console.log(`手計算との比較 ${handCells}件／チームの索引との比較 ${teamCompared}件／試合数の比較 ${gamesCompared}件／区間の合計と試合全体 ${wholeCompared}件`);
  console.log(`既知の食い違い（公式の記録）: ${knownSeen.size}／${KNOWN_GAPS.size}試合が出ている`);
  if (!only.length && knownSeen.size !== KNOWN_GAPS.size) bad("既知の食い違いの数が合わない");
  if (ng > 0) {
    console.error(`NG ${ng}件\n   ${first.join("\n   ")}`);
    process.exit(1);
  }
  if (sensitivity && !sensitivity()) {
    console.error("NG 感度: 索引を壊しても検出できない");
    process.exit(1);
  }
  console.log("ok すべての検証に通りました");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
