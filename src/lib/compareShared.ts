// 比較表の列定義（ComparisonStatDef）を組み立てる共通ロジック。
// 従来は個人詳細ページ・チーム詳細ページの「比較」タブがそれぞれのページファイル内に持っていたが、
// トップレベル比較ページ（#/compare、ComparePage.tsx）も同じ列定義・表示ロジックを使うため
// （DESIGN.md 100章）、ここに切り出して3箇所から共有する。詳細ページ側の挙動は変更していない。

import { isPaint2Key, paintOf, paintFormat, paintValue, paintCoverage, PAINT2_COVERAGE, leaguePaintComplete } from "./teamPaint2";
import type { BoxscoreColumn, BoxscoreTabKey, ColumnCtx } from "../components/BoxscoreTable";
import type { ComparisonStatDef } from "../pages/ComparePage";
import type { BoxscoreCounts } from "./boxscoreAggregate";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "./format";
import { ftRate } from "../../shared/formulas";
import {
  seasonBoxColumnsFor,
  type SeasonBoxTabKey,
  type SeasonBoxscoreCtx,
  type TeamGameBoxTotals,
} from "./playerSeasonBoxscore";
import { teamBoxscoreColumnsFor } from "./teamBoxscoreColumns";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildPointsShareColumns,
  buildScoringColumns,
  EMPTY_TOTALS,
  perspectiveValue,
  type AllTeamsRow,
  type TeamPerspective,
  type TeamTotals,
} from "./teamStatsColumns";
import type { TeamGameLog } from "../../shared/types";
import type { Column } from "../components/SortableTable";

// 「日程結果」タブ・比較タブの+/-（差分）表示用。BoxscoreColumnはformat(単一のBoxscoreCounts)のみを
// 持ち差分表示を想定していないため、col.value(own/opp双方の生数値)から差分を求めて
// この関数側で整形する。%系（列ラベルに"%"を含む）は分子分母が同じ係数で相殺されないため
// ポイント差（±X.X%）、それ以外は原則整数（1試合分のカウント系スタッツは小数ではなく整数で表示する。
// SeasonBoxscoreColumnのcountDigits（合計モード=0桁）と同じ考え方）。
// AST/TOV・PPS・Rtg系(PACE/ORtg/DRtg/NetRtg)は元々小数表示の指標のため、そのまま桁数を保つ
const DECIMAL_DIFF_DIGITS: Record<string, number> = { asttov: 1, pps: 2, pace: 1, ortg: 1, drtg: 1, netrtg: 1 };

// col.value()の値スケールが列ごとに異なる: FG%/2P%/3P%/FT%/eFG%/TS%/PAINT2%/MID2%はsafeDiv()
// ベースで0〜1（format側でformatPctが×100する）だが、USG%/TOV%/AST%/LIVE TOV%/DEAD TOV%と
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

/** 比較の「G」の横に添える勝敗（G の試合数と同じ試合の勝敗。結果だけの試合 resultOnlyGames は試合ログに無いので入らない。DESIGN.md 234章） */
export interface CompareRecord {
  wins: number;
  losses: number;
}

/** 試合ログ（勝敗の旗を持つもの）から勝敗を数える。引き分けは無いので、敗は試合数−勝 */
export function recordOfLogs(logs: readonly { win: boolean }[]): CompareRecord {
  const wins = logs.filter((g) => g.win).length;
  return { wins, losses: logs.length - wins };
}

/**
 * 比べているすべての対象で値が「-」の項目を除く（比較の表で、データの無い項目を行ごと出さない。DESIGN.md 234章）。
 * 1つでも値のある対象がいれば残す（片方だけにある項目は今までどおり）。判定は表に出す値（format）だけで、
 * 対象・条件を変えて描き直すたびに判定し直すので、値が出るようになれば行は戻る
 */
export function defsWithAnyValue<T>(defs: ComparisonStatDef<T>[], items: readonly T[]): ComparisonStatDef<T>[] {
  return defs.filter((def) => items.some((item) => def.format(item) !== "-"));
}

function recordSuffix(record: CompareRecord | undefined): string | undefined {
  return record ? `（${record.wins}-${record.losses}）` : undefined;
}

export interface TeamCompareColumnData {
  key: string;
  label: string;
  boxTotals: TeamGameBoxTotals;
  /** リーグ平均（DESIGN.md 149章）。opp は自チームと同じ値（リーグ全体の相手はリーグ全体）、+/- は出さない（「-」） */
  isLeague?: boolean;
  paintLeagueComplete?: boolean;
  /** 絞り込んだ試合数（先頭の「G」行） */
  gamesCount: number;
  /** 絞り込んだ試合でのそのチームの勝敗（「G 6（3-3）」。リーグ平均は無し） */
  record?: CompareRecord;
  /** 結果だけの試合（228章）を勝敗に含むチーム・シーズンで、G の勝敗の横の「※」に添える説明（公式の勝敗は結果だけの試合を含む旨） */
  resultOnlyNote?: string;
  /**
   * 試合ログ（TeamGameLog）の合計。全チームスタッツ・チーム詳細と同じ値の項目（FTR・OR%・BENCH PTS・登録区分別得点・得点の割合など）を、
   * 全チームスタッツと同じ列の式で出すための元（`sumTeamGameLogs`）。リーグ平均は、試合ログを持たないので平均の値から作る
   * （`teamTotalsFromBoxTotals`。試合ログにしか無いベンチ得点・登録区分別得点は「-」）
   */
  logTotals?: { totals: TeamTotals; games: number; classPoints?: SplitClassPoints | null } | null;
}

/**
 * 試合ログの外国籍・帰化・アジア特別枠の得点の合計（自チーム・相手。DESIGN.md 298章）。試合ログの値は試合ごとの登録区分で集計済み
 * （2026-27 以降は登録区分の記録）。区分を分けて記録していない 2025-26 以前は作らない（null。比較の行は「-」）
 */
export interface SplitClassPoints {
  foreign: number;
  naturalized: number;
  asia: number;
  oppForeign: number;
  oppNaturalized: number;
  oppAsia: number;
}

export function sumSplitClassPoints(logs: readonly Pick<TeamGameLog, "foreignPoints" | "naturalizedPoints" | "asianQuotaPoints" | "opponentForeignPoints" | "opponentNaturalizedPoints" | "opponentAsianQuotaPoints">[]): SplitClassPoints {
  const out: SplitClassPoints = { foreign: 0, naturalized: 0, asia: 0, oppForeign: 0, oppNaturalized: 0, oppAsia: 0 };
  for (const g of logs) {
    out.foreign += g.foreignPoints ?? 0;
    out.naturalized += g.naturalizedPoints ?? 0;
    out.asia += g.asianQuotaPoints ?? 0;
    out.oppForeign += g.opponentForeignPoints ?? 0;
    out.oppNaturalized += g.opponentNaturalizedPoints ?? 0;
    out.oppAsia += g.opponentAsianQuotaPoints ?? 0;
  }
  return out;
}

const SPLIT_CLASS_POINT_ITEMS = [
  { key: "foreignPts3", pctKey: "pctforeign3", label: "外国籍 PTS", own: "foreign", opp: "oppForeign" },
  { key: "naturalizedPts3", pctKey: "pctnaturalized3", label: "帰化 PTS", own: "naturalized", opp: "oppNaturalized" },
  { key: "asiaPts3", pctKey: "pctasia3", label: "アジア特別枠 PTS", own: "asia", opp: "oppAsia" },
] as const;

/** 外国籍・帰化・アジア特別枠の得点（Misc）と、その総得点に占める割合（Scoring）。2025-26 以前・リーグ平均は「-」 */
function splitClassPointDefs(kind: "count" | "pct", perspective: TeamPerspective): ComparisonStatDef<TeamCompareColumnData>[] {
  return SPLIT_CLASS_POINT_ITEMS.map((item) => {
    const valueOf = (r: TeamCompareColumnData): number | null => {
      const lt = r.logTotals;
      const cp = lt?.classPoints;
      if (!lt || !cp || r.isLeague || lt.games === 0) return null;
      const own = kind === "count" ? cp[item.own] / lt.games : safeDivide(100 * cp[item.own], lt.totals.pts);
      const opp = kind === "count" ? cp[item.opp] / lt.games : safeDivide(100 * cp[item.opp], lt.totals.oppPts);
      return perspectiveValue(own, opp, perspective);
    };
    return {
      key: kind === "count" ? item.key : item.pctKey,
      label: kind === "count" ? item.label : `%${item.label}`,
      value: (r) => valueOf(r) ?? 0,
      format: (r) => {
        const v = valueOf(r);
        if (v === null) return "-";
        if (kind === "count") return perspective === "diff" ? formatSigned(v, 1) : formatDecimal(v, 1);
        return perspective === "diff" ? `${formatSigned(v, 1)}%` : formatPct100(v);
      },
      higherIsBetter: perspective === "opp" ? false : true,
    };
  });
}

function safeDivide(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

/**
 * リーグ平均の1チーム1試合平均（boxTotals）を、全チームスタッツの列の式（TeamTotals）に渡せる形にする。値は1試合平均なので games は1。
 * 試合ログにしか無い項目（ベンチ得点・スタメン得点・登録区分別得点）は0のまま（呼び出し側が「-」にする）。
 * プレータイプ内訳（PITP・FBPS・2ND PTS・PTSOFFTO）は、ボックススコアの列と同じく ctx.ownPlayType の値
 */
export function teamTotalsFromBoxTotals(box: TeamGameBoxTotals): TeamTotals {
  const side = (c: BoxscoreCounts, ctx: ColumnCtx) => ({
    pts: c.pts,
    fgm: c.pt2m + c.pt3m,
    fga: c.pt2a + c.pt3a,
    tpm: c.pt3m,
    tpa: c.pt3a,
    ftm: c.ftm,
    fta: c.fta,
    oreb: c.oreb,
    dreb: c.dreb,
    pt2in: ctx.ownPlayType.pt2in,
    fb: ctx.ownPlayType.fb,
    pt2nd: ctx.ownPlayType.pt2nd,
    pft: ctx.ownPlayType.pft,
    paint2m: c.paint2m,
    paint2a: c.paint2a,
    mid2m: c.nonPaint2m,
    mid2a: c.nonPaint2a,
  });
  const own = side(box.own, box.ownCtx);
  const opp = side(box.opp, box.oppCtx);
  return {
    ...EMPTY_TOTALS,
    ...own,
    reb: box.own.oreb + box.own.dreb,
    oppPts: opp.pts,
    oppFgm: opp.fgm,
    oppFga: opp.fga,
    oppTpm: opp.tpm,
    oppTpa: opp.tpa,
    oppFtm: opp.ftm,
    oppFta: opp.fta,
    oppOreb: opp.oreb,
    oppDreb: opp.dreb,
    oppPt2in: opp.pt2in,
    oppFb: opp.fb,
    oppPt2nd: opp.pt2nd,
    oppPft: opp.pft,
    oppPaint2m: opp.paint2m,
    oppPaint2a: opp.paint2a,
    oppMid2m: opp.mid2m,
    oppMid2a: opp.mid2a,
  };
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
  suffix: (r) => (r.isLeague ? undefined : recordSuffix(r.record)),
  suffixNote: (r) => (r.isLeague ? undefined : r.resultOnlyNote),
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
 * - 少ないほど良い: UFOUL・DQFOUL・TF・TF1・TF2・FLAG・DISR・OFF FOUL（個人の OFF FOUL は列定義に向きが無く「多いほど良い」扱いになっていた）
 * - 強調しない: テンポ（POSS・PACE。多いほうが良いものではない）と、チームの MIN（試合時間なので延長の有無だけで変わる）・G
 * - 試投数（FGA・2PA・3PA・FTA・PAINT2A・MID2A）と、試投・得点の内訳の割合・構成比は、良し悪しは無いが「多いほうを塗る」（相手チーム視点では向きを反転。DESIGN.md 250章）
 */
const COMPARE_LOWER_IS_BETTER = new Set(["ufoul", "dqfoul", "tf", "tf1", "tf2", "flag", "disr", "offfoul"]);
const COMPARE_NO_HIGHLIGHT = new Set([
  // テンポ: 多いほうが良いものではない（POSS は延長の有無でも増える。DESIGN.md 238章）
  "poss",
  "pace",
]);
/** チームの列定義で比較用の値（value）を持たない列の補い（無いと全員0扱いになり、強調が値の大小ではなく先頭の対象に付く） */
const TEAM_COMPARE_VALUE: Record<string, (c: BoxscoreCounts) => number> = {
  ufoul: (c) => c.unsportsmanlikeFouls,
  dqfoul: (c) => c.disqualifyingFouls,
  tf: (c) => c.technicalFouls,
  tf1: (c) => c.technicalFoulsCat1 ?? 0,
  tf2: (c) => c.technicalFoulsCat2 ?? 0,
  flag: (c) => c.flagrantFouls ?? 0,
  disr: (c) => c.disruptiveFouls ?? 0,
};
/**
 * 自チームと相手チームで同じ値になる項目（1つの試合のポゼッション・テンポは両チームで共通）。差（+/-）は常に0なので、
 * +/- の視点では値を出さない（「-」。全対象が「-」なら行ごと出ない）
 */
const TEAM_COMPARE_NO_DIFF = new Set(["poss", "pace"]);

function compareHigherIsBetter(key: string, own: boolean | undefined): boolean {
  return COMPARE_LOWER_IS_BETTER.has(key) ? false : (own ?? true);
}

export function teamCompareDefs(
  tabKey: BoxscoreTabKey,
  perspective: TeamPerspective,
  /** 比べるシーズンがすべて2026-27以降のとき true（Miscのファウルの列を TF1・TF2・FLAG・DISR にする） */
  foulSplit = false,
): ComparisonStatDef<TeamCompareColumnData>[] {
  // チームの表向けの列（Scoring の %3PM・%2PM は FGM、%3PA・%2PA は FGA に占める割合、%PTS・%FGM・%FGA・%FTM・%FTA は外す。teamBoxscoreColumns.ts）
  const defs = teamBoxscoreColumnsFor(tabKey, foulSplit).map((raw) => {
    const extraValue = TEAM_COMPARE_VALUE[raw.key];
    const col: BoxscoreColumn = extraValue && !raw.value ? { ...raw, value: (c) => extraValue(c) } : raw;
    const original = teamCompareDef(col, perspective);
    if (!isPaint2Key(col.key)) return original;
    const summaryOf = (r: TeamCompareColumnData) => (r.logTotals ? paintOf(r.logTotals.totals) : undefined);
    // リーグ平均は、内訳が2P全体と一致するときだけ出す（足りないときは「-」）
    const leagueAvailable = (r: TeamCompareColumnData) =>
      r.paintLeagueComplete ?? (!!r.logTotals && leaguePaintComplete(r.logTotals.totals));
    return {
      ...original,
      format: (r: TeamCompareColumnData) =>
        r.isLeague
          ? leagueAvailable(r) ? original.format(r) : "-"
          : paintFormat(summaryOf(r), col.key, "perGame", perspective),
      value: (r: TeamCompareColumnData) =>
        r.isLeague
          ? leagueAvailable(r) ? original.value(r) : 0
          : (paintValue(summaryOf(r), col.key, "perGame", perspective) ?? 0),
    };
  });
  // 全チームスタッツ・チーム詳細にあって、ボックススコアの列定義には無い項目（DESIGN.md 235章）
  const extras = teamLogTotalsDefs(tabKey, perspective, foulSplit);
  if (tabKey === "scoring") {
    defs.unshift({
      key: "paint2games",
      label: PAINT2_COVERAGE,
      value: () => 0,
      format: (r) => (r.isLeague ? "-" : paintCoverage(r.logTotals ? paintOf(r.logTotals.totals) : undefined, perspective)),
      noHighlight: true,
    });
  }
  if (tabKey === "advanced") {
    // 全チームスタッツと同じ並び: TOV% の次に FTR・OR%
    const at = defs.findIndex((d) => d.key === "tovpct");
    defs.splice(at === -1 ? defs.length : at + 1, 0, ...extras);
    return [TEAM_GAMES_DEF, ...defs];
  }
  return [TEAM_GAMES_DEF, ...defs, ...extras];
}

/** 試合ログにしか無い項目（リーグ平均の値は作れない） */
const TEAM_LOG_ONLY_KEYS: ReadonlySet<string> = new Set([
  "benchPts",
  "starterPts",
  "japanesePts3",
  "internationalPts3",
  "pctbenchpts",
  "pctstarterpts",
  "pctjapanese3",
  "pctinternational3",
]);
function teamLogTotalsDef(col: Column<AllTeamsRow>, perspective: TeamPerspective): ComparisonStatDef<TeamCompareColumnData> {
  const rowOf = (r: TeamCompareColumnData): AllTeamsRow | null =>
    r.logTotals
      ? { team: { teamId: "", teamName: r.label }, gamesPlayed: r.logTotals.games, wins: 0, losses: 0, totals: r.logTotals.totals }
      : null;
  const unavailable = (r: TeamCompareColumnData) =>
    !r.logTotals || (r.isLeague && (TEAM_LOG_ONLY_KEYS.has(col.key) || perspective === "diff"));
  return {
    key: col.key,
    label: col.label,
    value: (r) => (unavailable(r) ? 0 : Number(col.sortValue(rowOf(r)!))),
    format: (r) => (unavailable(r) ? "-" : (col.format?.(rowOf(r)!) ?? String(col.sortValue(rowOf(r)!)))),
    higherIsBetter: col.higherIsBetter ?? true,
  };
}

/**
 * 全チームスタッツ（teamStatsColumns.ts の列の式）と、チーム詳細のシーズン別成績の得点の割合（%3P・%PoutP・%FT・%OPA）を、
 * 試合ログの合計（logTotals）から出す。全チームスタッツと同じ式・同じデータ（TeamGameLog）なので、同じ条件なら同じ値になる。
 * 登録区分別得点・ベンチ得点も TeamGameLog の値（選手マスタは読まない）
 */
function teamLogTotalsDefs(tabKey: BoxscoreTabKey, perspective: TeamPerspective, foulSplit: boolean): ComparisonStatDef<TeamCompareColumnData>[] {
  const pick = (cols: Column<AllTeamsRow>[], keys: string[]) =>
    keys.map((k) => cols.find((c) => c.key === k)).filter((c): c is Column<AllTeamsRow> => c !== undefined);
  const defsOf = (cols: Column<AllTeamsRow>[]) => cols.map((c) => teamLogTotalsDef(c, perspective));
  if (tabKey === "advanced") {
    return defsOf(pick(buildAdvancedColumns("perGame", perspective), ["ftr", "orbpct"]));
  }
  const scoring = buildScoringColumns("perGame", perspective, true, true);
  if (tabKey === "misc") {
    return defsOf([
      ...pick(buildMiscColumns("perGame", perspective, true, foulSplit), ["benchPts", "starterPts"]),
      ...pick(scoring, ["japanesePts3", "internationalPts3"]),
    ]).concat(splitClassPointDefs("count", perspective));
  }
  if (tabKey === "scoring") {
    return defsOf([
      ...pick(scoring, [
        "pitppct",
        "fbppct",
        "2ndptspct",
        "ptsofftovpct",
        "pctbenchpts",
        "pctstarterpts",
        "pctjapanese3",
        "pctinternational3",
      ]),
    ]).concat(
      splitClassPointDefs("pct", perspective),
      defsOf([...pick(scoring, ["pctpaint2m", "pctpaint2a", "pctmid2m", "pctmid2a"]), ...buildPointsShareColumns(perspective)]),
    );
  }
  return [];
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
      perspective === "diff" && (r.isLeague || TEAM_COMPARE_NO_DIFF.has(col.key))
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
  /** 出場した試合（G の試合）での所属チームの勝敗（「G 6（3-3）」。移籍した選手は所属した各チームの試合の合計） */
  record?: CompareRecord;
  /** 出場した試合でのダブルダブル・トリプルダブルの回数（DD2・TD3。個人詳細のシーズン別成績と同じ数え方 `countDoubleTripleDoubles`） */
  ddtd?: { dd: number; td: number; p10?: number };
}

/**
 * 個人版の比較表: 「シーズン別成績」等と同じSEASON_BOX_COLUMNS（トラディショナル/アドバンスド/
 * Misc/スコアリング）をそのままComparisonStatDefに変換する。表示は常に「平均」固定
 * （合計だとスロットごとの試合数の違いで比較しづらくなるため。シチュエーション別成績と同じ方針）
 */
export function seasonBoxCompareDefs(
  tabKey: SeasonBoxTabKey,
  /** 比べるシーズンがすべて2026-27以降のとき true（Miscのファウルの列を TF1・TF2・FLAG・DISR にする） */
  foulSplit = false,
): ComparisonStatDef<CompareColumnData>[] {
  const defs: ComparisonStatDef<CompareColumnData>[] = seasonBoxColumnsFor(tabKey, foulSplit).map((col) => ({
    key: col.key,
    label: col.label,
    value: (r) => col.value(r.ctx, "perGame"),
    format: (r) => col.format(r.ctx, "perGame"),
    // G の横に、出場した試合でのチームの勝敗を添える（強調の判定には使わない値の飾り）
    ...(col.key === "g" ? { suffix: (r: CompareColumnData) => recordSuffix(r.record) } : {}),
    higherIsBetter: compareHigherIsBetter(col.key, col.higherIsBetter),
    noHighlight: COMPARE_NO_HIGHLIGHT.has(col.key),
  }));
  // 全選手スタッツ・個人詳細にあって、シーズン別成績の列定義には無い項目（DESIGN.md 235章）
  if (tabKey === "advanced") {
    // 全選手スタッツと同じ並び: TS% の次に FTR（FTA / FGA。チーム詳細・全選手スタッツの FTR と同じ式 shared/formulas.ts の ftRate）
    const ftr: ComparisonStatDef<CompareColumnData> = {
      key: "ftr",
      label: "FTR",
      value: (r) => ftRate(r.ctx.raw.fta, r.ctx.raw.fga),
      format: (r) => formatPct(ftRate(r.ctx.raw.fta, r.ctx.raw.fga)),
      higherIsBetter: true,
    };
    const at = defs.findIndex((d) => d.key === "ts");
    defs.splice(at === -1 ? defs.length : at + 1, 0, ftr);
  }
  if (tabKey === "traditional") {
    // DD2・TD3・PTS10: 個人詳細のシーズン別成績と同じ位置（末尾）・同じ数え方。回数のまま（平均にしない）
    const count = (key: "dd" | "td" | "p10", label: string): ComparisonStatDef<CompareColumnData> => ({
      key: label.toLowerCase(),
      label,
      value: (r) => r.ddtd?.[key] ?? 0,
      format: (r) => (r.ddtd?.[key] !== undefined ? String(r.ddtd[key]) : "-"),
      higherIsBetter: true,
    });
    // 二桁得点試合（PTS10）も同じ数え方で TD3 の右に（DESIGN.md 299-5・304章）
    defs.push(count("dd", "DD2"), count("td", "TD3"), count("p10", "PTS10"));
  }
  return defs;
}
