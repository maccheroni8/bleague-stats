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
  { id: "top-scorers", entity: "player", label: "トップスコアラー", group: "得点", load: () => import("./TopScorersFigure") },
  { id: "player-scatter", entity: "player", label: "散布図", group: "効率", load: () => import("./PlayerFreeScatterFigure") },
  { id: "player-venn", entity: "player", label: "ベン図", group: "効率", load: () => import("./PlayerVennFigure") },
  { id: "shoot-table-player", entity: "player", label: "シュート成功率", group: "効率", load: () => import("./PlayerShootTableFigure") },
  { id: "age", entity: "team", label: "年齢分布", group: "年齢", load: () => import("./AgeDistributionFigure") },
  { id: "ratings", entity: "team", label: "ORtg・DRtg", group: "効率", load: () => import("./RatingsScatterFigure") },
  { id: "division-matchups", entity: "team", label: "地区間の対戦数", group: "日程", load: () => import("./DivisionMatchupsFigure") },
  { id: "scoring", entity: "team", label: "日本人・外国籍の得点", group: "得点", load: () => import("./ScoringScatterFigure") },
  { id: "winpct-class", entity: "team", label: "勝率と登録区分別の得失点", group: "得点", load: () => import("./WinPctScatterFigure") },
  { id: "team-venn", entity: "team", label: "ベン図", group: "効率", load: () => import("./TeamVennFigure") },
  { id: "team-shooting", entity: "team", label: "散布図", group: "効率", load: () => import("./TeamFreeScatterFigure") },
  { id: "shoot-table-team", entity: "team", label: "シュート成功率", group: "効率", load: () => import("./TeamShootTableFigure") },
  { id: "best-lineup", entity: "team", label: "最強ラインナップ", group: "効率", load: () => import("./BestLineupFigure") },
  { id: "four-factors", entity: "team", label: "Four Factors", group: "効率", load: () => import("./FourFactorsFigure") },
];

export function figuresForEntity(entity: FigureEntity, catalog: readonly FigureDefinition[] = FIGURES) {
  return catalog.filter(figure => figure.entity === entity);
}
