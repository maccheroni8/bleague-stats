import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { clearExportDebugLog, exportDebugEnabled, exportDebugLines, installExportDebug, subscribeExportDebugLog } from "../lib/exportDebugLog";

/**
 * 画像保存の調べるための記録を、画面の下に出す（URL に debug=export があるときだけ。DESIGN.md 243章）。
 * スクリーンショットで送れるよう、新しい行を下に足して常に末尾を見せる。保存画像には写らない（保存の範囲の外・html2canvas の対象外）
 */
export function ExportDebugPanel() {
  const enabled = exportDebugEnabled();
  useEffect(() => {
    if (enabled) installExportDebug();
  }, [enabled]);
  const lines = useSyncExternalStore(subscribeExportDebugLog, exportDebugLines);
  const bodyRef = useRef<HTMLPreElement>(null);
  /** 記録の枠を画面の高さいっぱい近くまで広げる（1枚のスクリーンショットに多く入れるため） */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = body.scrollHeight;
  }, [lines, expanded]);
  if (!enabled) return null;
  return (
    <>
      {/* 記録の枠でページの末尾が隠れないよう、同じ高さの余白を足す */}
      <div className="export-debug-spacer" aria-hidden="true" />
      <div className={`export-debug-panel${expanded ? " export-debug-expanded" : ""}`} data-html2canvas-ignore="true">
      <div className="export-debug-head">
        <span>画像保存の記録（debug=export）</span>
        <span className="export-debug-actions">
          <button type="button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "縮める" : "広げる"}
          </button>
          <button type="button" onClick={clearExportDebugLog}>
            記録を消す
          </button>
        </span>
      </div>
      <pre ref={bodyRef} className="export-debug-body">
        {lines.length > 0 ? lines.join("\n") : "（まだ記録はありません。「画像として保存」を押してください）"}
      </pre>
      </div>
    </>
  );
}
