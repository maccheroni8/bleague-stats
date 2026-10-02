import { PLAYER_CAREER_TOTAL_DEFS } from "../../shared/playerRecords";
import { CAREER_TOTAL_DEFS } from "../../shared/teamRecords";
import { careerRecordRankingUrl } from "../components/CareerRecordRanking";
import { RECORD_MODE_PARAM, teamGameRecordRankingUrl } from "../components/TeamGameRecordRanking";
import { teamSeasonRecordRankingUrl } from "../components/TeamSeasonRecordRanking";
import { teamRecordItems } from "./teamGameRecords";
import { GAME_TYPE_PARAM, VENUE_PARAM } from "./urlFilterParams";

/**
 * 記録をランキングへまとめる前（DESIGN.md 189・196章）の、個人一覧・チーム一覧の「記録」タブのURLを、
 * ランキングページの同じ項目のURLに直す。ブックマークや共有されたリンクを生かすため。
 * 旧URLは、項目を表す `stat` を持つものだけが対象（`stat` が無いものは、記録タブの1位のカード一覧をそのまま開く）。
 * 直せないとき（項目が今は無い・記録タブに残る表）は null
 */

/** チーム一覧の記録タブの旧URL（歴代の通算成績・B.PREMIERレコード・クォーター別レコード）→ ランキング */
export function legacyTeamRecordsTarget(search: URLSearchParams): string | null {
  const stat = search.get("stat");
  if (!stat || search.get("scope") === "season") return null;
  const gameType = GAME_TYPE_PARAM.read(search) ?? "regular";
  const venue = VENUE_PARAM.read(search) ?? "total";
  switch (search.get("cat") ?? "career") {
    case "career":
      return CAREER_TOTAL_DEFS.some((d) => d.key === stat) ? careerRecordRankingUrl({ mode: "team", venue, gameType, statKey: stat }) : null;
    case "premier": {
      // 1試合の記録の項目、または1シーズンの記録（最多勝利数・最多連勝）
      if (stat === "wins" || stat === "streak") return teamSeasonRecordRankingUrl({ gameType, statKey: stat });
      const mode = RECORD_MODE_PARAM.read(search) ?? "record";
      return teamRecordItems(mode).some((i) => i.key === stat) ? teamGameRecordRankingUrl({ scope: "allTime", gameType, mode, statKey: stat }) : null;
    }
    case "period": {
      const mode = RECORD_MODE_PARAM.read(search) === "worst" ? "worst" : "record";
      return teamRecordItems(mode).some((i) => i.key === stat) ? teamGameRecordRankingUrl({ scope: "allTime", gameType, mode, statKey: stat }) : null;
    }
    default:
      // クラブレコード・クラブごとの1シーズン記録は、今も記録タブの表
      return null;
  }
}

/** 個人一覧の記録タブの旧URL（歴代の通算成績）→ ランキング */
export function legacyPlayerRecordsTarget(search: URLSearchParams): string | null {
  const stat = search.get("stat");
  if (!stat || search.get("scope") === "season" || (search.get("cat") ?? "career") !== "career") return null;
  if (!PLAYER_CAREER_TOTAL_DEFS.some((d) => d.key === stat)) return null;
  return careerRecordRankingUrl({
    mode: "player",
    venue: VENUE_PARAM.read(search) ?? "total",
    gameType: GAME_TYPE_PARAM.read(search) ?? "regular",
    statKey: stat,
  });
}
