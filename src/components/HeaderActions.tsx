import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SaveMenu } from "./SaveMenu";

/**
 * ページの見出し（h1）の行の右端に置く部品（保存ボタンなど。DESIGN.md 401章）。
 * 見出しは `PageTitleRow` で描き、その右端の枠を共有の置き場にする。保存ボタンは `HeaderActions` で包むと、
 * いま開いているタブ・表示のものがその枠に出る（枠が無いページではその場に出る）。
 */
let slotElement: HTMLElement | null = null;
const listeners = new Set<() => void>();
function setSlot(el: HTMLElement | null) {
  if (slotElement === el) return;
  slotElement = el;
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
const InHeader = createContext(false);

export function useHeaderSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => slotElement, () => null);
}

/** 見出し（h1）と、その右端の保存ボタンの枠。幅が足りないときは見出しのすぐ下の行の右端に回る */
export function PageTitleRow({ children, subtitle }: { children: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="page-title-row">
      <div className="page-title-main">
        <h1>{children}</h1>
        {subtitle != null && <p className="page-subtitle">{subtitle}</p>}
      </div>
      <div className="page-title-save">
        <SaveMenu />
      </div>
      <div
        className="page-title-actions"
        ref={(el) => {
          if (el) setSlot(el);
          else slotElement && setSlot(null);
        }}
      />
    </div>
  );
}

/** 見出しの行の右端に出す（枠が無いページではその場に出す）。入れ子にしても1回だけ移す */
export function HeaderActions({ children }: { children: ReactNode }) {
  const slot = useHeaderSlot();
  const inHeader = useContext(InHeader);
  if (inHeader || !slot) return <>{children}</>;
  return createPortal(<InHeader.Provider value>{children}</InHeader.Provider>, slot);
}
