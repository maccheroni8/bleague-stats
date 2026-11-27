// リーグ平均の所に出す B.LEAGUE のロゴ（画面専用。保存キーの対象外）。表示しているシーズンで切り替える:
// 2025-26 までは旧ロゴ、2026-27 からは新ロゴ（B.PREMIER と B.ONE は同じロゴ）。画像は public/media/league-logo/（公式サイトのヘッダーのロゴを PNG にしたもの）
import { createContext, useContext } from "react";

/** 新しいロゴになった最初のシーズン */
const NEW_LOGO_FIRST_SEASON = "2026-27";

export function leagueLogoUrl(season: string): string {
  const file = season >= NEW_LOGO_FIRST_SEASON ? "bleague-2026-.png" : "bleague-2016-2025.png";
  return `${import.meta.env.BASE_URL}media/league-logo/${file}`;
}

/** 表のように、行の部品がシーズンを直接受け取れない場所のために、ページが表示中のシーズンを渡す */
export const LeagueLogoSeasonContext = createContext<string | null>(null);
export const useLeagueLogoSeason = (): string | null => useContext(LeagueLogoSeasonContext);
