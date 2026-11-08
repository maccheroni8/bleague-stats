// 「on4 が可能だった試合」の判定（DESIGN.md 352章・353章）。そのチームのベンチ入り（ボックススコアの試合全体の選手行。出場しなかった選手を含む）に、
// 同時に4人出せるだけの外国籍・帰化・アジア特別枠の選手がいた試合。数え方はシーズンの OC の規則（season-rules.json の maxForeignOnCourt）に合わせ、
// 2026-27 の B.PREMIER は「外国籍3名以内＋帰化かアジア特別枠いずれか1名以内（別枠）＝最大4名」なので、外国籍が3名以上、かつ帰化＋アジア特別枠が1名以上。
// 区分が分からない選手は数えない（推測しない）。集計（TeamGameLog.on4Possible）と検証が同じ判定を使う。
import type { StoredGame } from "./types.ts";

/** on4 の判定ができるのは、同時出場の上限が4人のシーズンだけ（B.PREMIER の2026-27〜。B.ONE は3人、過去のシーズンは2〜3人） */
export function on4RuleApplies(maxForeignOnCourt: number | undefined): boolean {
  return maxForeignOnCourt === 4;
}

export type ClassLookup = (playerId: string, date?: string) => string | undefined;

/** 1チームのベンチ入りの数え上げ */
export interface BenchForeignCount {
  /** 外国籍 */
  foreign: number;
  /** 帰化選手＋アジア特別枠 */
  natAsia: number;
  /** 区分が分からない選手（数えていない） */
  unknown: number;
}

/** 4人（外国籍3＋帰化かアジア特別枠1）を同時に出せる人数がそろっているか */
export function on4Feasible(c: BenchForeignCount): boolean {
  return c.foreign >= 3 && c.natAsia >= 1;
}


/** 試合の元データ（ボックススコアの試合全体の選手行。出場しなかった選手を含む）から、両チームのベンチ入りの数え上げ */
export function benchForeignCounts(game: Pick<StoredGame, "date" | "raw">, classify: ClassLookup): Map<string, BenchForeignCount> {
  const out = new Map<string, BenchForeignCount>();
  for (const rows of [game.raw.HomeBoxscores, game.raw.AwayBoxscores]) {
    for (const r of rows ?? []) {
      if (r.Category !== 1 || r.PeriodCategory !== 18 || !r.PlayerID) continue;
      const teamId = String(r.TeamID);
      let c = out.get(teamId);
      if (!c) out.set(teamId, (c = { foreign: 0, natAsia: 0, unknown: 0 }));
      const cls = classify(String(r.PlayerID), game.date);
      if (cls === undefined) c.unknown += 1;
      else if (cls === "外国籍") c.foreign += 1;
      else if (cls === "帰化選手" || cls === "アジア特別枠") c.natAsia += 1;
    }
  }
  return out;
}

