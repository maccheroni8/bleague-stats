import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

/** ビルドしたコミット（公開サイトがどのコミットの内容かを確かめるため。画面には出さず、HTMLのmetaタグに埋め込む。DESIGN.md 198章） */
function buildCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { cwd: projectRoot, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return process.env.GITHUB_SHA ?? "unknown";
  }
}

/** 対応表を置いたシーズン（`public/media/catalog/{season}.json`）。置いていないシーズンは画面が取りに行かない（設計書257章）。 */
function mediaCatalogSeasons(): string[] {
  const dir = `${projectRoot}/public/media/catalog`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
}

const BUILD_COMMIT = buildCommit();
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  base: "/bleague-stats/",
  define: {
    __MEDIA_CATALOG_SEASONS__: JSON.stringify(mediaCatalogSeasons()),
  },
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
