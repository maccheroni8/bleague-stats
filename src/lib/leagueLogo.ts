// リーグ平均の所に出す B.LEAGUE のロゴ（画面専用。保存キーの対象外）。表示しているシーズンで切り替える:
// 2024-25 までは通常のロゴ、2025-26 は10周年のロゴ、2026-27 からは新ロゴ（B.PREMIER と B.ONE は同じロゴ）。
// 画像は public/media/league-logo/（公式サイトのヘッダーのロゴを PNG にしたもの。旧ロゴは Wayback Machine の保存分）
import { createContext, useContext } from "react";

/** 10周年のロゴを使った最初のシーズン */
const TENTH_LOGO_FIRST_SEASON = "2025-26";
/** 新しいロゴになった最初のシーズン */
const NEW_LOGO_FIRST_SEASON = "2026-27";

/** 透明地の黒いロゴ（新ロゴ）か。ダーク表示の暗い地では沈むので、表では白に反転して出す（旧ロゴは白地付き） */
export function leagueLogoIsTransparent(season: string): boolean {
  return season >= NEW_LOGO_FIRST_SEASON;
}

export function leagueLogoUrl(season: string): string {
  const file = season >= NEW_LOGO_FIRST_SEASON ? "bleague-2026-.png" : season >= TENTH_LOGO_FIRST_SEASON ? "bleague-2025-10th.png" : "bleague-2016-2024.png";
  return `${import.meta.env.BASE_URL}media/league-logo/${file}`;
}

/** 表のように、行の部品がシーズンを直接受け取れない場所のために、ページが表示中のシーズンを渡す */
export const LeagueLogoSeasonContext = createContext<string | null>(null);
export const useLeagueLogoSeason = (): string | null => useContext(LeagueLogoSeasonContext);
