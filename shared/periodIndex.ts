// ピリオド別の索引（data/{season}/player-period-index.json.gz・team-period-index.json.gz）の形式（DESIGN.md 225章）。
// 選手×試合×ピリオド、チーム×試合×ピリオドの成績を、シーズンごとに列ごとに並べたもの。値は、シーズン成績のQ別・前後半
// （src/lib/playerSeasonBoxscore.ts の computeGamePeriodTotals）が試合の生データから出す値と同じ関数（buildPlayerBoxscores・buildTeamTotalCounts・computeTeamRatings）で作る。
// シーズンごとの集計の保存キーの対象になるので（scripts/lib/dataLayout.ts の BUILD_CODE_ENTRIES）、**ここは形式の定義だけにして、あとから変えない**。
// 読む補助は src/lib/periodIndex.ts（保存キーの対象外）に置く。項目を足すときは、既存の読み方を壊さない形（列を足す）にして、PERIOD_INDEX_VERSION は変えない。

import { STINT_COUNT_KEYS } from "./onCourt.ts";

export const PERIOD_INDEX_VERSION = 1;

/**
 * 持つ区間。前半（1Q＋2Q）・後半（3Q＋4Q）は、読むときに足す（選手の値は足し算で出せる。チームのポゼッションだけは足し算にならないので、別に持つ）。
 * ot は、その試合のすべての延長の合計（延長の無い試合は無し）
 */
export const PERIOD_ATOMS = ["q1", "q2", "q3", "q4", "ot"] as const;
export type PeriodAtom = (typeof PERIOD_ATOMS)[number];

/** 持つ区間の、試合の生データでのピリオド番号（第1延長が5）。ot の本数は試合ごとに違う */
export const PERIOD_ATOM_NUMBERS: Record<Exclude<PeriodAtom, "ot">, number[]> = { q1: [1], q2: [2], q3: [3], q4: [4] };

/** チームのポゼッションを持つ区間（足し算にならないので、前半・後半も別に持つ） */
export const PERIOD_POSS_KEYS = ["q1", "q2", "q3", "q4", "ot", "h1", "h2"] as const;
export type PeriodPossKey = (typeof PERIOD_POSS_KEYS)[number];

/**
 * 選手の統計の列（PlayerGameLog・PlayerSeasonRawTotals と同じ項目名。出場時間だけ秒に直した minSec）。
 * シーズン成績のQ別（buildPeriodFilteredRawTotals）が使う選手の値をすべて含む。+/- は公式のピリオド別の値がある試合だけ（flags の PERIOD_ROW_FLAG_PLUS_MINUS）
 */
export const PLAYER_PERIOD_STAT_COLUMNS = [
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
  "blockedAgainst",
  "foulsDrawn",
  "plusMinus",
  "pt2in",
  "ptfb",
  "pt2nd",
  "ptsOffTov",
  "dunks",
  "basketCounts",
  "pf",
  "technicalFouls",
  "unsportsmanlikeFouls",
  "disqualifyingFouls",
  "offensiveFoulsCommitted",
  "chargesDrawn",
  "assisted2m",
  "assisted3m",
  "assistedFtm",
  "paint2m",
  "paint2a",
  "mid2m",
  "mid2a",
] as const;
export type PlayerPeriodStatColumn = (typeof PLAYER_PERIOD_STAT_COLUMNS)[number];

/** 行の旗: 公式のピリオド別の +/- がある（2022-23以降。無い行の plusMinus は 0 で、値なしとして扱う） */
export const PERIOD_ROW_FLAG_PLUS_MINUS = 1;
/**
 * 行の旗: plusMinus は在コートの復元の値（公式のピリオド別の +/- が無い 2016-17〜2021-22。5人組の区間の Q別の得点差を足したもの。DESIGN.md 303章）。
 * そのチームの試合で、区間の合計が試合全体の復元の +/- と全選手で一致し、区間の得点の合計が両チームの得点と一致したときだけ付ける。古い索引には無い
 */
export const PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED = 2;
/**
 * 出場中の材料の列（在コート基準の再集計。DESIGN.md 303章。shared/playerOnCourt.ts）。選手のその区間の、本人がいた5人組の区間の合計。
 * 「ocSec」秒、「ocOwn.{項目}」自チーム（PLAYER_PERIOD_ONCOURT_OWN_KEYS）、「ocOpp.{項目}」相手（PLAYER_PERIOD_ONCOURT_OPP_KEYS）、「fgAssists」FGにつながったアシスト、「ocQuality」チームの品質（ビット）。
 * 2020-21以降のシーズンの索引だけが持つ（それ以前の索引・古い索引には無い）。プレーバイプレーの無い試合の行は -1
 */
/** Q別で使う項目だけ持つ（容量を抑えるため）: 出場中の割合（%PTS〜%FTA）・AST%（FGM）・個人 OR%（自チーム OR・相手 DR） */
export const PLAYER_PERIOD_ONCOURT_OWN_KEYS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "or"] as const satisfies readonly (typeof STINT_COUNT_KEYS)[number][];
export const PLAYER_PERIOD_ONCOURT_OPP_KEYS = ["dr"] as const satisfies readonly (typeof STINT_COUNT_KEYS)[number][];
export const PLAYER_PERIOD_ONCOURT_COLUMNS = [
  "ocSec",
  ...PLAYER_PERIOD_ONCOURT_OWN_KEYS.map((k) => `ocOwn.${k}` as const),
  ...PLAYER_PERIOD_ONCOURT_OPP_KEYS.map((k) => `ocOpp.${k}` as const),
  "fgAssists",
  "ocQuality",
] as const;

/** チームの統計の列（BoxscoreCounts の項目名のまま。出場時間は秒）。相手の値は、同じ試合の相手の行から引く */
export const TEAM_PERIOD_COUNT_COLUMNS = [
  "minSec",
  "pts",
  "pt2m",
  "pt2a",
  "pt3m",
  "pt3a",
  "ftm",
  "fta",
  "oreb",
  "dreb",
  "treb",
  "ast",
  "tov",
  "stl",
  "blk",
  "foul",
] as const;
export type TeamPeriodCountColumn = (typeof TEAM_PERIOD_COUNT_COLUMNS)[number];

/**
 * チームの統計の列の追加分（DESIGN.md 256章の段階1。2026-10-17）。全チームの表の Misc・Scoring と Scoring % に要る値で、項目名は TeamGameLog と同じ。
 * 値は試合ログ（scripts/aggregate.ts）と同じ関数で、プレーバイプレーをその区間のピリオドに絞って（得点の内訳・ファウル等）、
 * ボックススコアはその区間の行で（被ファウル・ベンチ／スタメン得点・登録区分別の得点）出す。区間の合計は試合ログの値と一致する（validate-period-index が確かめる）。
 * 古い索引には無い（読む側は、キー「区間.列」が無ければ対象外として扱う）
 */
export const TEAM_PERIOD_EXTRA_COLUMNS = [
  "foulsDrawn",
  "pt2in",
  "fb",
  "pt2nd",
  "pft",
  "dunks",
  "technicalFouls",
  "basketCounts",
  "unsportsmanlikeFouls",
  "disqualifyingFouls",
  "technicalFoulsCat1",
  "technicalFoulsCat2",
  "flagrantFouls",
  "disruptiveFouls",
  "assisted2m",
  "assisted3m",
  "assistedFtm",
  "paint2m",
  "paint2a",
  "mid2m",
  "mid2a",
  "benchPoints",
  "starterPoints",
  "japanesePoints",
  "foreignPoints",
  "naturalizedPoints",
  "asianQuotaPoints",
] as const;
export type TeamPeriodExtraColumn = (typeof TEAM_PERIOD_EXTRA_COLUMNS)[number];

/**
 * オフェンスファウル（OFF FOUL）・チャージ（CHARGE）の列（275章 段階3。2026-10-20）。自チームの選手のうち、その区間にオフェンスファウルを犯した数・チャージを取った数の合計
 * （画面の区間別の選手スタッツ〔buildPlayerBoxscores〕を足したものと同じ値）。相手の値は相手の行から引く。ピリオド別の行が無い試合は -1。
 * 古い索引には無い（画面は「-」にする）ので、TEAM_PERIOD_EXTRA_COLUMNS には入れない
 */
export const TEAM_PERIOD_FOUL_COLUMNS = ["offFouls", "charges"] as const;
export type TeamPeriodFoulColumn = (typeof TEAM_PERIOD_FOUL_COLUMNS)[number];

/**
 * 外国籍・帰化・アジアの選手が同時に0〜4人コートにいた在コート秒数の列（On-Court Foreign。256章の段階1）。数え方は TeamGameLog.foreignCourtSeconds と同じ
 * （ピリオドの切れ目をまたぐ5人組は切れ目で分ける）。その試合で数えられる5人組が1つも無いチームは、すべての区間で -1（対象外）。古い索引には無い
 */
export const TEAM_PERIOD_FOREIGN_COLUMNS = ["oc0", "oc1", "oc2", "oc3", "oc4"] as const;
export type TeamPeriodForeignColumn = (typeof TEAM_PERIOD_FOREIGN_COLUMNS)[number];

/**
 * 人数（0〜4人）ごとの、その人数の5人組がコートにいた間の得点・失点・攻撃回数の列（256章の段階3の作り直しの回。2026-10-17）。
 * 「oc{n}Pts」自チームの得点・「oc{n}OppPts」相手の得点・「oc{n}Poss」自チームの攻撃回数・「oc{n}OppPoss」相手の攻撃回数。
 * 数え方は、よく使われるラインナップ（data/{season}/lineups）と同じ（区間の長さによらず足し、得点イベントのピリオドで区間に振り分ける）。
 * 攻撃回数は 2020-21 以降だけ（2019-20 以前は -1）。人数別の秒数（TEAM_PERIOD_FOREIGN_COLUMNS）と同じく、数えられる5人組が無いチームは全区間 -1。古い索引には無い
 */
export const TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS = [
  ...[0, 1, 2, 3, 4].map((n) => `oc${n}Pts`),
  ...[0, 1, 2, 3, 4].map((n) => `oc${n}OppPts`),
  ...[0, 1, 2, 3, 4].map((n) => `oc${n}Poss`),
  ...[0, 1, 2, 3, 4].map((n) => `oc${n}OppPoss`),
] as const;

/**
 * 試合全体の値を持つキー（「all.列」）。人数別の列（TEAM_PERIOD_FOREIGN_COLUMNS・TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS）だけを持つ。
 * 前後半5分の特別な試合は1Q〜4Qを持たない（-1）ので、試合全体の値は区間の合計では出せない。そのためすべての試合で試合全体の値を別に持つ
 * （特別な試合以外では、1Q〜4Q＋延長の合計と一致する。validate-period-index が確かめる）。古い索引には無い
 */
export const TEAM_PERIOD_WHOLE_GAME_KEY = "all";

/**
 * 選手のピリオド別の索引。同じシーズンの player-game-index.json の行（番号 row）に、区間ごとの値を結び付ける。
 * 行は (row, period) の昇順。その区間に出た（出場時間が0より長い、または何か記録のある）行だけを持つ。前後半5分の特別な試合の行は持たない
 */
export interface PlayerPeriodIndexFile {
  version: typeof PERIOD_INDEX_VERSION;
  generatedAt: string;
  season: string;
  /** 結び付け先の player-game-index.json の行数（合わないときは使わない） */
  indexRows: number;
  rows: {
    /** player-game-index.json の行の番号 */
    row: number[];
    /** 区間（PERIOD_ATOMS の番号） */
    period: number[];
    flags: number[];
    /** 2020-21以降は、PLAYER_PERIOD_ONCOURT_COLUMNS の列も持つ */
    stats: Record<PlayerPeriodStatColumn, number[]> & Partial<Record<string, number[]>>;
  };
}

/**
 * チームのピリオド別の索引。行の位置は team-game-index.json と同じ（試合番号×2＋(ホーム 0／アウェイ 1)）。
 * 値が無い区間（前後半5分の特別な試合の1Q〜4Q・前半・後半、延長の無い試合の延長）は -1。
 * counts のキーは「区間.列」（例: "q1.pts"）。列は TEAM_PERIOD_COUNT_COLUMNS・TEAM_PERIOD_EXTRA_COLUMNS・TEAM_PERIOD_FOREIGN_COLUMNS・TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS（後の3つは 2026-10-17 から）。
 * 人数別の列は、試合全体の値も「all.列」（TEAM_PERIOD_WHOLE_GAME_KEY）で持つ。poss は PERIOD_POSS_KEYS ごとのポゼッション（足し算にならないので前半・後半も別に持つ。小数のまま）
 */
export interface TeamPeriodIndexFile {
  version: typeof PERIOD_INDEX_VERSION;
  generatedAt: string;
  season: string;
  /** 結び付け先の team-game-index.json の行数（合わないときは使わない） */
  indexRows: number;
  rows: {
    counts: Record<string, number[]>;
    poss: Record<PeriodPossKey, number[]>;
  };
}
