// 現在のURLの?season=クエリパラメータと、見ているリーグ（league=one。DESIGN.md 297章）を、遷移先のリンクにも自動で引き継ぐLink/NavLinkラッパー。
// これによりページ側は個々のリンク生成時にseason・リーグを意識する必要が無くなる
// （SortableTableのlinkTo等、既存の`(row) => \`/teams/${row.id}\``という書き方をそのまま維持できる）。
// ?season=が無い場合（現在シーズンをそのまま見ている場合）は season を付与しない。
// 遷移先に?season=が書いてあるリンク（別のシーズンのページへつなぐもの）はそのまま使う。
// 遷移先に league が書いてあるリンク（もう一方のリーグのページへつなぐもの）はそれを使う（`league=premier` は書かない形に直す）
import { Link, NavLink, useSearchParams, type LinkProps, type NavLinkProps } from "react-router-dom";
import { applyLeagueToParams, leagueFromParams, type League } from "../lib/league";

export function withSeasonAndLeague(to: string, season: string | null, league: League): string {
  // ページ内の位置（#以降。用語集の節へのリンク等）はクエリの後ろに付け直す
  const hashIndex = to.indexOf("#");
  const hash = hashIndex >= 0 ? to.slice(hashIndex) : "";
  const [path, query] = (hashIndex >= 0 ? to.slice(0, hashIndex) : to).split("?");
  const params = new URLSearchParams(query);
  if (season && !params.has("season")) params.set("season", season);
  applyLeagueToParams(params, league);
  const q = params.toString();
  if (!q) return `${path}${hash}`;
  return `${path}?${q}${hash}`;
}

export function SeasonLink({ to, ...rest }: LinkProps) {
  const [searchParams] = useSearchParams();
  const resolvedTo = typeof to === "string" ? withSeasonAndLeague(to, searchParams.get("season"), leagueFromParams(searchParams)) : to;
  return <Link to={resolvedTo} {...rest} />;
}

export function SeasonNavLink({ to, ...rest }: NavLinkProps) {
  const [searchParams] = useSearchParams();
  const resolvedTo = typeof to === "string" ? withSeasonAndLeague(to, searchParams.get("season"), leagueFromParams(searchParams)) : to;
  return <NavLink to={resolvedTo} {...rest} />;
}
