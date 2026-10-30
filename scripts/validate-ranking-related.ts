// ランキング（個人）の関連スタッツ（設計書264章。src/lib/rankingRelatedStats.ts）の検証（検証専用。CIには入れず、必要なときに手で実行する）。
//
// 確かめること: 割合の項目ごとに、並べる関連スタッツ（分子→分母）から割合を計算し直すと、表の割合と一致する
// （合計・平均の両方。平均はシーズン合計を出場試合数で割った値なので、割合は同じ）。値はすべての項目が別々の正の数になる作り物の合計で確かめる
// （式の関係の検証。実データの値は画面で確認する）。
//
// 使い方: npm run validate:ranking-related（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { SEASON_ADVANCED_COLUMNS, SEASON_SCORING_COLUMNS, SEASON_TRADITIONAL_COLUMNS, buildSeasonBoxscoreCtx, type PlayerSeasonRawTotals, type TeamSeasonRawTotals } from "../src/lib/playerSeasonBoxscore";
import { hasRelatedStats, relatedStatsFor } from "../src/lib/rankingRelatedStats";
import { displayModeApplies } from "../src/lib/playerSeasonRanking";
import type { PlayerSummary } from "../shared/types";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failures += 1;
    console.error(`NG ${label} ${detail}`);
  } else console.log(`ok ${label}`);
}

// すべての数が別々の正の数の合計（試合数20）
let n = 7;
const next = () => (n += 3);
const raw = { gamesPlayed: 20, gamesStarted: 10 } as Record<string, number>;
const ownKeys = ["min", "pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf", "foulsDrawn", "blockedAgainst", "technicalFouls", "pt2in", "ptfb", "pt2nd", "plusMinus", "ptsOffTov", "dunks", "basketCounts", "unsportsmanlikeFouls", "disqualifyingFouls", "technicalFoulsCat1", "technicalFoulsCat2", "flagrantFouls", "disruptiveFouls", "offensiveFoulsCommitted", "chargesDrawn", "assisted2m", "assisted3m", "assistedFtm", "paint2m", "paint2a", "mid2m", "mid2a", "onCourtOwnPoss", "onCourtOppPoss", "onCourtSeconds"];
for (const k of ownKeys) raw[k] = next();
// 出場中の割合の材料（出場中の記録がそろう試合 18 / 出場 20）。分子は本人（その試合だけ）、分母は出場中の自チーム
raw.ocGames = 18;
for (const k of ["ocPts", "ocFgm", "ocFga", "ocTpm", "ocTpa", "ocFtm", "ocFta", "ocTeamPts", "ocTeamFgm", "ocTeamFga", "ocTeamTpm", "ocTeamTpa", "ocTeamFtm", "ocTeamFta", "ocFgAssists"]) raw[k] = 0;
// 整合: 3PM<3PA<FGM<FGA, FTM<FTA
raw.tpm = 40;
raw.tpa = 110;
raw.fgm = 230;
raw.fga = 520;
raw.ftm = 90;
raw.fta = 120;
raw.pts = 2 * (raw.fgm - raw.tpm) + 3 * raw.tpm + raw.ftm;
Object.assign(raw, { ocTpm: 36, ocTpa: 99, ocFgm: 207, ocFga: 468, ocFtm: 81, ocFta: 108, ocTeamTpm: 120, ocTeamTpa: 330, ocTeamFgm: 410, ocTeamFga: 880, ocTeamFtm: 200, ocTeamFta: 260, ocTeamPts: 1150, ocFgAssists: 60 });
raw.ocPts = 2 * (raw.ocFgm! - raw.ocTpm!) + 3 * raw.ocTpm! + raw.ocFtm!;
raw.min = 600;
const teamRaw = {
  pts: 1900, fgm: 700, fga: 1500, tpm: 200, tpa: 560, ftm: 350, fta: 450, oreb: 200, dreb: 500, reb: 700, ast: 400, tov: 250, stl: 120, blk: 60, pf: 380, foulsDrawn: 300,
  min: 4000,
} as Record<string, number>;
const team = { ...teamRaw } as unknown as TeamSeasonRawTotals;

const SEASON_START = 2025;
const ctxTotal = buildSeasonBoxscoreCtx(raw as unknown as PlayerSeasonRawTotals, team, "total", SEASON_START);
const ctxPerGame = buildSeasonBoxscoreCtx(raw as unknown as PlayerSeasonRawTotals, team, "perGame", SEASON_START);

const columns = new Map([...SEASON_TRADITIONAL_COLUMNS, ...SEASON_ADVANCED_COLUMNS, ...SEASON_SCORING_COLUMNS].map((c) => [c.key, c]));

// 割合の計算式（関連スタッツの数から）
const FORMULA: Record<string, (v: number[]) => number> = {
  fgpct: (v) => v[0]! / v[1]!,
  "2ppct": (v) => v[0]! / v[1]!,
  "3ppct": (v) => v[0]! / v[1]!,
  ftpct: (v) => v[0]! / v[1]!,
  asttov: (v) => v[0]! / v[1]!,
  tovpct: (v) => (100 * v[0]!) / (v[1]! + 0.44 * v[2]! + v[0]!),
  efg: (v) => (v[0]! + 0.5 * v[1]!) / v[2]!,
  ts: (v) => v[0]! / (2 * (v[1]! + 0.44 * v[2]!)),
  pps: (v) => v[0]! / v[1]!,
  paint2pct: (v) => v[0]! / v[1]!,
  mid2pct: (v) => v[0]! / v[1]!,
};
const PCT100 = ["pctpts", "pctfgm", "pctfga", "pct3pm", "pct3pa", "pct2pm", "pct2pa", "pctftm", "pctfta", "pctptsasted", "pct3pmown", "pct3paown", "pctpaint2mown", "pctpaint2aown", "pctmid2mown", "pctmid2aown"];
for (const k of PCT100) FORMULA[k] = (v) => (100 * v[0]!) / v[1]!;

const player = { playerId: "p" } as PlayerSummary;
const num = (s: string) => Number(s.replace(/,/g, ""));
for (const [key, formula] of Object.entries(FORMULA)) {
  const col = columns.get(key);
  if (!col) {
    check(`${key}: 表の列がある`, false);
    continue;
  }
  check(`${key}: 関連スタッツを並べる項目として扱う・平均／合計の切り替えを使える`, hasRelatedStats("any", key) && displayModeApplies("any", key));
  const shown = col.value(ctxTotal, "total");
  for (const mode of ["total", "perGame"] as const) {
    const ctx = mode === "total" ? ctxTotal : ctxPerGame;
    const rel = relatedStatsFor({ category: "traditional", statKey: key, mode, ctxOf: () => ctx, shooting: [] });
    if (!rel) {
      check(`${key}(${mode}): 関連スタッツがある`, false);
      continue;
    }
    // 表示は丸めるので、丸める前の値で確かめるため、digits を大きくした値は使わず、表示の丸め幅（平均は0.05・合計は0.5）に収まるかで見る
    const text = rel.of(player)!;
    const values = text.map(num);
    const tol = mode === "total" ? 0.5 : 0.05;
    const approx = formula(values);
    // 丸めの影響を避けるため、丸めなしの値（total なら整数なので厳密、perGame なら ×試合数で戻す）で計算し直す
    // 出場中の値の項目は、平均を出場中の記録がそろう試合数（18）で割る
    const games = key.startsWith("pct") && !key.endsWith("own") && key !== "pctptsasted" ? 18 : 20;
    const exact = formula(mode === "total" ? values : values.map((x: number) => x * games));
    const ok = Math.abs(exact - shown) < Math.max(0.02 * Math.abs(shown), 1e-6) + (mode === "total" ? 0 : Math.abs(shown) * 0.02);
    check(`${key}(${mode}): ${rel.labels.join("／")} ${text.join("／")} → ${approx.toFixed(3)}（表 ${shown.toFixed(3)}）`, ok, `許容 ${tol}`);
  }
}
// 平均のとき、出場中の自チームの値も、出場中の記録がそろう試合数で割っている（%PTS の TEAM PTS（出場中）。DESIGN.md 303章）
{
  const rel = relatedStatsFor({ category: "scoring", statKey: "pctpts", mode: "perGame", ctxOf: () => ctxPerGame, shooting: [] })!;
  check("pctpts(perGame): TEAM PTS（出場中）は 出場中の合計÷そろう試合数", rel.of(player)![1] === (1150 / 18).toFixed(1), String(rel.of(player)));
}
// 出場中の記録がそろう試合が無い（2019-20以前など）ときは、%PTS とその関連スタッツは「-」
{
  const none = buildSeasonBoxscoreCtx({ ...raw, ocGames: 0 } as unknown as PlayerSeasonRawTotals, team, "total", 2018);
  const rel = relatedStatsFor({ category: "scoring", statKey: "pctpts", mode: "total", ctxOf: () => none, shooting: [] })!;
  check("pctpts: 出場中の記録が無ければ関連スタッツは「-」", rel.of(player)!.every((x: string) => x === "-"));
  check("pctpts: 出場中の記録が無ければ表も「-」", columns.get("pctpts")!.format(none, "total") === "-");
}
// 2016-17 より前はペイント内外が無いので「-」
{
  const old = buildSeasonBoxscoreCtx(raw as unknown as PlayerSeasonRawTotals, team, "total", 2015);
  const rel = relatedStatsFor({ category: "scoring", statKey: "paint2pct", mode: "total", ctxOf: () => old, shooting: [] })!;
  check("paint2pct: ペイント内外の無いシーズンは「-」", rel.of(player)!.every((x: string) => x === "-"));
}
// 関連スタッツを並べない項目
for (const key of ["pace", "ortg", "drtg", "netrtg", "per", "ppp", "pts", "eff", "dd2"]) {
  check(`${key}: 関連スタッツは並べない`, !hasRelatedStats("advanced", key));
}
// シューティング: 「{種別}_3ppct」→「{種別}_3pm」「{種別}_3pa」
{
  const shooting = [
    { key: "cs_3pm", format: () => "3.0", sortValue: () => 3 },
    { key: "cs_3pa", format: () => "7.5", sortValue: () => 7.5 },
    { key: "cs_3ppct", format: () => "40.0%", sortValue: () => 40 },
  ];
  const rel = relatedStatsFor({ category: "shooting", statKey: "cs_3ppct", mode: "perGame", ctxOf: () => null, shooting })!;
  check("shooting: cs_3ppct → 3PM／3PA", rel.labels.join("／") === "3PM／3PA" && rel.of(player)!.join("／") === "3.0／7.5");
  check("shooting: 関連スタッツの無い列は並べない", relatedStatsFor({ category: "shooting", statKey: "cs_3pm", mode: "perGame", ctxOf: () => null, shooting }) === null);
}

if (failures > 0) {
  console.error(`\n${failures} 件の食い違いがあります`);
  process.exit(1);
}
console.log("\nすべて一致しました");
