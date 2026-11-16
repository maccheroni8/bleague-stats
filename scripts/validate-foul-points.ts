// 反則ポイント（DESIGN.md 416章）の検証。先に npm run build:data で作っておく。
// 1. 導出データ（foul-points.json）を生データから作り直した中身が、ファイルと同じ（作成時刻を除く）
// 2. 数がファウルの導出データ（fouls.json）と合う（TF・コーチとベンチ・UF・フレグラント・ディスラプティブ・DQ）。2026-27 以降は TF1＋TF2＝TF（区分の無いテクニカルが無い）
// 3. 台帳（docs/foul-points/）: 本文のファイルと台帳の行が1対1で、data の表（foul-penalties.json）が台帳から作ったものと同じ
// 4. 画面の集計（src/lib/figureFoulPoints.ts）の決まりを、人工のデータで確かめる（旧規程の退場の3点だけ・コーチの退場・エントリー・出場停止の範囲・新規程の点数）
// 5. 実データで、手で数えた値（過去シーズンのクラブ）と同じ
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { buildFoulPoints, type FoulPenaltiesFile, type FoulPointsFile } from "../shared/foulPoints.ts";
import type { FoulsIndexFile } from "../shared/foulsIndex.ts";
import type { TeamGameIndexFile } from "../shared/gameIndex.ts";
import type { Category } from "../shared/types.ts";
import { FOUL_POINT_RULES, foulPointRuleFor } from "../shared/foulPointRules.ts";
import { teamFoulPointRows } from "../src/lib/figureFoulPoints.ts";
import { buildFoulPenaltyTables } from "./build-foul-penalties.ts";
import { readLedger } from "./lib/penaltyLedger.ts";
import { RELEASES_DIR } from "./lib/penaltyReleaseFetch.ts";
import { FOUL_POINTS_EXPECTED } from "./lib/foulPointsExpected.ts";

const seasons = readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
let checks = 0;
const summary: string[] = [];

for (const season of seasons) {
  for (const category of ["premier", "one"] as Category[]) {
    const dir = path.join(DATA_DIR, seasonDirName(season, category));
    const name = category === "one" ? `${season} B.ONE` : season;
    if (!existsSync(path.join(dir, "team-game-index.json.gz"))) continue;
    const file = await readJson<FoulPointsFile>(path.join(dir, "foul-points.json"));
    assert.ok(file, `${name}: foul-points.json.gz がありません`);
    const teamIndex = (await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json")))!;
    const penalties = await readJson<FoulPenaltiesFile>(path.join(dir, "foul-penalties.json"));
    const games = await readAllGames(season, category);

    // 1. 作り直した中身と同じ
    const rebuilt = buildFoulPoints(season, teamIndex, games, penalties?.rows ?? []);
    assert.deepEqual({ ...rebuilt, generatedAt: "" }, { ...file, generatedAt: "" }, `${name}: 作り直した中身がファイルと違います`);
    checks++;

    // 2. ファウルの導出データと合う
    const fouls = (await readJson<FoulsIndexFile>(path.join(dir, "fouls.json")))!;
    assert.deepEqual(fouls.games.key, file.games.key, `${name}: 試合の並びが fouls.json と違います`);
    let rows = 0;
    let entryShort = 0;
    for (let r = 0; r < file.games.key.length * 2; r++) {
      if (file.team.entry[r]! >= 0 && file.team.entry[r]! <= 9) entryShort++;
      if (file.team.tf[r] === -1) {
        assert.equal(fouls.team.tfCoach[r], -1, `${name} 行${r}: PBP の有無が fouls.json と違います`);
        continue;
      }
      const f = (c: keyof FoulsIndexFile["team"]) => fouls.team[c][r]!;
      assert.equal(file.team.tf[r], f("tfCoach") + f("tfBench") + f("tfPlayer"), `${name} 行${r}: TF`);
      assert.equal(file.team.tfStaff[r], f("tfCoach") + f("tfBench"), `${name} 行${r}: コーチ・ベンチの TF`);
      assert.equal(file.team.uf[r], f("uf"), `${name} 行${r}: UF`);
      assert.equal(file.team.flagrant[r], f("flagrant"), `${name} 行${r}: フレグラント`);
      assert.equal(file.team.disruptive[r], f("disruptive"), `${name} 行${r}: ディスラプティブ`);
      assert.equal(file.team.dq[r], f("dq"), `${name} 行${r}: DQ`);
      assert.ok(file.team.absorbed[r]! <= 2 * file.team.ejectPair[r]!, `${name} 行${r}: 退場に含める数は退場1人2回まで`);
      if (foulPointRuleFor(season)?.system === "new") {
        assert.equal(file.team.tf1[r]! + file.team.tf2[r]!, file.team.tf[r], `${name} 行${r}: 区分の書かれていないテクニカルがあります（点数が決まらない）`);
      } else {
        assert.equal(file.team.tf1[r]! + file.team.tf2[r]!, 0, `${name} 行${r}: 旧規程のシーズンに区分のあるテクニカル`);
      }
      rows++;
    }
    checks++;
    summary.push(`${name}: チームの行 ${rows}・エントリー9名以下 ${entryShort}・台帳の行 ${file.penalties.length}（試合に結び付いた ${file.penalties.filter((p) => p.game >= 0).length}）`);
  }
}

// 3. 台帳
{
  const ledger = await readLedger();
  const files = readdirSync(RELEASES_DIR).filter((f) => f.endsWith(".txt")).map((f) => f.replace(/\.txt$/, ""));
  const ids = new Set(ledger.rows.map((r) => r.newsId));
  for (const id of files) assert.ok(ids.has(id), `台帳に本文 ${id} の行がありません`);
  for (const id of ids) assert.ok(files.includes(id), `台帳の行 ${id} の本文がありません`);
  for (const r of ledger.rows) {
    if (r.status === "取り消し" || r.status === "後の発表に含む") assert.ok(r.changedBy && ids.has(r.changedBy), `${r.newsId}: ${r.status}の行には changedBy（あとのリリース）が要ります`);
    if (r.status === "自動読み取り" || r.status === "手で確認") {
      assert.ok(r.season && r.incidentDate && r.competition && r.club && r.suspensionGames !== null, `${r.newsId}: 使う行に欠けた値があります`);
      if (r.ejected) assert.ok(r.ejectionKind, `${r.newsId}: 退場の種類がありません`);
    }
  }
  const { files: tables } = await buildFoulPenaltyTables();
  for (const season of seasons) {
    for (const category of ["premier", "one"] as Category[]) {
      const have = await readJson<FoulPenaltiesFile>(path.join(DATA_DIR, seasonDirName(season, category), "foul-penalties.json"));
      assert.deepEqual(have, tables.get(`${season}:${category}`) ?? null, `${season} ${category}: data の foul-penalties.json が台帳と合いません（scripts/build-foul-penalties.ts を流す）`);
    }
  }
  const count = (s: string) => ledger.rows.filter((r) => r.status === s).length;
  summary.push(`台帳: 本文 ${files.length}・行 ${ledger.rows.length}（自動読み取り ${count("自動読み取り")}・手で確認 ${count("手で確認")}・後の発表に含む ${count("後の発表に含む")}・要確認 ${count("要確認")}・取り消し ${count("取り消し")}）`);
  checks += 3;
}

// 4. 画面の集計の決まり（人工のデータ）
{
  assert.equal(foulPointRuleFor("2016-17")!.estimated, true);
  assert.equal(foulPointRuleFor("2018-19")!.version, "2017年7月12日改正");
  assert.equal(foulPointRuleFor("2019-20")!.entry, false, "2019-20 はエントリー人数を数えない");
  assert.equal(foulPointRuleFor("2025-26")!.entry, true);
  assert.equal(foulPointRuleFor("2026-27")!.system, "new");
  assert.equal(foulPointRuleFor("2015-16"), null);
  assert.equal(FOUL_POINT_RULES.length, 5);
  const blank = (n: number) => new Array<number>(n).fill(0);
  const mk = (season: string, over: Partial<Record<string, number[]>>, penalties: FoulPointsFile["penalties"] = [], flags = [0, 0, 1]): FoulPointsFile => {
    const team = Object.fromEntries(["tf", "tf1", "tf2", "tfStaff", "uf", "flagrant", "disruptive", "dq", "ejectPair", "ejectDq", "absorbed", "entry"].map((c) => [c, over[c] ?? (c === "entry" ? [12, 12, 12, 12, 12, 12] : blank(6))])) as FoulPointsFile["team"];
    return { version: 1, generatedAt: "", season, teams: [["A", "Aチーム"], ["B", "Bチーム"]], games: { key: ["g1", "g2", "g3"], date: ["2020-10-01", "2020-10-08", "2021-05-01"], flags, home: [0, 1, 0], away: [1, 0, 1] }, team, penalties };
  };
  // 旧規程（行は 試合×2＋ホーム0/アウェイ1。A は g1 ホーム・g2 アウェイ・g3 ホーム）: g1 で選手が TF＋UF で退場（absorbed 2）、ほかに TF 1、
  // g2 でコーチの退場（台帳）でコーチの TF 2・エントリー 9名・出場停止 1試合（レギュラー）、
  // ポストシーズン g3 の UF 1 と出場停止 2試合（数えない）
  const old = mk(
    "2020-21",
    { tf: [2, 0, 0, 2, 0, 0], tfStaff: [0, 0, 0, 2, 0, 0], uf: [1, 0, 0, 0, 1, 0], ejectPair: [1, 0, 0, 0, 0, 0], absorbed: [2, 0, 0, 0, 0, 0], entry: [12, 12, 12, 9, 12, 12] },
    [
      { newsId: "1", teamId: "A", incidentDate: "2020-10-08", competition: "regular", role: "ヘッドコーチ", person: "x", suspensionGames: 1, coachEjection: true, game: 1 },
      { newsId: "2", teamId: "A", incidentDate: "2021-05-01", competition: "postseason", role: "選手", person: "y", suspensionGames: 2, coachEjection: false, game: 2 },
    ],
  );
  const a = teamFoulPointRows(old, { kind: "all" }).find((r) => r.teamId === "A")!;
  assert.deepEqual([a.tf.count + a.uf.count, a.ejection.count, a.suspension.count, a.entry.count], [1, 2, 1, 1], "旧規程の件数（TF＋UF の4回のうち、退場の2人分の4回を除いた1回）");
  assert.equal(a.total, 1 + 2 * 3 + 1 * 3 + 5, "旧規程の合計（TF1・退場2×3・出場停止3・エントリー9名で5）");
  assert.equal(a.remaining, 31 - a.total);
  assert.equal(teamFoulPointRows(old, { kind: "recent", n: 1 }).find((r) => r.teamId === "A")!.total, 3 + 3 + 5, "直近1試合（g2）だけ: コーチの退場3・出場停止3・エントリー5");
  // 2019-20 はエントリーを数えない
  assert.equal(teamFoulPointRows({ ...old, season: "2019-20" }, { kind: "all" }).find((r) => r.teamId === "A")!.entry.points, 0);
  // 新規程: TF1 1・TF2 2・フレグラント 1・ディスラプティブ 3（0点）・DQ 1・出場停止 2試合
  const neu = mk(
    "2026-27",
    { tf: [3, 0, 0, 0, 0, 0], tf1: [1, 0, 0, 0, 0, 0], tf2: [2, 0, 0, 0, 0, 0], uf: [4, 0, 0, 0, 0, 0], flagrant: [1, 0, 0, 0, 0, 0], disruptive: [3, 0, 0, 0, 0, 0], dq: [1, 0, 0, 0, 0, 0], ejectPair: [1, 0, 0, 0, 0, 0], absorbed: [2, 0, 0, 0, 0, 0] },
    [{ newsId: "3", teamId: "A", incidentDate: "2020-10-01", competition: "regular", role: "選手", person: "z", suspensionGames: 2, coachEjection: false, game: 0 }],
  );
  const n = teamFoulPointRows(neu, { kind: "all" }).find((r) => r.teamId === "A")!;
  assert.equal(n.total, 2 + 2 * 1 + 2 + 4 + 2 * 4, "新規程の合計（退場の点は無い）");
  assert.equal(n.ejection.points, 0);
  // 発表で取り消された選手の退場は、退場の点から1回引く（旧規程）
  const cancelled = { ...old, penalties: [...old.penalties, { newsId: "4", teamId: "A", incidentDate: "2020-10-01", competition: "regular" as const, role: "選手", person: "w", suspensionGames: 0, coachEjection: false, ejectionCancelled: true, game: 0 }] };
  assert.equal(teamFoulPointRows(cancelled, { kind: "all" }).find((r) => r.teamId === "A")!.ejection.count, a.ejection.count - 1, "取り消された退場は数えない");
  // 反則金の段階（版ごと・リーグごと）
  const fine = (season: string, cat: "premier" | "one") => foulPointRuleFor(season)!.fines[cat].map((s) => `${s.from}-${s.to ?? ""}:${s.manYen}`).join(" ");
  assert.equal(fine("2026-27", "premier"), "31-40:40 41-50:80 51-60:120 61-70:160 71-80:200 81-:300");
  assert.equal(fine("2026-27", "one"), "31-40:20 41-50:40 51-60:60 61-70:80 71-80:100 81-:150");
  assert.equal(fine("2025-26", "premier"), "31-40:20 41-50:40 51-60:60 61-70:80 71-80:100 81-:150");
  assert.equal(fine("2018-19", "one"), "31-40:20 41-50:40 51-60:60 61-70:80 71-:100");
  checks += 17;
}

// 5. 実データで、手で数えた値
for (const e of FOUL_POINTS_EXPECTED) {
  const file = (await readJson<FoulPointsFile>(path.join(DATA_DIR, seasonDirName(e.season, "premier"), "foul-points.json")))!;
  const row = teamFoulPointRows(file, { kind: "all" }).find((r) => r.teamId === e.teamId);
  assert.ok(row, `${e.season} ${e.teamId}: 行がありません`);
  assert.deepEqual(
    { total: row.total, tf: row.tf.count, uf: row.uf.count, ejection: row.ejection.count, tf1: row.tf1.count, tf2: row.tf2.count, flagrant: row.flagrant.count, dq: row.dq.count, suspension: row.suspension.count, entry: row.entry.points },
    { total: e.total, tf: e.tf, uf: e.uf, ejection: e.ejection, tf1: e.tf1, tf2: e.tf2, flagrant: e.flagrant, dq: e.dq, suspension: e.suspension, entry: e.entry },
    `${e.season} ${e.teamId}（${e.note}）: 手で数えた値と違います`,
  );
  checks++;
}

for (const line of summary) console.log(line);
console.log(`validate:foul-points: ${checks} 件の確認が通りました`);
