import { formatMinutesFromSeconds } from "./boxscoreAggregate";

/**
 * 時間（出場時間など）の表示。サイト全体で「分:秒」（28:30）に統一する。小数の分（28.5）は画面に出さない。
 * 分（小数）を渡す。平均は秒に丸めてから出す（1,000分以上は3桁区切り。formatMinutesFromSeconds と同じ）。
 * 並べ替え・判定は今までどおり値（分）で行い、これは表示だけに使う。
 * 保存キーの対象（集計のコード）に入れないよう、boxscoreAggregate.ts・format.ts には足さずに別のファイルにしている
 */
export function formatMinutesColon(minutes: number): string {
  return formatMinutesFromSeconds(Math.round(minutes * 60));
}

/** 時間の差（符号つき。「+3:15」「-0:40」。差が秒に丸めて0なら符号なしの「0:00」） */
export function formatSignedMinutesColon(minutes: number): string {
  const sec = Math.round(minutes * 60);
  if (sec === 0) return formatMinutesFromSeconds(0);
  return `${sec > 0 ? "+" : "-"}${formatMinutesFromSeconds(Math.abs(sec))}`;
}
