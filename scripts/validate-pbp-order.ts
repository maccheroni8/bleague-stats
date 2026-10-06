// PBPの並べ替え（shared/pbpOrder.ts。DESIGN.md 212章）の検証スクリプト（検証専用。CIには入れず、必要なときに手で実行する）。
//
// 全シーズン・全試合（B.PREMIER・B.ONE）について、次を確かめる:
//  1. 並べ替え後のPBPが時系列（(経過秒, ピリオド) の昇順）になっている。イベントの数・中身は変わらず、元の配列も書き換わっていない
//  2. 集計用の読み込み（readAllGames）が返す試合のPBPが、時系列になっている
//  3. 並べ替える前（保存されたままの配列）と後で、次の結果が一致する:
//     アシストの紐付け（ペア・得点者別・チーム別）／選手のボックススコアの数え上げ（チャージ・オフェンスファウル・被アシスト内訳などPBP由来の全項目）／
//     ポゼッション開始／在コートの復元（区間・+/-・ラインナップのスティント・チーム合計・並びの補正・警告）／最大リード・最大ビハインド／得点の推移
//  並べ替えで配列が変わらなかった試合（延長の無い試合など）は、入力が同じなので 3. は省略する（--all-compare で全試合を比べる）。
//
// 使い方: npm run validate:pbp-order [-- --season 2025-26] [-- --all-compare]
//   （src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { existsSync, readdirSync } from "node:fs";
import type { Category, PlayByPlayEvent, StoredGame } from "../shared/types.ts";
import { DATA_DIR, gamesDir, gameFilePath, readAllGames, readGameFile } from "./lib/storage.ts";
import { withChronologicalPlayByPlays } from "../shared/pbpOrder.ts";
import { computeAssistedScoring } from "../shared/assistedScoring.ts";
import { gameMaxMargins } from "../shared/gameMargins.ts";
import { buildPossessionStartEvents, onCourtPeriodCount, reconstructOnCourt, substitutionModelForSeason } from "../shared/onCourt.ts";
import { buildPlayerBoxscores } from "../src/lib/boxscoreAggregate";
import { buildScoreTimeline } from "../src/lib/leadTracker";

const args = process.argv.slice(2);
const onlySeason = args.includes("--season") ? args[args.indexOf("--season") + 1] : undefined;
const allCompare = args.includes("--all-compare");

// 時系列かどうかの判定は、共通関数とは別に書く（同じ書き方の誤りを見逃さないため）
const dur = (p: number) => (p <= 4 ? 600 : 300);
const startOf = (p: number) => {
  let t = 0;
  for (let i = 1; i < p; i += 1) t += dur(i);
  return t;
};
const elapsedOf = (e: PlayByPlayEvent) => {
  const m = /^(\d+):(\d{2})$/.exec(e.RestTime ?? "");
  return startOf(e.Period) + dur(e.Period) - (m ? Number(m[1]) * 60 + Number(m[2]) : 0);
};
function chronologicalProblem(events: PlayByPlayEvent[]): string | null {
  for (let i = 1; i < events.length; i += 1) {
    const a = events[i - 1]!;
    const b = events[i]!;
    if (elapsedOf(b) < elapsedOf(a) || (elapsedOf(b) === elapsedOf(a) && b.Period < a.Period)) return `位置${i}で逆行（${a.Period}Q ${a.RestTime} → ${b.Period}Q ${b.RestTime}）`;
  }
  return null;
}

/** 比べるための文字列。Map・Set は、挿入順（処理するイベントの順で変わる）ではなく、キーの順にそろえる */
const toJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    x instanceof Map
      ? [...x.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))
      : x instanceof Set
        ? [...x.values()].sort()
        : x,
  );

/** 並べ替える前と後で、結果が食い違う項目の名前（空なら一致） */
function mismatches(before: StoredGame, after: StoredGame): string[] {
  const out: string[] = [];
  const home = before.homeTeam.id;
  const away = before.awayTeam.id;
  const check = (name: string, f: (g: StoredGame) => unknown) => {
    if (toJson(f(before)) !== toJson(f(after))) out.push(name);
  };
  check("アシストの紐付け", (g) => computeAssistedScoring(g.raw.PlayByPlays));
  check("選手の数え上げ（チャージ・オフェンスファウル・被アシスト等）", (g) => [
    buildPlayerBoxscores(g.raw.HomeBoxscores, undefined, g.raw.PlayByPlays, []).map((p) => [p.playerId, p.counts]),
    buildPlayerBoxscores(g.raw.AwayBoxscores, undefined, g.raw.PlayByPlays, []).map((p) => [p.playerId, p.counts]),
  ]);
  check("ポゼッション開始", (g) => buildPossessionStartEvents(g.raw.PlayByPlays, home, away));
  check("在コートの復元", (g) => {
    const periods = onCourtPeriodCount(g.season, g.quarterScores.home.length, g.raw.PlayByPlays);
    const r = reconstructOnCourt(g.raw.PlayByPlays, g.raw.HomeBoxscores, g.raw.AwayBoxscores, home, away, periods, substitutionModelForSeason(g.season));
    return [r.intervals, r.plusMinus, r.lineupStints, r.teamTotals, r.orderRepairs, r.warnings];
  });
  check("最大リード・最大ビハインド", (g) => gameMaxMargins(g));
  check("得点の推移", (g) =>
    buildScoreTimeline(
      g.raw.PlayByPlays,
      { home: g.homeScore, away: g.awayScore },
      onCourtPeriodCount(g.season, g.quarterScores.home.length, g.raw.PlayByPlays),
    ),
  );
  return out;
}

interface Tally {
  games: number;
  reordered: number;
  notChronological: number;
  contentChanged: number;
  loaderNotChronological: number;
  compared: number;
  mismatched: number;
}

async function main(): Promise<void> {
  const seasons = readdirSync(DATA_DIR)
    .filter((s) => /^\d{4}-\d{2}$/.test(s) && (!onlySeason || s === onlySeason))
    .sort();
  const rows: Record<string, string | number>[] = [];
  const problems: string[] = [];
  let failed = false;

  for (const season of seasons) {
    for (const category of ["premier", "one"] as Category[]) {
      const dir = gamesDir(season, category);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
      const t: Tally = { games: 0, reordered: 0, notChronological: 0, contentChanged: 0, loaderNotChronological: 0, compared: 0, mismatched: 0 };

      for (const file of files) {
        const key = file.replace(/\.json\.gz$/, "");
        const before = await readGameFile(gameFilePath(season, key, category)); // 保存されたまま（並べ替えない）
        if (!before || !before.gameEndedFlg || !before.raw.PlayByPlays?.length) continue;
        t.games += 1;
        const snapshot = before.raw.PlayByPlays.map((e) => e.No).join(",");
        const after = withChronologicalPlayByPlays(before);
        const reordered = after !== before;
        if (reordered) t.reordered += 1;

        // 1. 時系列になっているか。イベントの数・中身が同じか。元の配列が書き換わっていないか
        const problem = chronologicalProblem(after.raw.PlayByPlays);
        if (problem) {
          t.notChronological += 1;
          problems.push(`${season}${category === "one" ? "(B.ONE)" : ""}/${key}: 並べ替え後が時系列でない: ${problem}`);
        }
        const beforeSet = new Set(before.raw.PlayByPlays);
        const sameEvents =
          after.raw.PlayByPlays.length === before.raw.PlayByPlays.length &&
          new Set(after.raw.PlayByPlays).size === before.raw.PlayByPlays.length &&
          after.raw.PlayByPlays.every((e) => beforeSet.has(e));
        if (!sameEvents || before.raw.PlayByPlays.map((e) => e.No).join(",") !== snapshot) {
          t.contentChanged += 1;
          problems.push(`${season}${category === "one" ? "(B.ONE)" : ""}/${key}: イベントの数・中身が変わった、または元の配列が書き換わった`);
        }

        // 3. 並べ替える前後で結果が一致するか（配列が変わった試合。--all-compare なら全試合）
        if (reordered || allCompare) {
          t.compared += 1;
          const diff = mismatches(before, after);
          if (diff.length > 0) {
            t.mismatched += 1;
            problems.push(`${season}${category === "one" ? "(B.ONE)" : ""}/${key}: 並べ替えの前後で食い違う: ${diff.join("、")}`);
          }
        }
      }

      // 2. 集計用の読み込み（readAllGames）が返す試合が時系列か
      for (const g of await readAllGames(season, category)) {
        if (!g.gameEndedFlg || !g.raw.PlayByPlays?.length) continue;
        if (chronologicalProblem(g.raw.PlayByPlays)) {
          t.loaderNotChronological += 1;
          problems.push(`${season}${category === "one" ? "(B.ONE)" : ""}/${g.scheduleKey}: readAllGames が返したPBPが時系列でない`);
        }
      }

      if (t.notChronological + t.contentChanged + t.loaderNotChronological + t.mismatched > 0) failed = true;
      rows.push({
        シーズン: `${season}${category === "one" ? " B.ONE" : ""}`,
        終了試合: t.games,
        並べ替えた試合: t.reordered,
        時系列でない: t.notChronological,
        中身が変わった: t.contentChanged,
        "読み込みが時系列でない": t.loaderNotChronological,
        前後を比べた試合: t.compared,
        食い違い: t.mismatched,
      });
    }
  }

  console.table(rows);
  const sum = (k: string) => rows.reduce((a, r) => a + Number(r[k]), 0);
  console.log(
    `合計: 終了試合${sum("終了試合")}、並べ替えた試合${sum("並べ替えた試合")}、前後を比べた試合${sum("前後を比べた試合")}、` +
      `時系列でない${sum("時系列でない")}、中身が変わった${sum("中身が変わった")}、読み込みが時系列でない${sum("読み込みが時系列でない")}、食い違い${sum("食い違い")}`,
  );
  for (const p of problems.slice(0, 20)) console.log(`  NG ${p}`);
  console.log(failed ? "結果: 食い違いあり" : "結果: すべて一致");
  if (failed) process.exitCode = 1;
}

await main();
