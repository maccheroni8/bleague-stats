import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, getSystemTheme, persistTheme, type Theme } from "../lib/theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme() ?? getSystemTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const label = theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え";

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => {
        const next: Theme = theme === "dark" ? "light" : "dark";
        setTheme(next);
        persistTheme(next);
      }}
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}
