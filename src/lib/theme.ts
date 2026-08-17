// index.htmlの初期化スクリプトと同じキーを使う（そちらはFOUC防止のためReactマウント前に
// localStorageを読んで<html>にdata-theme属性を設定する。キーがずれると初期表示とReact側の
// 状態が食い違うので変更時は両方を揃えること）
const STORAGE_KEY = "bleague-stats-theme";

export type Theme = "light" | "dark";

export function getStoredTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === "light" || value === "dark" ? value : null;
}

export function getSystemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function persistTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
}
