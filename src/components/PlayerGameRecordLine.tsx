// 選手の1試合記録のランキングの URL と、記録の1行（日付・対戦相手）。
// ランキングの画面（PlayerGameRecordRanking）から切り出した小さなファイル（選手一覧の記録タブ等が、ランキングの読み込み・集計の部品まで読まなくてよいように）
import { useNarrow } from "../lib/teamLabel";
import type { PlayerRecordRow } from "../lib/gameRecordQuery";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { GAME_TYPE_PARAM, RECORDS_SCOPE_PARAM, type RecordsScope } from "../lib/urlFilterParams";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/** 選手の1試合記録のランキングの URL（選手一覧の記録タブのカードから移るとき等） */
export function playerGameRecordRankingUrl(opts: { scope: RecordsScope; gameType: SeasonGameTypeFilter; statKey: string; season?: string }): string {
  const p = new URLSearchParams();
  p.set("m", "player");
  p.set("k", "game");
  RECORDS_SCOPE_PARAM.write(p, opts.scope);
  GAME_TYPE_PARAM.write(p, opts.gameType);
  p.set("stat", opts.statKey);
  if (opts.season) p.set("season", opts.season);
  return `/rankings?${p.toString()}`;
}

/** 名前の下の行: 日付（シーズン）・当時のチーム・対戦相手（ポジションで絞り込んでいるときは当時のポジション） */
export function PlayerGameRecordLine({ e, season, showPosition = false }: { e: PlayerRecordRow; season: string; showPosition?: boolean }) {
  const narrow = useNarrow();
  const date = narrow ? e.date.replace(/-/g, "/").slice(2) : e.date;
  const position = showPosition && e.position ? `${e.position}${e.positionFallback ? "＊" : ""}` : null;
  return (
    <>
      <span className="record-date-nowrap">
        {date}（{season}）
      </span>
      {narrow ? " " : "　"}
      <ResponsiveTeamName teamId={e.teamId} name={e.teamName} always nowrap /> {e.isHome ? "vs" : "@"}{" "}
      <ResponsiveTeamName teamId={e.opponentTeamId} name={e.opponentTeamName} always nowrap />
      {position && <span className="record-date-nowrap">　{position}</span>}
    </>
  );
}
