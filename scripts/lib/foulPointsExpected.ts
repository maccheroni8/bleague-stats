// 反則ポイントの検証（validate-foul-points.ts）で使う、手で数えた値（過去シーズンのクラブ。DESIGN.md 416章）。
// 値は、試合の生データのプレーバイプレー・ボックススコアと台帳（docs/foul-points/suspensions.json）を、集計のコードとは別に数えて決めた。
// 公式の記録の訂正や台帳の直しで変わったときは、数え直してから直す。
export interface FoulPointsExpected {
  season: string;
  teamId: string;
  note: string;
  total: number;
  tf: number;
  uf: number;
  ejection: number;
  tf1: number;
  tf2: number;
  flagrant: number;
  dq: number;
  suspension: number;
  entry: number;
}

export const FOUL_POINTS_EXPECTED: readonly FoulPointsExpected[] = [
  // 旧規程。2016-10-30 の乱闘で DQ 5人（退場5回）、ギレンウォーターの TF2回の退場（退場の3点だけ）・出場停止は台帳から6試合
  { season: "2016-17", teamId: "706", note: "アルバルク東京", total: 60, tf: 15, uf: 6, ejection: 7, tf1: 0, tf2: 0, flagrant: 0, dq: 0, suspension: 6, entry: 0 },
  // 旧規程。DQ の退場2回（カミングス・ブラッキンズ）。先の発表（規律委員長の決定）は後の発表に含めて1回ずつ
  { season: "2018-19", teamId: "729", note: "名古屋ダイヤモンドドルフィンズ", total: 36, tf: 17, uf: 7, ejection: 2, tf1: 0, tf2: 0, flagrant: 0, dq: 0, suspension: 2, entry: 0 },
  // 2019-20（版が見つからず推定）。DQ 2人（4164）と TF＋UF の退場1回
  { season: "2019-20", teamId: "699", note: "京都ハンナリーズ", total: 35, tf: 11, uf: 9, ejection: 3, tf1: 0, tf2: 0, flagrant: 0, dq: 0, suspension: 2, entry: 0 },
  // 旧規程。ジョシュア・スミスの TF2回の退場2回（出場停止は1＋2試合）
  { season: "2021-22", teamId: "696", note: "富山グラウジーズ", total: 50, tf: 18, uf: 17, ejection: 2, tf1: 0, tf2: 0, flagrant: 0, dq: 0, suspension: 3, entry: 0 },
  // 旧規程（エントリー人数あり）。エントリー9名以下の試合2つで15点
  { season: "2022-23", teamId: "720", note: "島根スサノオマジック", total: 65, tf: 14, uf: 15, ejection: 3, tf1: 0, tf2: 0, flagrant: 0, dq: 0, suspension: 4, entry: 15 },
];
