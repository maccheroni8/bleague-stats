import type { ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { SeasonLink } from "./SeasonLink";
import { leagueSwitchUrl, useLeague } from "../lib/league";
import { pageAvailability, type LeaguePage } from "../lib/leagueAvailability";

/**
 * B.ONE でまだ見られないページ（leagueAvailability.ts）は、ページの代わりに理由と「B.PREMIER で見る」を出す（DESIGN.md 297章）。
 * 「B.PREMIER で見る」の行き先はヘッダーの切り替えと同じ（チーム詳細は一覧へ。B.ONE のクラブは B.PREMIER に無いため）。
 * 見られるページはそのまま出す
 */
export function LeagueGate({ page, children }: { page: LeaguePage; children: ReactNode }) {
  const league = useLeague();
  const location = useLocation();
  const [params] = useSearchParams();
  const availability = pageAvailability(page, league);
  if (availability.ready) return <>{children}</>;
  const season = params.get("season");
  const to = season ? leagueSwitchUrl(location.pathname, season, null, "premier") : location.pathname;
  return (
    <div className="league-unavailable">
      <p>{availability.reason}</p>
      <p>
        {/* league=premier を書いておく（書かないと SeasonLink が今のリーグ＝B.ONE を引き継ぐ） */}
        <SeasonLink to={`${to}${to.includes("?") ? "&" : "?"}league=premier`}>B.PREMIER で見る</SeasonLink>
      </p>
    </div>
  );
}
