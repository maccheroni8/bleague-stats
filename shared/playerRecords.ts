// 個人版「歴代記録」タブ（PlayersListPage.tsx、2026-09-04）の値関数。PlayerGameLog
// （data/{season}/player-games/{playerId}.json）だけから算出できるため、shared/teamRecords.ts
// と同じく、フロントエンド（LeaguePlayerRecordsTab）とバックエンド
// （scripts/aggregate-league-player-rankings.ts、全選手横断の歴代順位算出）の両方から
// 同じ定義を参照する共通モジュールにした。チーム版と異なり、クラブレコード相当（1試合単位の
// 最高記録）は対象外（ユーザー指定、別途Rankingsページの機能として検討予定）。

import type { PlayerGameLog } from "./types.ts";

/** 「歴代記録」タブ: 全シーズン合算の単一の合計値（平均ではない）。PlayerDetailPage.tsxの
 * CareerCountTotals（45章）・TeamCareerTotals（Phase TF）と同じ考え方 */
export interface PlayerCareerTotals {
  wins: number;
  games: number;
  /** 合計出場時間（分、小数）。表示時はformatMinutesFromSeconds(Math.round(minMinutes*60))を使う */
  minMinutes: number;
  pts: number;
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
  foulsDrawn: number;
  blockedAgainst: number;
  plusMinus: number;
  fbps: number;
  pitp: number;
  secondChancePts: number;
  ptsOffTov: number;
  dunks: number;
  doubleDoubles: number;
  tripleDoubles: number;
}

/** ダブルダブル/トリプルダブルの判定閾値。src/lib/playerSeasonBoxscore.tsの
 * countDoubleTripleDoubles()・scripts/aggregate.tsの季集計と同じロジック
 * （PTS/REB/AST/STL/BLKのうち2桁到達部門数が2以上でDD、3以上でTD） */
function countDoubleTripleDouble(g: PlayerGameLog): { dd: boolean; td: boolean } {
  const doubleDigitCount = [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length;
  return { dd: doubleDigitCount >= 2, td: doubleDigitCount >= 3 };
}

export function buildPlayerCareerTotals(logs: PlayerGameLog[]): PlayerCareerTotals {
  const totals: PlayerCareerTotals = {
    wins: 0,
    games: 0,
    minMinutes: 0,
    pts: 0,
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
    foulsDrawn: 0,
    blockedAgainst: 0,
    plusMinus: 0,
    fbps: 0,
    pitp: 0,
    secondChancePts: 0,
    ptsOffTov: 0,
    dunks: 0,
    doubleDoubles: 0,
    tripleDoubles: 0,
  };
  for (const g of logs) {
    totals.wins += g.win ? 1 : 0;
    totals.games += 1;
    totals.minMinutes += g.min;
    totals.pts += g.pts;
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
    totals.foulsDrawn += g.foulsDrawn;
    totals.blockedAgainst += g.blockedAgainst;
    totals.plusMinus += g.plusMinus;
    totals.fbps += g.ptfb;
    totals.pitp += g.pt2in;
    totals.secondChancePts += g.pt2nd;
    totals.ptsOffTov += g.ptsOffTov;
    totals.dunks += g.dunks;
    const { dd, td } = countDoubleTripleDouble(g);
    if (dd) totals.doubleDoubles += 1;
    if (td) totals.tripleDoubles += 1;
  }
  return totals;
}

export interface PlayerCareerTotalDef {
  key: string;
  label: string;
  value: (t: PlayerCareerTotals) => number;
}

export const PLAYER_CAREER_TOTAL_DEFS: PlayerCareerTotalDef[] = [
  { key: "wins", label: "勝利数（出場試合）", value: (t) => t.wins },
  { key: "games", label: "試合数", value: (t) => t.games },
  { key: "minMinutes", label: "出場時間", value: (t) => t.minMinutes },
  { key: "pts", label: "得点", value: (t) => t.pts },
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
  { key: "foulsDrawn", label: "ファウルドローン", value: (t) => t.foulsDrawn },
  { key: "blockedAgainst", label: "被ブロック数", value: (t) => t.blockedAgainst },
  { key: "plusMinus", label: "プラスマイナス", value: (t) => t.plusMinus },
  { key: "fbps", label: "ファストブレイクポイント", value: (t) => t.fbps },
  { key: "pitp", label: "ペイント内得点", value: (t) => t.pitp },
  { key: "secondChancePts", label: "セカンドチャンスポイント", value: (t) => t.secondChancePts },
  { key: "ptsOffTov", label: "ポイントオフターンオーバー", value: (t) => t.ptsOffTov },
  { key: "dunks", label: "ダンク", value: (t) => t.dunks },
  { key: "doubleDoubles", label: "ダブルダブル数", value: (t) => t.doubleDoubles },
  { key: "tripleDoubles", label: "トリプルダブル数", value: (t) => t.tripleDoubles },
];
