// 保存画像のフッターに出す「データの基準日」（DESIGN.md 239章）。表に入っている試合のうち、終わった試合の最も新しい試合日。
// 試合の一覧（games-summary）から求めるので、取得済みの集計・導出データには手を入れない（保存キーの対象外）。
//
// 試合の範囲は表の「レギュラー／プレーオフ（CS）／合算」の選択に合わせる。スタッツの条件や直近N試合などで表の試合を絞っていても、
// 基準日は「そのシーズン・その試合区分で、データが入っている最新の試合日」のまま（データがいつの時点のものかを示す日付のため）。
import type { GameSummary } from "../../shared/types";
import { fetchGameSummaries, fetchSeasons } from "./data";
import { formatBaseDate, latestBaseDate, latestEndedGameDate, type BaseDateGameType } from "./exportFormat";

export { latestBaseDate };
export type { BaseDateGameType };

// 同じシーズンを何度も読まないよう、読み込みの約束（Promise）をシーズンごとに持つ。保存のたびに新しい値が要るので、
// 結果ではなく読み込みだけを使い回す（ページを開き直すまで変わらない。取得に失敗したら次の保存で読み直す）
const summaryCache = new Map<string, Promise<GameSummary[]>>();

function summariesOf(season: string): Promise<GameSummary[]> {
  let p = summaryCache.get(season);
  if (!p) {
    p = fetchGameSummaries(season).catch((e) => {
      summaryCache.delete(season);
      throw e;
    });
    summaryCache.set(season, p);
  }
  return p;
}

/** 1シーズンの基準日（「2026/10/11」形式）。試合が無い・取得できないときは undefined */
export async function seasonBaseDate(season: string, gameType: BaseDateGameType = "regular"): Promise<string | undefined> {
  try {
    const d = latestEndedGameDate(await summariesOf(season), gameType);
    return d ? formatBaseDate(d) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 歴代・通算の基準日: 試合区分に合う試合がある最も新しいシーズンの、最新の試合日。
 * 新しいシーズンから順に探す（進行中のシーズンにまだプレーオフが無いときは前のシーズンの日付になる）
 */
export async function allTimeBaseDate(gameType: BaseDateGameType = "regular"): Promise<string | undefined> {
  try {
    const seasons = (await fetchSeasons())
      .filter((s) => s.hasCompletedGames)
      .map((s) => s.season)
      .sort()
      .reverse();
    for (const season of seasons) {
      const d = await seasonBaseDate(season, gameType);
      if (d) return d;
    }
  } catch {
    // 基準日が取れなくても保存は止めない（フッターに日付を出さないだけ）
  }
  return undefined;
}
