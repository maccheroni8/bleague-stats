import { useState, type RefObject } from "react";
import { exportElementAsImage } from "../lib/exportImage";

export function ExportImageButton({ targetRef, filename }: { targetRef: RefObject<HTMLElement | null>; filename: string }) {
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (!targetRef.current || busy) return;
    setBusy(true);
    try {
      await exportElementAsImage(targetRef.current, filename);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button className="export-image-button" onClick={handleClick} disabled={busy}>
      {busy ? "出力中..." : "画像として保存"}
    </button>
  );
}
