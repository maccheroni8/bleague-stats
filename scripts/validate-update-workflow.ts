// 更新のワークフロー（.github/workflows/update-stats.yml）で、B.ONE の取得が B.PREMIER の更新を止めない形になっているかの検証（DESIGN.md 14章・8-9）。
// 書き方そのものの正しさは actionlint が見る。ここでは並びと条件の約束だけを、ファイルの行から確かめる（外のサイトに問い合わせない）。
//
// - B.ONE の判定・取得のステップ（名前に「B.ONE」があり「Fail if」で始まらないもの）は continue-on-error: true と timeout-minutes を持つ
//   （判定のステップは問い合わせをしないので timeout-minutes は要らない）
// - B.ONE の取得のステップは、B.PREMIER の日程・ボックススコア・スポーツナビの取得より後、コミットより前にある
// - B.PREMIER の取得のステップの条件は proceed の premier、B.ONE の取得のステップの条件は proceed の one を見る。コミットは run を見る
// - B.ONE のステップは --category one を付けて実行する
// - B.ONE のステップの失敗は、always() 付きの「Fail if B.ONE …」のステップで通知される
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}

interface Step {
  name: string;
  id?: string;
  if?: string;
  continueOnError: boolean;
  timeout: boolean;
  body: string;
  index: number;
}

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".github", "workflows", "update-stats.yml");
const lines = readFileSync(file, "utf-8").split("\n");
const steps: Step[] = [];
let cur: Step | null = null;
for (const line of lines) {
  const start = /^ {6}- (?:name|uses): (.*)$/.exec(line);
  if (start) {
    cur = { name: start[1]!.trim(), continueOnError: false, timeout: false, body: "", index: steps.length };
    steps.push(cur);
    continue;
  }
  if (!cur) continue;
  if (/^ {0,5}\S/.test(line)) {
    cur = null;
    continue;
  }
  const id = /^ {8}id: (\S+)/.exec(line);
  if (id) cur.id = id[1];
  const cond = /^ {8}if: (.*)$/.exec(line);
  if (cond) cur.if = cond[1];
  if (/^ {8}continue-on-error: true\s*$/.test(line)) cur.continueOnError = true;
  if (/^ {8}timeout-minutes: \d+/.test(line)) cur.timeout = true;
  cur.body += `${line}\n`;
}

const byId = new Map(steps.filter((s) => s.id).map((s) => [s.id!, s]));
const oneSteps = steps.filter((s) => s.name.includes("B.ONE") && !s.name.startsWith("Fail if"));
const oneFetch = oneSteps.filter((s) => s.id !== "check_one");
const premierFetchIds = ["schedule_full", "schedule_recent", "boxscore_new", "boxscore_nightly"];
const yahoo = steps.find((s) => s.name.startsWith("Scrape Yahoo PBP"));
const commit = byId.get("commit");

check("B.ONE の判定のステップ（check_one）がある", byId.has("check_one"));
check("B.ONE の取得のステップが4つある（日程のフル・直近、ボックススコアの新着・深夜）", oneFetch.length === 4, oneFetch.map((s) => s.id).join(", "));
for (const s of oneSteps) {
  check(`${s.name}: continue-on-error`, s.continueOnError);
  check(`${s.name}: --category one を付けて実行`, /--category one\b/.test(s.body));
}
for (const s of oneFetch) {
  check(`${s.name}: timeout-minutes がある`, s.timeout);
  check(`${s.name}: 条件が proceed の one を見る`, (s.if ?? "").includes("steps.proceed.outputs.one == 'true'"), s.if);
  check(`${s.name}: B.PREMIER の取得とスポーツナビより後`, premierFetchIds.every((id) => (byId.get(id)?.index ?? Infinity) < s.index) && !!yahoo && yahoo.index < s.index);
  check(`${s.name}: コミットより前`, !!commit && s.index < commit.index);
  const notified = steps.some((f) => f.name.startsWith("Fail if B.ONE") && (f.if ?? "").includes("always()") && (f.if ?? "").includes(`steps.${s.id}.outcome == 'failure'`));
  check(`${s.name}: 失敗が「Fail if B.ONE …」で通知される`, notified);
}
{
  const s = byId.get("check_one");
  const notified = steps.some((f) => f.name.startsWith("Fail if B.ONE") && (f.if ?? "").includes("always()") && (f.if ?? "").includes("steps.check_one.outcome == 'failure'"));
  check("B.ONE の判定の失敗が通知される", !!s && notified);
}
for (const id of premierFetchIds) {
  const s = byId.get(id);
  check(`B.PREMIER の ${id}: 条件が proceed の premier を見る`, !!s && (s.if ?? "").includes("steps.proceed.outputs.premier == 'true'"), s?.if);
  check(`B.PREMIER の ${id}: B.ONE を指定していない`, !!s && !/--category/.test(s.body));
}
check("スポーツナビの取得は B.PREMIER の条件で動く", !!yahoo && (yahoo.if ?? "").includes("steps.proceed.outputs.premier == 'true'"), yahoo?.if);
check("コミットは proceed の run を見る", !!commit && (commit.if ?? "") === "steps.proceed.outputs.run == 'true'", commit?.if);
{
  const proceed = byId.get("proceed");
  check("proceed が run・premier・one を出す", !!proceed && ["run=", "premier=", "one="].every((k) => proceed.body.includes(`echo "${k}`)));
}
// B.ONE の判定の結果を読むのは proceed だけ（B.PREMIER の判定・取得が B.ONE の判定に左右されない）
{
  const readers = steps.filter((s) => s.id !== "proceed" && (s.body + (s.if ?? "")).includes("steps.check_one.outputs"));
  check("B.ONE の判定の結果を読むのは proceed だけ", readers.length === 0, readers.map((s) => s.name).join(", "));
}

if (failed > 0) {
  console.error(`\n${failed}件の確認が通りませんでした`);
  process.exitCode = 1;
} else {
  console.log("\nすべての確認が通りました");
}
