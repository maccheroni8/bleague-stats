// 比較表の列定義（ComparisonStatDef）を組み立てる共通ロジック。
// 従来は個人詳細ページ・チーム詳細ページの「比較」タブがそれぞれのページファイル内に持っていたが、
// トップレベル比較ページ（#/compare、ComparePage.tsx）も同じ列定義・表示ロジックを使うため
// （DESIGN.md 100章）、ここに切り出して3箇所から共有する。詳細ページ側の挙動は変更していない。

import { COLUMNS_BY_TAB, type BoxscoreColumn, type BoxscoreTabKey, type ColumnCtx } from "../components/BoxscoreTable";
import type { ComparisonStatDef } from "../pages/ComparePage";
import type { BoxscoreCounts } from "./boxscoreAggregate";
import { formatSigned } from "./format";
import {
  SEASON_BOX_COLUMNS,
  type SeasonBoxTabKey,
  type SeasonBoxscoreCtx,
  type TeamGameBoxTotals,
} from "./playerSeasonBoxscore";
import type { TeamPerspective } from "./teamStatsColumns";

// 「日程結果」タブ・比較タブの+/-（差分）表示用。BoxscoreColumnはformat(単一のBoxscoreCounts)のみを
// 持ち差分表示を想定していないため、col.value(own/opp双方の生数値)から差分を求めて
// この関数側で整形する。%系（列ラベルに"%"を含む）は分子分母が同じ係数で相殺されないため
// ポイント差（±X.X%）、それ以外は原則整数（1試合分のカウント系スタッツは小数ではなく整数で表示する。
// SeasonBoxscoreColumnのcountDigits（合計モード=0桁）と同じ考え方）。
// AST/TOV・PPS・Rtg系(PACE/ORtg/DRtg/NetRtg)は元々小数表示の指標のため、そのまま桁数を保つ
const DECIMAL_DIFF_DIGITS: Record<string, number> = { asttov: 1, pps: 2, pace: 1, ortg: 1, drtg: 1, netrtg: 1 };

// col.value()の値スケールが列ごとに異なる: FG%/2P%/3P%/FT%/eFG%/TS%/PAINT2%/MID2%はsafeDiv()
// ベースで0〜1（format側でformatPctが×100する）だが、USG%/TOV%/AST%/LIVE%/DEAD%と
// スコアリングタブの%-share系（%PTS等）はsharePct()/tovPct()等が既に0〜100スケールを返す
// （format側はformatPct100でそのまま%表記にする）。後者を診断表示用のformatColumnDiffで
// 誤って再度×100すると桁違いの値になるため、0〜100スケールの列だけこの集合で判定して
// 二重乗算を避ける
const PCT_ALREADY_0_TO_100: ReadonlySet<string> = new Set([
  "usg",
  "tovpct",
  "astpct",
  "pctptsasted",
  "livetovpct",
  "deadtovpct",
  "pctpts",
  "pctfgm",
  "pctfga",
  "pct3pm",
  "pct3pa",
  "pct2pm",
  "pct2pa",
  "pctftm",
  "pctfta",
]);

export function formatColumnDiff(
  col: BoxscoreColumn,
  own: BoxscoreCounts,
  ownCtx: ColumnCtx,
  opp: BoxscoreCounts,
  oppCtx: ColumnCtx,
): string {
  if (!col.value) return "-";
  const ownValue = col.value(own, ownCtx);
  const oppValue = col.value(opp, oppCtx);
  if (ownValue === undefined || oppValue === undefined) return "-";
  const diff = ownValue - oppValue;
  if (col.label.includes("%")) {
    const diffPct = PCT_ALREADY_0_TO_100.has(col.key) ? diff : diff * 100;
    return `${formatSigned(diffPct, 1)}%`;
  }
  if (col.key === "min") {
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
    return `${sign}${Math.floor(Math.abs(diff) / 60)}:${String(Math.abs(diff) % 60).padStart(2, "0")}`;
  }
  const digits = DECIMAL_DIFF_DIGITS[col.key];
  return digits !== undefined ? formatSigned(diff, digits) : formatSigned(Math.round(diff), 0);
}

export interface TeamCompareColumnData {
  key: string;
  label: string;
  boxTotals: TeamGameBoxTotals;
  /** リーグ平均（DESIGN.md 149章）。opp は自チームと同じ値（リーグ全体の相手はリーグ全体）、+/- は出さない（「-」） */
  isLeague?: boolean;
  /** 絞り込んだ試合数（先頭の「G」行） */
  gamesCount: number;
}

/**
 * チームの比較の先頭行「G」（絞り込んだ試合数）。自チーム/opp/+/-の切り替えに関わらず同じ値を出す。
 * 多い・少ないに良し悪しが無いので強調しない（個人の比較は列定義に G・GS があるのでそのまま）
 */
const TEAM_GAMES_DEF: ComparisonStatDef<TeamCompareColumnData> = {
  key: "g",
  label: "G",
  value: (r) => r.gamesCount,
  // リーグ平均はシーズン全体の試合数（見出しに「（◯試合）」で出す）で、チームの試合数と並べると紛らわしいので「-」
  format: (r) => (r.isLeague ? "-" : String(r.gamesCount)),
  higherIsBetter: true,
  noHighlight: true,
};

/**
 * BoxscoreColumn.format（例: `String(c.pts)`）は1試合分の整数カウント前提で書かれているため、
 * buildTeamMultiGameBoxTotalsが返す1試合あたり平均値（小数）をそのまま渡すと、内部の複合計算
 * （例: FGM列のc.pt2m+c.pt3m）で浮動小数点誤差が乗り小数点以下が延々と表示されることがある
 * （例: "31.200000000000003"）。col.formatの出力が単純な数値文字列（%表記・MM:SS・"-"等では
 * ない）の場合のみ小数第1位に丸め直す。丸め自体はbuildTeamMultiGameBoxTotals側では行わず
 * （%系列の分子分母を丸め前の生の値で計算させ、ポイント差を防ぐため）、ここでの文字列レベルの
 * 後処理のみで対応する
 */
export function cleanNumericString(s: string): string {
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(1) : s;
}

/**
 * 「日程結果」タブと同じCOLUMNS_BY_TAB（試合詳細ページのボックススコア列定義）を、
 * 自チーム/opp/+/-トグルに応じたComparisonStatDefへ変換する（チーム版の比較表）
 */
/**
 * 比較の表で「良い方の値」を強調するときの向きの補正（DESIGN.md 134-4）。列定義（BoxscoreTable の COLUMNS_BY_TAB・
 * SEASON_BOX_COLUMNS）はボックススコア等の他の表でも使うので変えず、比較の表だけで上書きする。
 * - 少ないほど良い: UFOUL・DQFOUL・TF・OFF FOUL（個人の OFF FOUL は列定義に向きが無く「多いほど良い」扱いになっていた）
 * - 強調しない: 試投数と、試投数に占める割合（多い・少ないに良し悪しが無い）
 */
const COMPARE_LOWER_IS_BETTER = new Set(["ufoul", "dqfoul", "tf", "offfoul"]);
const COMPARE_NO_HIGHLIGHT = new Set([
  "fga",
  "2pa",
  "3pa",
  "fta",
  "paint2a",
  "mid2a",
  "pctfga",
  "pct3pa",
  "pct2pa",
  "pctfta",
  "pct3paown",
  "pctpaint2aown",
  "pctmid2aown",
]);
/** チームの列定義で比較用の値（value）を持たない列の補い（無いと全員0扱いになり強調されない） */
const TEAM_COMPARE_VALUE: Record<string, (c: BoxscoreCounts) => number> = {
  ufoul: (c) => c.unsportsmanlikeFouls,
  dqfoul: (c) => c.disqualifyingFouls,
  tf: (c) => c.technicalFouls,
};

function compareHigherIsBetter(key: string, own: boolean | undefined): boolean {
  return COMPARE_LOWER_IS_BETTER.has(key) ? false : (own ?? true);
}

export function teamCompareDefs(tabKey: BoxscoreTabKey, perspective: TeamPerspective): ComparisonStatDef<TeamCompareColumnData>[] {
  const defs = COLUMNS_BY_TAB[tabKey].map((raw) => {
    const extraValue = TEAM_COMPARE_VALUE[raw.key];
    const col: BoxscoreColumn = extraValue && !raw.value ? { ...raw, value: (c) => extraValue(c) } : raw;
    return teamCompareDef(col, perspective);
  });
  return [TEAM_GAMES_DEF, ...defs];
}

function teamCompareDef(col: BoxscoreColumn, perspective: TeamPerspective): ComparisonStatDef<TeamCompareColumnData> {
  const ownHigherIsBetter = compareHigherIsBetter(col.key, col.higherIsBetter);
  return {
    key: col.key,
    label: col.label,
    value: (r) => {
      if (perspective === "own") return col.value?.(r.boxTotals.own, r.boxTotals.ownCtx) ?? 0;
      if (perspective === "opp") return col.value?.(r.boxTotals.opp, r.boxTotals.oppCtx) ?? 0;
      const ownValue = col.value?.(r.boxTotals.own, r.boxTotals.ownCtx);
      const oppValue = col.value?.(r.boxTotals.opp, r.boxTotals.oppCtx);
      return ownValue !== undefined && oppValue !== undefined ? ownValue - oppValue : 0;
    },
    format: (r) =>
      perspective === "diff" && r.isLeague
        ? "-"
        : perspective === "own"
        ? cleanNumericString(col.format(r.boxTotals.own, r.boxTotals.ownCtx))
        : perspective === "opp"
          ? cleanNumericString(col.format(r.boxTotals.opp, r.boxTotals.oppCtx))
          : formatColumnDiff(col, r.boxTotals.own, r.boxTotals.ownCtx, r.boxTotals.opp, r.boxTotals.oppCtx),
    // 相手チーム視点では向きを反転する（相手のPTSは少ない方が、相手のTOVは多い方が自チームにとって良い。
    // チーム一覧・ランキングの視点切り替えと同じ考え方）
    higherIsBetter: perspective === "opp" ? !ownHigherIsBetter : ownHigherIsBetter,
    // チームの比較では MIN（出場時間。試合時間なので延長戦の有無だけで変わる）も強調しない（G と同じ扱い。DESIGN.md 149章）
    noHighlight: COMPARE_NO_HIGHLIGHT.has(col.key) || col.key === "min",
  };
}

export interface CompareColumnData {
  key: string;
  label: string;
  ctx: SeasonBoxscoreCtx;
}

/**
 * 個人版の比較表: 「シーズン別成績」等と同じSEASON_BOX_COLUMNS（トラディショナル/アドバンスド/
 * Misc/スコアリング）をそのままComparisonStatDefに変換する。表示は常に「平均」固定
 * （合計だとスロットごとの試合数の違いで比較しづらくなるため。シチュエーション別成績と同じ方針）
 */
export function seasonBoxCompareDefs(tabKey: SeasonBoxTabKey): ComparisonStatDef<CompareColumnData>[] {
  return SEASON_BOX_COLUMNS[tabKey].map((col) => ({
    key: col.key,
    label: col.label,
    value: (r) => col.value(r.ctx, "perGame"),
    format: (r) => col.format(r.ctx, "perGame"),
    higherIsBetter: compareHigherIsBetter(col.key, col.higherIsBetter),
    noHighlight: COMPARE_NO_HIGHLIGHT.has(col.key),
  }));
}
