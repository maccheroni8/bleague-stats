import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * iPhone・iPad で、できた画像を画面いっぱいに出す（DESIGN.md 246・247章）。画面の下に「写真に保存」（共有シート）と「閉じる」を固定し、
 * そのすぐ上に、画像の長押し（「"写真"に追加」）でも保存できる案内。長い画像は、ボタンの上の範囲でスクロールして全体を見る
 * （ボタンは画像に重ならないので、スクロールの途中でも押せ、画像の下端〔基準日・アカウント名〕も隠れない）。
 * body の直下に出し（保存の範囲の外・html2canvas の対象外）、ページのスクロール位置や表の状態には触れない。閉じれば画面は保存前のまま
 */
export function ExportImagePreview({
  files,
  notice,
  onShare,
  onClose,
}: {
  /** できた画像（1枚。タブをまとめて保存するときは複数。縦に続けて出し、「写真に保存」で全部を渡す） */
  files: File[];
  /** 表示の中に出す案内（解像度を下げた・共有の画面を開けなかった など） */
  notice: string | null;
  /** 「写真に保存」。押した処理の中で、await を挟まずに共有シートを開く */
  onShare: () => void;
  onClose: () => void;
}) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="export-preview" role="dialog" aria-modal="true" aria-label="保存する画像" data-html2canvas-ignore="true">
      {notice && (
        <p className="export-preview-notice" role="status">
          {notice}
        </p>
      )}
      <div className="export-preview-scroll">
        {urls.map((url, i) => (
          <img key={url} className="export-preview-image" src={url} alt={`保存する画像${urls.length > 1 ? `（${i + 1}／${urls.length}）` : ""}`} />
        ))}
      </div>
      <div className="export-preview-footer">
        <p className="export-preview-hint">{files.length > 1 ? `${files.length}枚をまとめて保存します。` : ""}画像を長押しして「"写真"に追加」でも保存できます。</p>
        <div className="export-preview-bar">
          <button type="button" className="export-preview-save" onClick={onShare}>
            写真に保存
          </button>
          <button type="button" ref={closeRef} className="export-preview-close" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
