// CLIとして直接実行されたかどうかを判定する。
// パスに空白・日本語・記号を含むディレクトリでも正しく比較できるよう pathToFileURL を使う
// （`file://${process.argv[1]}` の単純結合はURLエンコードされず一致しないバグを踏んだため）。

import { pathToFileURL } from "node:url";

export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return moduleUrl === pathToFileURL(entry).href;
}
