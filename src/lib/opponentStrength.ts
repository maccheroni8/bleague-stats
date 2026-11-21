import type { GameSummary, TeamSummary, UpcomingGameEntry } from "../../shared/types";

/**
 * 対戦相手の強さ（相手の最新勝率）の共通の部品（設計書251章・444章）。相手の最新勝率を使う画面は、すべてここを通す
 * （チーム詳細の概要「シチュエーション別勝敗」・条件別順位表の「対戦相手の強さ（最新勝率）」・On-Court Foreign の「対勝率6割以上」・
 * 図解の「条件付きの勝率」・チーム詳細の md・順位表の「対戦相手の強さ」「残り相手勝率」）。
 *
 * 最新勝率＝そのシーズンのレギュラーシーズンの勝÷(勝＋敗)。終わったシーズンは最終、進行中は今の成績。
 * 元は teams.json の wins/losses（結果だけの試合〔不戦勝など〕を含む）。順位表の最新日のスナップショットも同じ勝敗
 * （全シーズン・両リーグで一致することを validate:opponent-strength で確かめる）なので、どちらを渡しても同じ値になる。
 *
 * 別の考え方の「その試合の時点までの勝率」（相手が5試合以上消化した試合だけ。チーム詳細のシチュエーション別成績・
 * 直近成績の「対戦相手勝率」）は situational.ts の buildRecordsBeforeGame が受け持ち、ここでは扱わない。
 * 保存キーの対象のファイル（集計）からは使わない。
 */

export type OpponentSeasonRecord = Pick<TeamSummary, "teamId" | "wins" | "losses">;
export type OpponentSeasonTier = "under50" | "atLeast50" | "atLeast60";

/** チームID → 最新勝率。0試合・欠損・不正な勝敗は推測せず載せない（その相手との試合は、どの計算でも数えない） */
export function buildOpponentSeasonWinRates(teams: readonly OpponentSeasonRecord[] | null | undefined): ReadonlyMap<string, number> {
  const rates = new Map<string, number>();
  for (const team of teams ?? []) {
    const games = team.wins + team.losses;
    if (!Number.isSafeInteger(team.wins) || !Number.isSafeInteger(team.losses) ||
        team.wins < 0 || team.losses < 0 || !Number.isSafeInteger(games) || games <= 0) continue;
    rates.set(team.teamId, team.wins / games);
  }
  return rates;
}

/** 1試合ごとの相手の強さ（その試合の相手の最新勝率）。勝率を出せない相手は undefined */
export function opponentLatestWinRate(opponentTeamId: string, rates: ReadonlyMap<string, number>): number | undefined {
  return rates.get(opponentTeamId);
}

/** 区分（対5割未満・対5割以上・対6割以上）。6割以上は5割以上にも含める。消化試合数の下限は設けない */
export function matchesOpponentSeasonWinRate(
  opponentTeamId: string,
  tier: OpponentSeasonTier,
  rates: ReadonlyMap<string, number>,
): boolean {
  const rate = opponentLatestWinRate(opponentTeamId, rates);
  if (rate === undefined) return false;
  switch (tier) {
    case "under50": return rate < 0.5;
    case "atLeast50": return rate >= 0.5;
    case "atLeast60": return rate >= 0.6;
  }
}

/** 数字で選ぶ区分（●以上／●未満。図解の条件付きの勝率・条件別順位表の「対勝率●以上の相手」） */
export function matchesOpponentLatestRate(
  opponentTeamId: string,
  mode: "ge" | "lt",
  rate: number,
  rates: ReadonlyMap<string, number>,
): boolean {
  const r = opponentLatestWinRate(opponentTeamId, rates);
  if (r === undefined) return false;
  return mode === "ge" ? r >= rate - 1e-9 : r < rate - 1e-9;
}

/** 相手の最新勝率の平均（ここまで・残り）。value は加重平均（同じ相手と複数回なら、その回数だけ数える）、games はその試合数 */
export interface OpponentStrength {
  /** 相手の最新勝率の、試合数での加重平均（0〜1） */
  value: number;
  /** 値を出した試合数 */
  games: number;
  /** リーグ内の順位（高い順。同じ表示値＝小数第3位まで同じなら同じ順位で、次の順位は飛ばす） */
  rank: number;
}

/** 平均と順位を付ける（順位は表示している値〔小数第3位〕が同じなら同じ順位。ランキングの順位の付け方と同じ） */
function rankAverages(sums: Map<string, { sum: number; games: number }>): Map<string, OpponentStrength> {
  const entries = [...sums].filter(([, s]) => s.games > 0).map(([teamId, s]) => ({ teamId, value: s.sum / s.games, games: s.games }));
  const key = (v: number) => v.toFixed(3);
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const result = new Map<string, OpponentStrength>();
  sorted.forEach((e, i) => {
    let j = i;
    while (j > 0 && key(sorted[j - 1]!.value) === key(e.value)) j -= 1;
    result.set(e.teamId, { value: e.value, games: e.games, rank: j + 1 });
  });
  return result;
}

/**
 * ここまでの相手の強さ（順位表の列「対戦相手の強さ」）: すでに戦ったレギュラーシーズンの試合の、相手の最新勝率の平均。
 * games はレギュラーシーズンの終了した試合（結果だけの試合〔不戦勝など〕も、順位表と同じく戦った試合として含めて渡す）。
 * 自チームの勝率を出せない（まだ試合をしていない）クラブは値を持たない
 */
export function computeOpponentStrength(
  teams: readonly OpponentSeasonRecord[],
  games: readonly GameSummary[],
): Map<string, OpponentStrength> {
  const rates = buildOpponentSeasonWinRates(teams);
  const sums = new Map<string, { sum: number; games: number }>();
  const add = (teamId: string, opponentId: string) => {
    const opponentWinPct = rates.get(opponentId);
    if (opponentWinPct === undefined || !rates.has(teamId)) return;
    const s = sums.get(teamId) ?? { sum: 0, games: 0 };
    s.sum += opponentWinPct;
    s.games += 1;
    sums.set(teamId, s);
  };
  for (const g of games) {
    if (g.gameType !== "regular" || !g.gameEndedFlg) continue;
    add(g.homeTeamId, g.awayTeamId);
    add(g.awayTeamId, g.homeTeamId);
  }
  return rankAverages(sums);
}

/**
 * 残りの相手の強さ（順位表の列「残り相手勝率」）: これからの試合（開催予定）の、相手の最新勝率の平均。同じ相手と複数回なら、その回数だけ数える。
 * upcoming は、まだ試合の記録が無い開催予定（`pendingUpcomingGames` を通したもの）。中止・延期で日程が決まっていない試合は開催予定に載らないので入らない。
 * excludeKeys（結果だけの試合など、すでに勝敗が付いた試合）は数えない。開催予定はチーム名しか持たないので、teamIdByName で名寄せする
 * （名寄せできない試合は数えない）。勝率を出せない相手（まだ試合をしていない）との試合も数えない。残り試合が無いクラブは値を持たない
 */
export function computeRemainingOpponentStrength(
  teams: readonly OpponentSeasonRecord[],
  upcoming: readonly UpcomingGameEntry[],
  teamIdByName: ReadonlyMap<string, string>,
  excludeKeys: ReadonlySet<string> = new Set(),
): Map<string, OpponentStrength> {
  const rates = buildOpponentSeasonWinRates(teams);
  const sums = new Map<string, { sum: number; games: number }>();
  const add = (teamId: string, opponentId: string) => {
    const opponentWinPct = rates.get(opponentId);
    if (opponentWinPct === undefined) return;
    const s = sums.get(teamId) ?? { sum: 0, games: 0 };
    s.sum += opponentWinPct;
    s.games += 1;
    sums.set(teamId, s);
  };
  for (const g of upcoming) {
    if (excludeKeys.has(g.scheduleKey)) continue;
    const homeId = teamIdByName.get(g.homeTeamName);
    const awayId = teamIdByName.get(g.awayTeamName);
    if (!homeId || !awayId) continue;
    add(homeId, awayId);
    add(awayId, homeId);
  }
  return rankAverages(sums);
}
