import type { GameType, ScheduleFile } from "./types.ts";
import type { CancelledGameEntry } from "./scheduleCancelled.ts";

/**
 * 結果だけの試合（schedule.json の resultOnlyGames。DESIGN.md 228章）。
 * 試合は行われ、公式の日程・試合ページに得点が載っているが、ボックススコア（選手・チームの記録）が無い試合。
 * - "no-boxscore": 試合ページに得点があるのに、ボックススコアが公式に無い（2017-18 ScheduleKey=1810 など）
 * - "forfeit": 不戦勝／不戦敗（公式の日程のカードは試合へのリンクが無く「不戦勝／不戦敗」のボタン。2022-23 ScheduleKey=500609 の 20-0 など）
 *
 * 入れる先: チームの勝敗・得失点、順位表、星取り表、順位推移、日程ページ（得点つき・リンクなし）、勝敗表（リンクなし）。
 * 入れない先: 選手・チームのスタッツ、試合ログ、ランキング、記録、試合詳細ページ（試合の記録が無い）。
 * 生データ（games/）が後から取り込まれた試合は、この一覧から外す（記録のある試合が優先）。
 */
export type ResultOnlyReason = "no-boxscore" | "forfeit";

export interface ResultOnlyGameEntry {
  scheduleKey: string;
  /** JST基準のYYYY-MM-DD */
  date: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  /** レギュラーシーズン／ポストシーズン（試合ページの大会名から。オールスターなどは入れない） */
  gameType: GameType;
  venue?: string;
  /** JST基準のHH:MM */
  tipoffTime?: string;
  reason: ResultOnlyReason;
}

/** 古い schedule.json には cancelledGames・resultOnlyGames が無い */
export type ScheduleFileExtended = ScheduleFile & {
  cancelledGames?: CancelledGameEntry[];
  resultOnlyGames?: ResultOnlyGameEntry[];
};

/**
 * 試合ページの得点が「試合の結果」として使えるか。未開催は「--」、中止は 0-0、引き分けは無い。
 * 得点が2つとも整数で、0-0 でも同点でもないときだけ true
 */
export function isUsableResultScore(home: number | null | undefined, away: number | null | undefined): boolean {
  if (home === null || home === undefined || away === null || away === undefined) return false;
  if (!Number.isInteger(home) || !Number.isInteger(away)) return false;
  if (home < 0 || away < 0) return false;
  if (home === 0 && away === 0) return false;
  return home !== away;
}

/**
 * ボックススコアが公式に無い試合として扱い始める、試合日からの日数。
 * 公式のボックススコアは試合の数時間後に出る。それより十分あとまで出ない試合だけを「結果だけの試合」にする
 * （遅れて公開される試合を取り違えない。あとから公開されたら、取り込みの結果が優先される）
 */
export const NO_BOXSCORE_AFTER_DAYS = 7;

/** 試合日（JST）から days 日以上たっているか。today は JST の YYYY-MM-DD */
export function isOlderThanDays(date: string, today: string, days: number): boolean {
  const ms = new Date(`${today}T00:00:00+09:00`).getTime() - new Date(`${date}T00:00:00+09:00`).getTime();
  return ms >= days * 86_400_000;
}

/** 勝敗・得失点を数える側（順位表の計算に渡す形）。ホーム・アウェイ・得点だけを持つ */
export interface ResultOnlyScore {
  scheduleKey: string;
  date: string;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  homeScore: number;
  awayScore: number;
}

export function toResultOnlyScore(g: ResultOnlyGameEntry): ResultOnlyScore {
  return {
    scheduleKey: g.scheduleKey,
    date: g.date,
    homeTeam: { id: g.homeTeamId, name: g.homeTeamName },
    awayTeam: { id: g.awayTeamId, name: g.awayTeamName },
    homeScore: g.homeScore,
    awayScore: g.awayScore,
  };
}
