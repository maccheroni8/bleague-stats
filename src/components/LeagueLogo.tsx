import { leagueLogoUrl, useLeagueLogoSeason } from "../lib/leagueLogo";

/** リーグ平均の所に出す B.LEAGUE のロゴ（TeamLogo と同じ作り。シーズンを渡さなければ、ページが渡した表示中のシーズン） */
export function LeagueLogo({ season, size = 24, className }: { season?: string; size?: number; className?: string }) {
  const fromPage = useLeagueLogoSeason();
  const s = season ?? fromPage;
  if (!s) return null;
  return (
    <img
      src={leagueLogoUrl(s)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`team-logo${className ? ` ${className}` : ""}`}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
