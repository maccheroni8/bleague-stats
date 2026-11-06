// プレーオフ進出ラインまでの見通し（順位表の列）。ライン（基準の勝数）はシーズン・リーグごとに下の表で設定する。設定が無いシーズン・リーグは列を出さない。
import type { League } from "./league";

export interface PlayoffWinLine {
  /** 基準の勝数（この勝数に届けばプレーオフ進出ライン） */
  wins: number;
  /** 1クラブの規定のレギュラーシーズン試合数。残り試合数＝この数−消化済み試合数 */
  games: number;
}

/**
 * 基準の勝数。2026-27 B.PREMIER は 36勝（60試合の6割）。
 * 残り試合数は「規定の試合数−消化済み（勝＋敗。結果だけの試合を含む）」で数える。中止・延期になった試合や日程が未定の試合は、
 * 規定の試合数に含まれるので、行われるまで残りに数える（開催予定の一覧の件数は使わない）。マジックナンバー（playoff-race.json）の残りと同じ数え方
 */
const WIN_LINES: Record<League, Record<string, PlayoffWinLine>> = {
  premier: { "2026-27": { wins: 36, games: 60 } },
  one: {},
};

export function playoffWinLine(season: string, league: League): PlayoffWinLine | null {
  return WIN_LINES[league]?.[season] ?? null;
}

export type PlayoffLineStatus =
  | { kind: "reached" }
  | { kind: "out" }
  | { kind: "open"; needWins: number; remaining: number; maxLosses: number };

export function playoffLineStatus(wins: number, losses: number, line: PlayoffWinLine): PlayoffLineStatus {
  if (wins >= line.wins) return { kind: "reached" };
  const remaining = Math.max(0, line.games - wins - losses);
  const needWins = line.wins - wins;
  if (needWins > remaining) return { kind: "out" };
  return { kind: "open", needWins, remaining, maxLosses: remaining - needWins };
}

export function playoffLineText(status: PlayoffLineStatus): string {
  return status.kind === "reached" ? "到達" : status.kind === "out" ? "届かない" : `あと${status.needWins}勝（残り${status.maxLosses}敗まで可）`;
}

/** 並べ替え用の値。到達 < 必要な勝ち数が少ない < 多い < 届かない */
export function playoffLineSortValue(status: PlayoffLineStatus): number {
  return status.kind === "reached" ? -1 : status.kind === "out" ? 1000 : status.needWins;
}
