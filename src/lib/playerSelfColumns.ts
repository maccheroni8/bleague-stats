// 選手の SELF2PM・SELF3PM・SELFFTM・アシストの有無の4項目（ASTFGM・SELFFGM・ASTPTS・SELFPTS）・アシストあり／セルフの割合・MID PTS・MID PTS% の列（画面専用。DESIGN.md 362章・465〜467章）。
// 元の定義の AST2M・AST3M の見出しも、ここで AST2PM・AST3PM に直す（元の定義の文字列は変えない。キー・URL・保存した設定は古い表記のまま）。
// 列の元の定義（playerSeasonBoxscore.ts）は保存キーの対象なので書き換えず、このファイルを読み込んだときに Scoring の列の並び
// （SEASON_SCORING_COLUMNS。SEASON_BOX_COLUMNS.scoring と同じ配列）へ、画面側から同じ並びで差し込む。
// 全選手スタッツ・個人詳細・ランキング・比較・md・図解のどれも、この配列から列を作るので、1か所の差し込みで同じ並びになる。
// 画面の入口（src/main.tsx）とこの列を使う検証から import する。このファイルを保存キーの対象のファイルから import しないこと。
import { formatDecimal, formatPct100 } from "./format";
import { countDigits, SEASON_SCORING_COLUMNS, type PlayerSeasonRawTotals, type SeasonBoxscoreColumn } from "./playerSeasonBoxscore";
import { SELF_COUNT_DEFS, SELF_PCT_DEFS, selfCountsOf, selfPct, selfSplitOf, type SelfShotKind, type ShotMadeSource } from "./selfScoring";

const NA = "-";

/** 本人が出た試合のうち、試合の流れの記録が無い試合（2017-18 の1810）で点を取っていると、アシストの数が足りず Self が実際より多くなる。そのシーズンの行は「-」 */
export function playerSelfUnavailable(raw: PlayerSeasonRawTotals): boolean {
  return raw.pcPts !== undefined && raw.pts > raw.pcPts;
}

export function playerShotSource(t: PlayerSeasonRawTotals): ShotMadeSource {
  return {
    made2: t.fgm - t.tpm,
    made3: t.tpm,
    madeFt: t.ftm,
    ast2: t.assisted2m,
    ast3: t.assisted3m,
    astFt: t.assistedFtm,
  };
}

function pctColumn(key: string, label: string, kind: SelfShotKind, side: "ast" | "self"): SeasonBoxscoreColumn {
  const calc = (raw: PlayerSeasonRawTotals): number | null => {
    if (playerSelfUnavailable(raw)) return null;
    const sp = selfSplitOf(playerShotSource(raw), kind);
    return sp.total > 0 ? selfPct(side === "ast" ? sp.ast : sp.self, sp.total) : null;
  };
  return {
    key,
    label,
    format: (c) => {
      const v = calc(c.raw);
      return v === null ? NA : formatPct100(v);
    },
    value: (c) => calc(c.raw) ?? 0,
  };
}

export const PLAYER_SELF_COUNT_COLUMNS: SeasonBoxscoreColumn[] = SELF_COUNT_DEFS.map((d) => ({
  key: d.key,
  label: d.label,
  format: (c, mode) =>
    playerSelfUnavailable(c.raw) ? NA : formatDecimal(d.pick(selfCountsOf(playerShotSource(c.scaled))), countDigits(mode)),
  value: (c) => (playerSelfUnavailable(c.raw) ? 0 : d.pick(selfCountsOf(playerShotSource(c.scaled)))),
}));

export const PLAYER_SELF_PCT_COLUMNS: SeasonBoxscoreColumn[] = SELF_PCT_DEFS.flatMap((d) => [
  pctColumn(d.astKey, d.astLabel, d.kind, "ast"),
  pctColumn(d.selfKey, d.selfLabel, d.kind, "self"),
]);

const MID_SPLIT_FIRST_YEAR = 2016;

/** ミッドレンジの2P（MID2M）で決めた得点＝MID2M×2。内訳が無いシーズン・試合は MID2M と同じ扱い */
export const PLAYER_MID_PTS_COLUMN: SeasonBoxscoreColumn = {
  key: "midpts",
  label: "MID PTS",
  format: (c, mode) => (c.seasonStartYear >= MID_SPLIT_FIRST_YEAR ? formatDecimal(c.scaled.mid2m * 2, countDigits(mode)) : NA),
  value: (c) => (c.seasonStartYear >= MID_SPLIT_FIRST_YEAR ? c.scaled.mid2m * 2 : 0),
};

/** 得点に占めるミッドレンジの得点の割合（合計でも平均でも同じ値）。得点が0なら「-」 */
export const PLAYER_MID_PTS_PCT_COLUMN: SeasonBoxscoreColumn = {
  key: "midptspct",
  label: "MID PTS%",
  format: (c) => (c.seasonStartYear >= MID_SPLIT_FIRST_YEAR && c.raw.pts > 0 ? formatPct100((100 * c.raw.mid2m * 2) / c.raw.pts) : NA),
  value: (c) => (c.seasonStartYear >= MID_SPLIT_FIRST_YEAR && c.raw.pts > 0 ? (100 * c.raw.mid2m * 2) / c.raw.pts : 0),
};

/** 元の定義の見出し → 画面の見出し（元の定義はキーの対象なので書き換えない） */
const RENAMED_LABELS: Record<string, string> = { AST2M: "AST2PM", AST3M: "AST3PM" };

export const PLAYER_PTS_SELF_COLUMN: SeasonBoxscoreColumn = pctColumn("pctptsself", "%PTS SELF", "pts", "self");

/** Scoring の列に差し込む。ASTFTM の右に Self の本数と種類ごとの割合、%PTS ASTED の右に %PTS SELF（すでにあれば何もしない） */
export function installPlayerSelfColumns(cols: SeasonBoxscoreColumn[] = SEASON_SCORING_COLUMNS): SeasonBoxscoreColumn[] {
  if (cols.some((c) => c.key === "self2m")) return cols;
  for (const c of cols) c.label = RENAMED_LABELS[c.label] ?? c.label;
  const at = (k: string) => cols.findIndex((c) => c.key === k);
  const sAstFt = at("astftm");
  const sPctAsted = at("pctptsasted");
  if (sAstFt < 0 || sPctAsted < 0) return cols;
  // 後ろから差し込む（先の位置がずれない）。MID PTS% は PC（ポイントクリエイト）の右＝ペイント内外の内訳の手前
  const sPc = at("pc");
  if (sPc >= 0) cols.splice(sPc + 1, 0, PLAYER_MID_PTS_PCT_COLUMN);
  cols.splice(sPctAsted + 1, 0, PLAYER_PTS_SELF_COLUMN);
  cols.splice(sAstFt + 1, 0, ...PLAYER_SELF_COUNT_COLUMNS, ...PLAYER_SELF_PCT_COLUMNS);
  return cols;
}

installPlayerSelfColumns();

