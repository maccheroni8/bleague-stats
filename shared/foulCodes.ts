// ファウル種別のActionCD1コード（新旧）。DESIGN.md 16-7章。
//
// 2026-27の新競技規則で、公式の記録が新表記へ移行した（2026-10-06にAPIの返り値が書き換わった。9/23〜10/4の33試合）。
// 同じ試合の書き換え前後を比べると、変わったのは次の2点だけで、イベントの数・並び・FTの本数・攻撃権は同じ（実データで確認済み。16-7章）:
//   旧24（選手個人のテクニカル）→ 91（テクニカル カテゴリ1）／92（カテゴリ2）
//   旧25（アンスポーツマン）    → 93（フレグラント）／94（ディスラプティブ）
// コーチ・ベンチのテクニカル（20・21）とディスクォリファイング（26）はコードのまま（20・21は文言に「カテゴリ1」が付く）。
// 集計・ポゼッションの判定は、旧コードと新コードを同じ扱いにする。新しい区分の件数は、別の項目（FoulCategoryCounts）としても持つ。

import type { FoulCategoryCounts, OpponentFoulCategoryCounts } from "./types.ts";

/** 選手個人のテクニカルファウル（旧24・新91/92）。PlayerID1に選手が付く */
export const PLAYER_TECHNICAL_FOUL_CODES: ReadonlySet<number> = new Set([24, 91, 92]);
/** コーチ・ベンチのテクニカルファウル（20・21）。選手に紐付かずチームに帰属する */
export const TEAM_TECHNICAL_FOUL_CODES: ReadonlySet<number> = new Set([20, 21]);
/** テクニカルファウルのFT（FTの後もボールを保持していたチームが続ける）になる反則のコード（20・21・24・91・92） */
export const TECHNICAL_FT_FOUL_CODES: ReadonlySet<number> = new Set([20, 21, 24, 91, 92]);
/** アンスポーツマン系のファウル（旧25・新93/94）。UFOULの集計に使う */
export const UNSPORTSMANLIKE_FOUL_CODES: ReadonlySet<number> = new Set([25, 93, 94]);
/** ディスクォリファイングファウル（26）。DQFOULの集計に使う */
export const DISQUALIFYING_FOUL_CODE = 26;
/** アンスポーツマン系のFT（FTを得た側がボールを保持する）になる反則のコード（25・26・93・94） */
export const UNSPORTSMANLIKE_FT_FOUL_CODES: ReadonlySet<number> = new Set([25, 26, 93, 94]);
/** 新しい区分のコード（91〜94） */
export const NEW_FOUL_CODES: ReadonlySet<number> = new Set([91, 92, 93, 94]);

/** 新しい区分のコード → 件数の項目（旧コードは区分が無いので null） */
export function foulCategoryKey(code: number): keyof FoulCategoryCounts | null {
  switch (code) {
    case 91:
      return "technicalFoulsCat1";
    case 92:
      return "technicalFoulsCat2";
    case 93:
      return "flagrantFouls";
    case 94:
      return "disruptiveFouls";
    default:
      return null;
  }
}

/** 0件の項目は持たない（2025-26以前など古いデータに項目が無くても画面が動く形。導出データも、新しい区分が無い試合は変わらない） */
export function nonZeroFoulCategoryFields(counts: Partial<FoulCategoryCounts> | undefined): Partial<FoulCategoryCounts> {
  const out: Partial<FoulCategoryCounts> = {};
  if (!counts) return out;
  for (const key of ["technicalFoulsCat1", "technicalFoulsCat2", "flagrantFouls", "disruptiveFouls"] as const) {
    if (counts[key]) out[key] = counts[key];
  }
  return out;
}

/** 相手チーム分の項目名（opponentTechnicalFoulsCat1 など）に付け替える */
export function opponentFoulCategoryFields(counts: Partial<FoulCategoryCounts> | undefined): Partial<OpponentFoulCategoryCounts> {
  const f = nonZeroFoulCategoryFields(counts);
  const out: Partial<OpponentFoulCategoryCounts> = {};
  if (f.technicalFoulsCat1) out.opponentTechnicalFoulsCat1 = f.technicalFoulsCat1;
  if (f.technicalFoulsCat2) out.opponentTechnicalFoulsCat2 = f.technicalFoulsCat2;
  if (f.flagrantFouls) out.opponentFlagrantFouls = f.flagrantFouls;
  if (f.disruptiveFouls) out.opponentDisruptiveFouls = f.disruptiveFouls;
  return out;
}
