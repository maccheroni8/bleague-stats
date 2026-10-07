// ルーキー（選手契約および登録に関する規程 第5条〔新人選手〕に準じた判定。DESIGN.md 213・215章）。
//
// 規程の第5条（1）:
//  新人選手とは、外国籍選手・アジア特別枠選手・帰化選手に該当せず、かつ国内リーグ（B1・B2・B3・B.PREMIER・B.ONE・B.NEXT）および海外リーグ（NBA Summer League含む）の在籍経験がなく、
//  当該シーズンに初めてBリーグにリーグ登録された選手をいう。
//  なお、上記に基づき新人選手として扱われるシーズンにおいて、当該シーズン3月31日時点で22歳以下の選手は、B.PREMIERリーグ戦・B.ONEリーグ戦およびB.NEXTリーグ戦の1シーズンの出場試合数が
//  当該選手の所属するチームの行った試合の半分以下の場合、当該シーズンの翌シーズンも新人選手として扱うものとし、以後も同様とする。
//  但し、当該選手が、インジュアリーリストに登録されていた期間を除き、1シーズンのすべてにわたりリーグ選手登録された場合は、当該シーズンまで新人選手として扱うものとし、翌シーズン以後は新人選手として扱わない。
//
// ここでの判定（近似。画面にも注記する）:
//  - 登録区分が日本人でない選手は対象外（選手マスタの classification）
//  - 初めての登録: 選手ページの「クラブ所属履歴」（B1・B2・B3を含む）の最初のシーズン。それがB1の最初の登録シーズンより前なら、B2・B3で先に登録されていたので、
//    B2・B3のシーズンの出場試合数が分からず延長を確かめられないため、B1ではルーキーとしない。B.LEAGUE発足の2016-17が最初の選手は、それ以前の経歴が載らないので判定の対象外
//  - 延長（翌シーズンも新人選手）: ①そのシーズンの3月31日（終了年）時点で22歳以下 ②レギュラーシーズンの出場試合数が、所属チームの試合数の半分以下（シーズン途中の移籍は
//    shared/rookieGames.ts の数え方） ③「1シーズンのすべてにわたり登録」でない。③は、最初のベンチ入りが所属クラブのレギュラーシーズンの3試合目以内のシーズンを「すべて登録」とみなす近似
//    （リーグ登録の試合数は直接のデータが無い。ベンチ入りの無いシーズンは、開幕時点の登録ではないとみなす）。3つとも満たすとき、翌シーズンも対象にする
//  - B1に登録が無いシーズンの扱い: 所属履歴にそのシーズンのB2・B3のクラブがあれば、出場試合数が分からないので、そこで延長を打ち切る。履歴にも無いシーズン（大学・海外など）は、
//    リーグ戦の出場が無いものとして、年齢が合えば延長する（B1に戻ったシーズンも、ルーキーに入る）
//  - 新人賞の受賞の有無は使わない
//  - 海外リーグの在籍経験・2016-17より前の国内の経歴は判定できない（選手ページの履歴は2016-17以降の国内クラブだけ）
//  - インジュアリーリスト: 2025年1月より前は判定できない
//  - 現行の規程を全シーズンに当てはめる（過去の規程の版は見ていない）
//  - 履歴・登録区分・（延長の判定で必要なときの）生年月日が読めていない選手は「判定不能」とし、対象から外す（ルーキーとはみなさない）。読めた次の集計から、判定に戻る

import type { ClubHistoryEntry } from "./types.ts";
import { isUnderExtensionAge } from "./rookieAge.ts";

/** 最初のベンチ入りが、クラブの開幕から何試合目以内なら「1シーズンのすべてにわたり登録」とみなすか */
export const OPENING_REGISTRATION_MAX_GAME = 3;

/** 出場試合数がチームの試合数のこの割合以下なら、翌シーズンも新人選手（半分以下） */
export const ROOKIE_EXTENSION_MAX_GAMES_RATIO = 0.5;

/** B.LEAGUE発足のシーズン。B1の最初の登録がこのシーズンの選手は、それ以前の経歴が載らないので「初めての登録」を判定できない */
export const FIRST_LEAGUE_SEASON = "2016-17";

export interface RookieSeasonGames {
  /** レギュラーシーズンの出場試合数（出場時間がある試合） */
  gamesPlayed: number;
  /** 所属チームの行ったレギュラーシーズンの試合数（シーズン途中の移籍は所属した各チームの分の合計。shared/rookieGames.ts） */
  teamGames: number;
}

export interface RookieInput {
  /** 選手マスタの登録区分（"日本人"・"外国籍"・"帰化選手"・"アジア特別枠"）。読めないときは省略 */
  classification?: string;
  /** 生年月日（"YYYY-MM-DD"）。読めないときは省略 */
  birthDate?: string;
  /** B1（B.PREMIER）に登録していたシーズン（昇順。player-careers の在籍シーズン） */
  registeredSeasons: string[];
  /** 選手ページの「クラブ所属履歴」。取得できていない選手は省略 */
  history?: ClubHistoryEntry[];
  /** シーズン → 最初のベンチ入りが、そのときの所属クラブのレギュラーシーズンの何試合目か（ベンチ入りが無いシーズンはキーが無い） */
  firstBenchGameNo: Record<string, number | undefined>;
  /** シーズン → レギュラーシーズンの出場試合数と、所属チームの試合数（試合の記録が無いシーズンはキーが無い） */
  games: Record<string, RookieSeasonGames | undefined>;
}

export type RookieJudgement =
  /** 判定できた。seasons は対象のシーズン（空のこともある）。extendedSeasons は、そのうち2年目以降（延長）のシーズン */
  | { status: "judged"; seasons: string[]; extendedSeasons: string[] }
  /** 判定の対象外: 日本人でない、B1の最初の登録が2016-17、B1の登録が無い */
  | { status: "not-applicable"; reason: "not-japanese" | "first-season-2016-17" | "no-registration" }
  /** 履歴によると、B1より前にB2・B3で先に登録されていた（初めての登録ではない。延長を確かめられないので、B1ではルーキーとしない） */
  | { status: "registered-earlier"; firstHistorySeason: string }
  /** 判定に必要な情報が足りない。対象から外す（ルーキーとはみなさない） */
  | { status: "undeterminable"; reason: "no-classification" | "no-birth-date" | "no-history" | "history-lacks-first-season" };

/** "2025-26" → "2026-27" */
export function nextSeason(season: string): string {
  const start = Number(season.slice(0, 4)) + 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** 1人の選手のルーキーのシーズンを判定する */
export function judgeRookie(input: RookieInput): RookieJudgement {
  if (input.classification === undefined) return { status: "undeterminable", reason: "no-classification" };
  if (input.classification !== "日本人") return { status: "not-applicable", reason: "not-japanese" };
  const first = input.registeredSeasons[0];
  if (first === undefined) return { status: "not-applicable", reason: "no-registration" };
  if (first === FIRST_LEAGUE_SEASON) return { status: "not-applicable", reason: "first-season-2016-17" };

  if (!input.history || input.history.length === 0) return { status: "undeterminable", reason: "no-history" };
  const historySeasons = input.history.map((h) => h.season).sort();
  // 履歴にB1の最初の登録シーズンが載っていない（履歴の読み取りが不完全・名簿との食い違い）ときは、初めての登録を判定できない
  if (!historySeasons.includes(first) && historySeasons[0]! > first) return { status: "undeterminable", reason: "history-lacks-first-season" };
  if (historySeasons[0]! < first) return { status: "registered-earlier", firstHistorySeason: historySeasons[0]! };

  const registered = new Set(input.registeredSeasons);
  const historySet = new Set(historySeasons);
  const lastRegistered = input.registeredSeasons[input.registeredSeasons.length - 1]!;
  const seasons: string[] = [first];
  let cur = first;
  while (nextSeason(cur) <= lastRegistered) {
    // cur から翌シーズンへ延長されるか
    if (registered.has(cur)) {
      const g = input.games[cur];
      if (g && g.teamGames > 0 && g.gamesPlayed > g.teamGames * ROOKIE_EXTENSION_MAX_GAMES_RATIO) break; // 出場試合数が半分を超えた
      const benchNo = input.firstBenchGameNo[cur];
      if (benchNo !== undefined && benchNo <= OPENING_REGISTRATION_MAX_GAME) break; // 1シーズンのすべてにわたり登録（とみなす）
    } else if (historySet.has(cur)) {
      break; // B1に登録が無く、B2・B3のクラブにいたシーズン。出場試合数が分からないので、延長を確かめられない
    } // 履歴にも無いシーズン（大学・海外など）は、リーグ戦の出場が無いものとして、年齢が合えば延長する
    const young = isUnderExtensionAge(input.birthDate, cur);
    if (young === null) return { status: "undeterminable", reason: "no-birth-date" };
    if (!young) break;
    cur = nextSeason(cur);
    if (registered.has(cur)) seasons.push(cur);
  }
  return { status: "judged", seasons, extendedSeasons: seasons.slice(1) };
}
