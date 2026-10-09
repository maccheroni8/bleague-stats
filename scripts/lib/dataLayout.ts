// data/ 配下のファイルを、コミットに残す元データ（A）と、デプロイのときに元データから作る導出データ（B）に仕分ける（DESIGN.md 206章）。
//
// - A（元データ）: スクレイピングで取得した記録、固定した値（1月15日の身長・体重など）、取得時点の記録（在籍中の選手名簿・日程のティップオフ時刻・
//   見張りの一覧など）。作り直せないのでコミットに残す
// - B（導出データ）: 元データから、毎回同じ結果を作り直せるもの（試合の集計・ランキングなど）。コミットせず（.gitignore）、デプロイのときに
//   `npm run build:data` で作る。手元で画面を確認するときも同じコマンドで作る
//
// 新しい種類のファイルを data/ に足すときは、ここに A か B かを書く。書かないと `npm run build:data -- check-layout` が失敗する。
// .gitignore の B の並びもここと同じにする（check-layout が突き合わせる）。

import path from "node:path";

export const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;

/** シーズンのディレクトリ（data/{season}/ と data/{season}/one/）にある元データ（A） */
export const SEASON_RAW_ENTRIES = ["games", "yahoo", "schedule.json.gz"] as const;

/** シーズンのディレクトリ（data/{season}/ と data/{season}/one/）にある導出データ（B）。ディレクトリは中身ごと */
export const SEASON_DERIVED_ENTRIES = [
  "assist-pairs.json.gz",
  "games-summary.json.gz",
  "head-to-head.json.gz",
  "league-average.json.gz",
  "league-compare.json.gz",
  "lineups",
  "period-averages.json.gz",
  "player-game-index.json.gz",
  "player-game-records.json.gz",
  "player-games",
  "player-period-index.json.gz",
  "players.json.gz",
  "playoff-race.json.gz",
  "registered-players.json.gz",
  "standings-history.json.gz",
  "team-game-index.json.gz",
  "team-games",
  "team-period-index.json.gz",
  "team-stints",
  "teams.json.gz",
] as const;

/**
 * SEASON_DERIVED_ENTRIES のうち、シーズンによっては作られないもの（作成済みかの判定から外す）。
 * team-stints は 2020-21 以降だけ（2019-20 以前は実際のポゼッションの元になる交代の記録が使えない。DESIGN.md 204章）。
 * ここに足すのは、シーズンによって作られないと分かっているものだけ。作られるはずのファイルを足すと、作成漏れに気付けなくなる
 */
export const SEASON_OPTIONAL_DERIVED_ENTRIES = ["team-stints"] as const;

/** data/ 直下の元データ（A） */
export const GLOBAL_RAW_ENTRIES = [
  "club-honors.json.gz",
  "current-roster.json.gz",
  "division-history.json.gz",
  "game-watchlist-snapshots.json.gz",
  "game-watchlist.json",
  "logos",
  "player-awards.json.gz",
  "player-club-history.json.gz",
  "player-history.json.gz",
  "player-photos",
  "player-photos-manifest.json.gz",
  "players-master.json.gz",
  "season-positions.json.gz",
  "season-profiles.json.gz",
  "season-rosters.json.gz",
  "season-rules.json.gz",
  "team-colors.json.gz",
  "team-history.json.gz",
] as const;

/** data/ 直下の導出データ（B）。全シーズンをまたぐ集計 */
export const GLOBAL_DERIVED_ENTRIES = [
  "league-player-career-top.json.gz",
  "league-player-game-records.json.gz",
  "league-player-rankings.json.gz",
  "league-team-rankings.json.gz",
  "player-careers.json.gz",
  "player-page-seasons.json.gz",
  "rookie-eligibility.json.gz",
  "seasons.json.gz",
] as const;

/** シーズンごとの集計の元データのうち、シーズンをまたいで読む元データ（シーズンごとの集計結果の保存キーに含める） */
export const SEASON_BUILD_GLOBAL_INPUTS = [
  "club-honors.json.gz",
  "current-roster.json.gz",
  "division-history.json.gz",
  "player-awards.json.gz",
  "players-master.json.gz",
  "season-positions.json.gz",
  "season-profiles.json.gz",
  "season-rosters.json.gz",
  "season-rules.json.gz",
] as const;

/**
 * 保存キーに含める集計のコード。シーズンごとの集計の入口のスクリプトと、そこから import でたどれるファイルすべて（画面のコードは、入口からたどれたものだけ）、
 * と package-lock.json。これらの内容が変わったら、保存した過去シーズンの集計結果は作り直す。
 * 全シーズンをまたぐ集計（歴代ランキングなど）は毎回作るので、ここには含めない
 */
export const BUILD_CODE_ENTRIES = [
  "scripts/build-data.ts",
  "scripts/aggregate.ts",
  "scripts/aggregate-player-game-records.ts",
  "scripts/aggregate-game-index.ts",
  "scripts/aggregate-period-index.ts",
  "scripts/aggregate-league-compare.ts",
] as const;
export const BUILD_CODE_EXTRA_FILES = ["package-lock.json"] as const;

export type FileKind = "raw" | "derived" | "unknown";

const IGNORED_NAMES = new Set([".DS_Store"]);

/** data/ からの相対パス（区切りは / ）を A か B に仕分ける。無視するファイル（.DS_Store）は "ignored" */
export function classifyDataPath(rel: string): FileKind | "ignored" {
  const parts = rel.split("/").filter(Boolean);
  if (parts.length === 0) return "unknown";
  if (IGNORED_NAMES.has(parts[parts.length - 1]!)) return "ignored";
  const [head, ...rest] = parts as [string, ...string[]];
  if (SEASON_DIR_PATTERN.test(head)) {
    let entries = rest;
    if (entries[0] === "one") entries = entries.slice(1);
    if (entries.length === 0) return "unknown";
    const top = entries[0]!;
    if ((SEASON_RAW_ENTRIES as readonly string[]).includes(top)) return "raw";
    if ((SEASON_DERIVED_ENTRIES as readonly string[]).includes(top)) return "derived";
    if (top === "one") return "unknown";
    return "unknown";
  }
  if ((GLOBAL_RAW_ENTRIES as readonly string[]).includes(head)) return "raw";
  if ((GLOBAL_DERIVED_ENTRIES as readonly string[]).includes(head)) return "derived";
  return "unknown";
}

/** .gitignore に書く B のパターン（data/ 直下からの絶対パターン） */
export function derivedGitignorePatterns(): string[] {
  const patterns: string[] = [];
  for (const e of GLOBAL_DERIVED_ENTRIES) patterns.push(`/data/${e}`);
  for (const e of SEASON_DERIVED_ENTRIES) {
    const entry = e.endsWith(".gz") ? e : `${e}/`;
    patterns.push(`/data/*/${entry}`);
    patterns.push(`/data/*/one/${entry}`);
  }
  return patterns;
}

/**
 * そのシーズンの導出データが作成済みか（`build-data.ts --if-missing`＝`npm run dev` の起動前の自動作成の判定）。
 * SEASON_DERIVED_ENTRIES の**すべて**（SEASON_OPTIONAL_DERIVED_ENTRIES を除く）があること。特定のファイル1つの有無で見ない
 * （それだと、後から導出データの種類を足したときに、作成済みと判定されて新しいファイルが作られない。2026-10-09）。
 * 返すのは足りないファイルの名前（空なら作成済み）
 */
export function missingSeasonDerived(dataDir: string, season: string, exists: (p: string) => boolean): string[] {
  const optional = new Set<string>(SEASON_OPTIONAL_DERIVED_ENTRIES);
  return SEASON_DERIVED_ENTRIES.filter((e) => !optional.has(e) && !exists(path.join(dataDir, season, e)));
}

export function seasonDerivedPaths(dataDir: string, season: string): string[] {
  const out: string[] = [];
  for (const base of [path.join(dataDir, season), path.join(dataDir, season, "one")]) {
    for (const e of SEASON_DERIVED_ENTRIES) out.push(path.join(base, e));
  }
  return out;
}
