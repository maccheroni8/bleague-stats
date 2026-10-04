// 見張りの一覧（data/game-watchlist.json）の型と、変化の判定・診断。DESIGN.md 202章。
//
// こちらが見つけた公式の記録の誤り（交代の記録の欠け・並びの食い違いなど）が、公式のスタッツ修正で直るかを
// 見張るための仕組み。夜間実行で、一覧の試合を21日を過ぎても取り直し（試合から21日以内の試合は通常の再チェックで取り直す）、
// 交代・得点の記録、recordFixedFlg、最終スコア、公式の+/-が前回の版から変わっていれば、何が変わったかを一覧の履歴に残して報告する。
// 変化がなければ何もしない。見張りの期間は見つけた日から60日。

import { reconstructOnCourt, substitutionModelForSeason, totalGameSeconds } from "../../shared/onCourt.ts";
import type { BoxscoreRow, Category, StoredGame } from "../../shared/types.ts";

/** 見張る期間（見つけた日から） */
export const WATCH_DAYS = 60;

export type WatchStatus =
  /** 見張り中 */
  | "watching"
  /** 解消: 見つけた問題が公式の修正で直った（`check` の条件を満たした） */
  | "resolved"
  /** 修正あり: 期間が終わるまでに記録の変化があったが、問題は残っている */
  | "changed"
  /** 修正なし: 期間が終わるまで記録に変化が無かった */
  | "no-change"
  /** 対象外（古い）: 公式が直す見込みが低い古いシーズンの試合。一覧に載せるだけで取り直さない */
  | "out-of-scope";

/** 解消の判定。診断（diagnose）の値がこの条件を満たしたら解消とみなす */
export type WatchCheck =
  /** 同じ秒の交代の間にフリースローが挟まる並びの補正が不要になった（補正した場所が0） */
  | "orderRepairs"
  /** 在コート人数の警告が0になった */
  | "warnings"
  /** 公式の+/-との不一致（例外を除く）が0になった */
  | "plusMinus";

export interface WatchDiagnosis {
  /** 在コート人数などの警告の件数（補正後） */
  warnings: number;
  /** 交代をフリースローの前に動かした場所の数 */
  orderRepairs: number;
  /** ラインナップの5人組を割り出せなかった秒数（2チーム合計） */
  unreconstructedSeconds: number;
  /** 公式の+/-と合わない選手の数（補正すれば合わないが補正前なら合う「例外」は数えない） */
  plusMinusMismatches: number;
}

export interface WatchHistoryItem {
  /** 変化を見つけた時刻（ISO） */
  at: string;
  changes: string[];
  /** その時点の診断 */
  diagnosis: WatchDiagnosis;
}

export interface WatchEntry {
  scheduleKey: string;
  season: string;
  category: Category;
  reason: string;
  /** 見つけた日（JST、YYYY-MM-DD） */
  foundAt: string;
  /** 見張りの終了日（JST、YYYY-MM-DD。見つけた日 + WATCH_DAYS） */
  watchUntil: string;
  status: WatchStatus;
  /** 解消の判定（無ければ期間の終わりまで見張る） */
  check?: WatchCheck;
  /** 見つけたときの診断 */
  diagnosisAtFound?: WatchDiagnosis;
  history: WatchHistoryItem[];
  /** 見張りを終えた日（JST、YYYY-MM-DD） */
  closedAt?: string;
  note?: string;
}

export interface WatchFile {
  /** 説明（人が読むため） */
  description: string;
  watchDays: number;
  entries: WatchEntry[];
}

/** 変化の比較に使う、試合の記録の要点（見張り中の試合だけ、別のファイルに保存する） */
export interface WatchSnapshot {
  /** 交代・得点・フリースローの行（Period|RestTime|TeamID|PlayerID1|ActionCD1）を記録の並びのまま */
  rows: string[];
  recordFixedFlg: boolean;
  homeScore: number;
  awayScore: number;
  /** 公式の個人+/-（試合全体の行） */
  plusMinus: Record<string, number>;
}

const SUB_IN = 86;
const SUB_OUT = 87;
const SCORING_CODES = new Set([1, 3, 4, 7, 8, 44]);

function individualRows(game: StoredGame): BoxscoreRow[] {
  return [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores].filter((r) => r.Category === 1 && r.PeriodCategory === 18);
}

export function snapshotOf(game: StoredGame): WatchSnapshot {
  const rows: string[] = [];
  for (const e of game.raw.PlayByPlays) {
    if (e.ActionCD1 === SUB_IN || e.ActionCD1 === SUB_OUT || SCORING_CODES.has(e.ActionCD1)) {
      rows.push(`${e.Period}|${e.RestTime}|${e.TeamID ?? ""}|${e.PlayerID1 ?? ""}|${e.ActionCD1}`);
    }
  }
  const plusMinus: Record<string, number> = {};
  for (const r of individualRows(game)) {
    if (typeof r.PLUSMINUS === "number") plusMinus[r.PlayerID] = r.PLUSMINUS;
  }
  return {
    rows,
    recordFixedFlg: game.recordFixedFlg,
    homeScore: game.homeScore,
    awayScore: game.awayScore,
    plusMinus,
  };
}

function countBy(rows: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r, (m.get(r) ?? 0) + 1);
  return m;
}

/** 行の追加数・削除数（同じ行が複数あっても数えられる） */
function multisetDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = countBy(before);
  const a = countBy(after);
  const added: string[] = [];
  const removed: string[] = [];
  for (const [k, n] of a) for (let i = 0; i < n - (b.get(k) ?? 0); i += 1) added.push(k);
  for (const [k, n] of b) for (let i = 0; i < n - (a.get(k) ?? 0); i += 1) removed.push(k);
  return { added, removed };
}

const codeOfRow = (row: string): number => Number(row.split("|")[4]);

/** 前回の版（snapshot）から変わった点を、日本語の短い文で返す（変化が無ければ空） */
export function describeChanges(before: WatchSnapshot, after: WatchSnapshot): string[] {
  const changes: string[] = [];
  if (before.recordFixedFlg !== after.recordFixedFlg) {
    changes.push(`recordFixedFlg ${before.recordFixedFlg}→${after.recordFixedFlg}`);
  }
  if (before.homeScore !== after.homeScore || before.awayScore !== after.awayScore) {
    changes.push(`最終スコア ${before.homeScore}-${before.awayScore}→${after.homeScore}-${after.awayScore}`);
  }
  const { added, removed } = multisetDiff(before.rows, after.rows);
  const subDiff = (rows: string[]) => rows.filter((r) => codeOfRow(r) === SUB_IN || codeOfRow(r) === SUB_OUT).length;
  const scoreDiff = (rows: string[]) => rows.length - subDiff(rows);
  if (subDiff(added) + subDiff(removed) > 0) {
    changes.push(`交代の記録が変化（追加${subDiff(added)}・削除${subDiff(removed)}）`);
  }
  if (scoreDiff(added) + scoreDiff(removed) > 0) {
    changes.push(`得点・フリースローの記録が変化（追加${scoreDiff(added)}・削除${scoreDiff(removed)}）`);
  }
  if (added.length === 0 && removed.length === 0 && before.rows.some((r, i) => r !== after.rows[i])) {
    changes.push("得点・交代の並びが変化");
  }
  const pmChanged = Object.keys({ ...before.plusMinus, ...after.plusMinus }).filter((id) => before.plusMinus[id] !== after.plusMinus[id]);
  if (pmChanged.length > 0) changes.push(`公式の+/-が変化（${pmChanged.length}人）`);
  return changes;
}

/** 在コートの復元の診断（見つけた問題が直ったかの判定と、履歴の記録に使う） */
export function diagnose(game: StoredGame): WatchDiagnosis {
  const periods = game.quarterScores.home.length;
  const run = (repairSubOrder: boolean) =>
    reconstructOnCourt(
      game.raw.PlayByPlays,
      game.raw.HomeBoxscores,
      game.raw.AwayBoxscores,
      game.homeTeam.id,
      game.awayTeam.id,
      periods,
      substitutionModelForSeason(game.season),
      { repairSubOrder },
    );
  const fixed = run(true);
  const recorded = fixed.orderRepairs.length > 0 ? run(false) : null;
  const gameSeconds = totalGameSeconds(periods);
  let unreconstructedSeconds = 0;
  for (const teamId of [game.homeTeam.id, game.awayTeam.id]) {
    const sec = fixed.lineupStints.filter((s) => s.teamId === teamId).reduce((sum, s) => sum + (s.endSec - s.startSec), 0);
    unreconstructedSeconds += gameSeconds - sec;
  }
  let plusMinusMismatches = 0;
  for (const row of individualRows(game)) {
    if (typeof row.PLUSMINUS !== "number") continue;
    const reconstructed = fixed.plusMinus[row.PlayerID] ?? 0;
    if (row.PLUSMINUS === reconstructed) continue;
    if (recorded && row.PLUSMINUS === (recorded.plusMinus[row.PlayerID] ?? 0)) continue; // 例外（検証スクリプトと同じ扱い）
    plusMinusMismatches += 1;
  }
  return { warnings: fixed.warnings.length, orderRepairs: fixed.orderRepairs.length, unreconstructedSeconds, plusMinusMismatches };
}

/** 診断が、解消の判定の条件を満たしているか */
export function isResolved(check: WatchCheck, d: WatchDiagnosis): boolean {
  switch (check) {
    case "orderRepairs":
      return d.orderRepairs === 0;
    case "warnings":
      return d.warnings === 0;
    case "plusMinus":
      return d.plusMinusMismatches === 0;
  }
}

/** JSTの日付（YYYY-MM-DD）に日数を足す */
export function addDays(dateStr: string, days: number): string {
  const t = new Date(`${dateStr}T00:00:00+09:00`).getTime() + days * 86_400_000;
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(t));
}

export function todayJst(now: number = Date.now()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(now));
}

export function watchId(e: Pick<WatchEntry, "season" | "category" | "scheduleKey">): string {
  return `${e.season}/${e.category}/${e.scheduleKey}`;
}
