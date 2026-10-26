// 登録区分の記録（registrations.json）から「その区分で出場した試合だけ」を数え直す、純粋な部分（DESIGN.md 298章）。
// 読み込み・React の部品は registrationScope.ts（ここは data.ts を読まないので、検証スクリプトからも使える）。画面だけの部品（保存キーの対象外）。
import { registrationOn, SPLIT_CLASSIFICATION_FIRST_SEASON, type Classification, type SeasonRegistrationEntry, type SeasonRegistrationFile } from "../../shared/registration";
import type { PlayerGameLog, PlayerSummary } from "../../shared/types";
import { classificationMatches, type ClassificationGroupFilter, type PlayerGroupFilter } from "./classificationFilter";
import { countDoubleTripleDoubles, sumPlayerGameLogs } from "./playerSeasonBoxscore";
import { currentSeason } from "./season";

/** シーズンの途中で区分が変わった選手（記録の changes がある選手）の、playerId → 記録 */
export type ChangedRegistrations = ReadonlyMap<string, SeasonRegistrationEntry>;

export const EMPTY_CHANGED: ChangedRegistrations = new Map();
/** 記録のうち、シーズンの途中で区分が変わった選手だけ */
export function changedRegistrations(file: SeasonRegistrationFile | null | undefined): ChangedRegistrations {
  if (!file) return EMPTY_CHANGED;
  const out = new Map<string, SeasonRegistrationEntry>();
  for (const [id, e] of Object.entries(file.players)) if (e.changes && e.changes.length > 0) out.set(id, e);
  return out.size > 0 ? out : EMPTY_CHANGED;
}

/** 区分を分けて記録しているシーズン（2026-27 から今のシーズンまで）。通算・歴代で、数え直しが要るかを調べる範囲 */
export function splitRecordedSeasons(now: string = currentSeason()): string[] {
  const out: string[] = [];
  for (let y = Number(SPLIT_CLASSIFICATION_FIRST_SEASON.slice(0, 4)); ; y++) {
    const s = `${y}-${String(y + 1).slice(-2)}`;
    if (s > now) break;
    out.push(s);
  }
  return out;
}

/** 記録の1件で、その試合の日の区分 */
export function classificationOnDate(entry: SeasonRegistrationEntry, date: string): Classification {
  return registrationOn(entry, date).classification;
}

/** シーズンのうちに一度でも当てはまる区分になった選手か（記録の初めの区分と、途中の変更のどれか） */
export function everMatches(entry: SeasonRegistrationEntry, filter: ClassificationGroupFilter): boolean {
  return [entry.classification, ...(entry.changes ?? []).map((c) => c.classification)].some((c) => classificationMatches(c, filter));
}

/**
 * 区分を選んだときの選手の判定。途中で区分が変わった選手（changed にいる）は、シーズンのうちに一度でもその区分になったら通す
 * （値は scopeLogsByClassification で、その区分の試合だけに絞って足し直す）。ほかの選手は集計済みの区分（players.json）で判定する
 */
export function scopedPlayerMatches(p: PlayerSummary, filter: PlayerGroupFilter, changed: ChangedRegistrations): boolean {
  if (filter === "all" || filter === "rookie") return true;
  const entry = changed.get(p.playerId);
  return entry ? everMatches(entry, filter) : classificationMatches(p.classification, filter);
}

/** 途中で区分が変わった選手の試合ログを、その区分で出場した試合だけにする（変わっていない選手・区分を選んでいないときはそのまま） */
export function scopeLogsByClassification<T extends Pick<PlayerGameLog, "date">>(
  logs: readonly T[],
  playerId: string,
  filter: PlayerGroupFilter,
  changed: ChangedRegistrations,
): T[] {
  const entry = filter === "all" || filter === "rookie" ? undefined : changed.get(playerId);
  if (!entry) return logs as T[];
  return logs.filter((g) => classificationMatches(classificationOnDate(entry, g.date), filter as ClassificationGroupFilter));
}

/** 区分を選んでいて、対象の選手の中に途中で区分が変わった選手がいるか（いれば、試合ログから足し直す経路にする） */
export function needsClassificationRecompute(players: readonly Pick<PlayerSummary, "playerId">[], filter: PlayerGroupFilter, changed: ChangedRegistrations): boolean {
  if (filter === "all" || filter === "rookie" || changed.size === 0) return false;
  return players.some((p) => changed.has(p.playerId));
}

/**
 * 途中で区分が変わった選手の、その区分の試合だけ（scopedLogs はその区分に絞った試合ログ）のシーズンの値（レギュラーシーズン）。
 * 出場試合数・先発・合計（StatTotals）・1試合平均を、その試合だけで足し直す。掲載基準（出場率・成功数）と、試合ログを読まない表示に使う。
 * 率や上級スタッツの表示は、呼び出し側が試合ログから足し直す経路（needsClassificationRecompute）で出す。その区分の試合が無ければ null
 */
export function summaryScopedToClassification(p: PlayerSummary, scopedLogs: readonly PlayerGameLog[]): PlayerSummary | null {
  const regular = scopedLogs.filter((g) => g.gameType === "regular");
  const raw = sumPlayerGameLogs(regular);
  if (raw.gamesPlayed === 0) return null;
  const { dd, td } = countDoubleTripleDoubles(regular.filter((g) => g.min > 0));
  const n = raw.gamesPlayed;
  const totals = {
    gamesPlayed: n,
    gamesStarted: raw.gamesStarted,
    min: raw.min,
    pts: raw.pts,
    oreb: raw.oreb,
    dreb: raw.dreb,
    reb: raw.reb,
    ast: raw.ast,
    stl: raw.stl,
    blk: raw.blk,
    tov: raw.tov,
    pf: raw.pf,
    fgm: raw.fgm,
    fga: raw.fga,
    tpm: raw.tpm,
    tpa: raw.tpa,
    ftm: raw.ftm,
    fta: raw.fta,
    foulsDrawn: raw.foulsDrawn,
    blockedAgainst: raw.blockedAgainst,
    plusMinus: raw.plusMinus,
    doubleDoubles: dd,
    tripleDoubles: td,
  };
  const per = (v: number) => v / n;
  return {
    ...p,
    gamesPlayed: n,
    gamesStarted: raw.gamesStarted,
    totals,
    perGame: {
      min: per(raw.min),
      pts: per(raw.pts),
      oreb: per(raw.oreb),
      dreb: per(raw.dreb),
      reb: per(raw.reb),
      ast: per(raw.ast),
      stl: per(raw.stl),
      blk: per(raw.blk),
      tov: per(raw.tov),
      pf: per(raw.pf),
      plusMinus: per(raw.plusMinus),
    },
  };
}

