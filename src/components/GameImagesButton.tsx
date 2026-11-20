// 試合詳細の「画像」ボタン。画像の部品は、押したときに初めて読み込む
import { useSaveMenuEntry } from "./SaveMenu";
import { Suspense, lazy, useState } from "react";
import type { GameImageInput } from "../lib/gameImages/model";

const Dialog = lazy(() => import("./gameImages/GameImagesDialog"));

export function GameImagesButton({ input }: { input: GameImageInput }) {
  const [open, setOpen] = useState(false);
  const saveEntry = useSaveMenuEntry({ label: "画像（6枚）", order: 0, onSelect: () => setOpen(true) });
  return (
    <>
      {saveEntry}
      {open && (
        <Suspense fallback={<span className="game-images-loading">読み込み中...</span>}>
          <Dialog input={input} onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
