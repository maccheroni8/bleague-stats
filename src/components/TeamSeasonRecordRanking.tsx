import { useRef } from "react";
import type { LeagueSeasonWorstEntry, LeagueSeasonWorstTop20 } from "../../shared/leagueSeasonWorst";
import { SHORTENED_REGULAR_SEASONS } from "../../shared/regularSeasonComplete";
import type { LeagueRecordEntry, LeagueTeamRankingsFile, TeamColors } from "../../shared/types";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchLeagueTeamRankings, fetchTeamHistory } from "../lib/data";
import { gameTypeAxis, statItemAxis } from "../lib/filterAxes";
import { leagueTeamDisplayName } from "../lib/leagueTeamNames";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { teamNameInSeason } from "../lib/teamLabel";
import { stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { useJsonData } from "../lib/useJsonData";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { FilterBar } from "./FilterBar";
import { RankedList } from "./RankedList";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { TeamLogo } from "./TeamLogo";

/**
 * ランキング > チーム > 1シーズン記録（DESIGN.md 194章）: 1つのシーズンの記録。過去に在籍した全クラブの、全シーズンの中の上位20位
 * （同じ記録のシーズンはすべて）。項目は、最多勝利数（1シーズン）・最多連勝（シーズン内）と、ワースト側の最多敗戦数（1シーズン）・最多連敗（シーズン内）。
 * 試合区分はレギュラーシーズン／ポストシーズン／合算（ワースト側はレギュラーシーズンだけ。チーム詳細「クラブレコード」のシーズン記録のワーストと同じ対象・数え方。DESIGN.md 269章）。
 * 値は data/league-team-rankings.json の seasonSpecialTop20（ワースト側は seasonWorstTop20）。同じクラブが何度も入ることがある（1行が「クラブのあるシーズン」）
 */

/** 項目: 「最多連勝（シーズン内）」は、シーズンをまたいだ連勝を含まない */
export const TEAM_SEASON_RECORD_ITEMS = [
  { key: "wins", label: "最多勝利数", unit: "勝" },
  { key: "streak", label: "最多連勝（シーズン内）", unit: "連勝" },
  { key: "losses", label: "最多敗戦数", unit: "敗" },
  { key: "lossStreak", label: "最多連敗（シーズン内）", unit: "連敗" },
] as const;
/** ワースト側の項目（レギュラーシーズンだけ） */
const WORST_KEYS: readonly string[] = ["losses", "lossStreak"];
const SHORTENED_SEASONS_NOTE = `${SHORTENED_REGULAR_SEASONS[0]}〜${SHORTENED_REGULAR_SEASONS[SHORTENED_REGULAR_SEASONS.length - 1]}は中止の試合が多く試合数がそろわないため対象外です。`;
const STAT_PARAM = stringParam("stat", "wins", (v) => TEAM_SEASON_RECORD_ITEMS.some((d) => d.key === v));
const RANK_TOP_N = 20;

/** チームの1シーズン記録のランキングの URL（チーム一覧の記録タブのカードから移るとき） */
export function teamSeasonRecordRankingUrl(opts: { gameType: SeasonGameTypeFilter; statKey: string }): string {
  const p = new URLSearchParams();
  p.set("k", "special");
  GAME_TYPE_PARAM.write(p, opts.gameType);
  p.set("stat", opts.statKey);
  return `/rankings?${p.toString()}`;
}

/** 項目の上位20位。ワースト側の項目は、レギュラーシーズン以外では空（記録が無い）。ファイルにワースト側が無い古い版でも空 */
export function teamSeasonRecordEntries(rankings: LeagueTeamRankingsFile | null | undefined, gameType: SeasonGameTypeFilter, key: string): LeagueSeasonWorstEntry[] {
  if (!rankings) return [];
  if (WORST_KEYS.includes(key)) {
    if (gameType !== "regular") return [];
    return (rankings as LeagueTeamRankingsFile & { seasonWorstTop20?: LeagueSeasonWorstTop20 }).seasonWorstTop20?.regular?.[key as "losses" | "lossStreak"] ?? [];
  }
  return (rankings.seasonSpecialTop20[gameType]?.[key as "wins" | "streak"] ?? []) as LeagueRecordEntry[];
}

export function TeamSeasonRecordRanking({ teamColors }: { teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [statParam, setStatKey] = useUrlState(STAT_PARAM, "wins");
  const { data: rankings, loading } = useJsonData(() => fetchLeagueTeamRankings(), []);
  const { data: history } = useJsonData(() => fetchTeamHistory(), []);

  const item = TEAM_SEASON_RECORD_ITEMS.find((d) => d.key === statParam) ?? TEAM_SEASON_RECORD_ITEMS[0]!;
  const worstOnlyRegular = WORST_KEYS.includes(item.key) && gameType !== "regular";
  const entries = teamSeasonRecordEntries(rankings, gameType, item.key);
  const conditions = composeLabels(gameTypeLabels(gameType, null));
  const title = `歴代 チーム1シーズン記録 ${item.label}ランキング`;
  const filename = buildExportFilename(["チーム1シーズン記録", "歴代", item.label, ...conditions]);

  return (
    <>
      <FilterBar simple stateKey="rankings:team:special" axes={[gameTypeAxis(gameType, setGameType, null)]} />
      <FilterBar
        simple
        wide
        stateKey="rankings:team:special:stat"
        axes={[statItemAxis(TEAM_SEASON_RECORD_ITEMS.map((d) => ({ key: d.key, label: d.label })), item.key, setStatKey)]}
      />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : !rankings ? (
        <p className="empty-message">データがありません</p>
      ) : worstOnlyRegular ? (
        <p className="empty-message">レギュラーシーズンだけの記録です</p>
      ) : entries.length === 0 ? (
        <p className="empty-message">この条件の記録がありません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} baseDate={{ kind: "allTime", gameType: gameType }} ranking={{ media: "ロゴ", unit: "件", top: RANK_TOP_N }} />
          <ExportTarget ref={exportRef} className="export-target-compact export-target-rankings-team" baseDate={{ kind: "allTime", gameType: gameType }}>
            <ConditionTitle title={title} conditions={conditions} />
            <RankedList
              rows={entries}
              def={{
                key: item.key,
                label: item.label,
                value: (e) => e.value,
                format: (e) => `${e.value}${item.unit}`,
                higherIsBetter: true,
              }}
              tieKey={(e) => String(e.value)}
              rowKey={(e) => `${e.teamId}-${e.season}`}
              name={(e) => <ResponsiveTeamName teamId={e.teamId} name={teamNameInSeason(history, e.teamId, e.season, leagueTeamDisplayName(e.teamId))} />}
              subLabel={(e) => `${e.season}シーズン${(e as LeagueSeasonWorstEntry).ongoing ? "・継続中" : ""}`}
              linkTo={(e) => `/teams/${e.teamId}?season=${e.season}`}
              teamColor={(e) => teamColors?.[e.teamId]?.primary}
              avatar={(e) => <TeamLogo teamId={e.teamId} size={48} placeholder />}
              limit={RANK_TOP_N}
              unit="シーズン"
              exportKeepSub
              sortable={false}
              statScope="team"
              compact
            />
            {(item.key === "streak" || item.key === "lossStreak") && (
              <p className="rule-change-footnote">
                ※ シーズンをまたいだ連続は含みません。不戦勝・不戦敗など、スタッツの無い試合（結果だけの試合）も数えます。
                {item.key === "lossStreak" && "進行中のシーズンで続いている連敗も含み、「継続中」と表示します。"}
              </p>
            )}
            {item.key === "losses" && (
              <p className="rule-change-footnote">
                ※ レギュラーシーズンの全試合が終わったシーズンだけが対象です。{SHORTENED_SEASONS_NOTE}
              </p>
            )}
          </ExportTarget>
        </>
      )}
    </>
  );
}
