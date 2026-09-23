// 在コート5人組（reconstructOnCourtのlineupStints）のうち、日本人以外（外国籍・帰化選手・
// アジア特別枠）の人数を数える。scripts/aggregate.tsのcomputeForeignPlayerCourtSeconds
// （外国籍選手同時出場人数フィルタ・On-Court Foreignチャートの元データ）と、試合詳細ページの
// 「オンザコート4」の枠表示で同じ判定を使う。
import type { LineupStint } from "./onCourt.ts";

export type ClassificationLookup = (playerId: string) => string | undefined;

/**
 * 5人組のうち日本人以外の人数。区分が不明な選手が1人でもいればnullを返す
 * （区分不明を日本人・外国籍のどちらかに寄せて推測しない。DESIGN.md 51章）
 */
export function foreignCountInLineup(playerIds: string[], classify: ClassificationLookup): number | null {
  let count = 0;
  for (const playerId of playerIds) {
    const classification = classify(playerId);
    if (classification === undefined) return null;
    if (classification !== "日本人") count += 1;
  }
  return count;
}

export interface CourtInterval {
  startSec: number;
  endSec: number;
  /** 区間中の自チーム/相手チームの得点（試合詳細ページの枠のツールチップ用） */
  ownPoints: number;
  oppPoints: number;
}

/**
 * 指定チームで日本人以外の選手がminCount人以上同時に在コートだった時間帯を、連続する
 * スティントをつないだ区間の配列で返す（オンザコート4の可視化用）
 */
export function foreignOnCourtIntervals(
  stints: LineupStint[],
  teamId: string,
  classify: ClassificationLookup,
  minCount: number,
): CourtInterval[] {
  const matching = stints
    .filter((s) => s.teamId === teamId && s.endSec > s.startSec)
    .filter((s) => (foreignCountInLineup(s.playerIds, classify) ?? -1) >= minCount)
    .sort((a, b) => a.startSec - b.startSec);

  const merged: CourtInterval[] = [];
  for (const s of matching) {
    const last = merged[merged.length - 1];
    if (last && s.startSec <= last.endSec) {
      last.endSec = Math.max(last.endSec, s.endSec);
      last.ownPoints += s.ownPoints;
      last.oppPoints += s.oppPoints;
    } else {
      merged.push({ startSec: s.startSec, endSec: s.endSec, ownPoints: s.ownPoints, oppPoints: s.oppPoints });
    }
  }
  return merged;
}
