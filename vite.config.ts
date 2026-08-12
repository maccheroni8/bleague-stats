import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

export default defineConfig({
  plugins: [react()],
  // devサーバーの起動プロセスがこのプロジェクトの親ディレクトリを作業ディレクトリにしているため、
  // Viteのデフォルトfs.allow判定に外れてしまう。プロジェクトルートを明示的に許可する。
  server: {
    fs: {
      strict: false,
      allow: [projectRoot],
    },
  },
});
