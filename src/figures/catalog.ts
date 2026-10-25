// 完成した図だけを登録する。表示順はこの配列順。追加は1行と図の部品1つで完了する。
import type { ComponentType } from "react";
import type { Category } from "../../shared/types";

export type FigureEntity = "team" | "player";
export interface FigureProps { season: string; category: Category }
export interface FigureDefinition {
  /** 公開後は変えない。URLのfigureに使う */
  id: string;
  entity: FigureEntity;
  label: string;
  /** 図が増えたら分類に使う。現在は分類の選択欄を出さない */
  group: string;
  load: () => Promise<{ default: ComponentType<FigureProps> }>;
}
export const FIGURES: readonly FigureDefinition[] = [
  { id: "age", entity: "team", label: "年齢分布", group: "年齢", load: () => import("./AgeDistributionFigure") },
];

export function figuresForEntity(entity: FigureEntity, catalog: readonly FigureDefinition[] = FIGURES) {
  return catalog.filter(figure => figure.entity === entity);
}
