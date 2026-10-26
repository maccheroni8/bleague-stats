import { useMemo, useRef } from "react";
import { PLAYER_CAREER_ASTED_MIN_POINTS, PLAYER_CAREER_TOTAL_DEFS } from "../../shared/playerRecords";
import { CAREER_TOTAL_DEFS } from "../../shared/teamRecords";
import { CAREER_CONDITION_KEY_PREFIX, CAREER_ITEM_DEFS } from "../lib/playerConditionItems";
import type { LeagueRankingGameType, LeagueTeamRankEntry, TeamColors } from "../../shared/types";
import { ACTIVE_LABEL, ACTIVE_PARAM, activeAxis, activeNote } from "../lib/activePlayers";
import { buildExportFilename, classificationLabels, composeLabels, gameTypeLabels, leagueVenueLabels, type LeagueVenue } from "../lib/conditionLabels";
import { isSplitClassificationGroup, topFileClassKey, type SplitClassificationGroup } from "../lib/classificationFilter";
import type { LeaguePlayerCareerTopFileWithSplit, SplitCareerKey } from "../../shared/careerTopSplit";
import { ClassificationNotes } from "./ClassificationNotes";
import { formatLeaguePlayerRecordValue, formatLeagueTeamCareerValue } from "../lib/careerRecords";
import { fetchDivisionHistory, fetchLeaguePlayerCareerTop, fetchLeagueTeamRankings } from "../lib/data";
import { classificationAxis, gameTypeAxis, leagueVenueAxis, statItemAxis } from "../lib/filterAxes";
import { lastPremierSeasonFor, leagueTeamCurrentCategoryLabel, leagueTeamDisplayName } from "../lib/leagueTeamNames";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { stringParam, useUrlState } from "../lib/urlState";
import { CLASSIFICATION_PARAM, GAME_TYPE_PARAM, VENUE_PARAM } from "../lib/urlFilterParams";
import { useJsonData } from "../lib/useJsonData";
import { TEAM_DIVISIONS } from "../../scripts/lib/divisions";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { teamShortName } from "../../shared/teamNames";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerPhoto } from "./PlayerPhoto";
import { statJa } from "../lib/statNames";
import { RankedList } from "./RankedList";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { TeamLogo } from "./TeamLogo";

/**
 * ランキング > 個人／チーム > 通算記録（DESIGN.md 192章）: 過去に在籍した全選手・全クラブの通算成績（全シーズン合算）の順位。
 * 会場（トータル／ホーム／アウェイ）・試合区分（レギュラーシーズン／ポストシーズン／合算）・項目を選ぶ。
 * 個人は夜間の集計が書き出した上位20位（data/league-player-career-top.json。同じ値はすべて含む）、チームは全クラブ（data/league-team-rankings.json）
 */

// 個人の通算記録の項目: 通算成績（ボックススコアの合計）と、回数・在籍（リーグ優勝など。通算出場試合は通算成績の「試合数」と重なるので入れない。DESIGN.md 193章）。
// 回数・在籍の項目のキーは「career_titles」の形（スタッツの条件と同じ）
export const PLAYER_COUNT_ITEMS = CAREER_ITEM_DEFS.filter((d) => d.key !== "games");
const COUNT_GROUP = "回数・在籍";
const PLAYER_ITEMS = [
  ...PLAYER_CAREER_TOTAL_DEFS.map((d) => ({ key: d.key, label: d.label, group: "通算成績" })),
  ...PLAYER_COUNT_ITEMS.map((d) => ({ key: `${CAREER_CONDITION_KEY_PREFIX}${d.key}`, label: d.label, group: COUNT_GROUP })),
];
const PLAYER_STAT_PARAM = stringParam("stat", "pts", (v) => PLAYER_ITEMS.some((d) => d.key === v));
const COUNT_NOTE =
  "回数・在籍は、Bリーグ（2016-17シーズン）以降のB1（B.PREMIER）の記録から数えた、各選手の最新の累計です（進行中のシーズンは現時点まで）。会場・試合区分は選べません。個人賞（MVP・ベストファイブ・最優秀新人賞・新人賞ベストファイブ・個人タイトル）は種類ごとの受賞数で、B2の賞は数えません。個人タイトルは、得点王・リバウンド王・アシスト王・スティール王・ブロック王・ベスト3P成功率賞・ベストFT成功率賞の受賞数の合計です。";
const TEAM_STAT_PARAM = stringParam("stat", "wins", (v) => CAREER_TOTAL_DEFS.some((d) => d.key === v));
const PLAYER_RANK_TOP_N = 20;
/** 分けた区分 → 通算記録の上位のファイルの鍵 */
const SPLIT_CAREER_KEY: Record<SplitClassificationGroup, SplitCareerKey> = { 外国籍: "foreign", 帰化: "naturalized", アジア特別枠: "asia" };
const SPLIT_COUNT_REASON = "回数・在籍の項目は、外国籍・帰化・アジア特別枠を分けた区分では見られません（試合ごとの区分で分けられないため）。";

/** 通算記録のランキングの URL（個人・チームの記録タブのカードから移るとき） */
export function careerRecordRankingUrl(opts: {
  mode: "player" | "team";
  venue: LeagueVenue;
  gameType: SeasonGameTypeFilter;
  statKey: string;
}): string {
  const p = new URLSearchParams();
  if (opts.mode === "player") p.set("m", "player");
  p.set("k", "career");
  VENUE_PARAM.write(p, opts.venue);
  GAME_TYPE_PARAM.write(p, opts.gameType);
  p.set("stat", opts.statKey);
  return `/rankings?${p.toString()}`;
}

export function PlayerCareerRecordRanking({ teamColors }: { teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [venue, setVenue] = useUrlState(VENUE_PARAM, "total");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [classification, setClassification] = useUrlState(CLASSIFICATION_PARAM, "all");
  const [activeParam, setActive] = useUrlState(ACTIVE_PARAM, "all");
  const [statParam, setStatKey] = useUrlState(PLAYER_STAT_PARAM, "pts");
  const activeOn = activeParam === "active";
  const { data: file, loading } = useJsonData(() => fetchLeaguePlayerCareerTop() as Promise<LeaguePlayerCareerTopFileWithSplit>, []);

  const item = PLAYER_ITEMS.find((d) => d.key === statParam) ?? PLAYER_ITEMS[0]!;
  const countDef = PLAYER_COUNT_ITEMS.find((d) => `${CAREER_CONDITION_KEY_PREFIX}${d.key}` === item.key);
  const def = { key: item.key, label: item.label };
  // 登録区分を選んだときは、その区分で出場した試合だけの通算での上位（区分ごとの表。DESIGN.md 197・298章）。分けた区分は 2026-27 以降の試合だけ
  const classKey = topFileClassKey(classification);
  const splitKey = isSplitClassificationGroup(classification) ? SPLIT_CAREER_KEY[classification] : null;
  const splitCountBlocked = !!splitKey && !!countDef;
  // 現役を選んだときは、今季の名簿の選手だけの中での上位（現役の表。登録区分と組み合わせられる）
  const source = splitKey
    ? activeOn
      ? file?.byActiveSplitClass?.[splitKey]
      : file?.bySplitClass?.[splitKey]
    : activeOn
      ? file?.byActive?.[classKey ?? "all"]
      : classKey === "jp" || classKey === "intl"
        ? file?.byClassification?.[classKey]
        : file;
  const table = source ? (venue === "total" ? source.career : venue === "home" ? source.careerHome : source.careerAway) : undefined;
  const entries = countDef
    ? (source?.careerCounts?.[countDef.key] ?? [])
    : (table?.[gameType as LeagueRankingGameType]?.[def.key] ?? []);
  const rows = entries.flatMap((e) => (file?.players[e.playerId] ? [{ ...e, info: file.players[e.playerId]! }] : []));

  const classLabels = composeLabels(activeOn && ACTIVE_LABEL, classification !== "all" && classificationLabels(classification));
  const conditions = countDef
    ? [...classLabels, "各選手の最新の累計"]
    : composeLabels(classLabels, leagueVenueLabels(venue), gameTypeLabels(gameType, null));
  const title = `歴代 個人通算記録 ${statJa(def.label)}ランキング`;
  const countDisabled = "回数・在籍の項目は、会場・試合区分を選べません。";
  const filename = buildExportFilename(["個人通算記録", "歴代", statJa(def.label), ...conditions]);

  return (
    <>
      <FilterBar
        simple
        stateKey="rankings:player:career"
        axes={[
          classificationAxis(classification, setClassification, { season: null }),
          activeAxis(activeParam, setActive),
          { ...leagueVenueAxis(venue, setVenue), ...(countDef ? { disabledReason: countDisabled } : {}) },
          gameTypeAxis(gameType, setGameType, null, countDef ? { disabledReason: countDisabled } : {}),
        ]}
      />
      <FilterBar simple wide stateKey="rankings:player:career:stat" axes={[statItemAxis(PLAYER_ITEMS, def.key, setStatKey)]} />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : splitCountBlocked ? (
        <p className="empty-message">{SPLIT_COUNT_REASON}</p>
      ) : !file || !source ? (
        <p className="empty-message">データがありません</p>
      ) : rows.length === 0 ? (
        <p className="empty-message">この条件では該当選手がいません</p>
      ) : (
        <>
          <ExportImageButton
            targetRef={exportRef}
            filename={filename}
            baseDate={{ kind: "allTime", gameType: countDef ? "both" : gameType }}
            ranking={{ media: "写真", unit: "名", top: PLAYER_RANK_TOP_N }}
          />
          <ExportTarget ref={exportRef} className="export-target-compact export-target-rankings-player" baseDate={{ kind: "allTime", gameType: countDef ? "both" : gameType }}>
            <ConditionTitle title={title} conditions={conditions} />
            <PlayerNamePool names={rows.map((r) => r.info.name)}>
              <RankedList
                rows={rows}
                def={{
                  key: def.key,
                  label: def.label,
                  value: (r) => r.value,
                  format: (r) => (countDef ? `${r.value}${countDef.unit}` : formatLeaguePlayerRecordValue(def.key, r.value)),
                  higherIsBetter: true,
                }}
                tieKey={(r) => String(r.value)}
                rowKey={(r) => r.playerId}
                name={(r) => <ResponsivePlayerName name={r.info.name} />}
                subLabel={(r) => (
                  <>
                    <ResponsiveTeamName teamId={r.info.teamId} name={r.info.teamName} always nowrap />・{r.info.latestSeason}シーズンまで在籍確認
                  </>
                )}
                linkTo={(r) => `/players/${r.playerId}?season=${r.info.latestSeason}`}
                teamColor={(r) => teamColors?.[r.info.teamId]?.primary}
                avatar={(r) => <PlayerPhoto playerId={r.playerId} size={56} className="player-cell-photo" placeholder />}
                exportTeam={(r) => teamShortName(r.info.teamId, r.info.teamName)}
                limit={PLAYER_RANK_TOP_N}
                sortable={false}
                compact
              />
              {activeOn && <p className="rule-change-footnote">※ {activeNote()}</p>}
              <ClassificationNotes filter={classification} scope="allTime" />
              {countDef && <p className="rule-change-footnote">※ {COUNT_NOTE}</p>}
              {!countDef && def.key === "astedPct" && (
                <p className="rule-change-footnote">※ 通算得点が{PLAYER_CAREER_ASTED_MIN_POINTS.toLocaleString()}点以上の選手が対象です。得点のうち、アシストされた得点（アシストされた2P×2＋3P×3＋FT）の割合です。</p>
              )}
            </PlayerNamePool>
          </ExportTarget>
        </>
      )}
    </>
  );
}

export function TeamCareerRecordRanking({ teamColors }: { teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [venue, setVenue] = useUrlState(VENUE_PARAM, "total");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [statParam, setStatKey] = useUrlState(TEAM_STAT_PARAM, "wins");
  const { data: rankings, loading } = useJsonData(() => fetchLeagueTeamRankings(), []);
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);

  const def = CAREER_TOTAL_DEFS.find((d) => d.key === statParam) ?? CAREER_TOTAL_DEFS[0]!;
  const rows = useMemo(() => {
    if (!rankings) return [];
    const table = venue === "total" ? rankings.career : venue === "home" ? rankings.careerHome : rankings.careerAway;
    const entries: Record<string, LeagueTeamRankEntry> | undefined = table[gameType as LeagueRankingGameType]?.[def.key];
    return Object.entries(entries ?? {})
      .map(([teamId, entry]) => ({ teamId, entry }))
      .sort((a, b) => a.entry.rank - b.entry.rank || Number(a.teamId) - Number(b.teamId));
  }, [rankings, venue, gameType, def.key]);

  const conditions = composeLabels(leagueVenueLabels(venue), gameTypeLabels(gameType, null));
  const title = `歴代 チーム通算記録 ${statJa(def.label, "team")}ランキング`;
  const filename = buildExportFilename(["チーム通算記録", "歴代", statJa(def.label, "team"), ...conditions]);

  return (
    <>
      <FilterBar
        simple
        stateKey="rankings:team:career"
        axes={[leagueVenueAxis(venue, setVenue), gameTypeAxis(gameType, setGameType, null)]}
      />
      <FilterBar
        simple
        wide
        stateKey="rankings:team:career:stat"
        axes={[statItemAxis(CAREER_TOTAL_DEFS.map((d) => ({ key: d.key, label: d.label })), def.key, setStatKey)]}
      />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : !rankings ? (
        <p className="empty-message">データがありません</p>
      ) : rows.length === 0 ? (
        <p className="empty-message">この条件では該当クラブがありません</p>
      ) : (
        <>
          <ExportImageButton
            targetRef={exportRef}
            filename={filename}
            baseDate={{ kind: "allTime", gameType: gameType }}
            ranking={{ media: "ロゴ", unit: "チーム", top: null }}
          />
          <ExportTarget ref={exportRef} className="export-target-compact export-target-rankings-team" baseDate={{ kind: "allTime", gameType: gameType }}>
            <ConditionTitle title={title} conditions={conditions} />
            <RankedList
              rows={rows}
              def={{
                key: def.key,
                label: def.label,
                value: (r) => r.entry.value,
                format: (r) => formatLeagueTeamCareerValue(r.entry.value),
                higherIsBetter: true,
              }}
              tieKey={(r) => String(r.entry.value)}
              rowKey={(r) => r.teamId}
              name={(r) => <ResponsiveTeamName teamId={r.teamId} name={leagueTeamDisplayName(r.teamId)} />}
              subLabel={(r) => leagueTeamCurrentCategoryLabel(r.teamId)}
              // 現行のB.PREMIERクラブは今のシーズン、それ以外（B.ONEへ降格済み等）は最後にB.PREMIERにいたシーズンのチーム詳細へ
              linkTo={(r) => {
                if (r.teamId in TEAM_DIVISIONS) return `/teams/${r.teamId}`;
                const last = lastPremierSeasonFor(divisionHistory, r.teamId);
                return last ? `/teams/${r.teamId}?season=${last}` : `/teams/${r.teamId}`;
              }}
              teamColor={(r) => teamColors?.[r.teamId]?.primary}
              avatar={(r) => <TeamLogo teamId={r.teamId} size={48} placeholder />}
              unit="チーム"
              sortable={false}
              statScope="team"
              compact
            />
          </ExportTarget>
        </>
      )}
    </>
  );
}
