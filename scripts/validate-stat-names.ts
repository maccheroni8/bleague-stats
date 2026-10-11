// 項目名（略称と日本語名。DESIGN.md 237章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 名前の定義は src/lib/statNames.ts の1か所。画面の列の定義（保存キーの対象のファイルを含む）は略称の文字列をそのまま持つので、
// 「定義と一致していること」「旧い別表記が画面に残っていないこと」をここで確かめる。
//  1. 辞書の整合: 略称が重複しない・旧い別表記が略称と衝突しない・読み替え先が略称・日本語名がチーム／選手の別ごとに重複しない
//  2. 列の見出し・項目の定義（全チームスタッツ・全選手スタッツ・試合詳細・比較・用語集・記録・通算）の略称が、すべて辞書に載っている
//  3. クラブレコード・通算記録など日本語名で持っている項目が、辞書の日本語名と一致する
//  4. 画面のソースに、旧い別表記が残っていない（label・列見出しの文字列）
//  5. 説明文（statDescriptions.ts）のキーに、旧い別表記が残っていない。辞書の略称を引いたとき、先頭に「日本語名（略称）」が付く
//
// 使い方: npm run validate:stat-names（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { STAT_ALIASES, STAT_NAMES, canonicalStatLabel, isStatAbbr, statGlossaryTitle, statJa } from "../src/lib/statNames.ts";
import { STAT_DESCRIPTIONS, statDescription } from "../src/lib/statDescriptions.ts";
import { PLAYER_STAT_DEFS, TEAM_STAT_DEFS } from "../src/lib/statDefs.ts";
import { SEASON_BOX_COLUMNS, seasonBoxColumnsFor } from "../src/lib/playerSeasonBoxscore.ts";
import { buildAdvancedColumns, buildMiscColumns, buildScoringColumns, buildTraditionalColumns } from "../src/lib/teamStatsColumns.ts";
import { teamBoxscoreColumnsFor } from "../src/lib/teamBoxscoreColumns.ts";
import { COLUMNS_BY_TAB, boxscoreColumnsFor } from "../src/components/BoxscoreTable.tsx";
import { PLAYER_GAME_RECORD_STATS } from "../shared/playerGameRecords.ts";
import { CAREER_TOTAL_DEFS, TEAM_AGAINST_RECORD_STATS, TEAM_RECORD_STATS } from "../shared/teamRecords.ts";
import { PLAYER_CAREER_TOTAL_DEFS } from "../shared/playerRecords.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

const abbrs = Object.keys(STAT_NAMES);
const aliasKeys = Object.keys(STAT_ALIASES);

// ---- 1. 辞書の整合 ----
check("略称が重複しない（オブジェクトのキーなので常に成り立つが、数を残す）", new Set(abbrs).size === abbrs.length, `${abbrs.length}項目`);
check(
  "旧い別表記が、略称と衝突しない",
  aliasKeys.every((k) => !isStatAbbr(k)),
  aliasKeys.filter((k) => isStatAbbr(k)).join("、"),
);
check(
  "旧い別表記の読み替え先が、略称（または「opp 」＋略称）である",
  aliasKeys.every((k) => {
    const to = STAT_ALIASES[k]!;
    return isStatAbbr(to) || (to.startsWith("opp ") && isStatAbbr(to.slice(4)));
  }),
  aliasKeys.filter((k) => {
    const to = STAT_ALIASES[k]!;
    return !(isStatAbbr(to) || (to.startsWith("opp ") && isStatAbbr(to.slice(4))));
  }).join("、"),
);
for (const scope of ["player", "team"] as const) {
  const seen = new Map<string, string>();
  const dup: string[] = [];
  for (const abbr of abbrs) {
    const ja = statJa(abbr, scope);
    const prev = seen.get(ja);
    if (prev !== undefined) dup.push(`${prev} と ${abbr}（${ja}）`);
    seen.set(ja, abbr);
  }
  check(`日本語名が重複しない（${scope === "player" ? "選手" : "チーム"}の表）`, dup.length === 0, dup.join("\n   "));
}
check(
  "日本語名が、ほかの項目の略称と同じ文字列にならない（名前だけが違う同じ値の扱いと混ざらない）",
  abbrs.every((a) => {
    const ja = statJa(a);
    return ja === a || !isStatAbbr(ja);
  }),
);

// ---- 2. 列の見出し・項目の定義 ----
type Labeled = { label?: string; header?: string };
const collected = new Map<string, Set<string>>();
const add = (source: string, items: readonly Labeled[]) => {
  for (const it of items) {
    const label = it.label ?? it.header;
    if (!label) continue;
    if (!collected.has(label)) collected.set(label, new Set());
    collected.get(label)!.add(source);
  }
};
add("TEAM_STAT_DEFS", TEAM_STAT_DEFS);
add("PLAYER_STAT_DEFS", PLAYER_STAT_DEFS);
for (const tab of Object.keys(SEASON_BOX_COLUMNS) as (keyof typeof SEASON_BOX_COLUMNS)[]) {
  add(`SEASON_BOX_COLUMNS:${tab}`, seasonBoxColumnsFor(tab, false));
  add(`SEASON_BOX_COLUMNS:${tab}（ファウル分割）`, seasonBoxColumnsFor(tab, true));
}
for (const tab of Object.keys(COLUMNS_BY_TAB) as (keyof typeof COLUMNS_BY_TAB)[]) {
  add(`試合詳細:${tab}`, boxscoreColumnsFor(tab, false));
  add(`試合詳細:${tab}（ファウル分割）`, boxscoreColumnsFor(tab, true));
  add(`チームの表:${tab}`, teamBoxscoreColumnsFor(tab, false));
  add(`チームの表:${tab}（ファウル分割）`, teamBoxscoreColumnsFor(tab, true));
}
for (const perspective of ["own", "opp", "diff"] as const) {
  add(`全チームスタッツ Traditional:${perspective}`, buildTraditionalColumns("perGame", perspective));
  add(`全チームスタッツ Advanced:${perspective}`, buildAdvancedColumns("perGame", perspective));
  for (const split of [false, true]) {
    add(`全チームスタッツ Misc:${perspective}`, (buildMiscColumns as (...a: unknown[]) => Labeled[])("perGame", perspective, split));
  }
  add(`全チームスタッツ Scoring:${perspective}`, (buildScoringColumns as (...a: unknown[]) => Labeled[])("perGame", perspective));
}
add("PLAYER_GAME_RECORD_STATS", PLAYER_GAME_RECORD_STATS);

// 日本語を含まない見出し（略称らしい文字列）は、辞書の略称・「opp 」＋略称・シュート種別でなければならない
const NON_ABBR_ALLOWED = new Set<string>(["Top 3"]);
const unknown: string[] = [];
for (const [label, sources] of collected) {
  if (/[^\x00-\x7F]/.test(label)) continue; // 日本語名の項目（勝率・平均得点・得失点 等）は対象外
  if (NON_ABBR_ALLOWED.has(label)) continue;
  if (isStatAbbr(label)) continue;
  if (label.startsWith("opp ") && isStatAbbr(label.slice(4))) continue;
  // シュート種別（英語表記）は statJa が日本語名を返す
  if (statJa(label) !== label) continue;
  unknown.push(`${label}（${[...sources].slice(0, 3).join("、")}）`);
}
check("列・項目の見出し（日本語を含まないもの）が、すべて辞書の略称・opp＋略称・シュート種別", unknown.length === 0, unknown.join("\n   "));
check(
  "列・項目の見出しに、旧い別表記が無い",
  [...collected.keys()].every((l) => !(l in STAT_ALIASES)),
  [...collected.keys()].filter((l) => l in STAT_ALIASES).join("、"),
);

// ---- 3. 日本語名で持っている項目が、辞書の日本語名と一致する ----
const TEAM_RECORD_ABBR: Record<string, string> = {
  pts: "PTS", oppPts: "opp PTS", fgm: "FGM", fga: "FGA", fgPct: "FG%", twoPm: "2PM", twoPa: "2PA", twoPct: "2P%",
  tpm: "3PM", tpa: "3PA", tpPct: "3P%", ftm: "FTM", fta: "FTA", ftPct: "FT%", oreb: "OR", dreb: "DR", reb: "TR",
  ast: "AST", tov: "TOV", stl: "STL", blk: "BLK", stocks: "STOCKS", pf: "F", fbps: "FBPS", pitp: "PITP",
  ptsOffTov: "PTSOFFTO", secondChancePts: "2ND PTS", foulsDrawn: "FD", dunks: "DUNK",
  benchPoints: "BENCH PTS", starterPoints: "STARTER PTS", japanesePoints: "日本人 PTS", internationalPoints: "外国籍・帰化・アジア PTS",
};
const PLAYER_CAREER_ABBR: Record<string, string> = {
  games: "G", minMinutes: "MIN", pts: "PTS", fgm: "FGM", fga: "FGA", twoPm: "2PM", twoPa: "2PA", tpm: "3PM", tpa: "3PA",
  ftm: "FTM", fta: "FTA", oreb: "OR", dreb: "DR", reb: "TR", ast: "AST", tov: "TOV", stl: "STL", blk: "BLK",
  stocks: "STOCKS", pf: "F", foulsDrawn: "FD", blockedAgainst: "BSR", plusMinus: "+/-", fbps: "FBPS", pitp: "PITP",
  secondChancePts: "2ND PTS", ptsOffTov: "PTSOFFTO", dunks: "DUNK", doubleDoubles: "DD2", tripleDoubles: "TD3",
};
function checkJa(title: string, defs: readonly { key: string; label: string }[], map: Record<string, string>, scope: "team" | "player") {
  const bad: string[] = [];
  let compared = 0;
  for (const d of defs) {
    const abbr = map[d.key];
    if (!abbr) continue;
    compared += 1;
    if (!isStatAbbr(abbr)) {
      bad.push(`${d.key}: 対応表の略称 ${abbr} が辞書に無い`);
      continue;
    }
    const ja = statJa(abbr, scope);
    // 相手の記録（被記録）の「得点」「失点」は、視点が逆なので辞書の名前と同じ文字列でよい
    if (d.label !== ja) bad.push(`${d.key}: 「${d.label}」 → 辞書は「${ja}」`);
  }
  check(`${title}: 日本語名が辞書と一致する（${compared}項目）`, bad.length === 0, bad.join("\n   "));
}
checkJa("クラブレコード・1試合（TEAM_RECORD_STATS）", TEAM_RECORD_STATS, TEAM_RECORD_ABBR, "team");
checkJa("被記録（TEAM_AGAINST_RECORD_STATS）", TEAM_AGAINST_RECORD_STATS.filter((d) => d.key !== "pts" && d.key !== "oppPts"), TEAM_RECORD_ABBR, "team");
checkJa("チームの通算記録（CAREER_TOTAL_DEFS）", CAREER_TOTAL_DEFS, TEAM_RECORD_ABBR, "team");
checkJa("個人の通算記録（PLAYER_CAREER_TOTAL_DEFS）", PLAYER_CAREER_TOTAL_DEFS.filter((d) => d.key !== "games" && d.key !== "minMinutes"), PLAYER_CAREER_ABBR, "player");

// ---- 4. 画面のソースに、旧い別表記が残っていない ----
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const SRC = path.resolve(process.cwd(), "src"); // npm run はリポジトリのルートで実行する
const SOURCE_EXEMPT = new Set(["lib/statNames.ts"]);
// label: "X" / label="X" / >X<（見出しの文字列）/ statDescription("X")
const found: string[] = [];
for (const file of walk(SRC)) {
  const rel = path.relative(SRC, file).replaceAll(path.sep, "/");
  if (SOURCE_EXEMPT.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    const code = line.replace(/\/\/.*$/, "");
    for (const alias of aliasKeys) {
      const esc = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const patterns = [
        new RegExp(`label\\s*[:=]\\s*["'\`]${esc}["'\`]`),
        new RegExp(`>\\s*${esc}\\s*<`),
        new RegExp(`statDescription\\(\\s*["'\`]${esc}["'\`]`),
        new RegExp(`StatTile label="${esc}"`),
      ];
      if (patterns.some((p) => p.test(code))) found.push(`${rel}:${i + 1}  ${alias}  → ${STAT_ALIASES[alias]}`);
    }
  });
}
check("画面のソースに、旧い別表記が残っていない", found.length === 0, found.join("\n   "));

// ---- 5. 説明文 ----
check(
  "説明文のキーに、旧い別表記が残っていない",
  Object.keys(STAT_DESCRIPTIONS).every((k) => !(k in STAT_ALIASES)),
  Object.keys(STAT_DESCRIPTIONS).filter((k) => k in STAT_ALIASES).join("、"),
);
const ptsTip = statDescription("PTS");
check("ツールチップの先頭に「日本語名（略称）」が付く（PTS）", ptsTip === "得点（PTS）", String(ptsTip));
const rebTip = statDescription("REB");
check("旧い別表記（REB）で引いても、TR の説明が出る", rebTip === statDescription("TR") && !!rebTip, String(rebTip));
const pmTeam = statDescription("+/-", "team");
check("+/- はチームと選手で日本語名が変わる", !!pmTeam?.startsWith("得失点差（+/-）") && !!statDescription("+/-", "player")?.startsWith("出場中の得失点差（+/-）"));
check("用語集の見出し（PTS）は「得点（PTS）」", statGlossaryTitle("PTS") === "得点（PTS）", statGlossaryTitle("PTS"));
check("用語集の見出し（辞書に無い項目）は、そのまま", statGlossaryTitle("勝率") === "勝率");
check("旧い別表記の日本語名（Usage%）は ユーセージ%", statJa("Usage%") === "ユーセージ%", statJa("Usage%"));
check("opp 付きの日本語名（opp TR）は 相手のリバウンド", statJa("opp TR", "team") === "相手のリバウンド", statJa("opp TR", "team"));
check("opp PTS は 失点", statJa("opp PTS", "team") === "失点");
check("シュート種別（Jump Shot 2PM）は ジャンプショット 2ポイント成功数", statJa("Jump Shot 2PM") === "ジャンプショット 2ポイント成功数", statJa("Jump Shot 2PM"));
check("canonicalStatLabel: 略称・知らない文字列はそのまま", canonicalStatLabel("PTS") === "PTS" && canonicalStatLabel("勝率") === "勝率");

// 辞書の略称のうち、説明文の無いもの（参考。失敗にはしない）
const noDesc = abbrs.filter((a) => statDescription(a) === undefined);
console.log(`参考: 説明文の無い略称 ${noDesc.length} 件${noDesc.length > 0 ? `（${noDesc.join("、")}）` : ""}`);

console.log(failures === 0 ? "\nすべて ok" : `\n${failures} 件が NG`);
process.exitCode = failures === 0 ? 0 : 1;
