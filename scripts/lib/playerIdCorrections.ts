// 生データ（bleague.jp側）で選手IDが誤って記録されている試合の手動訂正リスト。
//
// 公式の個人成績（roster_detail）と試合単位の生データ（ボックススコア・PlayByPlays）で
// 紐付く選手IDが食い違うケースがあり、その場合は個人成績側を正として、該当試合の
// 生データのIDを付け替える。scrape-boxscore.tsが生データを保存する直前に適用するため、
// 保存済みファイル（フロントエンドの試合詳細ページが直接読む）も、再取得時も訂正後の値になる。
// 対象はボックススコア（HomeBoxscores/AwayBoxscores）のPlayerIDと、PlayByPlaysの
// PlayerID1/PlayerID2。選手名（PlayerNameJ等）は元データのまま（誤っているのはIDだけの想定）。

import type { GeniusContext } from "../../shared/types.ts";

interface PlayerIdCorrection {
  scheduleKey: string;
  wrongPlayerId: string;
  correctPlayerId: string;
  note: string;
}

export const PLAYER_ID_CORRECTIONS: PlayerIdCorrection[] = [
  {
    // 2026-09-23確認: 名古屋D #00 ロバート・ドジャー選手（9354）の出場記録が、この1試合だけ
    // 重野凱紀選手（51000106、2021-22は東京Z〈B2〉のみ在籍）のIDで記録されていた。
    // 公式の個人成績はドジャー選手の2021-22名古屋Dが9試合・147:30で、この試合（14:42）を
    // 含めた合計と一致する。重野選手の個人成績に名古屋Dでの出場は無い（DESIGN.md 94-11章）
    scheduleKey: "7589",
    wrongPlayerId: "51000106",
    correctPlayerId: "9354",
    note: "2021-12-05 名古屋D、ロバート・ドジャー",
  },
];

/** 該当試合の生データの選手IDを訂正する（該当しなければそのまま返す） */
export function applyPlayerIdCorrections(scheduleKey: string, context: GeniusContext): GeniusContext {
  const corrections = PLAYER_ID_CORRECTIONS.filter((c) => c.scheduleKey === scheduleKey);
  if (corrections.length === 0) return context;

  const fix = <T extends string | number | null>(id: T): T => {
    const hit = corrections.find((c) => String(id) === c.wrongPlayerId);
    if (!hit) return id;
    // 元データの型（数値/文字列）を保つ
    return (typeof id === "number" ? Number(hit.correctPlayerId) : hit.correctPlayerId) as T;
  };

  return {
    ...context,
    HomeBoxscores: context.HomeBoxscores.map((b) => ({ ...b, PlayerID: fix(b.PlayerID) })),
    AwayBoxscores: context.AwayBoxscores.map((b) => ({ ...b, PlayerID: fix(b.PlayerID) })),
    PlayByPlays: context.PlayByPlays.map((p) => ({ ...p, PlayerID1: fix(p.PlayerID1), PlayerID2: fix(p.PlayerID2) })),
  };
}
