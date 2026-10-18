// チーム詳細「クラブレコード」の最多連勝・最多連敗のトップ10（DESIGN.md 260章）。
// 連勝・連敗は、シーズンをまたがない（シーズン内の連続。今の「最多連勝（シーズン内）」と同じ）。1連は数えない（2連以上）。
// 試合ログ（日付順に並べ直す）から連続の区切りを数え、長さごとにまとめる。集計のコードから読まれない場所（保存キーの対象外）に置く。
import type { TeamGameLog } from "../../shared/types";

/** 連続の最小の長さ（1連は連勝・連敗に数えない） */
export const MIN_STREAK_LENGTH = 2;

/** トップの件数（同じ順位は続けて出す） */
export const STREAK_TOP_N = 10;

export type StreakKind = "win" | "loss";

type StreakGame = Pick<TeamGameLog, "date" | "scheduleKey" | "win" | "isHome" | "opponentTeamId" | "opponentTeamName">;

export interface StreakRun<G extends StreakGame = StreakGame> {
  season: string;
  length: number;
  first: G;
  last: G;
  /** 今も続いている（シーズンの最後の試合まで続いていて、そのシーズンがまだ終わっていない） */
  ongoing: boolean;
}

/** 長さごとにまとめた1行。runs は新しい順（継続中が先頭、そのあとは終わった日付の新しい順。先頭が代表として載せる一番新しい回） */
export interface StreakRow<G extends StreakGame = StreakGame> {
  /** 競技方式の順位（同じ長さは同じ順位を共有し、次の順位が飛ぶ。回数で数える） */
  rank: number;
  length: number;
  runs: StreakRun<G>[];
}

function byDate(a: StreakGame, b: StreakGame): number {
  return a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey);
}

/**
 * 1シーズン分の試合ログ（試合区分で絞り済み）から、MIN_STREAK_LENGTH 以上の連勝（または連敗）の連続をすべて求める。
 * seasonRunning が true のとき、シーズンの最後の試合まで続いている連続を「継続中」にする
 */
export function streakRunsOfSeason<G extends StreakGame>(season: string, logs: readonly G[], kind: StreakKind, seasonRunning: boolean): StreakRun<G>[] {
  const sorted = [...logs].sort(byDate);
  const target = kind === "win";
  const runs: StreakRun<G>[] = [];
  let start = -1;
  const close = (end: number) => {
    if (start < 0) return;
    const length = end - start + 1;
    if (length >= MIN_STREAK_LENGTH) {
      runs.push({ season, length, first: sorted[start]!, last: sorted[end]!, ongoing: seasonRunning && end === sorted.length - 1 });
    }
    start = -1;
  };
  for (let i = 0; i < sorted.length; i += 1) {
    if (sorted[i]!.win === target) {
      if (start < 0) start = i;
    } else {
      close(i - 1);
    }
  }
  close(sorted.length - 1);
  return runs;
}

/**
 * 連続を、長い順（同じ長さは、継続中が一番上、そのあとは終わった日付の新しい順）に並べ、トップN（同じ順位は続けて出す）を長さごとの行にまとめる。
 * 順位は今までの決まり（同じ値は同じ順位、次は飛ばす）で、個々の回を数えて付ける（長さ4が3回あれば、2位が3回で次は5位）
 */
export function rankStreakRuns<G extends StreakGame>(runs: readonly StreakRun<G>[], n: number = STREAK_TOP_N): StreakRow<G>[] {
  if (runs.length === 0) return [];
  const sorted = [...runs].sort((a, b) => b.length - a.length || Number(b.ongoing) - Number(a.ongoing) || b.last.date.localeCompare(a.last.date) || b.last.scheduleKey.localeCompare(a.last.scheduleKey));
  const ranks: number[] = [];
  let rank = 1;
  sorted.forEach((r, i) => {
    if (i === 0 || r.length !== sorted[i - 1]!.length) rank = i + 1;
    ranks.push(rank);
  });
  const cutoff = ranks[Math.min(n, sorted.length) - 1]!;
  const rows: StreakRow<G>[] = [];
  sorted.forEach((r, i) => {
    if (ranks[i]! > cutoff) return;
    const last = rows.at(-1);
    if (last && last.length === r.length) last.runs.push(r);
    else rows.push({ rank: ranks[i]!, length: r.length, runs: [r] });
  });
  return rows;
}

/** 日本時間の月（7・8月は前のシーズンが終わったあとのオフ。継続中の連続は無い） */
export function isOffseasonMonth(date: Date = new Date()): boolean {
  const month = Number(new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", month: "numeric" }).format(date));
  return month === 7 || month === 8;
}
