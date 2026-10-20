// 強制ターンオーバー表の列（種類別）。チーム詳細のシーズン別成績の Forced TOV と、対戦相手別の Forced TOV で共通に使う。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import type { TeamForcedTurnovers } from "../../shared/types";

/** 強制ターンオーバー表の列（種類別。「シーズン別成績」のForced TOVタブ用） */
export const FORCED_TURNOVER_COLUMNS: { key: string; label: string; title?: string; value: (d: TeamForcedTurnovers) => number }[] = [
  {
    key: "offensiveFoul",
    label: "オフェンスファウル",
    title: "シュートファウル以外のオフェンスファウルによるターンオーバー",
    value: (d) => d.offensiveFoul,
  },
  { key: "violation24sec", label: "24秒バイオレーション", title: "24秒バイオレーションによるターンオーバー", value: (d) => d.violation24sec },
  { key: "backcourt", label: "バックコート", title: "バックコートバイオレーションによるターンオーバー", value: (d) => d.backcourtViolation },
  { key: "violation5sec", label: "5秒バイオレーション", title: "5秒バイオレーションによるターンオーバー", value: (d) => d.violation5sec },
  { key: "violation8sec", label: "8秒バイオレーション", title: "8秒バイオレーションによるターンオーバー", value: (d) => d.violation8sec },
  {
    key: "otherDead",
    label: "その他デッドボール",
    title: "トラベリング・ダブルドリブル・3秒バイオレーション・アウトオブバウンズ等、上記以外のデッドボールターンオーバー",
    value: (d) => d.otherDead,
  },
  {
    key: "live",
    label: "ライブボール（参考）",
    title: "スティール由来（バッドパス・ボールハンドリングロスト）のライブボールターンオーバー。参考値",
    value: (d) => d.live,
  },
  {
    key: "total",
    label: "合計",
    value: (d) => d.offensiveFoul + d.violation24sec + d.backcourtViolation + d.violation5sec + d.violation8sec + d.otherDead + d.live,
  },
  {
    key: "gamesWithData",
    label: "データあり試合数",
    title: "Yahoo!スポーツplay-by-playが実際に取得できた試合数（分母の目安）",
    value: (d) => d.gamesWithData,
  },
];
