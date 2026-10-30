// チームの成績を登録区分（日本人／外国籍・帰化・アジア）で分ける土台（全チームスタッツの区分の選択・チーム詳細のシーズン別成績のアコーディオン）。
// 選手の1試合行の索引（player-game-index。形式は shared/gameIndex.ts）の行を、「チームの試合×区分」ごとに足して、
// 試合ログの合計（teamStatsColumns.ts の sumTeamGameLogs）と同じ形の TeamTotals にする。画面だけの変更で、保存キーの対象のファイルは触らない。
//
// 区分は試合ごとの区分（DESIGN.md 298章）。2026-27 以降の索引は行ごとの区分（rows.cls。日本人・外国籍・帰化選手・アジア特別枠。シーズン途中の変更・見做し日本人を含む）、
// それより前は選手マスタの classification（選手ごとに1つ。索引の選手の辞書の6番目。jp／intl の2つだけ）。区分が付かない行（マスタに無い選手）はどの区分にも入れない
// （unclassified に別に数える。推測しない。51章）。所属チームは行の「ホーム」の旗で決めるので、移籍した選手は試合ごとにそのときのチームに数えられる。
//
// 値の出どころ:
// - 選手の値を足せばチームの値と一致する項目（PTS・FGM/FGA・3P・FT・AST・STL・BLK・FD・PITP・FBPS・2ND PTS・PTSOFFTO・DUNK・AND1・AST2M/3M/FTM・TF/UFOUL）は、そのまま足す
// - 足しても一致しない項目（OR・DR・TR・TOV・PF・TF）は、選手の分だけ（チームリバウンド・チームターンオーバー・ベンチ／コーチのファウル・テクニカルファウルを含まない）
// - ペイント内外の2P・DQFOUL は試合全体の索引に無いので、ピリオド別の索引（5区間）を足して出す（ピリオド別の行が無い試合は「記録なし」）
// - 出せないもの（POSS・PACE・ORtg・DRtg・NetRtg・+/-・TF1/TF2/FLAG/DISR・ベンチ／スタメン得点・OR% など相手の値が要るもの）は CLASS_SPLIT_UNAVAILABLE に挙げ、列の側で「-」にする
// - opp の視点は「相手チームの、同じ区分の選手」の値（opp* の項目に入れる）
import { NATURALIZED_ASIA_LABEL } from "./statNames";
import { PLAYER_INDEX_STAT_COLUMNS, ROW_FLAG_HOME, type PlayerGameIndexFile } from "../../shared/gameIndex";
import { PLAYER_PERIOD_STAT_COLUMNS, type PlayerPeriodIndexFile } from "../../shared/periodIndex";
import type { TeamGameLog } from "../../shared/types";
import type { Column } from "../components/SortableTable";
import { paintOf, summarizePaint, withPaint, type PaintInput, type PaintPair } from "./teamPaint2";
import { EMPTY_TOTALS, type AllTeamsRow, type TeamTotals } from "./teamStatsColumns";

/** 区分: jp＝日本人、intl＝外国籍・帰化・アジア（まとめ）、foreign＝外国籍・naturalized＝帰化・asia＝アジア特別枠（2026-27 以降だけ分けられる） */
export type SplitClass = "jp" | "intl" | "foreign" | "naturalized" | "asia" | "natAsia";
/** 2025-26 以前（と古い索引）で出せる区分 */
export const SPLIT_CLASSES: readonly SplitClass[] = ["jp", "intl"];
/** 外国籍・帰化・アジア特別枠を分けて出せるシーズン（2026-27 以降）の区分 */
/** 帰化とアジア特別枠は足して1行（natAsia）にして見せる。帰化だけ・アジア特別枠だけは絞り込みで選んだときの区分 */
export const DETAILED_SPLIT_CLASSES: readonly SplitClass[] = ["jp", "foreign", "natAsia"];

/** 画面の登録区分の絞り込み → チームの区分（全選手・ルーキーは null） */
export function splitClassOfFilter(filter: string): SplitClass | null {
  switch (filter) {
    case "日本人":
      return "jp";
    case "外国籍・帰化・アジア":
      return "intl";
    case "外国籍":
      return "foreign";
    case "帰化":
      return "naturalized";
    case "アジア特別枠":
      return "asia";
    default:
      return null;
  }
}

/** チームの区分の名前（「日本人」「帰化」など。区分の行の見出し・注記に使う） */
export const SPLIT_CLASS_LABELS: Record<SplitClass, string> = {
  jp: "日本人",
  intl: "外国籍・帰化・アジア",
  foreign: "外国籍",
  naturalized: "帰化",
  asia: "アジア特別枠",
  natAsia: NATURALIZED_ASIA_LABEL,
};

/**
 * 足し込みの区分の番号: 0 日本人・1 外国籍・2 帰化選手・3 アジア特別枠（行ごとの区分 rows.cls と同じ番号）・
 * 4 外国籍・帰化・アジアのどれか（行ごとの区分の無い索引の intl）・5 区分なし
 */
const CLASS_JP = 0;
const CLASS_INTL_ANY = 4;
const CLASS_NONE = 5;
const CLASS_COUNT = 6;
/** 足し込みの区分の数（検証で、足し込みの位置を計算するのに使う） */
export const CLASS_SPLIT_BUCKETS = CLASS_COUNT;
/** 区分 → 足し込む番号（intl は 1〜4 の合計） */
const CLASS_NUMBERS: Record<SplitClass | "none", readonly number[]> = {
  jp: [CLASS_JP],
  foreign: [1],
  naturalized: [2],
  asia: [3],
  natAsia: [2, 3],
  intl: [1, 2, 3, CLASS_INTL_ANY],
  none: [CLASS_NONE],
};

/** 試合全体の索引から足す列（PlayerGameLog の項目名） */
export const CLASS_SPLIT_GAME_COLUMNS = [
  "minSec",
  "pts",
  "fgm",
  "fga",
  "tpm",
  "tpa",
  "ftm",
  "fta",
  "oreb",
  "dreb",
  "reb",
  "ast",
  "tov",
  "stl",
  "blk",
  "pf",
  "foulsDrawn",
  "pt2in",
  "ptfb",
  "pt2nd",
  "ptsOffTov",
  "dunks",
  "basketCounts",
  "technicalFouls",
  "unsportsmanlikeFouls",
  "assisted2m",
  "assisted3m",
  "assistedFtm",
] as const satisfies readonly (typeof PLAYER_INDEX_STAT_COLUMNS)[number][];

/** ピリオド別の索引から足す列 */
const PERIOD_COLS = ["paint2m", "paint2a", "mid2m", "mid2a", "disqualifyingFouls"] as const satisfies readonly (typeof PLAYER_PERIOD_STAT_COLUMNS)[number][];

/** 区分の行では出せない TeamTotals の項目。列の側で「-」にする（unavailableColumn） */
export const CLASS_SPLIT_UNAVAILABLE: ReadonlySet<keyof TeamTotals> = new Set<keyof TeamTotals>([
  "poss",
  "technicalFoulsCat1",
  "technicalFoulsCat2",
  "flagrantFouls",
  "disruptiveFouls",
  "oppTechnicalFoulsCat1",
  "oppTechnicalFoulsCat2",
  "oppFlagrantFouls",
  "oppDisruptiveFouls",
  "benchPoints",
  "starterPoints",
  "oppBenchPoints",
  "oppStarterPoints",
  "japanesePoints",
  "internationalPoints",
  "oppJapanesePoints",
  "oppInternationalPoints",
  "offFoul",
  "charge",
  "oppOffFoul",
  "oppCharge",
]);

/** 選手の値を足しても、チームの値にならない項目（チーム分を除く）。画面の注記に使う */
export const CLASS_SPLIT_PLAYERS_ONLY: readonly (keyof TeamTotals)[] = ["oreb", "dreb", "reb", "tov", "pf", "technicalFouls"];

/**
 * 全チームスタッツで、区分の行に出せない列のキー（CLASS_SPLIT_UNAVAILABLE を使う列）。POSS を使う PACE・ORtg・DRtg・NetRtg、相手の値が要る OR%、
 * +/-（区分では出せない）、TF1/TF2/FLAG/DISR、ベンチ／スタメン得点とその割合、登録区分別得点とその割合
 */
export const CLASS_SPLIT_UNAVAILABLE_COLUMN_KEYS: ReadonlySet<string> = new Set([
  "poss",
  "pace",
  "ortg",
  "drtg",
  "netrtg",
  "orbpct",
  "plusminus",
  "tf1",
  "tf2",
  "flag",
  "disr",
  "benchPts",
  "starterPts",
  "pctbenchpts",
  "pctstarterpts",
  "japanesePts3",
  "internationalPts3",
  "pctjapanese3",
  "pctinternational3",
]);

/**
 * opp の視点では MIN も相手チームのその区分の選手の出場時間にする（sumClassTotals が opp の値を oppMin に足している。TeamTotals には項目が無いので読み替える）。
 * 区分を選んでいないときの全チームスタッツは従来どおり（呼び出さない）
 */
export function withOppMinutes(totals: TeamTotals): TeamTotals {
  // ペイント内外の内訳（teamPaint2 の withPaint で付けた分）は新しい値に引き継ぐ
  const next = { ...totals, min: (totals as unknown as Record<string, number>)["oppMin"] ?? 0 };
  const paint = paintOf(totals);
  return paint ? withPaint(next, paint) : next;
}

/** 区分の行で出せない列（と、all が true のときは全列）を「-」固定にする。+/- の視点は区分別では出せないので all にする */
export function maskClassSplitColumns(columns: Column<AllTeamsRow>[], all: boolean): Column<AllTeamsRow>[] {
  return columns.map((c) =>
    all || CLASS_SPLIT_UNAVAILABLE_COLUMN_KEYS.has(c.key)
      ? { key: c.key, label: c.label, sortValue: () => 0, format: () => "-", render: undefined, align: c.align }
      : c,
  );
}

/** 1シーズン分の、チームの試合×区分ごとの合計 */
export interface ClassSplitSource {
  season: string;
  /** scheduleKey → 試合の番号（チームの行の位置は 番号×2＋〔ホーム 0／アウェイ 1〕） */
  gameNo: Map<string, number>;
  /** 試合全体の索引の列の合計。位置は ((チームの行×区分の数)＋区分)×列数＋列 */
  game: Float64Array;
  /** ペイント内外・DQFOUL の合計（ピリオド別の索引。5区間すべて）。ピリオド別の行が無い試合は hasPeriod が 0 */
  period: Float64Array | null;
  /** チームの行ごとに、ピリオド別の行がある選手が1人でもいたか（1／0）。period が null のときは空 */
  hasPeriod: Uint8Array;
  /** 行ごとの区分（rows.cls）を持つ索引か（2026-27 以降）。true なら外国籍・帰化・アジア特別枠を分けて出せる */
  detailed: boolean;
}

const gameCol = new Map<string, number>(CLASS_SPLIT_GAME_COLUMNS.map((c, i) => [c, i]));
const periodCol = new Map<string, number>(PERIOD_COLS.map((c, i) => [c, i]));

/** 索引の i 行目の足し込みの番号（行ごとの区分があればそれ、無ければ選手の辞書の jp／intl） */
function rowClassNumber(index: PlayerGameIndexFile, i: number): number {
  const code = index.rows.cls?.[i];
  if (code !== undefined) return code >= 0 && code <= 3 ? code : CLASS_NONE;
  const key = index.players[index.rows.player[i]!]![5];
  return key === "jp" ? CLASS_JP : key === "intl" ? CLASS_INTL_ANY : CLASS_NONE;
}

/** 選手の1試合行の索引（と、あればピリオド別の索引）から、チームの試合×区分の合計を作る */
export function buildClassSplitSource(index: PlayerGameIndexFile, periodIndex: PlayerPeriodIndexFile | null): ClassSplitSource {
  const { rows, games, players } = index;
  const teamRows = games.key.length * 2;
  const game = new Float64Array(teamRows * CLASS_COUNT * CLASS_SPLIT_GAME_COLUMNS.length);
  const n = rows.player.length;
  // 索引の行ごとの（チームの行×区分）の位置
  const slot = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const teamRow = rows.game[i]! * 2 + ((rows.flags[i]! & ROW_FLAG_HOME) !== 0 ? 0 : 1);
    slot[i] = teamRow * CLASS_COUNT + rowClassNumber(index, i);
  }
  for (let c = 0; c < CLASS_SPLIT_GAME_COLUMNS.length; c++) {
    const col = rows.stats[CLASS_SPLIT_GAME_COLUMNS[c]!];
    for (let i = 0; i < n; i++) game[slot[i]! * CLASS_SPLIT_GAME_COLUMNS.length + c]! += col[i]!;
  }
  let period: Float64Array | null = null;
  const hasPeriod = new Uint8Array(periodIndex ? teamRows : 0);
  if (periodIndex && periodIndex.indexRows === n) {
    period = new Float64Array(teamRows * CLASS_COUNT * PERIOD_COLS.length);
    const pr = periodIndex.rows;
    for (let k = 0; k < pr.row.length; k++) {
      const s = slot[pr.row[k]!]!;
      hasPeriod[Math.floor(s / CLASS_COUNT)] = 1;
      for (let c = 0; c < PERIOD_COLS.length; c++) period[s * PERIOD_COLS.length + c]! += pr.stats[PERIOD_COLS[c]!][k]!;
    }
  }
  return { season: index.season, gameNo: new Map(games.key.map((k, i) => [k, i])), game, period, hasPeriod, detailed: rows.cls !== undefined };
}

function gameValue(source: ClassSplitSource, teamRow: number, cls: readonly number[], col: string): number {
  let v = 0;
  for (const c of cls) v += source.game[(teamRow * CLASS_COUNT + c) * CLASS_SPLIT_GAME_COLUMNS.length + gameCol.get(col)!]!;
  return v;
}

function periodValue(source: ClassSplitSource, teamRow: number, cls: readonly number[], col: string): number {
  let v = 0;
  for (const c of cls) v += source.period![(teamRow * CLASS_COUNT + c) * PERIOD_COLS.length + periodCol.get(col)!]!;
  return v;
}

/** その区分を、このシーズンの索引で出せるか（外国籍・帰化・アジア特別枠は行ごとの区分がある索引だけ） */
export function classSplitAvailable(source: ClassSplitSource, cls: SplitClass): boolean {
  return cls === "jp" || cls === "intl" || source.detailed;
}

/** 1チーム・1試合・1区分の値（TeamTotals の own 側の項目名ごと） */
export interface ClassSideValues {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  pf: number;
  fd: number;
  min: number;
  pt2in: number;
  fb: number;
  pt2nd: number;
  pft: number;
  dunks: number;
  basketCounts: number;
  technicalFouls: number;
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
  assisted2m: number;
  assisted3m: number;
  assistedFtm: number;
  paint2m: number;
  paint2a: number;
  mid2m: number;
  mid2a: number;
}

/** チームの行（試合の番号×2＋〔ホーム 0／アウェイ 1〕）の、指定した区分（"none" は区分なし）の値 */
export function classSideValues(source: ClassSplitSource, teamRow: number, cls: SplitClass | "none"): ClassSideValues {
  const c = CLASS_NUMBERS[cls];
  const g = (col: string) => gameValue(source, teamRow, c, col);
  const p = (col: string) => (source.period && source.hasPeriod[teamRow] ? periodValue(source, teamRow, c, col) : 0);
  return {
    pts: g("pts"),
    fgm: g("fgm"),
    fga: g("fga"),
    tpm: g("tpm"),
    tpa: g("tpa"),
    ftm: g("ftm"),
    fta: g("fta"),
    oreb: g("oreb"),
    dreb: g("dreb"),
    reb: g("reb"),
    ast: g("ast"),
    tov: g("tov"),
    stl: g("stl"),
    blk: g("blk"),
    pf: g("pf"),
    fd: g("foulsDrawn"),
    min: g("minSec") / 60,
    pt2in: g("pt2in"),
    fb: g("ptfb"),
    pt2nd: g("pt2nd"),
    pft: g("ptsOffTov"),
    dunks: g("dunks"),
    basketCounts: g("basketCounts"),
    technicalFouls: g("technicalFouls"),
    unsportsmanlikeFouls: g("unsportsmanlikeFouls"),
    disqualifyingFouls: p("disqualifyingFouls"),
    assisted2m: g("assisted2m"),
    assisted3m: g("assisted3m"),
    assistedFtm: g("assistedFtm"),
    paint2m: p("paint2m"),
    paint2a: p("paint2a"),
    mid2m: p("mid2m"),
    mid2a: p("mid2a"),
  };
}

/** ペイント内外の1試合分。ピリオド別の行が無い試合は -1（記録なし。validPaint が通らず、内訳の対象から外れる） */
function paintInput(source: ClassSplitSource, teamRow: number, v: ClassSideValues): PaintInput {
  if (!source.period || !source.hasPeriod[teamRow]) return { pm: -1, pa: -1, mm: -1, ma: -1, tm: -1, ta: -1 };
  return { pm: v.paint2m, pa: v.paint2a, mm: v.mid2m, ma: v.mid2a, tm: v.fgm - v.tpm, ta: v.fga - v.tpa };
}

const OWN_KEYS = [
  "pts",
  "fgm",
  "fga",
  "tpm",
  "tpa",
  "ftm",
  "fta",
  "oreb",
  "dreb",
  "reb",
  "ast",
  "tov",
  "stl",
  "blk",
  "pf",
  "fd",
  "min",
  "pt2in",
  "fb",
  "pt2nd",
  "pft",
  "dunks",
  "basketCounts",
  "technicalFouls",
  "unsportsmanlikeFouls",
  "disqualifyingFouls",
  "assisted2m",
  "assisted3m",
  "assistedFtm",
  "paint2m",
  "paint2a",
  "mid2m",
  "mid2a",
] as const satisfies readonly (keyof ClassSideValues)[];

/** own 側の項目名 → TeamTotals の opp 側の項目名（oppPts・oppFgm …） */
function oppKey(k: (typeof OWN_KEYS)[number]): keyof TeamTotals {
  return ("opp" + k.charAt(0).toUpperCase() + k.slice(1)) as keyof TeamTotals;
}

/**
 * 試合ログ（絞り込み済み）の、指定した区分の合計。sumTeamGameLogs と同じ形（TeamTotals）で、
 * 自チームの項目は自チームのその区分の選手、opp の項目は相手チームの同じ区分の選手の値。
 * 索引に無い試合（試合の番号が引けない）は数えず、数えた試合を games に返す（平均の分母と勝敗は、呼び出し側がこの games で出す）
 */
export function sumClassTotals(source: ClassSplitSource, logs: readonly TeamGameLog[], cls: SplitClass): { games: TeamGameLog[]; totals: TeamTotals } {
  const totals: TeamTotals = { ...EMPTY_TOTALS };
  const t = totals as unknown as Record<string, number>;
  const games: TeamGameLog[] = [];
  const pairs: PaintPair[] = [];
  for (const g of logs) {
    const no = source.gameNo.get(g.scheduleKey);
    if (no === undefined) continue;
    const ownRow = no * 2 + (g.isHome ? 0 : 1);
    const oppRow = no * 2 + (g.isHome ? 1 : 0);
    const own = classSideValues(source, ownRow, cls);
    const opp = classSideValues(source, oppRow, cls);
    games.push(g);
    for (const k of OWN_KEYS) {
      t[k] = (t[k] ?? 0) + own[k];
      const ok = oppKey(k);
      t[ok] = (t[ok] ?? 0) + opp[k];
    }
    pairs.push({ own: paintInput(source, ownRow, own), opp: paintInput(source, oppRow, opp) });
  }
  return { games, totals: withPaint(totals, summarizePaint(pairs)) };
}

/** 試合ログの試合のうち、区分が付かない選手の得点（どちらの区分にも入らない分）。画面の注記と検証に使う */
export function sumUnclassifiedPoints(source: ClassSplitSource, logs: readonly TeamGameLog[]): number {
  let s = 0;
  for (const g of logs) {
    const no = source.gameNo.get(g.scheduleKey);
    if (no === undefined) continue;
    s += gameValue(source, no * 2 + (g.isHome ? 0 : 1), CLASS_NUMBERS.none, "pts");
  }
  return s;
}

/** 区分なしの行（マスタに無い選手）があるか。あれば、その分はどちらの区分にも入らない */
export function hasUnclassifiedRows(source: ClassSplitSource, logs: readonly TeamGameLog[]): boolean {
  for (const g of logs) {
    const no = source.gameNo.get(g.scheduleKey);
    if (no === undefined) continue;
    for (const row of [no * 2, no * 2 + 1]) {
      for (const col of CLASS_SPLIT_GAME_COLUMNS) if (gameValue(source, row, CLASS_NUMBERS.none, col) !== 0) return true;
    }
  }
  return false;
}

