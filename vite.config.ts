import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const projectRoot = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

/** ビルドしたコミット（公開サイトがどのコミットの内容かを確かめるため。画面には出さず、HTMLのmetaタグに埋め込む。DESIGN.md 198章） */
function buildCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GITHUB_SHA ?? "unknown";
  }
}

const BUILD_COMMIT = buildCommit();
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  base: "/bleague-stats/",
  plugins: [
    react(),
    {
      name: "build-info-meta",
      transformIndexHtml: () => [
        { tag: "meta", attrs: { name: "build-commit", content: BUILD_COMMIT }, injectTo: "head" },
        { tag: "meta", attrs: { name: "build-time", content: BUILD_TIME }, injectTo: "head" },
      ],
    },
  ],
  // devサーバーの起動プロセスがこのプロジェクトの親ディレクトリを作業ディレクトリにしているため、
  // Viteのデフォルトfs.allow判定に外れてしまう。プロジェクトルートを明示的に許可する。
  server: {
    fs: {
      strict: false,
      allow: [projectRoot],
    },
  },
});
