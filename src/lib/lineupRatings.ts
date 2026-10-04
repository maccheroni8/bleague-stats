// ラインナップ（5人の組み合わせ）の ORtg・DRtg・NetRtg。実際のポゼッション数があるシーズン（2020-21以降）は実際の値、
// 無いシーズン（2016-17〜2019-20）は推定値を返す（DESIGN.md 207章）。
import type { LineupAggregate } from "../../shared/types";

export interface LineupRatings {
  off: number | null;
  def: number | null;
  net: number | null;
  /** 実際のポゼッションで計算した値か（false は推定値） */
  real: boolean;
}

/** 100ポゼッションあたりの値。ポゼッションが0以下なら null */
export function per100(value: number, possessions: number): number | null {
  return possessions > 0 ? (100 * value) / possessions : null;
}

export function ratingsFromPossessions(ownPoints: number, oppPoints: number, ownPoss: number, oppPoss: number): Omit<LineupRatings, "real"> {
  const off = per100(ownPoints, ownPoss);
  const def = per100(oppPoints, oppPoss);
  return { off, def, net: off !== null && def !== null ? off - def : null };
}

export function lineupRatingsOf(l: LineupAggregate): LineupRatings {
  if (l.ownPoss !== undefined && l.oppPoss !== undefined) {
    return { ...ratingsFromPossessions(l.ownPoints, l.oppPoints, l.ownPoss, l.oppPoss), real: true };
  }
  return { off: l.estimatedOffRtg, def: l.estimatedDefRtg, net: l.estimatedNetRtg, real: false };
}

/** 一覧のすべての組み合わせが実際のポゼッションで計算できるか（見出しの「（推定）」の有無を決める） */
export function lineupsHaveRealPossessions(lineups: LineupAggregate[]): boolean {
  return lineups.length > 0 && lineups.every((l) => l.ownPoss !== undefined && l.oppPoss !== undefined);
}

export const ESTIMATED_RATING_NOTE = "このシーズンは実際のポゼッションを数えていないため、推定値です";
