// 旧試作URLを、条件を保ったままチームの年齢分布へ読み替える。
export function normalizeFigureParams(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  if (next.get("entity") === "player" && next.get("figure") === "index") return next;
  next.set("entity", "team");
  next.set("figure", "age");
  return next;
}
