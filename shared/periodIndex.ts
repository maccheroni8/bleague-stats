// ピリオド別の索引（data/{season}/player-period-index.json.gz・team-period-index.json.gz）の形式（DESIGN.md 225章）。
// 選手×試合×ピリオド、チーム×試合×ピリオドの成績を、シーズンごとに列ごとに並べたもの。値は、シーズン成績のQ別・前後半
// （src/lib/playerSeasonBoxscore.ts の computeGamePeriodTotals）が試合の生データから出す値と同じ関数（buildPlayerBoxscores・buildTeamTotalCounts・computeTeamRatings）で作る。
// シーズンごとの集計の保存キーの対象になるので（scripts/lib/dataLayout.ts の BUILD_CODE_ENTRIES）、**ここは形式の定義だけにして、あとから変えない**。
// 読む補助は src/lib/periodIndex.ts（保存キーの対象外）に置く。項目を足すときは、既存の読み方を壊さない形（列を足す）にして、PERIOD_INDEX_VERSION は変えない。

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
    stats: Record<PlayerPeriodStatColumn, number[]>;
  };
}

/**
 * チームのピリオド別の索引。行の位置は team-game-index.json と同じ（試合番号×2＋(ホーム 0／アウェイ 1)）。
 * 値が無い区間（前後半5分の特別な試合の1Q〜4Q・前半・後半、延長の無い試合の延長）は -1。
 * counts のキーは「区間.列」（例: "q1.pts"）。poss は PERIOD_POSS_KEYS ごとのポゼッション（足し算にならないので前半・後半も別に持つ。小数のまま）
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
