// チーム詳細ページ「通算成績」（Phase TF、67章）・「クラブレコード」（Phase TG、68章）タブの
// 値関数。TeamGameLog（data/{season}/team-games/{teamId}.json）だけから算出できるため、
// フロントエンド（1クラブ単位の表示）とバックエンド（scripts/aggregate-league-rankings.ts、
// 全クラブ横断の歴代順位算出、Phase H7）の両方から同じ定義を参照する共通モジュールにした
// （2026-08-29、src/pages/TeamDetailPage.tsxから移設。二重管理を避けるのが目的）。

import { safeDiv } from "./formulas.ts";
import type { TeamGameLog } from "./types.ts";

/**
 * 「通算成績」タブ（Phase TF）: 全シーズン合算の単一の合計値（平均ではない）。
 * PlayerDetailPage.tsxのCareerCountTotals（45章）と同じ考え方をチーム版に転用したもの
 */
export interface TeamCareerTotals {
  wins: number;
  games: number;
  pts: number;
  oppPts: number;
  fgm: number;
  fga: number;
  twoPm: number;
  twoPa: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  pf: number;
  fbps: number;
  pitp: number;
  ptsOffTov: number;
  secondChancePts: number;
  foulsDrawn: number;
  dunks: number;
  homeAttendance: number;
}

export function buildTeamCareerTotals(logs: TeamGameLog[]): TeamCareerTotals {
  const totals: TeamCareerTotals = {
    wins: 0,
    games: 0,
    pts: 0,
    oppPts: 0,
    fgm: 0,
    fga: 0,
    twoPm: 0,
    twoPa: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    tov: 0,
    stl: 0,
    blk: 0,
    pf: 0,
    fbps: 0,
    pitp: 0,
    ptsOffTov: 0,
    secondChancePts: 0,
    foulsDrawn: 0,
    dunks: 0,
    homeAttendance: 0,
  };
  for (const g of logs) {
    totals.wins += g.win ? 1 : 0;
    totals.games += 1;
    totals.pts += g.teamScore;
    totals.oppPts += g.opponentScore;
    totals.fgm += g.fgm;
    totals.fga += g.fga;
    totals.twoPm += g.fgm - g.tpm;
    totals.twoPa += g.fga - g.tpa;
    totals.tpm += g.tpm;
    totals.tpa += g.tpa;
    totals.ftm += g.ftm;
    totals.fta += g.fta;
    totals.oreb += g.oreb;
    totals.dreb += g.dreb;
    totals.reb += g.reb;
    totals.ast += g.ast;
    totals.tov += g.tov;
    totals.stl += g.stl;
    totals.blk += g.blk;
    totals.pf += g.pf;
    totals.fbps += g.fb;
    totals.pitp += g.pt2in;
    totals.ptsOffTov += g.pft;
    totals.secondChancePts += g.pt2nd;
    totals.foulsDrawn += g.foulsDrawn;
    totals.dunks += g.dunks;
    if (g.isHome && g.attendance !== undefined) totals.homeAttendance += g.attendance;
  }
  return totals;
}

/** そのチームの全試合を日付順に走査し、最長の連続勝利記録を求める（ユーザー指定通り） */
export function longestWinStreak(logs: TeamGameLog[]): number {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
  let max = 0;
  let current = 0;
  for (const g of sorted) {
    if (g.win) {
      current += 1;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

export interface CareerTotalDef {
  key: string;
  label: string;
  value: (t: TeamCareerTotals) => number;
}

export const CAREER_TOTAL_DEFS: CareerTotalDef[] = [
  { key: "wins", label: "勝利数", value: (t) => t.wins },
  { key: "games", label: "試合数", value: (t) => t.games },
  { key: "pts", label: "得点", value: (t) => t.pts },
  { key: "oppPts", label: "失点", value: (t) => t.oppPts },
  { key: "fgm", label: "FG成功数", value: (t) => t.fgm },
  { key: "fga", label: "FG試投数", value: (t) => t.fga },
  { key: "twoPm", label: "2P成功数", value: (t) => t.twoPm },
  { key: "twoPa", label: "2P試投数", value: (t) => t.twoPa },
  { key: "tpm", label: "3P成功数", value: (t) => t.tpm },
  { key: "tpa", label: "3P試投数", value: (t) => t.tpa },
  { key: "ftm", label: "フリースロー成功数", value: (t) => t.ftm },
  { key: "fta", label: "フリースロー試投数", value: (t) => t.fta },
  { key: "oreb", label: "オフェンスリバウンド", value: (t) => t.oreb },
  { key: "dreb", label: "ディフェンスリバウンド", value: (t) => t.dreb },
  { key: "reb", label: "トータルリバウンド", value: (t) => t.reb },
  { key: "ast", label: "アシスト", value: (t) => t.ast },
  { key: "tov", label: "ターンオーバー", value: (t) => t.tov },
  { key: "stl", label: "スティール", value: (t) => t.stl },
  { key: "blk", label: "ブロックショット", value: (t) => t.blk },
  { key: "pf", label: "ファウル", value: (t) => t.pf },
  { key: "fbps", label: "ファストブレイクポイント", value: (t) => t.fbps },
  { key: "pitp", label: "ペイント内得点", value: (t) => t.pitp },
  { key: "ptsOffTov", label: "ポイントオフターンオーバー", value: (t) => t.ptsOffTov },
  { key: "secondChancePts", label: "セカンドチャンスポイント", value: (t) => t.secondChancePts },
  { key: "foulsDrawn", label: "ファウルドローン", value: (t) => t.foulsDrawn },
  { key: "dunks", label: "ダンク", value: (t) => t.dunks },
  { key: "homeAttendance", label: "ホーム来場者数", value: (t) => t.homeAttendance },
];

/**
 * 「クラブレコード」タブ（Phase TG）: 個人詳細ページのキャリアハイ/ワースト（CareerHighGame/
 * CAREER_HIGH_STATS）と同じ方式をチーム版に転用したもの。1試合単位の最高/最低記録を扱う。
 * value/filterはTeamGameLogのみに依存する（表示用のformatはフロントエンド側で個別に持つ）
 */
export interface TeamRecordValueDef {
  key: string;
  label: string;
  value: (g: TeamGameLog) => number;
  /**
   * %系の指標は、個人版と同様に低試投数での極端な値がワースト記録として意味を持ちにくいため
   * クラブワースト表示の対象から除外する（フロントエンド側でのみ参照。歴代順位算出には無関係）。
   * デフォルトはtrue
   */
  worstEligible?: boolean;
  /** 対象試合の絞り込み（未指定なら全試合）。ホーム来場者数はホーム開催かつ計測済みの試合のみ対象にする */
  filter?: (g: TeamGameLog) => boolean;
}

export const TEAM_RECORD_STATS: TeamRecordValueDef[] = [
  { key: "pts", label: "得点", value: (g) => g.teamScore },
  { key: "oppPts", label: "失点", value: (g) => g.opponentScore },
  { key: "fgm", label: "FG成功数", value: (g) => g.fgm },
  { key: "fga", label: "FG試投数", value: (g) => g.fga },
  { key: "fgPct", label: "FG成功率", value: (g) => safeDiv(g.fgm, g.fga), worstEligible: false },
  { key: "twoPm", label: "2P成功数", value: (g) => g.fgm - g.tpm },
  { key: "twoPa", label: "2P試投数", value: (g) => g.fga - g.tpa },
  {
    key: "twoPct",
    label: "2P成功率",
    value: (g) => safeDiv(g.fgm - g.tpm, g.fga - g.tpa),
    worstEligible: false,
  },
  { key: "tpm", label: "3P成功数", value: (g) => g.tpm },
  { key: "tpa", label: "3P試投数", value: (g) => g.tpa },
  { key: "tpPct", label: "3P成功率", value: (g) => safeDiv(g.tpm, g.tpa), worstEligible: false },
  { key: "ftm", label: "フリースロー成功数", value: (g) => g.ftm },
  { key: "fta", label: "フリースロー試投数", value: (g) => g.fta },
  {
    key: "ftPct",
    label: "フリースロー成功率",
    value: (g) => safeDiv(g.ftm, g.fta),
    worstEligible: false,
  },
  { key: "oreb", label: "オフェンスリバウンド", value: (g) => g.oreb },
  { key: "dreb", label: "ディフェンスリバウンド", value: (g) => g.dreb },
  { key: "reb", label: "トータルリバウンド", value: (g) => g.reb },
  { key: "ast", label: "アシスト", value: (g) => g.ast },
  { key: "tov", label: "ターンオーバー", value: (g) => g.tov },
  { key: "stl", label: "スティール", value: (g) => g.stl },
  { key: "blk", label: "ブロックショット", value: (g) => g.blk },
  { key: "pf", label: "ファウル", value: (g) => g.pf },
  { key: "fbps", label: "ファストブレイクポイント", value: (g) => g.fb },
  { key: "pitp", label: "ペイント内得点", value: (g) => g.pt2in },
  { key: "ptsOffTov", label: "ポイントオフターンオーバー", value: (g) => g.pft },
  { key: "secondChancePts", label: "セカンドチャンスポイント", value: (g) => g.pt2nd },
  { key: "foulsDrawn", label: "ファウルドローン", value: (g) => g.foulsDrawn },
  { key: "dunks", label: "ダンク", value: (g) => g.dunks },
  {
    key: "attendance",
    label: "ホーム来場者数",
    value: (g) => g.attendance ?? 0,
    filter: (g) => g.isHome && g.attendance !== undefined,
  },
];

/** シーズン単位の値から最高値のシーズン（代表）と、同値タイの他シーズン一覧を求める */
export interface TeamSeasonSpecialAggregate {
  season: string;
  wins: number;
  streak: number;
}

export function bestTeamSeasonRecord(
  aggregates: TeamSeasonSpecialAggregate[],
  pick: (a: TeamSeasonSpecialAggregate) => number,
): { value: number; season: string; otherSeasons: string[] } | null {
  if (aggregates.length === 0) return null;
  const best = Math.max(...aggregates.map(pick));
  const matches = aggregates
    .filter((a) => pick(a) === best)
    .map((a) => a.season)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const [season, ...otherSeasons] = matches;
  return { value: best, season: season!, otherSeasons };
}
