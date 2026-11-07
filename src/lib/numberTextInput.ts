import { formatMinutesColon } from "./minutesFormat";
import { parseConditionInputFor } from "./statConditions";

/**
 * 数値・時間の入力欄（`NumberTextInput`）を確定したときの読み方（DESIGN.md 337章）。
 * - `text`: スタッツの条件のふつうの項目。全角を半角にそろえるだけで、読めない文字も残す（欄の下で案内する）
 * - `minutes`: スタッツの条件の MIN。読めれば「20:00」の形に整え、読めなければ残す
 * - `number`: ベン図の基準の値。数として読めなければ確定前の値に戻す。空は「初期値に戻す」
 * - `count`: 最終点差。0 以上の整数（3桁まで）。読めなければ確定前の値に戻す
 */
export type NumberTextKind = "text" | "minutes" | "number" | "count";

/** 全角の数字・記号を半角に（「２０：３０」→「20:30」、「－５」→「-5」）。前後の空白は外す */
export function toHalfWidthNumberText(text: string): string {
  return text
    .replace(/[０-９．－＋：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−–—ー]/g, "-")
    .replace(/[\s　]/g, "");
}

/** 確定したときの値。null は「読めないので確定前の値に戻す」 */
export function commitNumberText(draft: string, kind: NumberTextKind): string | null {
  const t = toHalfWidthNumberText(draft);
  if (t === "") return "";
  switch (kind) {
    case "text":
      return t;
    case "minutes": {
      const v = parseConditionInputFor(t, "minutes");
      return v === null ? t : formatMinutesColon(v);
    }
    case "number": {
      if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(t)) return null;
      const v = Number(t);
      return Number.isFinite(v) ? String(v) : null;
    }
    case "count":
      return /^\d+$/.test(t) ? String(Number(t.slice(0, 3))) : null;
  }
}
