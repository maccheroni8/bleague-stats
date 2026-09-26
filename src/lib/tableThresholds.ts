/**
 * 表の対象・除外の基準のうち、表を作るページと用語集（GlossaryGuides）の両方で使う値。
 * 用語集の説明と実際の基準がずれないよう、ここ1か所で定義する
 */

/** Scoring %（得点構成・FG試投構成）の選手の対象の出場時間の下限（1試合平均・合計、分） */
export const SCORING_SHARE_MIN_MPG = 10;
export const SCORING_SHARE_MIN_TOTAL_MIN = 300;

/** 直近成績（選手一覧）の直近N試合の選択肢と、対象にする最低出場試合数 */
export const RECENT_FORM_N_OPTIONS = [5, 10] as const;
export type PlayerRecentFormRecentN = (typeof RECENT_FORM_N_OPTIONS)[number];
export const MIN_GAMES_FOR_PLAYER_RECENT_FORM: Record<PlayerRecentFormRecentN, number> = { 5: 3, 10: 5 };

/**
 * よく使われるラインナップ（チーム詳細）で除外する出場時間の下限（秒）。これ未満はサンプルが小さすぎてノイズが大きい
 * （実データ確認: 4試合時点で3分(180秒)基準だとチームあたり4〜14組が該当。DESIGN.md参照）
 */
export const MIN_LINEUP_SECONDS = 180;
