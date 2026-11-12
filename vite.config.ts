import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Plugin } from "vite";
import { playerRecordPartPath, teamRecordPartPath, TEAM_RECORD_PART_TABLES, type PlayerRecordPartGroup } from "./src/lib/leagueRecordParts";

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

/** シーズン別の選手写真の台帳を置いたシーズン（`public/media/player-photos/{season}.json`）。置いていないシーズンは画面が取りに行かない。 */
function seasonPhotoSeasons(): string[] {
  const dir = `${projectRoot}/public/media/player-photos`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();
}

type RecordTables = Record<string, Record<string, unknown[]>>;

/**
 * 歴代の1試合記録の大きなファイルを、表ごとの小さなファイルに分けて dist/data/parts/ に書く（公開用のビルドだけ。DESIGN.md 355章）。
 * 元は同じビルドに入る data/ のファイルなので、中身は元のファイルと必ず一致する。元のファイルが無ければ何もしない（画面は元のファイルを読む）
 */
function leagueRecordParts(): Plugin {
  let outDir = "dist";
  return {
    name: "league-record-parts",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir.startsWith("/") ? config.build.outDir : join(projectRoot, config.build.outDir);
    },
    closeBundle() {
      const readGz = (name: string): Record<string, unknown> | null => {
        const file = join(projectRoot, "data", `${name}.json.gz`);
        if (!existsSync(file)) {
          console.warn(`[league-record-parts] ${name}.json.gz が無いので分けない`);
          return null;
        }
        return JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as Record<string, unknown>;
      };
      let count = 0;
      const write = (path: string, entries: unknown[]) => {
        const file = join(outDir, "data", `${path}.gz`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, gzipSync(JSON.stringify(entries)));
        count += 1;
      };
      const writeTables = (tables: RecordTables | undefined, path: (gameType: string, key: string) => string) => {
        for (const [gameType, byKey] of Object.entries(tables ?? {})) {
          for (const [key, entries] of Object.entries(byKey ?? {})) write(path(gameType, key), entries ?? []);
        }
      };
      const player = readGz("league-player-game-records");
      if (player) {
        writeTables(player.byGameType as RecordTables | undefined, (g, k) => playerRecordPartPath("all", g, k));
        const byClass = (player.byClassification ?? {}) as Record<string, RecordTables>;
        for (const group of ["jp", "intl"] as PlayerRecordPartGroup[]) {
          if (byClass[group]) writeTables(byClass[group], (g, k) => playerRecordPartPath(group, g, k));
        }
      }
      const team = readGz("league-team-rankings");
      if (team) {
        for (const table of TEAM_RECORD_PART_TABLES) writeTables(team[table] as RecordTables | undefined, (g, k) => teamRecordPartPath(table, g, k));
      }
      console.log(`[league-record-parts] ${count} 個の表のファイルを書いた`);
    },
  };
}

const BUILD_COMMIT = buildCommit();
const BUILD_TIME = new Date().toISOString();

export default defineConfig({
  base: "/bleague-stats/",
  define: {
    __MEDIA_CATALOG_SEASONS__: JSON.stringify(mediaCatalogSeasons()),
    __SEASON_PHOTO_SEASONS__: JSON.stringify(seasonPhotoSeasons()),
  },
  plugins: [
    react(),
    leagueRecordParts(),
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
