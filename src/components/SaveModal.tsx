import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * 画像・動画の保存の「窓」（モーダル。設計書396章）。保存ボタンを押すと開き、保存する内容の選択と保存・進み具合を出す。
 * 画像・動画のどちらでも、サイトのすべての保存ボタンで共通の部品として使う（中身は children で画面ごとに渡す）。
 * body の直下に出す（保存する範囲の外。html2canvas の対象外）。閉じる: 「閉じる」・窓の外を押す・Esc。
 * iPhone でも使えるよう、幅は画面幅に収め、ボタンは高さ44px以上にする
 */
export function SaveModal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  /** 窓の見出し（「画像として保存」「動画として保存」） */
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    // 窓の後ろのページがスクロールしないようにする
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="save-modal-backdrop"
      data-html2canvas-ignore="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="save-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="save-modal-head">
          <h2 className="save-modal-title">{title}</h2>
          <button type="button" ref={closeRef} className="save-modal-close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>
        <div className="save-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** 窓の中の「保存される見出しとサブタイトル」の見本（文字だけ。軽い版） */
export function SaveModalPreview({ scope, name, subtitle }: { scope?: string; name?: string; subtitle?: string }) {
  if (!scope && !name && !subtitle) return null;
  return (
    <div className="save-modal-preview" aria-label="保存される見出し">
      {scope && <p className="save-modal-preview-scope">{scope}</p>}
      {name && <p className="save-modal-preview-name">{name}</p>}
      {subtitle && <p className="save-modal-preview-sub">{subtitle}</p>}
    </div>
  );
}
