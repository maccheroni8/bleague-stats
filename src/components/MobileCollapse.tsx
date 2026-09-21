import { useState, type ReactNode } from "react";
import { useMediaQuery } from "../lib/useMediaQuery";

/**
 * スマホ幅（560px以下。index.cssのスマホ向けメディアクエリと同じ境目）では中身を既定で隠し、
 * 「◯◯を表示」ボタンで展開できるようにする。広い画面では常に中身をそのまま表示する。
 * 縦に長く横幅も要る図（円グラフ・ショットチャート等）が狭い画面で場所を取りすぎるのを避けるための包み。
 * 展開状態は保存しない（開き直すと隠れた状態に戻る）
 */
export function MobileCollapse({ label, children }: { label: string; children: ReactNode }) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const [open, setOpen] = useState(false);
  if (!narrow) return <>{children}</>;
  return (
    <>
      <button type="button" className="mobile-collapse-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? `${label}を隠す` : `${label}を表示`}
      </button>
      {open && children}
    </>
  );
}
