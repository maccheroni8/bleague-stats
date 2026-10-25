// 登録区分の分割（外国籍・帰化・アジア特別枠。2026-27 以降。shared/registration.ts・DESIGN.md 295章）の検証。データだけで動く。
//
// 1. 区分を決める処理: シーズン途中の変更は日付で当てる・2025-26 以前は記録を見ない・記録の無い選手は選手マスタ
// 2. 登録区分の記録（data/{season}/registrations.json・one/ 側）の形: シーズン・リーグ・区分の値・変更の日付の並びと範囲・見做し日本人は日本人だけ・選手マスタにある選手
// 3. 選手マスタ: 見做し日本人は日本人で印つき。手動の上書き一覧の帰化選手・アジア特別枠が選手マスタの区分と同じ
// 4. 導出データ（npm run build:data のあと）: 2026-27 以降の1試合の索引は行ごとの区分（rows.cls）を持ち、その区分で足した得点が、
//    チームの試合ログの日本人・外国籍・帰化・アジア特別枠の得点と試合ごとに一致する。2025-26 以前の索引は rows.cls を持たない
// 記録の無い出場選手（深夜の記録の前に試合に出た選手）は、選手マスタの区分で数えるので失敗にはせず件数だけ出す
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { CLASSIFICATION_OVERRIDES, DEEMED_JAPANESE_PLAYER_IDS } from "./lib/playerClassificationOverrides.ts";
import {
  CLASSIFICATION_CODES,
  SPLIT_CLASSIFICATION_FIRST_SEASON,
  hasSplitClassification,
  makeClassifier,
  registrationOn,
  type SeasonRegistrationFile,
} from "../shared/registration.ts";
import { ROW_FLAG_HOME, type PlayerGameIndexFile } from "../shared/gameIndex.ts";
import type { Category, PlayerMasterEntry, TeamGameLog } from "../shared/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}

// 1. 区分を決める処理
{
  const entry = { classification: "外国籍" as const, changes: [{ from: "2027-02-01", classification: "帰化選手" as const }] };
  check("変更の前の日は初めの区分", registrationOn(entry, "2027-01-31").classification === "外国籍");
  check("変更の日からは新しい区分", registrationOn(entry, "2027-02-01").classification === "帰化選手");
  check("日付を渡さなければ初めの区分", registrationOn(entry, undefined).classification === "外国籍");
  const master = new Map([
    ["1", { classification: "外国籍" as const }],
    ["2", { classification: "日本人" as const }],
  ]);
  const reg: SeasonRegistrationFile = { season: "x", league: "premier", players: { "1": { classification: "アジア特別枠" } } };
  check("2026-27 以降は記録の区分", makeClassifier("2026-27", reg, master)("1") === "アジア特別枠");
  check("2026-27 以降でも記録の無い選手は選手マスタ", makeClassifier("2026-27", reg, master)("2") === "日本人");
  check("2025-26 以前は記録があっても選手マスタ", makeClassifier("2025-26", reg, master)("1") === "外国籍");
  check("分けて選べる最初のシーズンは 2026-27", SPLIT_CLASSIFICATION_FIRST_SEASON === "2026-27" && hasSplitClassification("2026-27") && !hasSplitClassification("2025-26"));
}

const masterList = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
const master = new Map(masterList.map((p) => [p.playerId, p]));

// 3. 選手マスタ
{
  for (const id of DEEMED_JAPANESE_PLAYER_IDS) {
    const m = master.get(id);
    check(`見做し日本人 ${id} は選手マスタで日本人・印つき`, !!m && m.classification === "日本人" && m.deemedJapanese === true, JSON.stringify(m && { c: m.classification, d: m.deemedJapanese }));
  }
  const flagged = masterList.filter((p) => p.deemedJapanese && !DEEMED_JAPANESE_PLAYER_IDS.has(p.playerId));
  check("見做し日本人の印は一覧の選手だけ", flagged.length === 0, flagged.map((p) => p.playerId).join(", "));
  const mismatch = Object.entries(CLASSIFICATION_OVERRIDES).filter(([id, c]) => master.has(id) && master.get(id)!.classification !== c);
  check("手動の上書き一覧と選手マスタの区分が同じ", mismatch.length === 0, mismatch.map(([id, c]) => `${id}:${c}→${master.get(id)!.classification}`).join(", "));
}

// 2. 登録区分の記録
const seasons = readdirSync(DATA_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
for (const season of seasons) {
  for (const league of ["premier", "one"] as Category[]) {
    const file = await readJson<SeasonRegistrationFile>(path.join(DATA_DIR, seasonDirName(season, league), "registrations.json"));
    if (!file) continue;
    const label = `${season} ${league}`;
    check(`${label}: 2026-27 以降のシーズン`, hasSplitClassification(season));
    check(`${label}: ファイルのシーズン・リーグが置き場所と同じ`, file.season === season && file.league === league, `${file.season} ${file.league}`);
    const start = `${season.slice(0, 4)}-08-01`;
    const end = `${Number(season.slice(0, 4)) + 1}-07-31`;
    const bad: string[] = [];
    for (const [id, e] of Object.entries(file.players)) {
      if (!CLASSIFICATION_CODES.includes(e.classification)) bad.push(`${id}: 区分 ${e.classification}`);
      if (e.deemedJapanese && e.classification !== "日本人") bad.push(`${id}: 見做し日本人なのに ${e.classification}`);
      if (!master.has(id)) bad.push(`${id}: 選手マスタに無い`);
      let prev = "";
      for (const c of e.changes ?? []) {
        if (!CLASSIFICATION_CODES.includes(c.classification)) bad.push(`${id}: 変更の区分 ${c.classification}`);
        if (c.from <= prev) bad.push(`${id}: 変更の日付が昇順でない`);
        if (c.from < start || c.from > end) bad.push(`${id}: 変更の日付 ${c.from} がシーズンの外`);
        if (c.deemedJapanese && c.classification !== "日本人") bad.push(`${id}: 変更の見做し日本人なのに ${c.classification}`);
        prev = c.from;
      }
    }
    check(`${label}: 記録の値（${Object.keys(file.players).length}名）`, bad.length === 0, bad.slice(0, 10).join(" / "));
    // 試合に出たのに記録の無い選手（選手マスタの区分で数える。深夜の記録で埋まる）
    const appeared = new Set<string>();
    for (const g of await readAllGames(season, league)) {
      for (const r of [...g.raw.HomeBoxscores, ...g.raw.AwayBoxscores]) if (r.PeriodCategory === 18 && r.PlayerID) appeared.add(String(r.PlayerID));
    }
    const unrecorded = [...appeared].filter((id) => !file.players[id]);
    console.log(`     ${label}: 試合に出た選手 ${appeared.size}名のうち、記録の無い選手 ${unrecorded.length}名${unrecorded.length > 0 ? `（${unrecorded.slice(0, 10).join(", ")}）` : ""}`);
  }
}

// 4. 導出データ
let derivedChecked = 0;
for (const season of seasons) {
  for (const league of ["premier", "one"] as Category[]) {
    const dir = path.join(DATA_DIR, seasonDirName(season, league));
    const index = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
    if (!index) continue;
    const label = `${season} ${league}`;
    if (!hasSplitClassification(season)) {
      check(`${label}: 2025-26 以前の索引は行ごとの区分を持たない`, index.rows.cls === undefined);
      continue;
    }
    derivedChecked += 1;
    const cls = index.rows.cls;
    check(`${label}: 索引が行ごとの区分を持つ`, !!cls && cls.length === index.rows.player.length);
    if (!cls) continue;
    // 試合×ホーム/アウェイごとの区分別の得点
    const sums = new Map<string, number[]>();
    for (let i = 0; i < cls.length; i += 1) {
      const key = `${index.games.key[index.rows.game[i]!]}|${(index.rows.flags[i]! & ROW_FLAG_HOME) !== 0 ? "h" : "a"}`;
      const s = sums.get(key) ?? [0, 0, 0, 0];
      const c = cls[i]!;
      if (c >= 0) s[c] = (s[c] ?? 0) + index.rows.stats.pts[i]!;
      sums.set(key, s);
    }
    const mism: string[] = [];
    let compared = 0;
    const teamDir = path.join(dir, "team-games");
    for (const f of existsSync(teamDir) ? readdirSync(teamDir).filter((x) => x.endsWith(".json.gz")) : []) {
      for (const log of (await readJson<TeamGameLog[]>(path.join(teamDir, f.replace(/\.gz$/, "")))) ?? []) {
        const s = sums.get(`${log.scheduleKey}|${log.isHome ? "h" : "a"}`);
        if (!s) continue;
        compared += 1;
        const want = [log.japanesePoints, log.foreignPoints, log.naturalizedPoints, log.asianQuotaPoints];
        if (want.some((v, i) => v !== s[i])) mism.push(`${log.scheduleKey} ${f.replace(/\.json\.gz$/, "")}: 索引 ${s.join("/")} 試合ログ ${want.join("/")}`);
      }
    }
    check(`${label}: 索引の区分別の得点がチームの試合ログと一致（${compared}行）`, compared > 0 && mism.length === 0, mism.slice(0, 5).join(" / "));
    // 見做し日本人は日本人（0）として数える
    for (const id of DEEMED_JAPANESE_PLAYER_IDS) {
      const pi = index.players.findIndex((p) => p[0] === id);
      if (pi < 0) continue;
      const rows = index.rows.player.map((p, i) => (p === pi ? cls[i] : undefined)).filter((v) => v !== undefined);
      check(`${label}: 見做し日本人 ${id} の行はすべて日本人`, rows.length > 0 && rows.every((c) => c === 0), rows.join(","));
    }
  }
}
check("2026-27 以降の索引を1つ以上確かめた", derivedChecked > 0);

if (failed > 0) {
  console.error(`\n${failed}件の確認が通りませんでした`);
  process.exitCode = 1;
} else {
  console.log("\nすべての確認が通りました");
}
