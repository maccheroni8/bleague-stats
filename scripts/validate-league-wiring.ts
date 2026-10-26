// リーグ（B.PREMIER／B.ONE）の通し忘れを洗い出す検証（DESIGN.md 297章）。
//
// 静的な確認（src/ のコードを TypeScript の構文木で読む）:
//   1. 読み込み: 引数に `league` を持つ関数（data.ts の fetch〜・gameIndexLoad.ts の load〜 など）を、league を渡さずに呼んでいる所。
//      B.ONE で見られるページ（leagueAvailability.ts の ready）から import でたどれるファイルにあれば失敗。たどれないファイルは「残り」として数だけ出す
//   2. data.ts の、シーズンごとの置き場所を読む関数が league を受けるか（`${dataBase}/${season}/` を直接書いていないか）
//   3. フックの依存: useJsonData・useMemo・useEffect・useCallback の中で league を使っているのに、依存の配列に league が無い所（全ファイル）
//   4. リンク: react-router-dom の Link・NavLink・useNavigate を直接使っている所（SeasonLink を通らず league が落ちる）。
//      ready のページからたどれるファイルにあれば失敗（許可の一覧 ALLOWED_RAW_LINKS を除く）。たどれないファイルは「残り」
//   5. 読み込みの使い回し（モジュールの中の Map<string, Promise<…>>）: そのファイルが leagueCacheKey で鍵にリーグを入れているか（全ファイル）
// 動かす確認:
//   6. data.ts の各関数・各 load〜 が、league "one" で data/{season}/one/ を、省略で data/{season}/ を読むか（fetch を差し替えて URL を見る）
//   7. URL・リンク・覚える鍵・リーグの切り替え・地区の並び・保存画像の見出しとファイル名の小さな関数
//
// 使い方: npm run validate:league-wiring（esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1。
// 残りの一覧を全部出すときは `-- --list-pending`、B.ONE で見られるページからたどれるファイルの一覧は `-- --list-ready-files`
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import ts from "typescript";
import { ONE_PAGE_AVAILABILITY, type LeaguePage } from "../src/lib/leagueAvailability";
import * as data from "../src/lib/data";
import * as gameIndexLoad from "../src/lib/gameIndexLoad";
import { loadSeasonPeriodSource } from "../src/lib/seasonPeriod";
import { loadTtsSource } from "../src/lib/teamTts";
import { loadTeamPeriodSource } from "../src/lib/teamPeriodTotals";
import { loadClassSplitSource } from "../src/lib/teamClassSplitLoad";
import { allTimeBaseDate } from "../src/lib/dataBaseDate";
import {
  applyLeagueToParams,
  isLeagueSeason,
  latestLeagueSeason,
  leagueCacheKey,
  leagueFromParams,
  leaguePageStateKey,
  leagueSwitchUrl,
  ONE_SEASONS,
} from "../src/lib/league";
import { withSeasonAndLeague } from "../src/components/SeasonLink";
import { divisionOrder, groupByDivision, seasonDivisions } from "../src/lib/divisionGroups";
import { exportHeadingLines, seasonsScope } from "../src/lib/exportHeading";
import { exportFilenameWithLeague } from "../src/lib/exportFormat";
import type { SeasonEntry, StandingsTeamSnapshot } from "../shared/types";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "src");
const listPending = process.argv.includes("--list-pending");
const listReadyFiles = process.argv.includes("--list-ready-files");

let failures = 0;
function fail(msg: string): void {
  failures++;
  console.error(`  ✗ ${msg}`);
}
function check(cond: boolean, msg: string): void {
  if (!cond) fail(msg);
}
function eq(actual: unknown, expected: unknown, msg: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${msg}: ${JSON.stringify(actual)}（期待 ${JSON.stringify(expected)}）`);
}

// ---------------------------------------------------------------------------
// ページとファイルの対応（App.tsx の Route）。ready のページは、このファイルから import でたどれる全ファイルを調べる
const PAGE_FILES: Record<LeaguePage, string> = {
  home: "src/pages/HomePage.tsx",
  teams: "src/pages/TeamsListPage.tsx",
  teamDetail: "src/pages/TeamDetailPage.tsx",
  players: "src/pages/PlayersListPage.tsx",
  playerDetail: "src/pages/PlayerDetailPage.tsx",
  schedule: "src/pages/SchedulePage.tsx",
  game: "src/pages/GameDetailPage.tsx",
  rankings: "src/pages/RankingsPage.tsx",
  compare: "src/pages/ComparePage.tsx",
  standings: "src/pages/StandingsPage.tsx",
  figures: "src/pages/FiguresPage.tsx",
  glossary: "src/pages/GlossaryPage.tsx",
};
/** どのページでも動く部品（ヘッダー・保存画像など）。ready のページと同じに扱う */
const ALWAYS_FILES = ["src/App.tsx", "src/components/LeagueGate.tsx"];

/**
 * league を渡さずに呼んでよい所（理由つき）。「ファイル:関数名」。B.ONE には無いデータ・リーグに関係しないデータだけ
 */
const ALLOWED_PREMIER_CALLS: Record<string, string> = {};

/** SeasonLink を通さないリンク・画面遷移でよい所（理由つき）。ファイル単位 */
const ALLOWED_RAW_LINKS: Record<string, string> = {
  "src/App.tsx": "リーグの切り替え（leagueSwitchUrl で league を書いた URL へ移る）",
  "src/lib/urlState.ts": "今の URL のクエリを書き換えるだけ（league はそのまま残る）",
  "src/components/SeasonLink.tsx": "league を引き継ぐ部品そのもの",
  "src/pages/TeamsListPage.tsx": "旧URLの転送（今の URL のクエリをそのまま引き継ぐので league も残る。記録タブは B.PREMIER だけ）",
};

/** 読み込みの使い回しのうち、リーグに関係しないもの（理由つき）。ファイル単位 */
const ALLOWED_CACHES: Record<string, string> = {
  "src/lib/pageStateCache.ts": "鍵は usePageState が leaguePageStateKey で作る",
};

// ---------------------------------------------------------------------------
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listSourceFiles(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.d\.ts$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join("/");
const files = listSourceFiles(SRC);
const sources = new Map<string, ts.SourceFile>();
for (const f of files) {
  sources.set(rel(f), ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS));
}

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = path.join(path.dirname(path.join(ROOT, from)), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    const r = rel(cand);
    if (sources.has(r)) return r;
  }
  return null;
}

function importsOf(file: string): string[] {
  const sf = sources.get(file)!;
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) {
      const r = resolveImport(file, n.moduleSpecifier.text);
      if (r) out.push(r);
    }
    // 遅れて読む部品（lazy(() => import("…"))）
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) {
      const r = resolveImport(file, n.arguments[0].text);
      if (r) out.push(r);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** たどらないファイル（まだ B.ONE で見られないページ。App.tsx はすべてのページを import するので、ページの中へはたどらない） */
function closureOf(entries: string[], skip: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...entries];
  while (stack.length > 0) {
    const f = stack.pop()!;
    if (seen.has(f) || !sources.has(f) || skip.has(f)) continue;
    seen.add(f);
    stack.push(...importsOf(f));
  }
  return seen;
}

const readyPages = (Object.keys(PAGE_FILES) as LeaguePage[]).filter((p) => ONE_PAGE_AVAILABILITY[p].ready);
const notReadyPageFiles = new Set((Object.keys(PAGE_FILES) as LeaguePage[]).filter((p) => !ONE_PAGE_AVAILABILITY[p].ready).map((p) => PAGE_FILES[p]));
const readyClosure = closureOf([...readyPages.map((p) => PAGE_FILES[p]), ...ALWAYS_FILES], notReadyPageFiles);

if (listReadyFiles) {
  for (const f of [...readyClosure].sort()) console.log(f);
  process.exit(0);
}

// ---- 1. league を受ける関数 ----
/** 関数名 → league の引数の位置（同じ名前の関数が別の位置に league を持つときは -1 にして、呼び出し側を調べない） */
const leagueFns = new Map<string, number>();
function leagueParamIndex(params: ts.NodeArray<ts.ParameterDeclaration>): number {
  return params.findIndex((p) => ts.isIdentifier(p.name) && p.name.text === "league");
}
for (const [, sf] of sources) {
  const visit = (n: ts.Node) => {
    let name: string | undefined;
    let params: ts.NodeArray<ts.ParameterDeclaration> | undefined;
    if (ts.isFunctionDeclaration(n) && n.name) {
      name = n.name.text;
      params = n.parameters;
    } else if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      name = n.name.text;
      params = n.initializer.parameters;
    }
    if (name && params) {
      const i = leagueParamIndex(params);
      if (i >= 0) {
        const prev = leagueFns.get(name);
        leagueFns.set(name, prev === undefined || prev === i ? i : -1);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

interface Missing {
  file: string;
  line: number;
  fn: string;
}
const missingCalls: Missing[] = [];
const enclosingFunctionName = (n: ts.Node): string => {
  for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) return p.name.text;
    if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
    if (ts.isMethodDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  }
  return "(top)";
};
for (const [file, sf] of sources) {
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) ? callee.name.text : undefined;
      const index = name ? leagueFns.get(name) : undefined;
      // 引数の並びに展開（...args）がある呼び出しは数えられないので調べない
      if (name && index !== undefined && index >= 0 && !n.arguments.some((a) => ts.isSpreadElement(a)) && n.arguments.length <= index) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
        if (!ALLOWED_PREMIER_CALLS[`${file}:${name}`]) missingCalls.push({ file, line, fn: `${name}（${enclosingFunctionName(n)} の中）` });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

console.log("1. 読み込みに league を渡しているか");
const readyMissing = missingCalls.filter((m) => readyClosure.has(m.file));
const pendingMissing = missingCalls.filter((m) => !readyClosure.has(m.file));
for (const m of readyMissing) fail(`${m.file}:${m.line} ${m.fn} に league を渡していない（B.ONE で見られるページからたどれるファイル）`);
console.log(`  B.ONE で見られるページ: ${readyPages.join("・")}（たどれるファイル ${readyClosure.size}）。league の渡し忘れ ${readyMissing.length}件`);
const pendingByFile = new Map<string, number>();
for (const m of pendingMissing) pendingByFile.set(m.file, (pendingByFile.get(m.file) ?? 0) + 1);
console.log(`  残り（まだ B.ONE で見られないページだけが使うファイル）: ${pendingMissing.length}件・${pendingByFile.size}ファイル`);
if (listPending) for (const m of pendingMissing) console.log(`    ${m.file}:${m.line} ${m.fn}`);
else for (const [f, n] of [...pendingByFile].sort((a, b) => b[1] - a[1])) console.log(`    ${f}: ${n}`);

// ---- 2. data.ts ----
console.log("2. data.ts のシーズンごとの読み込みが league を受けるか");
{
  const text = readFileSync(path.join(SRC, "lib/data.ts"), "utf8");
  // categoryBase（B.PREMIER と B.ONE の置き場所を分ける1か所）の中は除く
  const direct = text
    .split("\n")
    .map((l, i) => [l, i + 1] as const)
    .filter(([l]) => l.includes("${dataBase}/${season}") && !l.includes('league === "one" ?'));
  for (const [, line] of direct) fail(`src/lib/data.ts:${line} がシーズンの置き場所を直接書いている（categoryBase(season, league) を使う）`);
}

// ---- 3. フックの依存 ----
console.log("3. league を使うフックの依存に league があるか");
const HOOKS = new Set(["useJsonData", "useMemo", "useEffect", "useCallback", "useLayoutEffect"]);
function usesIdentifier(n: ts.Node, name: string): boolean {
  let found = false;
  const visit = (c: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(c) && c.text === name) {
      const p = c.parent;
      // obj.league（プロパティの名前）・{ league: … } の名前の側は数えない
      const isPropName = (ts.isPropertyAccessExpression(p) && p.name === c) || (ts.isPropertyAssignment(p) && p.name === c);
      if (!isPropName) found = true;
    }
    ts.forEachChild(c, visit);
  };
  visit(n);
  return found;
}
let hookChecked = 0;
for (const [file, sf] of sources) {
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOKS.has(n.expression.text) && n.arguments.length >= 2) {
      const [fn, deps] = n.arguments;
      if (fn && deps && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isArrayLiteralExpression(deps) && usesIdentifier(fn.body, "league")) {
        hookChecked++;
        const has = deps.elements.some((e) => ts.isIdentifier(e) && e.text === "league");
        if (!has) fail(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} ${n.expression.text} の中で league を使うのに、依存の配列に league が無い`);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}
console.log(`  league を使うフック ${hookChecked}か所`);

// ---- 4. リンク ----
console.log("4. SeasonLink を通らないリンク・画面遷移");
const rawLinkFiles: { file: string; names: string[] }[] = [];
for (const [file, sf] of sources) {
  const names: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || st.moduleSpecifier.text !== "react-router-dom") continue;
    const nb = st.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb)) continue;
    for (const el of nb.elements) {
      const imported = (el.propertyName ?? el.name).text;
      if (["Link", "NavLink", "useNavigate", "Navigate"].includes(imported) && !el.isTypeOnly) names.push(imported);
    }
  }
  if (names.length > 0 && !ALLOWED_RAW_LINKS[file]) rawLinkFiles.push({ file, names });
}
const readyRaw = rawLinkFiles.filter((r) => readyClosure.has(r.file));
for (const r of readyRaw) fail(`${r.file} が react-router-dom の ${r.names.join("・")} を直接使っている（SeasonLink を通さないと league が落ちる）`);
const pendingRaw = rawLinkFiles.filter((r) => !readyClosure.has(r.file));
console.log(`  B.ONE で見られるページからたどれるファイル: ${readyRaw.length}件。残り: ${pendingRaw.length}ファイル`);
for (const r of pendingRaw) console.log(`    ${r.file}: ${r.names.join("・")}`);

// ---- 5. 読み込みの使い回し ----
console.log("5. 読み込みの使い回し（Map<string, Promise<…>>）の鍵にリーグが入っているか");
let caches = 0;
for (const [file, sf] of sources) {
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      const init = d.initializer;
      if (!init || !ts.isNewExpression(init) || !ts.isIdentifier(init.expression) || init.expression.text !== "Map") continue;
      const typeText = (init.typeArguments ?? []).map((t) => t.getText(sf)).join(",") + (d.type ? d.type.getText(sf) : "");
      if (!/Promise</.test(typeText)) continue;
      caches++;
      if (ALLOWED_CACHES[file]) continue;
      if (!sf.getFullText().includes("leagueCacheKey(")) fail(`${file} の ${d.name.getText(sf)} の鍵にリーグが入っていない（leagueCacheKey を使う）`);
    }
  }
}
console.log(`  ${caches}か所`);

// ---- 6. 動かす確認: 読み込む場所 ----
console.log("6. 読み込む場所（data/{season}/one/）");
const requested: string[] = [];
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input);
  requested.push(url);
  // 中身は空の配列（形の確認はしない。どこを読みに行くかだけを見る）
  return new Response(gzipSync(Buffer.from("[]")), { status: 200, headers: { "content-encoding": "identity" } });
}) as typeof fetch;
// DecompressionStream は Node 18 以降にある。content-encoding が gzip でないときは展開して読む

async function urlsOf(call: () => Promise<unknown>): Promise<string[]> {
  requested.length = 0;
  try {
    await call();
  } catch {
    // 中身が空なので、後の処理で落ちる関数がある。読みに行った場所だけを見る
  }
  return [...requested];
}

const S = "2026-27";
type AnyFn = (...args: unknown[]) => Promise<unknown>;
const dataFns = Object.entries(data).filter(([name, fn]) => typeof fn === "function" && name.startsWith("fetch")) as [string, AnyFn][];
let dataChecked = 0;
for (const [name, fn] of dataFns) {
  const i = leagueFns.get(name);
  if (i === undefined || i < 0) continue;
  dataChecked++;
  const args: unknown[] = [S, "1", "2"].slice(0, i);
  while (args.length < i) args.push("1");
  const one = await urlsOf(() => fn(...args, "one"));
  const premier = await urlsOf(() => fn(...args));
  check(one.length > 0 && one.every((u) => u.includes(`/data/${S}/one/`)), `${name}(…, "one") が data/${S}/one/ を読んでいない: ${one.join(", ")}`);
  check(premier.length > 0 && premier.every((u) => u.includes(`/data/${S}/`) && !u.includes(`/data/${S}/one/`)), `${name}(…) が data/${S}/ を読んでいない: ${premier.join(", ")}`);
}
console.log(`  data.ts の ${dataChecked}関数`);
{
  const one = await urlsOf(() => allTimeBaseDate("regular", "one"));
  check(one.length > 0 && one.every((u) => u.includes("/one/")), `allTimeBaseDate（B.ONE）が B.ONE の置き場所だけを読んでいない: ${one.join(", ")}`);
}
const loaders: [string, (league?: "premier" | "one") => Promise<unknown>][] = [
  ["loadPlayerGameIndex", (l) => gameIndexLoad.loadPlayerGameIndex(S, l)],
  ["loadTeamGameIndex", (l) => gameIndexLoad.loadTeamGameIndex(S, l)],
  ["loadAssistPairs", (l) => gameIndexLoad.loadAssistPairs(S, l)],
  ["loadSeasonPeriodSource", (l) => loadSeasonPeriodSource(S, l)],
  ["loadTtsSource", (l) => loadTtsSource(S, l)],
  ["loadTeamPeriodSource", (l) => loadTeamPeriodSource(S, l)],
  ["loadClassSplitSource", (l) => loadClassSplitSource(S, l)],
];
for (const [name, call] of loaders) {
  const one = await urlsOf(() => call("one"));
  const premier = await urlsOf(() => call());
  check(one.length > 0 && one.every((u) => u.includes(`/data/${S}/one/`)), `${name}（B.ONE）が data/${S}/one/ を読んでいない: ${one.join(", ")}`);
  check(premier.length > 0 && premier.every((u) => !u.includes("/one/")), `${name}（B.PREMIER）が B.ONE の置き場所を読んでいる: ${premier.join(", ")}`);
}
console.log(`  読み込みの部品 ${loaders.length + 1}`);

// ---- 7. 小さな関数 ----
console.log("7. URL・リンク・覚える鍵・切り替え・地区の並び・保存画像");
const p = (q: string) => new URLSearchParams(q);
eq(leagueFromParams(p("season=2026-27")), "premier", "league が無ければ B.PREMIER");
eq(leagueFromParams(p("league=one")), "one", "league=one は B.ONE");
eq(leagueFromParams(p("league=b2")), "premier", "知らない値は B.PREMIER");
eq(leagueCacheKey(S, "premier"), S, "B.PREMIER の使い回しの鍵は今までどおり");
eq(leagueCacheKey(S, "one"), `one/${S}`, "B.ONE の使い回しの鍵");
eq(leaguePageStateKey("schedule:2026-27:view", "premier"), "schedule:2026-27:view", "B.PREMIER の覚える鍵は今までどおり");
eq(leaguePageStateKey("schedule:2026-27:view", "one"), "one:schedule:2026-27:view", "B.ONE の覚える鍵");
{
  const q = p("season=2026-27&league=premier");
  applyLeagueToParams(q, "one");
  eq(q.toString(), "season=2026-27", "リンク先の league=premier は書かない形に直す");
}
eq(withSeasonAndLeague("/teams/701", S, "one"), `/teams/701?season=${S}&league=one`, "B.ONE ではリンクに league=one を付ける");
eq(withSeasonAndLeague("/teams/701", S, "premier"), `/teams/701?season=${S}`, "B.PREMIER のリンクは今までどおり");
eq(withSeasonAndLeague("/glossary#oc", null, "one"), "/glossary?league=one#oc", "ページ内の位置はクエリの後ろ");
eq(withSeasonAndLeague("/players/1?season=2024-25", S, "one"), "/players/1?season=2024-25&league=one", "リンク先のシーズンはそのまま");
eq(withSeasonAndLeague("/players/1?league=premier", S, "one"), `/players/1?season=${S}`, "B.ONE の画面から B.PREMIER の画面へのリンク");
eq(withSeasonAndLeague("/", null, "premier"), "/", "season も league も無いリンク");
const seasons: SeasonEntry[] = ["2024-25", "2025-26", "2026-27"].map((season) => ({ season, coverage: "full", yahooPbp: true, hasCompletedGames: true }) as unknown as SeasonEntry);
eq(isLeagueSeason("one", "2025-26", seasons), false, "B.ONE の 2025-26（旧B2）は選べない");
eq(isLeagueSeason("one", "2026-27", seasons), true, "B.ONE の 2026-27 は選べる");
eq(latestLeagueSeason("one", seasons), ONE_SEASONS[ONE_SEASONS.length - 1], "B.ONE の初期のシーズン");
eq(leagueSwitchUrl("/teams/701", "2024-25", seasons, "one"), "/teams?season=2026-27&league=one", "チーム詳細で切り替えたら一覧へ（B.ONE に無いシーズンは初期のシーズン）");
eq(leagueSwitchUrl("/games/507275", S, seasons, "premier"), `/schedule?season=${S}`, "試合詳細で切り替えたら日程へ");
eq(leagueSwitchUrl("/players/30436", S, seasons, "one"), `/players/30436?season=${S}&league=one`, "選手詳細はそのまま");
eq(leagueSwitchUrl("/teams/stats", S, seasons, "one"), `/teams/stats?season=${S}&league=one`, "/teams/stats はチーム詳細ではない");
eq(divisionOrder("one"), ["north", "east", "central", "west", "south"], "B.ONE の地区の並び（北→東→中→西→南）");
eq(divisionOrder("premier"), ["east", "central", "west", "north", "south"], "B.PREMIER の地区の並びは今までどおり");
{
  const snap = (teamId: string, division: string, divisionRank: number) => ({ teamId, division, divisionRank }) as unknown as StandingsTeamSnapshot;
  const teams = [snap("a", "south", 1), snap("b", "east", 1), snap("c", "north", 1), snap("d", "west", 1), snap("e", "central", 1)];
  eq(groupByDivision(teams, "one").map((g) => g.division), ["north", "east", "central", "west", "south"], "B.ONE の地区のまとめの順");
  eq(groupByDivision(teams).map((g) => g.division), ["east", "central", "west", "north", "south"], "B.PREMIER の地区のまとめの順");
  const history = { premier: {}, one: { [S]: { a: "south", b: "east", c: "north" } } } as never;
  eq(seasonDivisions(history, S, "one"), ["north", "east", "south"], "B.ONE のシーズンの地区の並び");
}
eq(exportHeadingLines("2026-27シーズン 得点ランキング", "B.PREMIER"), { scope: "B.PREMIER 2026-27シーズン", name: "得点ランキング" }, "見出し: シーズン");
eq(exportHeadingLines("歴代 個人通算記録 得点ランキング", "B.ONE"), { scope: "B.ONE 歴代", name: "個人通算記録 得点ランキング" }, "見出し: 歴代");
eq(exportHeadingLines("通算（2020-21以降） On/Off", "B.PREMIER"), { scope: "B.PREMIER 通算（2020-21以降）", name: "On/Off" }, "見出し: 通算（期間つき）");
eq(exportHeadingLines("2026-27シーズンの記録", "B.PREMIER"), { scope: "B.PREMIER 2026-27シーズン", name: "記録" }, "見出し: シーズンの〜");
eq(exportHeadingLines("宇都宮 vs 千葉J", "B.PREMIER", seasonsScope(["2026-27", "2026-27"])), { scope: "B.PREMIER 2026-27シーズン", name: "宇都宮 vs 千葉J" }, "見出し: 比較");
eq(seasonsScope(["2026-27", "2024-25"]), "2024-25・2026-27シーズン", "比較の範囲（複数シーズン）");
eq(exportHeadingLines("ボックススコア：Traditional", "B.ONE"), { scope: "B.ONE", name: "ボックススコア：Traditional" }, "見出し: 範囲の無いもの");
eq(exportFilenameWithLeague("個人ランキング_2026-27_得点.png", "B.ONE"), "B.ONE_個人ランキング_2026-27_得点.png", "ファイル名にリーグ名");
eq(exportFilenameWithLeague("ORtg_DRtg_2026-27", "B.PREMIER"), "B.PREMIER_ORtg_DRtg_2026-27.png", "拡張子の無いファイル名");

// 保存画像のある部品の見出しが、範囲（シーズン・歴代・通算）か exportScope を持つか（範囲の無い見出しは1行目がリーグ名だけになる）
console.log("8. 保存画像の見出しの1行目");
{
  const exportFiles = [...sources.keys()].filter((f) => sources.get(f)!.getFullText().includes("<ExportImageButton"));
  for (const file of exportFiles) {
    const sf = sources.get(file)!;
    const visit = (n: ts.Node) => {
      if ((ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) && n.tagName.getText(sf) === "ConditionTitle") {
        const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
        const hasScope = attrs.some((a) => a.name.getText(sf) === "exportScope");
        const titleAttr = attrs.find((a) => a.name.getText(sf) === "title");
        const text = titleAttr?.initializer?.getText(sf) ?? "";
        // 見出しを作る変数（title・xxxTitle.title）の作り方は 7. の関数の確認と、各部品の見出しの決まり（シーズン・歴代・通算で始める）で担保する
        const ok = hasScope || /\{title\}|\{\w+Title\.title\}|シーズン|歴代|通算/.test(text);
        if (!ok) fail(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1} 保存画像の見出し ${text} に範囲が無い（exportScope を渡す）`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  console.log(`  保存画像のある部品 ${exportFiles.length}ファイル`);
}

if (failures > 0) {
  console.error(`\n食い違い ${failures}件`);
  process.exit(1);
}
console.log("\nすべて一致");
