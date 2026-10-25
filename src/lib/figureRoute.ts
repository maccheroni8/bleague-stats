import { FIGURES, figuresForEntity, type FigureDefinition, type FigureEntity } from "../figures/catalog";

/** 旧URLを保ち、登録した図の対象に合わせる。未実装の図は選択肢にしない。 */
export function normalizeFigureParams(params: URLSearchParams, catalog: readonly FigureDefinition[] = FIGURES): URLSearchParams {
  const next = new URLSearchParams(params);
  const requested = next.get("figure");
  const entity: FigureEntity = next.get("entity") === "player" ? "player" : "team";
  const exact = catalog.find(figure => figure.id === requested);
  // figureが無かった初期試作は、選手側でも年齢分布だったためチーム側へ移す。
  const legacy = !requested ? catalog.find(figure => figure.id === "age") : undefined;
  const target = exact ?? legacy ?? (requested ? figuresForEntity(entity, catalog)[0] : figuresForEntity("team", catalog)[0]);
  next.set("entity", target?.entity ?? entity);
  next.set("figure", target?.id ?? "index");
  return next;
}
