// Yahoo!スポーツplay-by-playのターンオーバーを、相手に強制した種類別カウント（TeamForcedTurnovers）に分類する（DESIGN.md 275章 段階2）。
// 集計（scripts/aggregate.ts）と画面の両方から使えるよう shared/ に置く。語彙は scripts/lib/yahooPbp.ts の LIVE/DEAD_TURNOVER_SUBTYPES と同じ。
import type { TeamForcedTurnovers, YahooTurnoverEvent } from "./types.ts";

/** TeamForcedTurnovers の件数の項目（gamesWithData を除く） */
export type ForcedTurnoverBucket = keyof Omit<TeamForcedTurnovers, "gamesWithData">;

/**
 * Yahoo!スポーツplay-by-playのターンオーバーイベントを、相手に強制した種類別カウントの
 * バケットに分類する（TeamForcedTurnoversの5主要種別＋その他デッド/ライブに集約する。DESIGN.md参照。
 * 8秒バイオレーションは全2,274試合中265試合・288件確認済みで、実在するタグ）
 */
export function classifyForcedTurnover(to: Pick<YahooTurnoverEvent, "ballType" | "subtypeRaw">): ForcedTurnoverBucket {
  if (to.ballType === "live") return "live";
  switch (to.subtypeRaw) {
    case "オフェンスファウル":
      return "offensiveFoul";
    case "24秒バイオレーション":
      return "violation24sec";
    case "バックコート":
      return "backcourtViolation";
    case "5秒バイオレーション":
    case "5秒チームバイオレーション":
      return "violation5sec";
    case "8秒バイオレーション":
      return "violation8sec";
    default:
      return "otherDead";
  }
}
