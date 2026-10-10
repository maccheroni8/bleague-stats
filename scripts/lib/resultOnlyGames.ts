// 結果だけの試合（schedule.json の resultOnlyGames。shared/resultOnlyGames.ts・DESIGN.md 228章）を、公式の試合ページから作る・振り分ける。
// - 不戦勝／不戦敗: 公式の日程のカードに試合へのリンクが無く、ボタンが「不戦勝／不戦敗」（scripts/lib/scheduleCancelled.ts の forfeits）
// - ボックススコアが公式に無い試合: 試合から NO_BOXSCORE_AFTER_DAYS 日たっても生データが取れず、試合ページには得点がある
// どちらも、試合ページ（game_detail）の日付・対戦・得点・大会名・クラブのリンク（TeamID）から作る。
import type { GameDetailInfo } from "./upcomingGame.ts";
import { classifyGameType } from "./gameType.ts";
import { isExhibitionGame } from "./exhibitionGames.ts";
import {
  isUsableResultScore,
  type ResultOnlyGameEntry,
  type ResultOnlyReason,
} from "../../shared/resultOnlyGames.ts";

export interface BuildResultOnlyOptions {
  reason: ResultOnlyReason;
  /** 試合ページから TeamID が読めなかったときの、チーム名→TeamID（TEAM_NAMES・過去の名称など） */
  fallbackTeamIdByName?: Map<string, string>;
  /** 試合ページの得点が使えないときの代わり（公式の日程のカードの得点） */
  fallbackScores?: { home: number | null; away: number | null };
}

export type BuildResultOnlyOutcome =
  | { ok: true; entry: ResultOnlyGameEntry }
  | { ok: false; why: "score-unavailable" | "exhibition" | "team-unresolved" | "no-convention" };

/** 試合ページの内容から結果だけの試合の項目を作る。作れない理由は why に返す（呼び出し側が記録する） */
export function buildResultOnlyEntry(info: GameDetailInfo, opts: BuildResultOnlyOptions): BuildResultOnlyOutcome {
  let home = info.homeScore;
  let away = info.awayScore;
  if (!isUsableResultScore(home, away) && opts.fallbackScores) {
    home = opts.fallbackScores.home;
    away = opts.fallbackScores.away;
  }
  if (!isUsableResultScore(home, away)) return { ok: false, why: "score-unavailable" };
  // 大会名が読めない試合は、オールスターなどと見分けられないので入れない
  if (!info.conventionName) return { ok: false, why: "no-convention" };
  if (isExhibitionGame(info.conventionName)) return { ok: false, why: "exhibition" };

  const resolve = (name: string): string | undefined => info.teamIdByName.get(name) ?? opts.fallbackTeamIdByName?.get(name);
  const homeTeamId = resolve(info.entry.homeTeamName);
  const awayTeamId = resolve(info.entry.awayTeamName);
  if (!homeTeamId || !awayTeamId) return { ok: false, why: "team-unresolved" };

  return {
    ok: true,
    entry: {
      scheduleKey: info.entry.scheduleKey,
      date: info.entry.date,
      homeTeamId,
      homeTeamName: info.entry.homeTeamName,
      awayTeamId,
      awayTeamName: info.entry.awayTeamName,
      homeScore: home!,
      awayScore: away!,
      gameType: classifyGameType(info.conventionName),
      ...(info.entry.venue ? { venue: info.entry.venue } : {}),
      ...(info.entry.tipoffTime ? { tipoffTime: info.entry.tipoffTime } : {}),
      reason: opts.reason,
    },
  };
}

export interface ReconcileResultOnlyInput {
  /** 前回までの resultOnlyGames */
  existing: ResultOnlyGameEntry[];
  /** 今回の実行で新たに作れた項目 */
  built: ResultOnlyGameEntry[];
  /** 生データ（games/）がある試合。記録のある試合が優先で、結果だけの試合から外す */
  withBoxscore: Set<string>;
}

export interface ReconcileResultOnlyResult {
  entries: ResultOnlyGameEntry[];
  /** 今回新たに加えた試合のキー */
  added: string[];
  /** 生データが取り込まれたので外した試合のキー（公式のボックススコアが後から公開された） */
  superseded: string[];
}

/** 結果だけの試合の一覧を決める（日付・キーの昇順）。前回の分は引き継ぎ、生データが取り込まれた試合は外す。同じキーは新しい項目で置き換える */
export function reconcileResultOnly(input: ReconcileResultOnlyInput): ReconcileResultOnlyResult {
  const existingKeys = new Set(input.existing.map((g) => g.scheduleKey));
  const superseded = input.existing.filter((g) => input.withBoxscore.has(g.scheduleKey)).map((g) => g.scheduleKey).sort();
  const byKey = new Map<string, ResultOnlyGameEntry>();
  for (const g of input.existing) if (!input.withBoxscore.has(g.scheduleKey)) byKey.set(g.scheduleKey, g);
  const added: string[] = [];
  for (const g of input.built) {
    if (input.withBoxscore.has(g.scheduleKey)) continue;
    if (!existingKeys.has(g.scheduleKey)) added.push(g.scheduleKey);
    byKey.set(g.scheduleKey, g);
  }
  const entries = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
  return { entries, added: added.sort(), superseded };
}
