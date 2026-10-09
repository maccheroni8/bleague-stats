// 1試合行の索引（data/{season}/player-game-index.json.gz・team-game-index.json.gz）の形式（DESIGN.md 219章）。
// 選手・チームの試合ログ（player-games/・team-games/）の、ランキングの1試合記録の条件・昇順・連続記録などに必要な項目を、1シーズン1ファイルに
// 列ごとに並べたもの（1行ずつのオブジェクトにすると約4倍になる）。シーズンごとの集計の保存キーの対象になるので（scripts/lib/dataLayout.ts の
// BUILD_CODE_ENTRIES）、**ここは形式の定義だけにして、あとから変えない**。検索・読み込みの補助は src/lib/gameIndex.ts（保存キーの対象外）に置く。
// 項目を足すときは、既存の読み方を壊さない形（統計の列を足す）にして、GAME_INDEX_VERSION は変えない。
import type { Division } from "./types.ts";

export const GAME_INDEX_VERSION = 1;

/** 試合の旗: ポストシーズンの試合 */
export const GAME_FLAG_PLAYOFF = 1;
/** 試合の旗: 前後半5分の特別な試合（2016-17・2017-18のCSで1勝1敗のときに行った。1Q〜4Qが無い。DESIGN.md 143章） */
export const GAME_FLAG_SHORT = 2;
/** 選手の行の旗: 先発 */
export const ROW_FLAG_STARTER = 1;
/** 選手の行の旗: ホーム（自チームが試合の表のホーム） */
export const ROW_FLAG_HOME = 2;

/** 選手の統計の列（PlayerGameLog の項目名のまま。出場時間だけ秒に直した minSec） */
export const PLAYER_INDEX_STAT_COLUMNS = [
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
  // アシストされた得点（被アシスト率）。2P・3P・FTの成功数
  "assisted2m",
  "assisted3m",
  "assistedFtm",
  // 勝ち越し弾・同点弾・決勝点（第4Q・延長の残り5分・2分・1分以内。FGとFT）。位置は shared/gameFlow.ts の clutchIndex（窓×種類×{FG,FT}）。DESIGN.md 221章
  "c5GaFg",
  "c5GaFt",
  "c5TieFg",
  "c5TieFt",
  "c5WinFg",
  "c5WinFt",
  "c2GaFg",
  "c2GaFt",
  "c2TieFg",
  "c2TieFt",
  "c2WinFg",
  "c2WinFt",
  "c1GaFg",
  "c1GaFt",
  "c1TieFg",
  "c1TieFt",
  "c1WinFg",
  "c1WinFt",
] as const;

/** 勝負所の列（clutchIndex の順）。PLAYER_INDEX_STAT_COLUMNS の末尾の18個 */
export const PLAYER_INDEX_CLUTCH_COLUMNS = PLAYER_INDEX_STAT_COLUMNS.slice(-18) as unknown as readonly (typeof PLAYER_INDEX_STAT_COLUMNS)[number][];

/** チームの統計の列（TeamGameLog の項目名のまま。attendance は未計測を -1 で持つ） */
export const TEAM_INDEX_STAT_COLUMNS = [
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
  "fb",
  "pt2in",
  "pft",
  "pt2nd",
  "foulsDrawn",
  "dunks",
  "benchPoints",
  "starterPoints",
  "attendance",
  "japanesePoints",
  "foreignPoints",
  "naturalizedOrAsianPoints",
  // 最大のラン（点数・最初と最後の得点の経過秒・ラン直前の両チームの得点）。プレーバイプレーの得点が無い試合は -1。DESIGN.md 221章
  "maxRun",
  "maxRunFromSec",
  "maxRunToSec",
  "maxRunOwnBefore",
  "maxRunOppBefore",
] as const;

/** チームの1Q〜4Qの得点の列。自チーム p1〜p4、相手 o1〜o4。公式のスコアが欠けていて補えなかった区間と、前後半5分の特別な試合は -1 */
export const TEAM_INDEX_PERIOD_COLUMNS = ["p1", "p2", "p3", "p4", "o1", "o2", "o3", "o4"] as const;

/** チーム辞書の1件: [チームID, そのシーズンのチーム名, そのシーズンの地区（履歴に無ければ ""）] */
export type IndexTeam = [id: string, name: string, division: Division | ""];

/**
 * 試合の表（全試合を日付→試合番号の順に並べた列。選手・チームの行は、この並びの番号で試合を指す）。
 * home・away はチーム辞書の番号。homeMaxLead・awayMaxLead は、試合中にホーム・アウェイが最も大きくリードした点差（延長を含む。プレーバイプレーが無ければ -1）
 */
export interface IndexGames {
  key: string[];
  date: string[];
  flags: number[];
  home: number[];
  away: number[];
  homeScore: number[];
  awayScore: number[];
  overtimes: number[];
  homeMaxLead: number[];
  awayMaxLead: number[];
}

/** 選手辞書の1件: [選手ID, そのシーズンの名前, 当時のポジション（無ければ ""）, ポジションの補い方（"" 当時の値／"near" 近いシーズンの値／"current" 現在の値）, 生年月日（無ければ ""）, 登録区分（"jp"・"intl"・無ければ ""）] */
export type IndexPlayer = [id: string, name: string, position: string, positionFallback: "" | "near" | "current", birthDate: string, classKey: "jp" | "intl" | ""];

export interface PlayerGameIndexFile {
  version: typeof GAME_INDEX_VERSION;
  generatedAt: string;
  season: string;
  teams: IndexTeam[];
  games: IndexGames;
  players: IndexPlayer[];
  /** 1選手×1試合（出場した試合だけ）。選手の番号→試合の番号の順に並ぶ。列の長さはすべて同じ */
  rows: {
    player: number[];
    game: number[];
    flags: number[];
    stats: Record<(typeof PLAYER_INDEX_STAT_COLUMNS)[number], number[]>;
  };
}

export interface TeamGameIndexFile {
  version: typeof GAME_INDEX_VERSION;
  generatedAt: string;
  season: string;
  teams: IndexTeam[];
  games: IndexGames;
  /** 1チーム×1試合。各試合にホーム・アウェイの2行があり、行の位置は「試合の番号×2＋(ホーム 0／アウェイ 1)」 */
  rows: {
    stats: Record<(typeof TEAM_INDEX_STAT_COLUMNS)[number] | (typeof TEAM_INDEX_PERIOD_COLUMNS)[number], number[]>;
    /** 1Q〜4Qの得点をプレーバイプレーから補った行: [行の位置, 補った区間（1始まり）] */
    periodsFromPbp: [row: number, periods: number[]][];
  };
}
