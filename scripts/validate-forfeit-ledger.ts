// 不戦勝／不戦敗の台帳（docs/forfeit-ledger/ledger.json）と、その取り込み・集計の扱いの検証（DESIGN.md 431章）。
//  1. 台帳の行の形（得点・出典・規約・TeamID が日程の対戦と合う）
//  2. 台帳の足し方: 公式のカードから作った項目、または前回までの項目を台帳で上書きしない（公式のカード＞台帳）。公式のカードの読み取りは validate:result-only-games
//  3. 台帳に載る試合が、日程の resultOnlyGames にあり、cancelledGames・upcomingGames・scheduleKeys・生データ（games/）に残っていない（空の枠が集計に混ざらない）
//  4. 集計（build:data のあと）: 台帳の試合を含むチーム・シーズンの勝敗の試合数が、スタッツの試合数＋台帳の試合数に合う。得点・失点は含む／含まない
//  5. 既存の扱いが変わらない: 2022-23 の 500609（滋賀 20-0 名古屋D）・中止の試合（412章）
import { gunzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, seasonDirName } from "./lib/storage.ts";
import { forfeitLedgerEntries, ledgerFill, readForfeitLedgerRows } from "./lib/forfeitLedger.ts";
import { reconcileResultOnly } from "./lib/resultOnlyGames.ts";
import type { ResultOnlyGameEntry, ScheduleFileExtended } from "../shared/resultOnlyGames.ts";
import type { Category } from "../shared/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}
const rj = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(gunzipSync(readFileSync(p)).toString("utf-8")) as T) : null);

const rows = readForfeitLedgerRows();
check("台帳に行がある", rows.length >= 1);

// 1. 行の形
for (const r of rows) {
  const label = `${r.season} ${r.scheduleKey}`;
  check(`${label}: 不戦勝／不戦敗で、得点が 20-0 か 0-20`, r.reason === "forfeit" && ((r.homeScore === 20 && r.awayScore === 0) || (r.homeScore === 0 && r.awayScore === 20)));
  check(`${label}: 出典（公式のお知らせの URL・日付・規約）がある`, /^https:\/\/www\.bleague\.jp\//.test(r.source?.url ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(r.source?.announcedOn ?? "") && (r.source?.rule ?? "").includes("第57条"));
  check(`${label}: 日付・TeamID・種類が入っている`, /^\d{4}-\d{2}-\d{2}$/.test(r.date) && !!r.homeTeamId && !!r.awayTeamId && r.homeTeamId !== r.awayTeamId && r.gameType === "regular");
}

// 2. 足し方（公式のカード＞台帳）
{
  const row = rows[0]!;
  const ledger = forfeitLedgerEntries(row.season, (row.category ?? "premier") as Category);
  check("台帳の項目から出典などの台帳だけの項目を除く", ledger.length >= 1 && !("source" in ledger[0]!) && !("season" in ledger[0]!));
  const official: ResultOnlyGameEntry = { ...ledger[0]!, homeScore: 20, awayScore: 0, venue: "公式の会場" };
  check("前回までに項目がある試合は、台帳で足さない", ledgerFill(ledger, [official], []).length === 0);
  check("今回公式のカードから作れた試合は、台帳で足さない", ledgerFill(ledger, [], [official]).length === 0);
  check("どちらにも無い試合は、台帳から足す", ledgerFill(ledger, [], []).length === ledger.length);
  const rec = reconcileResultOnly({ existing: [], built: [official], withBoxscore: new Set() });
  check("公式のカードから作った項目は、台帳の項目を置き換える（同じキー）", reconcileResultOnly({ existing: ledger, built: [official], withBoxscore: new Set() }).entries[0]?.venue === "公式の会場" && rec.entries.length === 1);
  // 空の枠は「本物の生データ」に入れない（withBoxscore を本物だけにする）ので、結果だけの試合から外れない
  check("空の枠だけの試合（本物の生データが無い）は結果だけの試合から外れない", reconcileResultOnly({ existing: ledger, built: [], withBoxscore: new Set() }).entries.length === ledger.length);
  check("本物の生データが取り込まれたら外れる（記録のある試合が優先）", reconcileResultOnly({ existing: ledger, built: [], withBoxscore: new Set([ledger[0]!.scheduleKey]) }).entries.length === 0);
}

// 3. 日程のデータ
for (const r of rows) {
  const category = (r.category ?? "premier") as Category;
  const dir = path.join(DATA_DIR, seasonDirName(r.season, category));
  const schedule = rj<ScheduleFileExtended>(path.join(dir, "schedule.json.gz"));
  const label = `${r.season}${category === "one" ? " B.ONE" : ""} ${r.scheduleKey}`;
  const entry = schedule?.resultOnlyGames?.find((g) => g.scheduleKey === r.scheduleKey);
  check(`${label}: 日程の結果だけの試合にある（不戦勝・得点・TeamID）`, !!entry && entry.reason === "forfeit" && entry.homeScore === r.homeScore && entry.awayScore === r.awayScore && entry.homeTeamId === r.homeTeamId && entry.awayTeamId === r.awayTeamId);
  check(`${label}: 中止・開催予定・日程のキー・生データには残っていない`,
    !(schedule?.cancelledGames ?? []).some((g) => g.scheduleKey === r.scheduleKey) &&
      !(schedule?.upcomingGames ?? []).some((g) => g.scheduleKey === r.scheduleKey) &&
      !(schedule?.scheduleKeys ?? []).includes(r.scheduleKey) &&
      !existsSync(path.join(dir, "games", `${r.scheduleKey}.json.gz`)),
  );

  // 4. 集計（build:data のあと）
  const teams = rj<{ teams?: unknown } | Array<Record<string, unknown>>>(path.join(dir, "teams.json.gz"));
  const list = (Array.isArray(teams) ? teams : (teams as { teams?: Array<Record<string, unknown>> } | null)?.teams) as Array<Record<string, any>> | undefined;
  if (list) {
    for (const [id, win] of [[r.homeTeamId, r.homeScore > r.awayScore], [r.awayTeamId, r.awayScore > r.homeScore]] as const) {
      const t = list.find((x) => x.teamId === id);
      check(`${label}: ${t?.teamName ?? id} の勝敗の試合数＝スタッツの試合数＋結果だけの試合`, !!t && t.wins + t.losses === t.gamesPlayed + (t.resultOnlyGames ?? 0) && (t.resultOnlyGames ?? 0) >= 1, JSON.stringify({ w: t?.wins, l: t?.losses, g: t?.gamesPlayed, ro: t?.resultOnlyGames }));
      void win;
    }
  } else {
    console.log(`skip ${label}: teams.json が無い（build:data のあとに確かめる）`);
  }
}

// 5. 既存の扱い
{
  const s2223 = rj<ScheduleFileExtended>(path.join(DATA_DIR, "2022-23", "schedule.json.gz"));
  const e = s2223?.resultOnlyGames?.find((g) => g.scheduleKey === "500609");
  check("2022-23 の 500609（滋賀 20-0 名古屋D）は不戦勝のまま", !!e && e.reason === "forfeit" && e.homeScore === 20 && e.awayScore === 0 && e.homeTeamId === "698" && e.awayTeamId === "729");
  check("2022-23 の中止（広島-信州 500670）は中止のまま", !!s2223?.cancelledGames?.some((g) => g.scheduleKey === "500670"));
  for (const [season, n] of [["2019-20", 173], ["2020-21", 26], ["2021-22", 56], ["2024-25", 1]] as const) {
    const s = rj<ScheduleFileExtended>(path.join(DATA_DIR, season, "schedule.json.gz"));
    check(`${season} の中止は ${n} 試合のまま`, (s?.cancelledGames ?? []).length === n && (s?.resultOnlyGames ?? []).length === 0);
  }
}

if (failed > 0) {
  console.error(`\n失敗 ${failed}件`);
  process.exitCode = 1;
} else {
  console.log("\nすべて通りました");
}
