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
 * よく使われるラインナップ（チーム詳細）の条件。次の2つを両方満たす組み合わせだけを、普段の表示に出す
 * （満たさない組み合わせは「全パターンを表示」で開く。DESIGN.md 203章）:
 * - 使われた試合の平均で、MIN_LINEUP_AVG_SECONDS秒以上（出場時間の合計 ÷ 使われた試合数）
 * - 使われた試合数が、チームの試合数のMIN_LINEUP_GAME_SHARE以上
 */
export const MIN_LINEUP_AVG_SECONDS = 180;
export const MIN_LINEUP_GAME_SHARE = 0.15;
