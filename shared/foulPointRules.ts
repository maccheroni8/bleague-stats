// 反則ポイントの点数（シーズンごとの「反則金に関する規程」第3条。DESIGN.md 416章）。点数の表はこの1か所。
// 画面（図解「ファウル」の反則ポイントの表）と検証が読む。集計（shared/foulPoints.ts）は数だけを持ち、ここを読まない（保存キーの対象外）。
//
// 版ごとの根拠（bleague.jp の規程集 PDF。番号は年度で変わる）:
//   2016年6月1日施行の原本（2016-17）: 保管版が見つからない。前後の版と同じ点数として推定（2026-11-17 のユーザーの決定）
//   2017年7月12日改正（2017-18・2018-19）: http://web.archive.org/web/20190920061933/https://www.bleague.jp/files/user/about/pdf/r-29_2018.pdf
//     退場1回3点（5回のプレイヤー・ファウルによる退場を除く）、テクニカル・アンスポーツマンライク1回1点、出場停止1試合3点、
//     同じ試合でテクニカル・アンスポーツマンライク2回により退場したときは退場の3点だけ。エントリー人数の項は無い
//   2019年9月11日改正（2019-20）: 保管版が見つからない。前後の版と同じ点数として推定し、エントリー人数の分は数えない（同上の決定）
//   2020年7月14日改正（2020-21〜2025-26）: http://web.archive.org/web/20240926203325/https://www.bleague.jp/files/user/about/pdf/r-27.pdf
//     （2020-09・2022-01・2023-05・2024-09 の保管版は同文。2026年7月14日の改正まで改正の記録なし）
//     2017年版に、エントリー人数が9名以下の試合は (10−人数)×5点 を加えた
//   2026年7月14日・8月18日改正（2026-27〜）: https://www.bleague.jp/files/user/about/pdf/r-27.pdf
//     テクニカル（カテゴリ2）1点、テクニカル（カテゴリ1）・フレグラント2点、ディスクォリファイング4点、出場停止1試合4点、エントリー人数は同じ。
//     退場の点は無くなった。ディスラプティブは点数の定めが無い（0点）
// どの版も、試合開始の遅れ（第1・第3クォーター）の点があるが、記録が無いので数えない。リーグ戦（レギュラーシーズン）の年間合計で、31点以上で反則金。

export type FoulPointSystem = "old" | "new";

export interface FoulPointRule {
  /** この規程を当てる最初のシーズン */
  from: string;
  system: FoulPointSystem;
  /** 規程の版（画面・用語集の文） */
  version: string;
  /** 版が見つからず、前後の版から推定したか */
  estimated: boolean;
  /** エントリー人数（9名以下）の分を数えるか */
  entry: boolean;
  points: {
    /** 旧: テクニカル・アンスポーツマンライク1回 */
    tf?: number;
    uf?: number;
    /** 旧: 退場1回（5ファウルを除く） */
    ejection?: number;
    /** 新: テクニカル（カテゴリ1・2）・フレグラント・ディスクォリファイング・ディスラプティブ */
    tf1?: number;
    tf2?: number;
    flagrant?: number;
    dq?: number;
    disruptive?: number;
    /** 出場停止1試合 */
    suspension: number;
    /** エントリー人数1人足りないごと（10名との差×この点） */
    entryShortPerPlayer: number;
  };
  /**
   * 反則金の段階（第2条。万円）。premier＝B1（2025-26 まで）・B.PREMIER、one＝B2（2025-26 まで）・B.ONE。
   * 版が見つからないシーズンは、点数と同じく前後の版を当てはめる（推定）
   */
  fines: Record<"premier" | "one", readonly FoulPointFineStep[]>;
}

/** 反則ポイントの段階（from 点以上 to 点以下。to が null は「以上」）と反則金（万円） */
export interface FoulPointFineStep {
  from: number;
  to: number | null;
  manYen: number;
}

/** 反則金がかかる年間の合計（31点以上） */
export const FOUL_POINTS_FINE_THRESHOLD = 31;
/** エントリー人数の基準（10名との差） */
export const FOUL_POINTS_ENTRY_BASE = 10;

const OLD_POINTS = { tf: 1, uf: 1, ejection: 3, suspension: 3, entryShortPerPlayer: 5 };
const steps = (amounts: readonly number[]): FoulPointFineStep[] =>
  amounts.map((manYen, i) => ({ from: 31 + i * 10, to: i === amounts.length - 1 ? null : 40 + i * 10, manYen }));
/** 2017年版・2020年版（B1・B2）: B1 は 81点以上 150万円、B2 は 71点以上 100万円 */
const OLD_FINES = { premier: steps([20, 40, 60, 80, 100, 150]), one: steps([20, 40, 60, 80, 100]) };
/** 2026年版: B.PREMIER は 81点以上 300万円、B.ONE は 81点以上 150万円 */
const NEW_FINES = { premier: steps([40, 80, 120, 160, 200, 300]), one: steps([20, 40, 60, 80, 100, 150]) };

/** 新しい順（そのシーズン以前で最も新しい行を当てる） */
export const FOUL_POINT_RULES: readonly FoulPointRule[] = [
  { from: "2026-27", system: "new", version: "2026年8月18日改正", estimated: false, entry: true, points: { tf1: 2, tf2: 1, flagrant: 2, dq: 4, disruptive: 0, suspension: 4, entryShortPerPlayer: 5 }, fines: NEW_FINES },
  { from: "2020-21", system: "old", version: "2020年7月14日改正", estimated: false, entry: true, points: OLD_POINTS, fines: OLD_FINES },
  { from: "2019-20", system: "old", version: "2019年9月11日改正（版が見つからないため推定）", estimated: true, entry: false, points: OLD_POINTS, fines: OLD_FINES },
  { from: "2017-18", system: "old", version: "2017年7月12日改正", estimated: false, entry: false, points: OLD_POINTS, fines: OLD_FINES },
  { from: "2016-17", system: "old", version: "2016年6月1日施行（版が見つからないため推定）", estimated: true, entry: false, points: OLD_POINTS, fines: OLD_FINES },
];

/** 反則金の表のリーグの名前（2025-26 までは B1・B2） */
export function foulPointLeagueLabel(season: string, category: "premier" | "one"): string {
  if (season >= "2026-27") return category === "one" ? "B.ONE" : "B.PREMIER";
  return category === "one" ? "B2" : "B1";
}

/** そのシーズンの規程（2016-17 より前は null） */
export function foulPointRuleFor(season: string): FoulPointRule | null {
  return FOUL_POINT_RULES.find((r) => season >= r.from) ?? null;
}

/** エントリー人数の分の点（9名以下の試合。数えないシーズン・ボックススコアの無い試合は0） */
export function entryShortPoints(rule: FoulPointRule, entry: number): number {
  if (!rule.entry || entry < 0 || entry >= FOUL_POINTS_ENTRY_BASE) return 0;
  return (FOUL_POINTS_ENTRY_BASE - entry) * rule.points.entryShortPerPlayer;
}
