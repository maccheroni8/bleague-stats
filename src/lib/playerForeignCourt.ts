// 個人詳細の On-Court Foreign（本人がコートにいたときの、同時にコートにいた外国籍・帰化・アジア特別枠の人数ごとの本人の成績。DESIGN.md 352章）。
// 材料は player-foreign.json（集計が試合ごとに作る。PlayerForeignFile）。人数は本人を含む。画面だけの部品（保存キーの対象外）。
import type { PlayerForeignFile } from "../../shared/types";

export const PLAYER_FOREIGN_COUNTS = [0, 1, 2, 3, 4] as const;
const EVENT_KEYS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "or", "dr", "ast", "tov"] as const;
export type PlayerForeignEvent = (typeof EVENT_KEYS)[number];

/** 1つの人数の合計 */
export interface PlayerForeignBucket {
  seconds: number;
  events: Record<PlayerForeignEvent, number>;
  /** 本人が出ている間の自チーム得点・相手得点・自チーム攻撃回数・相手攻撃回数（自チームの視点だけ） */
  team: { pts: number; oppPts: number; poss: number; oppPoss: number } | null;
}

export interface PlayerForeignTotals {
  /** 数えた試合数（本人の在コートの時間がある試合） */
  games: number;
  /** [0人, 1人, 2人, 3人, 4人] */
  buckets: PlayerForeignBucket[];
}

export interface PlayerForeignGame {
  scheduleKey: string;
  teamId: string | undefined;
  gameType: string;
}

/** 試合ごとの材料を、条件に合う試合だけ足す（side: own＝自チームの人数／opp＝相手の人数。include が false の試合は数えない） */
export function sumPlayerForeign(
  file: PlayerForeignFile,
  playerId: string,
  games: readonly PlayerForeignGame[],
  side: "own" | "opp",
  include: (g: PlayerForeignGame) => boolean,
): PlayerForeignTotals {
  const perGame = file.players[playerId] ?? {};
  const keyIndex = EVENT_KEYS.map((k) => file.eventKeys.indexOf(k));
  const buckets: PlayerForeignBucket[] = PLAYER_FOREIGN_COUNTS.map(() => ({
    seconds: 0,
    events: Object.fromEntries(EVENT_KEYS.map((k) => [k, 0])) as Record<PlayerForeignEvent, number>,
    team: side === "own" ? { pts: 0, oppPts: 0, poss: 0, oppPoss: 0 } : null,
  }));
  let counted = 0;
  for (const g of games) {
    if (!include(g)) continue;
    const entry = perGame[g.scheduleKey];
    if (!entry) continue;
    const sideData = entry[side];
    let any = false;
    for (const n of PLAYER_FOREIGN_COUNTS) {
      const v = sideData[String(n)];
      if (!v) continue;
      const b = buckets[n]!;
      b.seconds += v[0] ?? 0;
      if ((v[0] ?? 0) > 0) any = true;
      // 本人の記録は、PLAYER_EVENT_KEYS の並び（ファイルの eventKeys）のまま 1 番目から
      EVENT_KEYS.forEach((k, i) => (b.events[k] += v[1 + keyIndex[i]!] ?? 0));
      if (b.team) {
        const base = 1 + file.eventKeys.length;
        b.team.pts += v[base] ?? 0;
        b.team.oppPts += v[base + 1] ?? 0;
        b.team.poss += v[base + 2] ?? 0;
        b.team.oppPoss += v[base + 3] ?? 0;
      }
    }
    if (any) counted += 1;
  }
  return { games: counted, buckets };
}
