// 2026-27シーズンの新競技規則（DESIGN.md 16章）に伴う、公式データの表記・コード変更の検知。
//
// B.LEAGUEは新競技規則（ディスラプティブ/フレグラント、テクニカルのカテゴリ1/2）を9/22開幕から
// 先行適用するが、公式の記録システム改修が間に合わないため、当面は旧名称のまま配信される。
// 改修完了後に新表記へ一括更新される予定で、その時期は未定。このスクリプトは日次cronで
// 「新表記への移行」や「ActionCD1コードの変更」に気づくための警報（トリップワイヤ）で、
// 異常を検知すると終了コード1で終了する（GitHub Actionsの失敗ステータスとして通知される）。
//
// 検知する内容（いずれも異常＝要確認）:
//  A. 新語彙: PlayTextに「ディスラプティブ」「フレグラント」「カテゴリ1/2」等が出現した
//  B. 未知のActionCD1: 過去10シーズンの実データで確認済みのコード集合に無いコードが出現した
//  C. テキストとコードの不一致: 「テクニカル」「アンスポーツマン」「ディスクォリファイング」を含む
//     PlayTextのActionCD1が、集計で使っているコード（24/20/21・25・26。boxscoreAggregate.ts）と
//     異なる。文言は旧名称のままコードだけ変わった場合に、UFOUL/TF集計が静かに欠落するのを防ぐ
//  D. 急な0件化: 直近の試合でTF/UFOUL等のイベント（ActionCD1=24・25・20・21）が統計的にあり得ない
//     ほど出ていない（コードの意味変更や新コードへの移行で、旧コードのイベントが消えた場合）
//
// A〜Cは「この実行の対象範囲」（既定: 直近--since-hours時間以内に取得/変更された試合。
// --allで当該シーズンの全試合）だけを見る。Dは対象範囲に関わらず、直近の試合を日付順に見る。
//
// 使い方:
//   node --experimental-strip-types scripts/check-rule-change.ts --season 2026-27
//   node --experimental-strip-types scripts/check-rule-change.ts --season 2026-27 --all   # 全試合を走査
//
// 開幕後の実データ確認（DESIGN.md 16-4章）にも使えるよう、対象範囲でのテクニカル/アンスポーツマン系の
// PlayText（ActionCD1別）の集計を常に出力する。

import { appendFileSync } from "node:fs";
import { currentSeason } from "./lib/season.ts";
import { readAllGames } from "./lib/storage.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { Category, StoredGame } from "../shared/types.ts";

/** 2016-17〜2025-26の全試合（B.PREMIER/B.ONE）で実際に出現したActionCD1の全集合（2026-09-19時点）＋
 * DESIGN.md 2-4章で確定済みの90（タイムアウト） */
const KNOWN_ACTION_CD1: ReadonlySet<number> = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 31, 80, 81, 82, 83, 84,
  85, 86, 87, 88, 89, 90,
]);

/** 新規則の新語彙（A）。全角数字の「カテゴリ１」等の表記ゆれも拾う */
const NEW_VOCABULARY = /ディスラプ|フレグラ|カテゴリ\s*[1-2１-２]/;

/** 旧名称の語彙と、それを集計で使っているActionCD1（C）。boxscoreAggregate.tsのbuildMiscEventCounts・
 * countTechnicalFoulsと対応させること */
const OLD_TERM_CODES: { term: string; codes: readonly number[]; label: string }[] = [
  { term: "テクニカル", codes: [20, 21, 24], label: "テクニカルファウル（TF）" },
  { term: "アンスポーツマン", codes: [25], label: "アンスポーツマンファウル（UFOUL）" },
  { term: "ディスクォリファイング", codes: [26], label: "ディスクォリファイングファウル（DQFOUL）" },
];

/** 急な0件化（D）の監視対象。windowGamesは、過去10シーズンの1試合あたり発生率の実績
 * （24: 0.15〜0.21、25: 0.20〜0.56、20: 0.05〜0.13、21: 0.04〜0.11）の下限側で、直近windowGames試合の
 * 期待発生数が約7件（0件になる確率0.1%未満）になる試合数 */
const ZERO_WATCH: { code: number; label: string; windowGames: number }[] = [
  { code: 24, label: "選手個人のテクニカルファウル（TF）", windowGames: 47 },
  { code: 25, label: "アンスポーツマンファウル（UFOUL）", windowGames: 35 },
  { code: 20, label: "コーチテクニカルファウル", windowGames: 140 },
  { code: 21, label: "ベンチテクニカルファウル", windowGames: 175 },
];

const DEFAULT_SINCE_HOURS = 48;
const MAX_ALERT_SAMPLES = 5;

interface Alert {
  kind: "new-vocabulary" | "unknown-action-cd1" | "text-code-mismatch" | "zero-events";
  message: string;
}

interface GameRef {
  category: Category;
  game: StoredGame;
}

function isRecentlyChanged(game: StoredGame, sinceMs: number): boolean {
  const changedAt = Math.max(Date.parse(game.meta.firstScrapedAt), Date.parse(game.meta.lastChangedAt));
  return Number.isFinite(changedAt) && changedAt >= sinceMs;
}

function ref(g: GameRef): string {
  return `${g.category}:${g.game.scheduleKey}(${g.game.date})`;
}

/** 選手番号・選手名・(ファウル数)・後続のフリースロー指示を落として、判定名の部分だけを取り出す */
function normalizePlayText(text: string): string {
  const m = /(テクニカル\S*ファウル|アンスポーツマン\S*ファウル|ディスクォリファイング\S*ファウル|ディスラプ\S*|フレグラ\S*|カテゴリ\s*\S+)/.exec(
    text,
  );
  return m ? m[1]! : text.slice(0, 20);
}

export interface CheckResult {
  alerts: Alert[];
  summaryLines: string[];
}

/** 純粋関数（ファイル入出力を含まない）。テストしやすいよう試合の配列を受け取る */
export function checkRuleChange(games: GameRef[], scanTargets: GameRef[]): CheckResult {
  const alerts: Alert[] = [];
  const summaryLines: string[] = [];

  // A・B・C: 対象範囲の全イベントを走査
  const newVocabSamples: string[] = [];
  const unknownCodes = new Map<number, string[]>();
  const mismatchSamples = new Map<string, string[]>();
  const labelCounts = new Map<string, number>();
  let newVocabCount = 0;

  for (const target of scanTargets) {
    for (const ev of target.game.raw.PlayByPlays) {
      const text = String(ev.PlayText ?? "");
      if (NEW_VOCABULARY.test(text)) {
        newVocabCount++;
        if (newVocabSamples.length < MAX_ALERT_SAMPLES) newVocabSamples.push(`${ref(target)} ActionCD1=${ev.ActionCD1} 「${text}」`);
      }
      if (!KNOWN_ACTION_CD1.has(ev.ActionCD1)) {
        const samples = unknownCodes.get(ev.ActionCD1) ?? [];
        if (samples.length < MAX_ALERT_SAMPLES) samples.push(`${ref(target)} 「${text}」`);
        unknownCodes.set(ev.ActionCD1, samples);
      }
      for (const { term, codes } of OLD_TERM_CODES) {
        if (!text.includes(term)) continue;
        // 「テクニカル」は「テクニカルタイムアウト」等、ファウル以外の語にも含まれうる。ファウルの判定名に限定する
        if (!text.includes("ファウル")) continue;
        const key = `${term}|${ev.ActionCD1}`;
        const label = `ActionCD1=${ev.ActionCD1} ${normalizePlayText(text)}`;
        labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
        if (!codes.includes(ev.ActionCD1)) {
          const samples = mismatchSamples.get(key) ?? [];
          if (samples.length < MAX_ALERT_SAMPLES) samples.push(`${ref(target)} 「${text}」`);
          mismatchSamples.set(key, samples);
        }
      }
    }
  }

  if (newVocabCount > 0) {
    alerts.push({
      kind: "new-vocabulary",
      message:
        `PlayTextに新規則の新語彙（ディスラプティブ/フレグラント/カテゴリ1・2）が${newVocabCount}件出現しました。` +
        `公式の記録システム改修が完了し、新表記へ移行し始めた可能性があります（DESIGN.md 16章）。` +
        `例: ${newVocabSamples.join(" / ")}`,
    });
  }
  for (const [code, samples] of unknownCodes) {
    alerts.push({
      kind: "unknown-action-cd1",
      message: `未知のActionCD1=${code}が出現しました（既知のコード集合に無い）。新規則に伴う新コードの可能性があります。例: ${samples.join(" / ")}`,
    });
  }
  for (const [key, samples] of mismatchSamples) {
    const [term, code] = key.split("|");
    alerts.push({
      kind: "text-code-mismatch",
      message:
        `PlayTextに「${term}」を含むファウルがあるのに、ActionCD1=${code}（集計対象のコードではない）で記録されています。` +
        `UFOUL/TF/DQFOULの集計から漏れている恐れがあります。例: ${samples.join(" / ")}`,
    });
  }

  // D: 直近の試合（日付順）で、監視対象コードが急に0件になっていないか
  const finished = games
    .filter((g) => g.game.gameEndedFlg)
    .sort((a, b) => (a.game.date === b.game.date ? Number(a.game.scheduleKey) - Number(b.game.scheduleKey) : a.game.date < b.game.date ? -1 : 1));
  for (const watch of ZERO_WATCH) {
    if (finished.length < watch.windowGames) {
      summaryLines.push(`ActionCD1=${watch.code}（${watch.label}）: 終了試合${finished.length}件で、判定に必要な${watch.windowGames}件に未達のため0件化チェックは保留`);
      continue;
    }
    const recent = finished.slice(-watch.windowGames);
    const count = recent.reduce(
      (sum, g) => sum + g.game.raw.PlayByPlays.filter((ev) => ev.ActionCD1 === watch.code).length,
      0,
    );
    summaryLines.push(`ActionCD1=${watch.code}（${watch.label}）: 直近${watch.windowGames}試合で${count}件`);
    if (count === 0) {
      alerts.push({
        kind: "zero-events",
        message:
          `直近${watch.windowGames}試合（${ref(recent[0]!)}〜${ref(recent[recent.length - 1]!)}）でActionCD1=${watch.code}` +
          `（${watch.label}）が0件です。過去10シーズンの発生率では0件になる確率が0.1%未満で、コードの意味変更・新コードへの移行の恐れがあります。` +
          `このままだと集計値が静かに欠落します（DESIGN.md 16-2章）`,
      });
    }
  }

  // 開幕後の実データ確認（DESIGN.md 16-4章）用: 対象範囲の判定名の内訳
  summaryLines.push(`走査した試合: ${scanTargets.length}件（シーズン全体${games.length}件）`);
  if (labelCounts.size === 0) {
    summaryLines.push("対象範囲にテクニカル/アンスポーツマン/ディスクォリファイング系のファウルは無し");
  } else {
    for (const [label, count] of [...labelCounts.entries()].sort()) summaryLines.push(`${label}: ${count}件`);
  }

  return { alerts, summaryLines };
}

function parseArgs(argv: string[]): { season: string; all: boolean; sinceHours: number } {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sinceHours = Number(get("--since-hours") ?? DEFAULT_SINCE_HOURS);
  if (!Number.isFinite(sinceHours) || sinceHours <= 0) throw new Error("--since-hoursには正の数を指定してください");
  return { season: get("--season") ?? currentSeason(), all: argv.includes("--all"), sinceHours };
}

async function main(): Promise<void> {
  const { season, all, sinceHours } = parseArgs(process.argv.slice(2));
  const categories: Category[] = ["premier", "one"];
  const games: GameRef[] = [];
  for (const category of categories) {
    for (const game of await readAllGames(season, category)) games.push({ category, game });
  }
  if (games.length === 0) {
    console.log(`[check-rule-change] ${season}: 試合データがまだ無いためスキップします`);
    return;
  }

  const sinceMs = Date.now() - sinceHours * 60 * 60 * 1000;
  const scanTargets = all ? games : games.filter((g) => isRecentlyChanged(g.game, sinceMs));
  const { alerts, summaryLines } = checkRuleChange(games, scanTargets);

  console.log(`[check-rule-change] ${season}（${all ? "全試合" : `直近${sinceHours}時間に取得/変更された試合`}）`);
  for (const line of summaryLines) console.log(`  ${line}`);

  const summaryPath = process.env["GITHUB_STEP_SUMMARY"];
  if (summaryPath) {
    const md = [
      `### 新競技規則の検知（${season}）`,
      ...summaryLines.map((l) => `- ${l}`),
      alerts.length > 0 ? `\n**⚠ 異常 ${alerts.length}件**\n${alerts.map((a) => `- [${a.kind}] ${a.message}`).join("\n")}` : "\n異常なし",
      "",
    ].join("\n");
    appendFileSync(summaryPath, md);
  }

  if (alerts.length === 0) {
    console.log("[check-rule-change] 異常なし");
    return;
  }
  for (const a of alerts) console.log(`::error title=新競技規則の検知 [${a.kind}]::${a.message}`);
  console.error(`[check-rule-change] 異常を${alerts.length}件検知しました。DESIGN.md 16章を参照して対応してください`);
  process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
