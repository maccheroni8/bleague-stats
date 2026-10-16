/** 任意で実画像を照合する読み取り専用アダプター。取得・変換・保存は行わない。 */
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { MediaCatalog } from "../../shared/mediaCatalog.ts";
import { validateMediaCatalog, validMediaPath, type MediaFileObservation, type MediaIssue } from "../../shared/mediaCatalogValidation.ts";

export async function validateMediaFiles(catalog: MediaCatalog, root: string): Promise<MediaIssue[]> {
  const observed: MediaFileObservation[] = [];
  const issues: MediaIssue[] = [];
  let realRoot: string;
  try { realRoot = await realpath(root); }
  catch { return [...validateMediaCatalog(catalog), { code: "invalid-root", location: root, message: "画像ルートを読み取れません" }]; }
  for (const a of catalog.assets) {
    if (!validMediaPath(a.path)) continue;
    try {
      const actual = await realpath(path.resolve(realRoot, a.path));
      const relative = path.relative(realRoot, actual);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        issues.push({ code: "outside-root", location: a.path, message: "画像の参照先が指定ルート外です" });
        continue;
      }
      if (!(await stat(actual)).isFile()) throw new Error("not a file");
      observed.push({ path: a.path, sha256: createHash("sha256").update(await readFile(actual)).digest("hex") });
    } catch {
      issues.push({ code: "unreadable-file", location: a.path, message: "画像ファイルが存在しないか読み取れません" });
    }
  }
  return [...validateMediaCatalog(catalog, observed), ...issues];
}
