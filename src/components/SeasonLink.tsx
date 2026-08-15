// 現在のURLの?season=クエリパラメータを、遷移先のリンクにも自動で引き継ぐLink/NavLinkラッパー。
// これによりページ側は個々のリンク生成時にseasonを意識する必要が無くなる
// （SortableTableのlinkTo等、既存の`(row) => \`/teams/${row.id}\``という書き方をそのまま維持できる）。
// ?season=が無い場合（現在シーズンをそのまま見ている場合）は何も付与しない
import { Link, NavLink, useSearchParams, type LinkProps, type NavLinkProps } from "react-router-dom";

function withSeason(to: string, season: string | null): string {
  if (!season) return to;
  const [path, query] = to.split("?");
  const params = new URLSearchParams(query);
  params.set("season", season);
  return `${path}?${params.toString()}`;
}

export function SeasonLink({ to, ...rest }: LinkProps) {
  const [searchParams] = useSearchParams();
  const resolvedTo = typeof to === "string" ? withSeason(to, searchParams.get("season")) : to;
  return <Link to={resolvedTo} {...rest} />;
}

export function SeasonNavLink({ to, ...rest }: NavLinkProps) {
  const [searchParams] = useSearchParams();
  const resolvedTo = typeof to === "string" ? withSeason(to, searchParams.get("season")) : to;
  return <NavLink to={resolvedTo} {...rest} />;
}
