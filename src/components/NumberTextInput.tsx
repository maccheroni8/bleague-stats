import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type InputHTMLAttributes } from "react";
import { commitNumberText, toHalfWidthNumberText, type NumberTextKind } from "../lib/numberTextInput";

/**
 * 数値・時間を手で入れる欄の共通部品（スタッツの条件・最終点差・ベン図の基準の値。DESIGN.md 337章）。
 *
 * - 入力中は打った文字をそのまま出す（欄の中に下書きを持つ）。数値として読む・形を整える・親に渡すのは、
 *   確定したとき（欄から離れたとき・Enter）だけ。値をURLに持つ画面では、URLが書き換わるのが少し遅れて届くため、
 *   1文字ごとに親へ渡すと、届くまでの間に欄が古い値へ書き戻され、日本語キーボードの確定前の文字が二重に入っていた
 * - 日本語キーボードの確定前（変換中）は、外から値を書き換えない・Enter で確定しない
 * - スマホでは数字のキーボード（inputMode="decimal"）。そのキーボードに無い「:」「−」は、親が置くボタンから
 *   `appendOnce`・`toggleSign` で下書きに足す
 */
export interface NumberTextInputHandle {
  /** 下書きの末尾に文字を足す（すでに含まれていれば足さない）。欄にフォーカスを戻す */
  appendOnce: (text: string) => void;
  /** 下書きの先頭の「-」を付け外しする */
  toggleSign: () => void;
}

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange" | "type" | "inputMode">;

export const NumberTextInput = forwardRef<NumberTextInputHandle, NativeProps & {
  /** 確定済みの値（親の状態・URLの値）の文字列 */
  value: string;
  /** 確定したときに呼ぶ。読めない入力は kind の決まりに従って、そのまま渡すか元に戻す */
  onCommit: (text: string) => void;
  kind: NumberTextKind;
}>(function NumberTextInput({ value, onCommit, kind, onBlur, onKeyDown, ...rest }, ref) {
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  /** 欄にフォーカスがあり、まだ確定していない入力があるか */
  const editing = useRef(false);
  const composing = useRef(false);
  const latest = useRef({ draft, value, onCommit, kind });
  latest.current = { draft, value, onCommit, kind };

  // 確定済みの値が外から変わったら下書きを合わせる（入力の途中・変換中は書き換えない）
  useEffect(() => {
    if (!editing.current && !composing.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const { draft: d, value: v, onCommit: c, kind: k } = latest.current;
    editing.current = false;
    const next = commitNumberText(d, k);
    if (next === null) {
      setDraft(v);
      return;
    }
    setDraft(next);
    if (next !== v) c(next);
  };

  // 欄の外を触って欄ごと閉じる（ポップオーバー）ときは、離れる前に欄が消えるので、消えるときに確定する
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => () => {
    if (editing.current) commitRef.current();
  }, []);

  useImperativeHandle(ref, () => ({
    appendOnce: (text) => {
      editing.current = true;
      setDraft((d) => (toHalfWidthNumberText(d).includes(text) ? d : `${d}${text}`));
      inputRef.current?.focus();
    },
    toggleSign: () => {
      editing.current = true;
      setDraft((d) => (/^[-−－ー]/.test(d) ? d.slice(1) : `-${d}`));
      inputRef.current?.focus();
    },
  }));

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode={kind === "count" ? "numeric" : "decimal"}
      enterKeyHint="done"
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      value={draft}
      onChange={(e) => {
        editing.current = true;
        setDraft(e.target.value);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(e) => {
        composing.current = false;
        setDraft(e.currentTarget.value);
      }}
      onBlur={(e) => {
        composing.current = false;
        commit();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        // 変換中の Enter（日本語キーボードの確定）は値の確定にしない
        if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && !composing.current) commit();
      }}
    />
  );
});
