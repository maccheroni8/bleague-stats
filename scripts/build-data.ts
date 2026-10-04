// 導出データ（B。scripts/lib/dataLayout.ts）を、元データ（A）から作る。デプロイ（.github/workflows/deploy.yml）と、手元で画面を確認するときの両方で使う（DESIGN.md 206章）。
//
// 使い方:
//   npm run build:data                                 全シーズンのシーズンごとの集計 → 全シーズンをまたぐ集計
//   npm run build:data -- --season 2026-27             そのシーズン（と、導出データがまだ無いシーズン）→ 全シーズンをまたぐ集計
//   npm run build:data -- --season 2026-27 --season-only   そのシーズンのシーズンごとの集計だけ（全体は作らない。デプロイの過去シーズンの作成用）
//   npm run build:data -- --cross-only                 全シーズンをまたぐ集計だけ
//   npm run build:data -- --if-missing                 導出データが無いシーズン・全体だけ作る（npm run dev の起動前に自動で呼ぶ）
//   npm run build:data -- --clean                      導出データをすべて消してから作る
//   npm run build:data -- plan                         デプロイ用: 現在のシーズンと、過去シーズンごとの保存キーを出力する
//   npm run build:data -- key 2024-25                  そのシーズンの保存キー（元データ・シーズンをまたいで読む元データ・集計のコードの内容から作る）
//   npm run build:data -- export 2024-25 <出力先>       そのシーズンの導出データを <出力先>/data/ 以下に写す（デプロイの保存・受け渡し用）
//   npm run build:data -- clean                        導出データをすべて消す（デプロイは、リポジトリに残っている導出データに左右されないよう、作る前に必ず呼ぶ）
//   npm run build:data -- check-layout                 data/ の全ファイルが A か B に仕分け済みかを確かめる
//   npm run build:data -- check-staged                 ステージ済み（git add 済み）の data/ のファイルに、導出データ・仕分け外が混ざっていないかを確かめる（夜間実行のコミット前）
//
// シーズンごとの集計: aggregate（B.PREMIER と、あれば B.ONE）→ 選手の1試合の記録（シーズン）→ 比較用のリーグ平均
// 全シーズンをまたぐ集計: 収録シーズンの一覧 → チーム歴代 → キャリア → 個人歴代 → 選手の1試合の記録（歴代）

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentSeason } from "./lib/season.ts";
import { isMainModule } from "./lib/isMain.ts";
import {
  BUILD_CODE_PATHS,
  GLOBAL_DERIVED_ENTRIES,
  SEASON_BUILD_GLOBAL_INPUTS,
  SEASON_DIR_PATTERN,
  SEASON_RAW_ENTRIES,
  classifyDataPath,
  derivedGitignorePatterns,
  seasonDerivedPaths,
} from "./lib/dataLayout.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");

/** 生データ（games/）が1件でもある収録シーズン（古い順） */
function seasonsWithGames(): string[] {
  return readdirSync(DATA, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .filter((s) => hasGameFiles(path.join(DATA, s, "games")))
    .sort();
}

function hasGameFiles(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith(".json.gz"));
}

function hasOne(season: string): boolean {
  return hasGameFiles(path.join(DATA, season, "one", "games"));
}

function seasonBuilt(season: string): boolean {
  return existsSync(path.join(DATA, season, "teams.json.gz"));
}

// ---- 保存キー ----

function listFiles(abs: string): string[] {
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return [abs];
  const out: string[] = [];
  for (const name of readdirSync(abs).sort()) {
    if (name === ".DS_Store") continue;
    out.push(...listFiles(path.join(abs, name)));
  }
  return out;
}

/** BUILD_CODE_PATHS の1項目から、対象のファイルを集める（"scripts/aggregate" のように存在しない名前は、同じ場所で名前がその文字で始まるものすべて） */
function codeFiles(rel: string): string[] {
  const abs = path.join(ROOT, rel);
  if (existsSync(abs)) return listFiles(abs);
  const dir = path.dirname(abs);
  const prefix = path.basename(abs);
  return existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith(prefix)).sort().flatMap((n) => listFiles(path.join(dir, n))) : [];
}

export function seasonKey(season: string): string {
  const files: string[] = [];
  for (const base of [path.join(DATA, season), path.join(DATA, season, "one")]) {
    for (const e of SEASON_RAW_ENTRIES) files.push(...listFiles(path.join(base, e)));
  }
  for (const e of SEASON_BUILD_GLOBAL_INPUTS) files.push(...listFiles(path.join(DATA, e)));
  for (const c of BUILD_CODE_PATHS) files.push(...codeFiles(c));
  const hash = createHash("sha256");
  for (const f of files) {
    hash.update(`${path.relative(ROOT, f)}\0`);
    hash.update(createHash("sha256").update(readFileSync(f)).digest());
  }
  return hash.digest("hex").slice(0, 32);
}

// ---- 作成 ----

interface StepTiming {
  label: string;
  seconds: number;
}
const timings: StepTiming[] = [];

function run(label: string, command: string, args: string[]): void {
  const started = Date.now();
  console.log(`\n▶ ${label}`);
  const r = spawnSync(command, args, { cwd: ROOT, stdio: "inherit" });
  const seconds = (Date.now() - started) / 1000;
  timings.push({ label, seconds });
  if (r.status !== 0) {
    console.error(`✗ 失敗: ${label}（終了コード ${r.status ?? "なし"}）`);
    process.exit(1);
  }
}

function node(label: string, script: string, ...args: string[]): void {
  run(label, process.execPath, ["--experimental-strip-types", path.join("scripts", script), ...args]);
}

function buildSeason(season: string): void {
  node(`${season} 集計`, "aggregate.ts", "--season", season);
  if (hasOne(season)) node(`${season} B.ONE 集計`, "aggregate.ts", "--season", season, "--category", "one");
  node(`${season} 選手の1試合の記録`, "aggregate-player-game-records.ts", "--season", season);
  run(`${season} 比較用のリーグ平均`, "npm", ["run", "--silent", "aggregate:league-compare", "--", "--season", season]);
}

function buildCross(): void {
  node("収録シーズンの一覧・選手ごとの最新シーズン", "aggregate.ts", "--index-only");
  node("チーム歴代記録", "aggregate-league-rankings.ts");
  node("選手のキャリア", "aggregate-player-careers.ts");
  node("個人歴代記録", "aggregate-league-player-rankings.ts");
  node("選手の1試合の記録（歴代）", "aggregate-league-player-game-records.ts");
}

function cleanDerived(): void {
  for (const e of GLOBAL_DERIVED_ENTRIES) rmSync(path.join(DATA, e), { force: true });
  for (const entry of readdirSync(DATA, { withFileTypes: true })) {
    if (!entry.isDirectory() || !SEASON_DIR_PATTERN.test(entry.name)) continue;
    for (const p of seasonDerivedPaths(DATA, entry.name)) rmSync(p, { recursive: true, force: true });
  }
}

// ---- 仕分けの確認 ----

function walk(abs: string, rel: string, out: string[]): void {
  for (const e of readdirSync(abs, { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    // 仕分けは先頭の階層で決まる（中身は見ない）ものは、ディレクトリ単位で確認する
    if (e.isDirectory()) {
      if (classifyDataPath(childRel) !== "unknown") continue;
      walk(path.join(abs, e.name), childRel, out);
    } else if (classifyDataPath(childRel) === "unknown") {
      out.push(childRel);
    }
  }
}

function checkLayout(): boolean {
  let ok = true;
  const unknown: string[] = [];
  walk(DATA, "", unknown);
  if (unknown.length > 0) {
    ok = false;
    console.error("A（元データ）にも B（導出データ）にも仕分けされていないファイルがあります。scripts/lib/dataLayout.ts に書き足してください:");
    for (const u of unknown.slice(0, 30)) console.error(`  data/${u}`);
    if (unknown.length > 30) console.error(`  …ほか${unknown.length - 30}件`);
  }
  const gitignorePath = path.join(ROOT, ".gitignore");
  const text = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
  const begin = "# BEGIN 導出データ";
  const end = "# END 導出データ";
  if (text.includes(begin)) {
    const block = text.slice(text.indexOf(begin) + begin.length, text.indexOf(end)).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
    const expected = derivedGitignorePatterns();
    if (JSON.stringify(block) !== JSON.stringify(expected)) {
      ok = false;
      console.error(".gitignore の「導出データ」の並びが、scripts/lib/dataLayout.ts と合っていません。`npm run build:data -- print-gitignore` の出力に置き換えてください");
    }
  } else {
    console.log("（.gitignore にまだ「導出データ」の並びがありません）");
  }
  if (ok) console.log("data/ の全ファイルが A か B に仕分け済みです");
  return ok;
}

// ---- 入口 ----

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0] && !args[0].startsWith("--") ? args[0] : undefined;

  if (sub === "clean") {
    cleanDerived();
    console.log("導出データをすべて消しました");
    return;
  }
  if (sub === "check-staged") {
    const r = spawnSync("git", ["diff", "--cached", "--name-only", "-z", "--", "data"], { cwd: ROOT, encoding: "utf-8" });
    if (r.status !== 0) throw new Error("git diff --cached に失敗しました");
    const bad = r.stdout.split("\0").filter(Boolean).map((f) => f.replace(/^data\//, "")).filter((rel) => {
      const kind = classifyDataPath(rel);
      return kind === "derived" || kind === "unknown";
    });
    if (bad.length > 0) {
      console.error("コミットに入れてはいけないファイル（導出データ、または仕分け外）がステージされています:");
      for (const b of bad.slice(0, 30)) console.error(`  data/${b}`);
      process.exitCode = 1;
    } else {
      console.log("ステージ済みのファイルは元データだけです");
    }
    return;
  }
  if (sub === "check-layout") {
    if (!checkLayout()) process.exitCode = 1;
    return;
  }
  if (sub === "print-gitignore") {
    console.log([`${"# BEGIN 導出データ"}（scripts/lib/dataLayout.ts から作る。手で直さない。デプロイのときに npm run build:data で作る）`, ...derivedGitignorePatterns(), "# END 導出データ"].join("\n"));
    return;
  }
  if (sub === "key") {
    const season = args[1];
    if (!season) throw new Error("使い方: build-data.ts key 2024-25");
    console.log(seasonKey(season));
    return;
  }
  if (sub === "plan") {
    const current = currentSeason();
    const past = seasonsWithGames().filter((s) => s < current);
    const matrix = { include: past.map((season) => ({ season, key: seasonKey(season) })) };
    console.log(JSON.stringify({ current, ...matrix }, null, 2));
    const out = process.env.GITHUB_OUTPUT;
    if (out) {
      await appendFile(out, `current=${current}\nmatrix=${JSON.stringify(matrix)}\n`);
    }
    return;
  }
  if (sub === "export") {
    const season = args[1];
    const outDir = args[2];
    if (!season || !outDir) throw new Error("使い方: build-data.ts export 2024-25 <出力先>");
    let n = 0;
    for (const p of seasonDerivedPaths(DATA, season)) {
      if (!existsSync(p)) continue;
      const dest = path.join(path.resolve(outDir), "data", path.relative(DATA, p));
      mkdirSync(path.dirname(dest), { recursive: true });
      cpSync(p, dest, { recursive: true });
      n += 1;
    }
    console.log(`${season}: ${n}件を ${outDir}/data/ に写しました`);
    return;
  }
  if (sub) throw new Error(`知らないサブコマンド: ${sub}`);

  if (args.includes("--clean")) cleanDerived();

  const started = Date.now();
  const seasonIdx = args.indexOf("--season");
  const only = seasonIdx >= 0 ? args[seasonIdx + 1] : undefined;
  const ifMissing = args.includes("--if-missing");
  const all = seasonsWithGames();
  let targets: string[];
  if (only) {
    if (!all.includes(only)) throw new Error(`生データがあるシーズンではありません: ${only}`);
    // 指定したシーズンのほかに、導出データがまだ無いシーズンも作る（全体の集計が全シーズンを読むため）
    targets = args.includes("--season-only") ? [only] : all.filter((s) => s === only || !seasonBuilt(s));
  } else if (ifMissing) {
    targets = all.filter((s) => !seasonBuilt(s));
  } else {
    targets = all;
  }
  const crossOnly = args.includes("--cross-only");
  const seasonOnly = args.includes("--season-only");
  if (!crossOnly) for (const s of targets) buildSeason(s);
  const crossMissing = GLOBAL_DERIVED_ENTRIES.some((e) => !existsSync(path.join(DATA, e)));
  const needCross = !seasonOnly && (!ifMissing || targets.length > 0 || crossMissing);
  if (needCross) buildCross();
  else if (ifMissing) console.log("導出データは作成済みです");

  const total = (Date.now() - started) / 1000;
  console.log(`\n== 所要時間 ==`);
  for (const t of timings) console.log(`${t.seconds.toFixed(1).padStart(6)}秒  ${t.label}`);
  console.log(`${total.toFixed(1).padStart(6)}秒  合計`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
