// 「シチュエーション別」の条件の一覧と判定（チーム詳細のチームスタッツ・全チームスタッツの「シチュエーション別」で共通。設計書443章）。
// 2つの画面が同じ関数を通るので、同じ条件は同じ試合を数える。画面だけの部品（保存キーの対象外）。
import { matchesOpponentStrength, opponentStrengthChoices, type OpponentRecords } from "./opponentStrength";
import type { DivisionHistoryFile, TeamGameLog } from "../../shared/types";
import { opponentDivisionChoices } from "./divisionGroups";
import { isWeekdayGame } from "./japaneseHolidays";
import type { League } from "./league";
import {
  MARGIN_CONDITION_LABELS,
  backToBackGameLabels,
  matchesDivision,
  matchesMargin,
  matchesMonth,
  matchesNewYearHalf,
  type BackToBackGame,
  type MarginCondition,
} from "./situational";
import { foreignSituationalGroups } from "./situationalRecords";

export const SITUATION_DIVISION_LABELS: Record<string, string> = {
  east: "東地区",
  west: "西地区",
  north: "北地区",
  central: "中地区",
  south: "南地区",
};

export interface TeamSituationRowDef {
  key: string;
  label: string;
  predicate: (g: TeamGameLog) => boolean;
}

export interface TeamSituationGroupDef {
  key: string;
  label: string;
  rows: TeamSituationRowDef[];
}

/** 「対◯地区」の行。そのシーズン・リーグにある地区（東西・東中西・B.ONE の北→東→中→西→南。DESIGN.md 314章） */
export function opponentDivisionRows(
  divisionHistory: DivisionHistoryFile | null | undefined,
  season: string,
  league: League,
): TeamSituationRowDef[] {
  const divisions = opponentDivisionChoices(divisionHistory, season, league);
  return divisions.map((d) => ({
    key: d,
    label: `対${SITUATION_DIVISION_LABELS[d]}`,
    predicate: (g: TeamGameLog) => matchesDivision(g, d, divisionHistory, season, league),
  }));
}

export interface TeamSituationContext {
  /** 試合区分で絞った、そのチームの試合ログ（月別・直近N試合の元） */
  scopedLogs: TeamGameLog[];
  teamId: string;
  /** buildBackToBackStatus(summaries) の結果。日程が未取得なら undefined */
  backToBack: Map<string, Map<string, BackToBackGame>> | undefined;
  /** 試合時点の相手の成績（buildOpponentRecords。最新勝率も添える）。未取得なら undefined */
  opponentRecords: OpponentRecords | undefined;
  divisionHistory: DivisionHistoryFile | null | undefined;
  season: string;
  league: League;
}

/**
 * チームの「シチュエーション別」の条件（グループ→行）。チーム詳細のチームスタッツと同じ並び・同じ判定。
 * 月別・直近N試合は渡された試合ログの中で決める。連戦の行は日程（backToBack）があるときだけ出る
 */
export function buildTeamSituationGroupDefs(ctx: TeamSituationContext): TeamSituationGroupDef[] {
  const { scopedLogs, teamId, backToBack, opponentRecords, divisionHistory, season, league } = ctx;
  const monthsWithData = new Set(scopedLogs.filter((g) => g.min > 0).map((g) => Number(g.date.slice(5, 7))));
  const playedLogs = scopedLogs.filter((g) => g.min > 0);
  const recentKeys = new Map([5, 10].map((n) => [n, new Set(playedLogs.slice(-n).map((g) => g.scheduleKey))] as const));
  return [
    {
      key: "result",
      label: "勝敗",
      rows: [
        { key: "win", label: "勝った試合", predicate: (g) => g.win },
        { key: "loss", label: "負けた試合", predicate: (g) => !g.win },
      ],
    },
    // 試合中の最大リード・最大ビハインド（延長戦を含む。DESIGN.md 150章）。同じ試合が複数の行に入ることがある
    {
      key: "inGameMargin",
      label: "試合中の点差",
      rows: (Object.keys(MARGIN_CONDITION_LABELS) as MarginCondition[]).map((c) => ({
        key: c,
        label: MARGIN_CONDITION_LABELS[c],
        predicate: (g) => matchesMargin(g, c),
      })),
    },
    {
      key: "recent",
      label: "直近試合",
      rows: [5, 10].map((n) => ({
        key: `recent${n}`,
        label: `直近${n}試合`,
        predicate: (g: TeamGameLog) => recentKeys.get(n)?.has(g.scheduleKey) ?? false,
      })),
    },
    {
      key: "venue",
      label: "会場",
      rows: [
        { key: "home", label: "ホーム", predicate: (g) => g.isHome },
        { key: "away", label: "アウェイ", predicate: (g) => !g.isHome },
      ],
    },
    {
      key: "division",
      label: "地区",
      rows: [...opponentDivisionRows(divisionHistory, season, league)],
    },
    {
      key: "weekday",
      label: "曜日",
      rows: [
        { key: "weekday", label: "平日開催", predicate: (g) => isWeekdayGame(g.date) },
        { key: "holiday", label: "休日開催", predicate: (g) => !isWeekdayGame(g.date) },
      ],
    },
    {
      key: "timing",
      label: "時期",
      rows: [
        { key: "before", label: "年明け前", predicate: (g) => matchesNewYearHalf(g, "before") },
        { key: "after", label: "年明け後", predicate: (g) => matchesNewYearHalf(g, "after") },
      ],
    },
    {
      key: "month",
      label: "月別",
      rows: Array.from({ length: 12 }, (_, i) => ((i + 8) % 12) + 1)
        .filter((m) => monthsWithData.has(m))
        .map((m) => ({ key: `m${m}`, label: `${m}月`, predicate: (g: TeamGameLog) => matchesMonth(g, m) })),
    },
    {
      // 対戦相手の強さ（設計書450章）: 試合時点の勝率と最新勝率を、同じ区切りを隣り合わせに並べる。
      // 行のキーは試合時点の勝率が前のまま（under50 など）、最新勝率は「latest_」を付ける。最新勝率は opponentRecords.latestWinRates があるときだけ
      key: "opponentStrength",
      label: "対戦相手の強さ",
      rows: opponentRecords
        ? opponentStrengthChoices()
            .filter((c) => c.basis === "atGame" || !!opponentRecords.latestWinRates)
            .map(({ tier, basis, label }) => ({
              key: basis === "atGame" ? tier : `latest_${tier}`,
              label,
              predicate: (g: TeamGameLog) => matchesOpponentStrength(g, tier, basis, { atGame: opponentRecords }),
            }))
        : [],
    },
    {
      key: "backToBack",
      label: "連戦",
      rows: backToBack
        ? backToBackGameLabels(backToBack).map((status) => ({
            key: status,
            label: status,
            predicate: (g: TeamGameLog) => backToBack.get(g.scheduleKey)?.get(teamId) === status,
          }))
        : [],
    },
    // 外国籍の人数（3つの数え方×自チーム・相手。条件別順位表と同じ判定。設計書392章）
    ...foreignSituationalGroups<TeamGameLog>(["own", "opp"]),
  ];
}
