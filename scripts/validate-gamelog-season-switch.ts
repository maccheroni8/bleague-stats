// 個人詳細の試合ログで、シーズン（・選手・リーグ）を切り替えたときに、前の条件の読み込み結果が
// 今の表示に混ざらないことの検証（DESIGN.md 342章）。
//
// 1. useJsonData の `discardStale`: 結果を取得したときの条件が今の条件と同じときだけ使う（sameDeps）
// 2. PlayerDetailPage.tsx の静的な確認（TypeScript の構文木で読む）:
//    - 選手・シーズン・リーグごとに読む useJsonData（fetchPlayerGameLogs・fetchGameSummaries・fetchTeamGameLogs）は discardStale を付ける
//    - 試合ログのボックススコア・シーズンのショットチャートの読み込みの effect は、条件が変わったときに前の読み込みの結果を捨てる
//      （effect が cleanup 関数を返し、then の中で取り消し済みかを見る）
//    - 通算の読み込みは、選手・リーグが変わったときに前の読み込みの結果を捨てる（careerGenerationRef）
//
// 使い方: npm run validate:gamelog-season-switch。1つでも食い違いがあれば終了コード1
import { readFileSync } from "node:fs";
import ts from "typescript";
import { sameDeps } from "../src/lib/useJsonData";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) {
    failures += 1;
    console.error(`NG ${name}${detail ? `: ${detail}` : ""}`);
  } else {
    console.log(`ok ${name}`);
  }
}

// 1. 条件の比較
check("同じ条件", sameDeps(["2026-27", "10815", "premier"], ["2026-27", "10815", "premier"]));
check("シーズンが違う", !sameDeps(["2026-27", "10815", "premier"], ["2025-26", "10815", "premier"]));
check("選手が違う", !sameDeps(["2026-27", "10815", "premier"], ["2026-27", "10816", "premier"]));
check("リーグが違う", !sameDeps(["2026-27", "10815", "premier"], ["2026-27", "10815", "one"]));
check("長さが違う", !sameDeps(["a"], ["a", "b"]));

// 2. 静的な確認
const file = "src/pages/PlayerDetailPage.tsx";
const text = readFileSync(file, "utf8");
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

const STRICT_FETCHERS = ["fetchPlayerGameLogs", "fetchGameSummaries", "fetchTeamGameLogs"];
const strictCalls: { fetcher: string; ok: boolean; line: number }[] = [];
const effects: { node: ts.CallExpression; line: number }[] = [];
function visit(node: ts.Node): void {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
    const name = node.expression.text;
    if (name === "useJsonData") {
      const fetcherText = node.arguments[0]?.getText(source) ?? "";
      const used = STRICT_FETCHERS.filter((f) => fetcherText.includes(`${f}(`));
      // 通算（全シーズン）は effect 側。ここは「いまのシーズンの選手・試合」を読むものだけ
      const depsText = node.arguments[1]?.getText(source) ?? "";
      if (used.length > 0 && /\bseason\b/.test(depsText)) {
        const opt = node.arguments[2]?.getText(source) ?? "";
        strictCalls.push({
          fetcher: used.join("+"),
          ok: /discardStale:\s*true/.test(opt),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        });
      }
    }
    if (name === "useEffect") effects.push({ node, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 });
  }
  ts.forEachChild(node, visit);
}
visit(source);

check("今のシーズンの読み込みが3つ見つかる", strictCalls.length >= 3, `${strictCalls.length}件`);
for (const c of strictCalls) check(`discardStale: ${c.fetcher} (${file}:${c.line})`, c.ok);

function effectReturnsCleanup(marker: string): { found: boolean; ok: boolean } {
  const target = effects.find((e) => e.node.arguments[0]?.getText(source).includes(marker));
  if (!target) return { found: false, ok: false };
  const body = target.node.arguments[0]!.getText(source);
  return { found: true, ok: /let cancelled = false/.test(body) && /return \(\) => \{\s*cancelled = true;?\s*\}/.test(body) && /if \(!cancelled\)/.test(body) };
}
for (const [label, marker] of [
  ["試合ログのボックススコアの読み込みは条件が変わると結果を捨てる", "setGameBoxLoading(true)"],
  ["シーズンのショットチャートの読み込みは条件が変わると結果を捨てる", "setSeasonShotChartLoading(true)"],
] as const) {
  const r = effectReturnsCleanup(marker);
  check(label, r.found && r.ok, r.found ? "取り消しの処理が足りない" : "effect が見つからない");
}
check("通算の読み込みは選手・リーグが変わると結果を捨てる", (text.match(/generation (===|!==) careerGenerationRef\.current/g) ?? []).length >= 8);
check("選手・リーグが変わるたびに careerGenerationRef を進める", /careerGenerationRef\.current \+= 1/.test(text));

if (failures > 0) {
  console.error(`\n${failures}件の食い違い`);
  process.exit(1);
}
console.log("\nすべて一致");
