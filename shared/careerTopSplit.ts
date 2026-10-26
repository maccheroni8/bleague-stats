// 個人の通算記録の上位（league-player-career-top.json）に足した、分けた登録区分（外国籍・帰化・アジア特別枠）の表の形（DESIGN.md 298章）。
// 型の本体（shared/types.ts の LeaguePlayerCareerTopFile）は保存キーの対象なので書き換えず、ここで広げる。
// 作るのは scripts/aggregate-league-player-rankings.ts（保存キーの対象外。全体の導出データは毎回作る）、読むのは画面（CareerRecordRanking.tsx）。
import type { Classification, ClassifyAt } from "./registration.ts";
import type { LeaguePlayerCareerTopByClass, LeaguePlayerCareerTopFile, PlayerGameLog } from "./types.ts";

/** 分けた区分の鍵（URL の cls と同じ並び。帰化は naturalized） */
export type SplitCareerKey = "foreign" | "naturalized" | "asia";
export const SPLIT_CAREER_KEYS: readonly SplitCareerKey[] = ["foreign", "naturalized", "asia"];

/** 分けた区分の鍵 → 登録区分の4値 */
export const SPLIT_CAREER_CLASSIFICATION = { foreign: "外国籍", naturalized: "帰化選手", asia: "アジア特別枠" } as const;

export type LeaguePlayerCareerTopFileWithSplit = LeaguePlayerCareerTopFile & {
  /**
   * 分けた区分ごとの上位20位。2026-27 以降の試合のうち、その区分で出場した試合だけの通算（それより前は区分を分けて記録していない）。
   * 回数・在籍（careerCounts）は試合で分けられないので空。追加前に生成したファイルには無い
   */
  bySplitClass?: Record<SplitCareerKey, LeaguePlayerCareerTopByClass>;
  /** 現役だけの中での、分けた区分ごとの上位20位（bySplitClass と同じ数え方） */
  byActiveSplitClass?: Record<SplitCareerKey, LeaguePlayerCareerTopByClass>;
};

/** 選手ごと・シーズンごとの試合ログ（scripts/aggregate-league-player-rankings.ts の読み込みの形） */
export interface PlayerSeasonLogs {
  season: string;
  logs: PlayerGameLog[];
}

/**
 * 試合ごとの区分で、その区分で出場した試合だけにする（DESIGN.md 298章）。match に、シーズンとその試合の日の区分を渡す
 * （classifiers はシーズンごとの shared/registration.ts の makeClassifier）。シーズンの途中で区分が変わった選手は、変わる前と後の試合が別の区分に入る
 */
export function filterByClassification(
  byPlayer: ReadonlyMap<string, PlayerSeasonLogs[]>,
  classifiers: ReadonlyMap<string, ClassifyAt>,
  match: (season: string, c: Classification | undefined) => boolean,
): Map<string, PlayerSeasonLogs[]> {
  const out = new Map<string, PlayerSeasonLogs[]>();
  for (const [playerId, seasons] of byPlayer) {
    const kept: PlayerSeasonLogs[] = [];
    for (const s of seasons) {
      const classify = classifiers.get(s.season);
      const logs = s.logs.filter((g) => match(s.season, classify?.(playerId, g.date)));
      if (logs.length > 0) kept.push({ season: s.season, logs });
    }
    if (kept.length > 0) out.set(playerId, kept);
  }
  return out;
}
