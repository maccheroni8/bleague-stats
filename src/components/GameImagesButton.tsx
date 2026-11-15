// 試合詳細の「画像を保存（6枚）」ボタン。画像の部品は、押したときに初めて読み込む
import { Suspense, lazy, useState } from "react";
import type { GameImageInput } from "../lib/gameImages/model";

const Dialog = lazy(() => import("./gameImages/GameImagesDialog"));

export function GameImagesButton({ input }: { input: GameImageInput }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="game-images-button-row">
      <button type="button" className="export-image-button" onClick={() => setOpen(true)}>
        画像を保存（6枚）
      </button>
      {open && (
        <Suspense fallback={<span className="game-images-loading">読み込み中...</span>}>
          <Dialog input={input} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
