import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { seedInitialPresets } from "./lib/figurePresets";

// 図の設定の保存に、選手の散布図の3つの設定をこのブラウザで1回だけ入れる（保存できない環境では何もしない）
seedInitialPresets();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
