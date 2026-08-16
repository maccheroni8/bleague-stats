import { teamLogoUrl } from "../lib/data";

// data/logos/{teamId}.pngは現行B.PREMIER26クラブ分しか無い（scripts/lib/teamLogoCodes.ts参照）。
// 過去シーズンのみ在籍した降格クラブ等はロゴが存在しないため、404時は要素ごと非表示にする
export function TeamLogo({ teamId, size = 24, className }: { teamId: string; size?: number; className?: string }) {
  return (
    <img
      src={teamLogoUrl(teamId)}
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
