// ルーキー（B.LEAGUEの新人賞の対象要件（現行）に準じた判定。DESIGN.md 213-4・214章）。
//
// 新人賞の対象要件:
//  (1) B1所属で、初めてB.LEAGUEにリーグ登録され、前シーズン4月1日時点で満23歳の誕生日を迎えていない
//  (2) (1)の「初めて登録」に関わらず、当該シーズンのリーグ登録試合数が全試合に満たず、新人賞を受賞しておらず、全試合に満たない事由がインジュアリーリストでない選手は、
//      リーグ戦開幕時点で登録されたシーズンまで対象
//
// ここでの判定（近似。画面にも注記する）:
//  - 初めての登録: 選手ページの「クラブ所属履歴」（B2・B3を含む）の最初のシーズン。それがB1の最初の登録シーズンより前なら、B2・B3で先に登録されていたので対象外。
//    B.LEAGUE発足の2016-17より前の経歴は載らないので、B1の最初の登録が2016-17の選手は判定の対象外
//  - 年齢: そのシーズンの開始年の4月1日時点で22歳以下（shared/rookieAge.ts）
//  - リーグ登録試合数が全試合に満たない: 登録の試合数は直接のデータが無いので、「最初のベンチ入りが、所属クラブのレギュラーシーズンの開幕から3試合目以内」を
//    「開幕時点で登録」とみなす。それより後（途中加入）、またはベンチ入りが無いシーズンは、翌シーズンも対象に延長する
//  - 新人賞を受賞していない: 最優秀新人賞だけを指す（新人賞ベストファイブは含めない）。受賞したシーズンまでで終わり
//  - インジュアリーリスト: 2025年1月より前は判定できないので、けがが理由の登録不足も途中加入として扱い、対象を延長する場合がある
//  - 履歴が読めていない選手は「判定不能」とし、対象から外す（ルーキーとはみなさない）。履歴が取れた次の集計から、判定に戻る

import type { ClubHistoryEntry } from "./types.ts";
import { isRookieAgeAtSeason } from "./rookieAge.ts";

/** 最初のベンチ入りが、クラブの開幕から何試合目以内なら「開幕時点で登録」とみなすか */
export const OPENING_REGISTRATION_MAX_GAME = 3;

/** B.LEAGUE発足のシーズン。B1の最初の登録がこのシーズンの選手は、それ以前の経歴が載らないので「初めての登録」を判定できない */
export const FIRST_LEAGUE_SEASON = "2016-17";

export interface RookieInput {
  /** 生年月日（"YYYY-MM-DD"）。読めないときは省略 */
  birthDate?: string;
  /** B1（B.PREMIER）に登録していたシーズン（昇順。player-careers の在籍シーズン） */
  registeredSeasons: string[];
  /** 選手ページの「クラブ所属履歴」。取得できていない選手は省略 */
  history?: ClubHistoryEntry[];
  /** シーズン → 最初のベンチ入りが、そのときの所属クラブのレギュラーシーズンの何試合目か（ベンチ入りが無いシーズンはキーが無い） */
  firstBenchGameNo: Record<string, number | undefined>;
  /** 最優秀新人賞を受賞したシーズン */
  rookieAwardSeasons: ReadonlySet<string>;
}

export type RookieJudgement =
  /** 判定できた。seasons は対象のシーズン（空のこともある） */
  | { status: "judged"; seasons: string[] }
  /** 判定の対象外: B1の最初の登録が2016-17、年齢の要件を満たさない、B1の登録が無い */
  | { status: "not-applicable"; reason: "first-season-2016-17" | "over-age" | "no-registration" }
  /** 履歴によると、B1より前にB2・B3で先に登録されていた（初めての登録ではない） */
  | { status: "registered-earlier"; firstHistorySeason: string }
  /** 判定に必要な情報が足りない。対象から外す（ルーキーとはみなさない） */
  | { status: "undeterminable"; reason: "no-birth-date" | "no-history" | "history-lacks-first-season" };

/**
 * 1人の選手のルーキーの対象シーズンを判定する。useHistory=false は、履歴を使わない判定（B1の最初の登録を初登録とみなす。履歴を取り込む前の方法。比較・検証用）
 */
export function judgeRookie(input: RookieInput, options: { useHistory?: boolean } = {}): RookieJudgement {
  const useHistory = options.useHistory ?? true;
  const first = input.registeredSeasons[0];
  if (first === undefined) return { status: "not-applicable", reason: "no-registration" };
  if (first === FIRST_LEAGUE_SEASON) return { status: "not-applicable", reason: "first-season-2016-17" };
  const youngAtFirst = isRookieAgeAtSeason(input.birthDate, first);
  if (youngAtFirst === null) return { status: "undeterminable", reason: "no-birth-date" };
  if (!youngAtFirst) return { status: "not-applicable", reason: "over-age" };

  if (useHistory) {
    if (!input.history || input.history.length === 0) return { status: "undeterminable", reason: "no-history" };
    const seasons = input.history.map((h) => h.season).sort();
    // 履歴にB1の最初の登録シーズンが載っていない（履歴の読み取りが不完全・名簿との食い違い）ときは、初めての登録を判定できない
    if (!seasons.includes(first) && seasons[0]! > first) return { status: "undeterminable", reason: "history-lacks-first-season" };
    if (seasons[0]! < first) return { status: "registered-earlier", firstHistorySeason: seasons[0]! };
  }

  const eligible: string[] = [];
  for (const season of input.registeredSeasons) {
    if (isRookieAgeAtSeason(input.birthDate, season) !== true) break; // 年齢の条件は、シーズンが進むほど厳しくなるだけ
    eligible.push(season);
    const no = input.firstBenchGameNo[season];
    const atOpening = no !== undefined && no <= OPENING_REGISTRATION_MAX_GAME;
    if (input.rookieAwardSeasons.has(season) || atOpening) break; // 受賞した／開幕時点で登録されたシーズンまで
  }
  return { status: "judged", seasons: eligible };
}
