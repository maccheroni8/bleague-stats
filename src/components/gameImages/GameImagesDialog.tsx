// 試合詳細の「画像を保存（6枚）」の画面: 6枚の見本を並べ、選んだ画像をまとめて、または1枚ずつ保存する
import { useEffect, useMemo, useRef, useState } from "react";
import { downloadExportImage } from "../../lib/exportImage";
import { GAME_IMAGE_COUNT, buildGameImageModel, gameImageTitle, gameImageFilename, type GameImageInput } from "../../lib/gameImages/model";
import { loadLogoDataUrl, renderGameImage } from "../../lib/gameImages/render";
import { Page1Keys } from "./Page1Keys";
import { Page2Flow } from "./Page2Flow";
import { Page3Shots } from "./Page3Shots";
import { Page4Usage } from "./Page4Usage";
import { PageBox } from "./Page56Box";
import type { Logos } from "./parts";

const INDEXES = Array.from({ length: GAME_IMAGE_COUNT }, (_, i) => i);

export default function GameImagesDialog({ input, onClose }: { input: GameImageInput; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const model = useMemo(() => buildGameImageModel(input), [input]);
  const [logos, setLogos] = useState<Logos | null>(null);
  const [selected, setSelected] = useState<boolean[]>(() => INDEXES.map(() => true));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const homeId = model.home.id;
  const awayId = model.away.id;
  useEffect(() => {
    let alive = true;
    void Promise.all([loadLogoDataUrl(homeId), loadLogoDataUrl(awayId)]).then(([h, a]) => {
      if (alive) setLogos({ [homeId]: h, [awayId]: a });
    });
    return () => {
      alive = false;
    };
  }, [homeId, awayId]);

  const save = async (indexes: number[]) => {
    if (busy || indexes.length === 0) return;
    setBusy(true);
    setError(false);
    const converted: string[] = [];
    try {
      for (const [n, i] of indexes.entries()) {
        setNotice(`画像を作っています（${n + 1} / ${indexes.length}）`);
        const svg = pageRefs.current[i]?.querySelector("svg");
        if (!svg) throw new Error("画像の元が見つかりませんでした");
        const { blob, ext } = await renderGameImage(svg);
        if (ext === "jpg") converted.push(`${i + 1}枚目`);
        downloadExportImage(new File([blob], gameImageFilename(model, i, ext), { type: blob.type }));
        // 続けて保存すると、ブラウザが2枚目以降を止めることがあるので少し間を空ける
        if (n < indexes.length - 1) await new Promise((r) => setTimeout(r, 350));
      }
      setNotice(`${indexes.length}枚を保存しました` + (converted.length > 0 ? `（${converted.join("・")}は5MBを超えるためJPEGにしました）` : ""));
    } catch (e) {
      setError(true);
      setNotice(`保存できませんでした：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const chosen = INDEXES.filter((i) => selected[i]);
  const ready = logos !== null;
  const pages = ready
    ? [
        <Page1Keys key={0} model={model} logos={logos} />,
        <Page2Flow key={1} model={model} logos={logos} />,
        <Page3Shots key={2} model={model} logos={logos} />,
        <Page4Usage key={3} model={model} logos={logos} />,
        <PageBox key={4} model={model} logos={logos} side="home" />,
        <PageBox key={5} model={model} logos={logos} side="away" />,
      ]
    : [];

  return (
    <dialog ref={dialogRef} className="game-images-dialog" aria-labelledby="game-images-title" onClose={onClose} onCancel={onClose}>
      <div className="game-images-heading">
        <h2 id="game-images-title">画像を保存（6枚）</h2>
        <button type="button" onClick={onClose}>
          閉じる
        </button>
      </div>
      <p className="game-images-lead">縦長（2160×2700）の画像です。保存したい画像にチェックを付けて「まとめて保存」、または1枚ずつ保存できます。</p>
      <div className="game-images-actions">
        <button type="button" className="game-images-primary" disabled={!ready || busy || chosen.length === 0} onClick={() => void save(chosen)}>
          {chosen.length === GAME_IMAGE_COUNT ? "6枚まとめて保存" : `選んだ${chosen.length}枚を保存`}
        </button>
        <button type="button" disabled={busy} onClick={() => setSelected(INDEXES.map(() => chosen.length !== GAME_IMAGE_COUNT))}>
          {chosen.length === GAME_IMAGE_COUNT ? "すべて外す" : "すべて選ぶ"}
        </button>
        <span className={`game-images-notice${error ? " game-images-notice-error" : ""}`} role={error ? "alert" : "status"}>
          {notice}
        </span>
      </div>
      {!ready && <p className="loading">見本を用意しています...</p>}
      <div className="game-images-grid">
        {pages.map((page, i) => (
          <figure key={i} className="game-images-item">
            <div
              className="game-images-thumb"
              ref={(el) => {
                pageRefs.current[i] = el;
              }}
            >
              {page}
            </div>
            <figcaption>
              <label>
                <input
                  type="checkbox"
                  checked={selected[i] ?? false}
                  disabled={busy}
                  onChange={(e) => setSelected((prev) => prev.map((v, k) => (k === i ? e.target.checked : v)))}
                />
                <span>{gameImageTitle(i, model.home.name, model.away.name)}</span>
              </label>
              <button type="button" disabled={busy} onClick={() => void save([i])}>
                この1枚を保存
              </button>
            </figcaption>
          </figure>
        ))}
      </div>
    </dialog>
  );
}
