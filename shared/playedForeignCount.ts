// 試合に出場した外国籍・帰化・アジア特別枠の選手の人数（設計書392章）。
// 「出場」＝ボックススコアの試合全体の選手行（Category=1・PeriodCategory=18）で、出場時間が0秒より長い（DNP・00:00 は数えない）。
// 区分は試合の日の登録区分（makeClassifier。388章の日付で切り替える区分）。区分が分からない選手は数えない（unknown に数だけ残す）。
// 集計（TeamGameLog・PlayerGameLog の foreignPlayedCount・intlPlayedCount）と検証が同じ関数を使う。
import type { BoxscoreRow } from "./types.ts";

export interface PlayedForeignCount {
  /** 出場した外国籍（帰化・アジア特別枠は含めない） */
  foreign: number;
  /** 出場した外国籍・帰化・アジア特別枠の合計 */
  intl: number;
  /** 出場したが区分が分からない選手（数えていない） */
  unknown: number;
}

/** "MM:SS" の出場時間が0秒より長いか（"DNP"・"00:00"・読めない値は出場なし） */
export function playedMoreThanZero(playTime: string | undefined): boolean {
  const m = /^(\d+):(\d{2})$/.exec(playTime ?? "");
  return m != null && Number(m[1]) * 60 + Number(m[2]) > 0;
}

/** 両チームの、出場した外国籍・帰化・アジア特別枠の人数（チームIDごと）。選手行の無いチームは入らない */
export function playedForeignCounts(
  rows: readonly BoxscoreRow[],
  classify: (playerId: string) => string | undefined,
): Map<string, PlayedForeignCount> {
  const out = new Map<string, PlayedForeignCount>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.Category !== 1 || r.PeriodCategory !== 18 || !r.TeamID) continue;
    const teamId = String(r.TeamID);
    let c = out.get(teamId);
    if (!c) out.set(teamId, (c = { foreign: 0, intl: 0, unknown: 0 }));
    if (!r.PlayerID || !playedMoreThanZero(r.PlayTime)) continue;
    const key = `${teamId}:${r.PlayerID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cls = classify(String(r.PlayerID));
    if (cls === undefined) c.unknown += 1;
    else if (cls === "外国籍") {
      c.foreign += 1;
      c.intl += 1;
    } else if (cls === "帰化選手" || cls === "アジア特別枠") c.intl += 1;
  }
  return out;
}

/** 試合ログに書く4つの項目（自チーム・相手）。どちらかのチームの選手行が無ければ書かない */
export function playedForeignFields(
  counts: Map<string, PlayedForeignCount>,
  teamId: string,
  opponentId: string,
): { foreignPlayedCount?: number; intlPlayedCount?: number; opponentForeignPlayedCount?: number; opponentIntlPlayedCount?: number } {
  const own = counts.get(teamId);
  const opp = counts.get(opponentId);
  return {
    ...(own ? { foreignPlayedCount: own.foreign, intlPlayedCount: own.intl } : {}),
    ...(opp ? { opponentForeignPlayedCount: opp.foreign, opponentIntlPlayedCount: opp.intl } : {}),
  };
}
