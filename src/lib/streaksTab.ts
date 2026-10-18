// チームスタッツのカテゴリタブ「Streaks」（各チームの最多連勝・最多連敗など。DESIGN.md 261章）の行と表示名。
// カテゴリタブの名前は英語表記（Traditional・Periods など）。名前の一覧 `categoryLabels.ts` は保存キーの対象なので、ここに置く。
import type { TeamStreak } from "../../shared/teamRecords";
import type { TeamGameLog } from "../../shared/types";
import { seasonStreakSummary, type SeasonStreakSummary } from "./streakRecords";

export const STREAKS_CATEGORY_LABEL = "Streaks";

/** 「Streaks」の1チーム。レギュラーシーズンの試合ログ（結果だけの試合を含む）から作る */
export interface StreakTeamRow {
  team: { teamId: string; teamName: string };
  games: number;
  wins: number;
  losses: number;
  /** 全試合の最長の連勝・連敗（同じ長さの回を新しい順に持つ）と、今の連続 */
  all: SeasonStreakSummary<TeamGameLog>;
  /** ホームの試合だけ・アウェイの試合だけを並べた連続の最長（その試合が無ければ null、勝ちや負けが無ければ 0） */
  home: { maxWin: number; maxLoss: number } | null;
  away: { maxWin: number; maxLoss: number } | null;
}

function venueMax(logs: readonly TeamGameLog[], season: string): { maxWin: number; maxLoss: number } | null {
  if (logs.length === 0) return null;
  const s = seasonStreakSummary(season, logs, false);
  return { maxWin: s.maxWin?.length ?? 0, maxLoss: s.maxLoss?.length ?? 0 };
}

/**
 * regularLogs は、そのチームのレギュラーシーズンの試合ログ（結果だけの試合を含む）。seasonRunning は、そのシーズンがまだ終わっていないか
 * （続いている連続を「継続中」にする。ホーム・アウェイ別は数字だけなので使わない）
 */
export function buildStreakTeamRow(team: { teamId: string; teamName: string }, season: string, regularLogs: readonly TeamGameLog[], seasonRunning: boolean): StreakTeamRow {
  const wins = regularLogs.filter((g) => g.win).length;
  return {
    team,
    games: regularLogs.length,
    wins,
    losses: regularLogs.length - wins,
    all: seasonStreakSummary(season, regularLogs, seasonRunning),
    home: venueMax(regularLogs.filter((g) => g.isHome), season),
    away: venueMax(regularLogs.filter((g) => !g.isHome), season),
  };
}

/** 「連勝/連敗」の列の並べ替えの値（連勝は正・連敗は負） */
export function signedStreak(streak: TeamStreak | null): number {
  return streak ? (streak.type === "win" ? streak.count : -streak.count) : 0;
}
