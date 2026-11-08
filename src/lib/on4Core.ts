// on4 の判定の純粋な部分（読み込みなし。画面と検証スクリプトで共有。DESIGN.md 352章）。数え方は on4Games.ts の先頭のとおり。
import type { StoredGame } from "../../shared/types";

/** on4 の判定ができるのは、同時出場の上限が4人の B.PREMIER のシーズンだけ（B.ONE は上限3、過去のシーズンは上限が2〜3） */
export function on4Supported(league: "premier" | "one", maxForeignOnCourt: number | undefined): boolean {
  return league === "premier" && maxForeignOnCourt === 4;
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

