// チームの成績の登録区分別（src/lib/teamClassSplit.ts）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  1. 日本人＋外国籍・帰化・アジア＋区分なし ＝ チームの値（試合ごと）。対象は選手の値を足せば一致する項目
//     （PTS・FGM/FGA・3P・FT・AST・STL・BLK・FD・PITP・FBPS・2ND PTS・PTSOFFTO・DUNK・AND1・TF・UFOUL・AST2M/3M/FTM）
//  2. OR・DR・TR・TOV・PF は、選手の合計がチームの値以下（差はチームリバウンド等のチーム分）。MIN は区分の合計がチームの出場時間に近い
//  3. ペイント内外の2P・DQFOUL は、ピリオド別の行がある試合で、区分の合計がチームの値と一致する。行が無い試合は「記録なし」になる
//  4. 既存の「日本人 PTS」「外国籍・帰化・アジア PTS」（試合ログ）と一致する
//  5. 区分が付かない行は、どちらの区分にも入らない（試合ごとに jp＋intl＋区分なし＝チーム。区分なしがあるのは進行中のシーズンだけ）
//  6. opp の値は、相手チームの同じ区分の値（リーグ全体で、自チームの合計＝opp の合計）
//  7. 感度: 索引を1か所壊すと食い違いとして検出される
//  8. 2026-27 以降（行ごとの区分がある索引）: 外国籍・帰化・アジア特別枠の PTS が、試合ログの foreignPoints・naturalizedPoints・asianQuotaPoints と一致し、
//     その3つの合計がまとめ（外国籍・帰化・アジア）と一致する（DESIGN.md 298章）。B.ONE（data/{season}/one/）も同じように確かめる
//
// 使い方: npm run validate:team-class-split。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import type { PlayerPeriodIndexFile } from "../shared/periodIndex.ts";
import type { TeamGameLog, TeamSummary } from "../shared/types.ts";
import { buildClassSplitSource, CLASS_SPLIT_BUCKETS, CLASS_SPLIT_GAME_COLUMNS, classSideValues, hasUnclassifiedRows, sumClassTotals, sumUnclassifiedPoints, type ClassSideValues, type ClassSplitSource } from "../src/lib/teamClassSplit";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

/** 選手の値を足せばチームの値と一致する項目: ClassSideValues の項目名 → 試合ログの値 */
const EXACT: [keyof ClassSideValues, (g: TeamGameLog) => number][] = [
  ["pts", (g) => g.teamScore],
  ["fgm", (g) => g.fgm],
  ["fga", (g) => g.fga],
  ["tpm", (g) => g.tpm],
  ["tpa", (g) => g.tpa],
  ["ftm", (g) => g.ftm],
  ["fta", (g) => g.fta],
  ["ast", (g) => g.ast],
  ["stl", (g) => g.stl],
  ["blk", (g) => g.blk],
  ["fd", (g) => g.foulsDrawn],
  ["pt2in", (g) => g.pt2in],
  ["fb", (g) => g.fb],
  ["pt2nd", (g) => g.pt2nd],
  ["pft", (g) => g.pft],
  ["dunks", (g) => g.dunks],
  ["basketCounts", (g) => g.basketCounts],
  ["unsportsmanlikeFouls", (g) => g.unsportsmanlikeFouls],
  ["assisted2m", (g) => g.assisted2m],
  ["assisted3m", (g) => g.assisted3m],
  ["assistedFtm", (g) => g.assistedFtm],
];
/** 足しても一致しない項目（チーム分を除く）。選手の合計 ≦ チームの値 */
const PLAYERS_ONLY: [keyof ClassSideValues, (g: TeamGameLog) => number][] = [
  ["oreb", (g) => g.oreb],
  ["dreb", (g) => g.dreb],
  ["reb", (g) => g.reb],
  ["tov", (g) => g.tov],
  ["pf", (g) => g.pf],
  ["technicalFouls", (g) => g.technicalFouls],
];
/**
 * 公式の記録で、選手の行の合計がチームの合計と合わない試合（既知。公式のチーム合計に、どの選手にも付かない1本のFG〔2点〕がある。
 * 生データ・集計は直さない）。キーは「シーズン チームID 試合キー」、値は食い違ってよい項目。ここに無い食い違いは失敗にする
 */
const KNOWN_GAPS = new Map<string, readonly (keyof ClassSideValues)[]>(
  [
    "2016-17 706 182",
    "2016-17 706 341",
    "2016-17 726 331",
    "2016-17 700 215",
    "2016-17 702 85",
    "2016-17 694 19",
    "2016-17 694 149",
  ].map((k) => [k, ["pts", "fgm", "fga", "pt2in"] as const]),
);
/** 出場していない選手の行に成績が付いている試合（2016-17 の試合101。DESIGN.md 277章）。DQFOUL がチームと合わない */
KNOWN_GAPS.set("2016-17 704 101", ["disqualifyingFouls"]);
KNOWN_GAPS.set("2016-17 706 101", ["disqualifyingFouls"]);

/** ピリオド別の索引から足す項目 */
const FROM_PERIOD: [keyof ClassSideValues, (g: TeamGameLog) => number][] = [
  ["paint2m", (g) => g.paint2m],
  ["paint2a", (g) => g.paint2a],
  ["mid2m", (g) => g.mid2m],
  ["mid2a", (g) => g.mid2a],
  ["disqualifyingFouls", (g) => g.disqualifyingFouls],
];

const add = (a: ClassSideValues, b: ClassSideValues, c: ClassSideValues, k: keyof ClassSideValues) => a[k] + b[k] + c[k];

async function main(): Promise<void> {
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const only = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a));
  const first: string[] = [];
  let ng = 0;
  // 食い違いは、項目ごとの件数と最初の数件を出す（メッセージの最初の語を項目とみなさず、呼び出し側が key を渡す）
  const byKey = new Map<string, { n: number; examples: string[] }>();
  const knownSeen = new Set<string>();
  const note = (m: string, key = "other") => {
    const gapKey = m.split(" ").slice(0, 3).join(" ");
    if (KNOWN_GAPS.get(gapKey)?.includes(key as keyof ClassSideValues)) {
      knownSeen.add(`${gapKey}:${key}`);
      return;
    }
    ng += 1;
    const e = byKey.get(key) ?? { n: 0, examples: [] };
    e.n += 1;
    if (e.examples.length < 12) e.examples.push(m);
    byKey.set(key, e);
    if (first.length < 15) first.push(m);
  };
  let games = 0;
  let detailedGames = 0;
  let missingFromIndex = 0;
  let noPeriodGames = 0;
  let periodChecked = 0;
  let playersOnlyGames = 0;
  let playersOnlyDiff = 0;
  let minDiff = 0;
  const unclassified: string[] = [];
  let lastSource: ClassSplitSource | null = null;
  let lastLogs: TeamGameLog[] = [];
  let leagueOwn = 0;
  let leagueOpp = 0;
  let leagueChecked = false;

  for (const season of seasons) {
    if (only.length > 0 && !only.includes(season)) continue;
    // B.ONE（data/{season}/one/）も同じように確かめる（DESIGN.md 298章）
    for (const dir of [path.join(DATA_DIR, season), path.join(DATA_DIR, season, "one")]) {
    const leagueLabel = dir.endsWith(`${path.sep}one`) ? `${season} B.ONE` : season;
    const index = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
    const periodIndex = await readJson<PlayerPeriodIndexFile>(path.join(dir, "player-period-index.json"));
    const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
    if (!index) continue;
    const source = buildClassSplitSource(index, periodIndex);
    let seasonUnclassifiedPts = 0;
    let seasonOwnPts = 0;
    let seasonOppPts = 0;
    for (const t of teams) {
      const logs = (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? [];
      lastSource = source;
      lastLogs = logs;
      for (const g of logs) {
        const no = source.gameNo.get(g.scheduleKey);
        if (no === undefined) {
          missingFromIndex += 1;
          continue;
        }
        games += 1;
        const row = no * 2 + (g.isHome ? 0 : 1);
        const jp = classSideValues(source, row, "jp");
        const intl = classSideValues(source, row, "intl");
        const none = classSideValues(source, row, "none");
        const where = `${leagueLabel} ${t.teamId} ${g.scheduleKey}`;
        // 1. 足せば一致する項目
        for (const [k, f] of EXACT) {
          if (add(jp, intl, none, k) !== f(g)) note(`${where} ${String(k)}: ${jp[k]}+${intl[k]}+${none[k]} ≠ ${f(g)}`, String(k));
        }
        // 2. チーム分を除く項目・MIN
        for (const [k, f] of PLAYERS_ONLY) {
          const sum = add(jp, intl, none, k);
          playersOnlyGames += 1;
          if (sum > f(g)) note(`${where} ${k}: 選手の合計 ${sum} > チーム ${f(g)}`);
          if (sum !== f(g)) playersOnlyDiff += 1;
        }
        const minSum = add(jp, intl, none, "min");
        if (Math.abs(minSum - g.min) > 1) {
          minDiff += 1;
          if (minDiff <= 3) note(`${where} MIN: 区分の合計 ${minSum} ≠ チーム ${g.min}`);
        }
        // 3. ペイント内外・DQFOUL（ピリオド別の行がある試合）
        if (source.period && source.hasPeriod[row]) {
          periodChecked += 1;
          for (const [k, f] of FROM_PERIOD) {
            const hasZeroOnly = (k === "paint2m" || k === "paint2a" || k === "mid2m" || k === "mid2a") && season < "2022-23";
            if (hasZeroOnly) continue;
            if (add(jp, intl, none, k) !== f(g)) note(`${where} ${String(k)}: ${jp[k]}+${intl[k]}+${none[k]} ≠ ${f(g)}`, String(k));
          }
        } else {
          noPeriodGames += 1;
          if (jp.paint2a !== 0 || intl.paint2a !== 0) note(`${where} ピリオド別の行が無いのにペイントの値がある`);
        }
        // 4. 既存の「日本人 PTS」「外国籍・帰化・アジア PTS」
        if (jp.pts !== g.japanesePoints) note(`${where} 日本人 PTS ${jp.pts} ≠ ${g.japanesePoints}`, "jpPts");
        if (intl.pts !== g.foreignPoints + g.naturalizedOrAsianPoints) note(`${where} 外国籍等 PTS ${intl.pts} ≠ ${g.foreignPoints + g.naturalizedOrAsianPoints}`, "intlPts");
        // 8. 外国籍・帰化・アジア特別枠（行ごとの区分がある索引だけ）
        if (source.detailed) {
          detailedGames += 1;
          const fo = classSideValues(source, row, "foreign");
          const na = classSideValues(source, row, "naturalized");
          const as = classSideValues(source, row, "asia");
          if (fo.pts !== g.foreignPoints) note(`${where} 外国籍 PTS ${fo.pts} ≠ ${g.foreignPoints}`, "foreignPts");
          if (na.pts !== g.naturalizedPoints) note(`${where} 帰化 PTS ${na.pts} ≠ ${g.naturalizedPoints}`, "naturalizedPts");
          if (as.pts !== g.asianQuotaPoints) note(`${where} アジア特別枠 PTS ${as.pts} ≠ ${g.asianQuotaPoints}`, "asiaPts");
          // 画面は帰化とアジア特別枠を足して1行（natAsia）で見せる。足した値が、別々の値の和と一致すること
          const naAsia = classSideValues(source, row, "natAsia");
          for (const [k] of EXACT) {
            if (naAsia[k] !== na[k] + as[k]) note(`${where} ${String(k)}: 帰化・アジア特別枠 ${naAsia[k]} ≠ 帰化＋アジア ${na[k] + as[k]}`, `natAsia-${String(k)}`);
          }
          for (const [k] of EXACT) {
            if (fo[k] + na[k] + as[k] !== intl[k]) note(`${where} ${String(k)}: 外国籍＋帰化＋アジア ${fo[k] + na[k] + as[k]} ≠ まとめ ${intl[k]}`, `split-${String(k)}`);
          }
        }
        seasonOwnPts += jp.pts + intl.pts;
        seasonOppPts += classSideValues(source, no * 2 + (g.isHome ? 1 : 0), "jp").pts + classSideValues(source, no * 2 + (g.isHome ? 1 : 0), "intl").pts;
      }
      // 6. 合計の opp の値が、相手の自チームの値（sumClassTotals の opp 側）と使い方が合う
      const jpSum = sumClassTotals(source, logs, "jp");
      const intlSum = sumClassTotals(source, logs, "intl");
      leagueOwn += jpSum.totals.pts + intlSum.totals.pts;
      leagueOpp += jpSum.totals.oppPts + intlSum.totals.oppPts;
      seasonUnclassifiedPts += sumUnclassifiedPoints(source, logs);
      if (jpSum.games.length !== logs.filter((g) => source.gameNo.has(g.scheduleKey)).length) note(`${season} ${t.teamId} 数えた試合数が合わない`);
      // 5. 区分なしの行の扱い
      if (hasUnclassifiedRows(source, logs)) unclassified.push(`${season} ${t.teamId}`);
    }
    leagueChecked = true;
    // 6. リーグ全体（そのシーズン）で、自チームの合計と opp の合計が等しい
    if (seasonOwnPts !== seasonOppPts) note(`${season} 自チームの合計 ${seasonOwnPts} ≠ 相手の合計 ${seasonOppPts}`);
    if (seasonUnclassifiedPts > 0 && season < "2026-27") note(`${leagueLabel} 区分が付かない選手の得点が ${seasonUnclassifiedPts} 点ある`);
    }
  }
  void leagueChecked;

  check(`2026-27 以降の試合（${detailedGames}試合）で、外国籍・帰化・アジア特別枠の値を出せる（行ごとの区分がある）`, detailedGames > 0);
  check(`試合ログの全試合を索引から引ける（${games}試合。引けない ${missingFromIndex}）`, missingFromIndex === 0, `${missingFromIndex}試合`);
  const knownExpected = [...KNOWN_GAPS].reduce((a, [, ks]) => a + ks.length, 0);
  console.log(`   既知の食い違い（公式の記録）: ${knownSeen.size}／${knownExpected}項目が出ている`);
  for (const [k, e] of byKey) console.log(`   [${k}] ${e.n}件: ${e.examples.join(" / ")}`);
  check(`日本人＋外国籍・帰化・アジア＋区分なし ＝ チームの値（${EXACT.length}項目）／ペイント内外・DQFOUL（ピリオド別の行がある ${periodChecked}試合）／既存の登録区分別 PTS／リーグ全体の自チーム＝相手`, ng === 0, first.join("\n   "));
  console.log(`   参考: チーム分を除く項目（${PLAYERS_ONLY.length}項目×${playersOnlyGames / PLAYERS_ONLY.length}試合）のうち、選手の合計とチームの値が違った項目 ${playersOnlyDiff}件／MIN が1分以上ずれた試合 ${minDiff}／ピリオド別の行が無い試合 ${noPeriodGames}`);
  console.log(`   参考: 区分が付かない選手の行があるチーム・シーズン: ${unclassified.length === 0 ? "なし" : unclassified.join("、")}`);

  // 7. 感度: 日本人の PTS を1だけ増やすと、「日本人＋外国籍等＋区分なし＝チーム」が崩れる
  if (lastSource && lastLogs.length > 0) {
    const g = lastLogs.find((l) => lastSource!.gameNo.has(l.scheduleKey))!;
    const no = lastSource.gameNo.get(g.scheduleKey)!;
    const row = no * 2 + (g.isHome ? 0 : 1);
    const ptsAt = (row * CLASS_SPLIT_BUCKETS + 0) * CLASS_SPLIT_GAME_COLUMNS.length + CLASS_SPLIT_GAME_COLUMNS.indexOf("pts");
    const sumOf = () => add(classSideValues(lastSource!, row, "jp"), classSideValues(lastSource!, row, "intl"), classSideValues(lastSource!, row, "none"), "pts");
    const okBefore = sumOf() === g.teamScore;
    lastSource.game[ptsAt] = lastSource.game[ptsAt]! + 1;
    check("感度: 索引を1か所壊すと食い違いとして検出される", okBefore && sumOf() !== g.teamScore);
  }

  if (failures > 0) {
    console.error(`\n${failures}件の検証が失敗しました`);
    process.exit(1);
  }
  console.log("\nすべての検証に通りました");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
