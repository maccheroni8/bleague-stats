import { createContext, useContext, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { ExportImageButton } from "../components/ExportImageButton";

/** 図解ページの「チーム／選手」タブの並びの一番右。どの図でも保存ボタンをここに出す */
export const FigureExportSlot = createContext<HTMLElement | null>(null);

/** 画像として保存するボタン。ページ上部の固定位置に出す（枠が無いときはその場に出す）。1つの図に保存の対象が複数あるときは label で見分ける */
export function FigureExportButton({ label, ...props }: ComponentProps<typeof ExportImageButton> & { label?: string }) {
  const slot = useContext(FigureExportSlot);
  const button = <ExportImageButton {...props} />;
  const node = label ? <span className="figure-export-item"><span className="figure-export-label">{label}</span>{button}</span> : button;
  return slot ? createPortal(node, slot) : node;
}
