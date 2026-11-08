import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// ページごとにプログラムを分けたあとも、CSS の並び（同じ強さの指定はあとのものが勝つ）を前と同じにするため、
// ページの部品が読む CSS は共通の CSS より前にここで読む（以前は App がページを読み込んだ順に、index.css より前に入っていた。DESIGN.md 356章）
import "./components/AnnualSchedule.css";
import "./figures/FigurePresets.css";
import "./pages/FiguresPage.css";
import "./index.css";
import { seedInitialPresets } from "./lib/figurePresets";

// 図の設定の保存に、選手の散布図の3つの設定をこのブラウザで1回だけ入れる（保存できない環境では何もしない）
seedInitialPresets();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
