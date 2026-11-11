// 図解「歴代最強ラインナップ」（DESIGN.md 370章）の導出データの形。作るのは scripts/aggregate-best-lineups.ts、読むのは src/lib/bestLineups.ts。
// 人数（2〜5人）ごとに1ファイル（data/best-lineups-{人数}.json.gz）。1行＝1シーズン×1クラブ×同じ組み合わせ×組の OC（その組の外国籍・帰化・アジア特別枠の人数）。
// シーズンの途中で登録区分が変わった選手がいる組は、OC ごとに別の行になる（読む側が組ごとに足して「すべて」の値にする）。
// 値は生の合計（時間・試合数・得点・失点・攻守のポゼッション）だけで、率は読むときに計算する。
// 残す組は、組全体（すべての OC・レギュラー＋ポストシーズン）で攻守とも「下限の最も小さい選択肢」以上のポゼッションがあるもの（どの区分・OC で絞っても、
// 下限を満たしうる組はすべて入る。区分・OC で絞った値は組全体の値以下なので）。

export type BestLineupSize = 2 | 3 | 4 | 5;
export const BEST_LINEUP_SIZES: readonly BestLineupSize[] = [2, 3, 4, 5];

/** 攻守それぞれのポゼッションの下限の選択肢（人数ごと。最初の値は DEFAULT）。ファイルには最も小さい選択肢以上の組を入れる */
export const BEST_LINEUP_MIN_POSS_OPTIONS: Record<BestLineupSize, readonly number[]> = {
  5: [100, 200, 400],
  4: [400, 600, 1000],
  3: [800, 1200, 1600],
  2: [1200, 1800, 2400],
};
/**
 * 最初の下限。2〜4人は、5人組（100・200・400）とレギュラーシーズンの対象の組の数が近くなる値にした（2026-11-11 の数え。
 * 5人 866・277・71／4人 829・319・62／3人 1008・265・49／2人 1322・304・36。DESIGN.md 370章）
 */
export const BEST_LINEUP_MIN_POSS_DEFAULT: Record<BestLineupSize, number> = { 5: 200, 4: 600, 3: 1200, 2: 1800 };

/** 対象の最初のシーズン（実際のポゼッションを数えているシーズン） */
export const BEST_LINEUP_FIRST_SEASON = "2020-21";

export function bestLineupFileName(size: BestLineupSize): string {
  return `best-lineups-${size}.json.gz`;
}

/** 試合区分ごとの合計の並び（行の中の位置） */
export const BL_SEC = 0;
export const BL_GAMES = 1;
export const BL_PTS = 2;
export const BL_OPP = 3;
export const BL_OWN_POSS = 4;
export const BL_OPP_POSS = 5;
export const BL_SUM_WIDTH = 6;

export interface BestLineupsFile {
  version: 1;
  size: BestLineupSize;
  /** 入れた組の下限（攻守とも。全試合・すべての OC の合計で判定） */
  minPoss: number;
  /** 対象のシーズン（昇順） */
  seasons: string[];
  /** シーズンごとの、集計に入った試合の最新の日付（YYYY-MM-DD。基準日の表示に使う） */
  latestDates: Record<string, string>;
  /** [シーズンの番号, チームID, そのシーズンのチーム名] */
  teams: [number, string, string][];
  /** [選手ID, 名前]。同じ選手でもシーズンで表記が違えば別の項目 */
  players: [string, string][];
  /**
   * 1行: [teams の番号, 選手の番号×人数（選手IDの文字列の昇順）, OC（数えられないとき -1）,
   *        レギュラーシーズンの合計×BL_SUM_WIDTH, ポストシーズンの合計×BL_SUM_WIDTH]
   */
  rows: number[][];
}
