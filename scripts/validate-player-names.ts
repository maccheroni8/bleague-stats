// 選手名の表記（DESIGN.md 222-5）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 決めた扱い: 単一のシーズンの表は、そのシーズンの表記（空白だけ半角の1つにそろえる）。歴代・通算・勝負所の通算など複数のシーズンをまたぐ表は、
// 選手マスタの今の登録名（空白をそろえたもの。マスタに無い選手は、その試合〔通算は最後の試合〕のシーズンの名前）。
//  1. どのデータにも、全角空白・連続した空白・前後の空白の入った選手名が無い（シーズンごとの players.json・registered-players.json・1試合行の索引、全シーズンの記録・通算の3ファイル）
//  2. 全シーズンの3ファイル（league-player-game-records.json・league-player-career-top.json・league-player-rankings.json）の名前が、今の登録名と一致する
//  3. 複数のシーズンをまたぐ表（歴代の1試合記録・勝負所の通算・アシストペアの1試合と通算）で、同じ選手が1つの表記でしか出ない。ニュービルは常に「D.J・ニュービル」
//  4. 単一のシーズンの表は、そのシーズンの表記のまま（ニュービルは 2022-23 が「ディージェイ・ニュービル」、2023-24 が「D.J・ニュービル」。金丸 晃輔の2016-17は空白が半角）
//
// 使い方: npm run validate:player-names（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { currentPlayerNames, normalizePlayerName } from "../shared/playerName.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import type { AssistPairsFile } from "../shared/assistPairs.ts";
import type {
  LeaguePlayerCareerTopFile,
  LeaguePlayerGameRecordsFile,
  LeaguePlayerRankingsFile,
  PlayerGameRecordEntry,
  PlayerMasterEntry,
  PlayerSummary,
} from "../shared/types.ts";
import { viewPlayerGameIndex } from "../src/lib/gameIndex.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS } from "../src/lib/gameRecordConditions.ts";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions.ts";
import { CLUTCH_MEASURES, CLUTCH_WINDOWS, queryAssistPairs, queryClutch } from "../src/lib/clutchQuery.ts";
import { playerQueryStats, queryPlayerGameRecords } from "../src/lib/gameRecordQuery.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}
const ALL = 1_000_000;
const NEWBILL = "33085";
const KANEMARU = "8592";
const messy = (n: string) => n !== normalizePlayerName(n);

const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
const current = currentPlayerNames(master);
const seasons = readdirSync(DATA_DIR)
  .filter((s) => /^\d{4}-\d{2}$/.test(s) && existsSync(path.join(DATA_DIR, s, "player-game-index.json.gz")))
  .sort();

check("正規化: 全角空白・連続した空白・前後の空白", normalizePlayerName("金丸　晃輔") === "金丸 晃輔" && normalizePlayerName("  エグゼビア  ギブソン ") === "エグゼビア ギブソン" && normalizePlayerName("D.J・ニュービル") === "D.J・ニュービル");
check("マスタの今の登録名: ニュービル", current.get(NEWBILL) === "D.J・ニュービル", String(current.get(NEWBILL)));
check("マスタの今の登録名: 金丸 晃輔（全角空白がそろう）", current.get(KANEMARU) === "金丸 晃輔", String(current.get(KANEMARU)));

// ---- 1. どのデータにも乱れた空白が無い ----
const views = new Map<string, ReturnType<typeof viewPlayerGameIndex>>();
const pairFiles = new Map<string, AssistPairsFile>();
const messyFound: string[] = [];
const seasonNames = new Map<string, Map<string, string>>(); // シーズン → 選手ID → そのシーズンの名前（索引）
for (const s of seasons) {
  const file = (await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, s, "player-game-index.json")))!;
  views.set(s, viewPlayerGameIndex(file));
  pairFiles.set(s, (await readJson<AssistPairsFile>(path.join(DATA_DIR, s, "assist-pairs.json")))!);
  seasonNames.set(s, new Map(file.players.map((p) => [p[0], p[1]])));
  for (const p of file.players) if (messy(p[1])) messyFound.push(`${s} 索引 ${JSON.stringify(p[1])}`);
  for (const f of ["players.json", "registered-players.json"]) {
    for (const p of (await readJson<PlayerSummary[]>(path.join(DATA_DIR, s, f))) ?? []) if (messy(p.name)) messyFound.push(`${s} ${f} ${JSON.stringify(p.name)}`);
  }
}
const leagueGames = (await readJson<LeaguePlayerGameRecordsFile>(path.join(DATA_DIR, "league-player-game-records.json")))!;
const careerTop = (await readJson<LeaguePlayerCareerTopFile>(path.join(DATA_DIR, "league-player-career-top.json")))!;
const rankings = (await readJson<LeaguePlayerRankingsFile>(path.join(DATA_DIR, "league-player-rankings.json")))!;
const leagueEntries: PlayerGameRecordEntry[] = [];
const pushTables = (tables: Record<string, Record<string, PlayerGameRecordEntry[]>>) => {
  for (const byKey of Object.values(tables)) for (const es of Object.values(byKey)) leagueEntries.push(...es);
};
pushTables(leagueGames.byGameType as unknown as Record<string, Record<string, PlayerGameRecordEntry[]>>);
for (const cls of Object.values(leagueGames.byClassification ?? {})) pushTables(cls as unknown as Record<string, Record<string, PlayerGameRecordEntry[]>>);
for (const e of leagueEntries) if (messy(e.playerName)) messyFound.push(`league-player-game-records ${JSON.stringify(e.playerName)}`);
for (const p of Object.values(careerTop.players)) if (messy(p.name)) messyFound.push(`league-player-career-top ${JSON.stringify(p.name)}`);
for (const p of Object.values(rankings.players)) if (messy(p.name)) messyFound.push(`league-player-rankings ${JSON.stringify(p.name)}`);
check(`どのデータにも、乱れた空白の選手名が無い（全${seasons.length}シーズンの players.json・registered-players.json・索引と、全シーズンの3ファイル）`, messyFound.length === 0, `${messyFound.length}件: ${messyFound.slice(0, 5).join(" / ")}`);

// ---- 2. 全シーズンの3ファイルは今の登録名 ----
{
  const bad: string[] = [];
  let n = 0;
  for (const e of leagueEntries) {
    n += 1;
    const want = current.get(e.playerId);
    if (want !== undefined && e.playerName !== want) bad.push(`記録 ${e.playerId} ${e.playerName} ≠ ${want}`);
  }
  for (const [file, players] of [["通算記録", careerTop.players], ["個人の順位", rankings.players]] as const) {
    for (const [id, p] of Object.entries(players)) {
      n += 1;
      const want = current.get(id);
      if (want !== undefined && p.name !== want) bad.push(`${file} ${id} ${p.name} ≠ ${want}`);
    }
  }
  check(`全シーズンの3ファイル（${n}件）の選手名が、マスタに載る選手はすべて今の登録名`, bad.length === 0, bad.slice(0, 5).join(" / "));
  const nb = leagueEntries.filter((e) => e.playerId === NEWBILL).map((e) => e.playerName);
  console.log(`   歴代の1試合記録の上位に出るニュービル: ${nb.length}行、表記 ${JSON.stringify([...new Set(nb)])}`);
}

// ---- 3. 複数のシーズンをまたぐ表で、同じ選手が1つの表記 ----
const allViews = seasons.map((s) => views.get(s)!);
{
  const namesById = new Map<string, Set<string>>();
  const add = (id: string, name: string) => {
    const set = namesById.get(id) ?? new Set<string>();
    set.add(name);
    namesById.set(id, set);
  };
  let rows = 0;
  for (const stat of playerQueryStats("record")) {
    for (const r of queryPlayerGameRecords({ views: allViews, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies: null, currentNames: current, stat, includeSpecial: true, topN: ALL }).rows) {
      add(r.playerId, r.playerName);
      rows += 1;
    }
  }
  for (const window of CLUTCH_WINDOWS) {
    for (const measure of CLUTCH_MEASURES) {
      for (const r of queryClutch({ views: allViews, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", rookies: null, currentNames: current, measure, window, topN: ALL }).rows) {
        add(r.playerId, r.playerName);
        rows += 1;
      }
    }
  }
  const pairData = seasons.map((s) => ({ pairs: pairFiles.get(s)!, index: views.get(s)! }));
  for (const unit of ["game", "career"] as const) {
    for (const r of queryAssistPairs({ data: pairData, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, unit, currentNames: current, topN: ALL }).rows) {
      add(r.assisterId, r.assisterName);
      add(r.scorerId, r.scorerName);
      rows += 1;
    }
  }
  const multi = [...namesById].filter(([, v]) => v.size > 1);
  check(`複数のシーズンをまたぐ表（歴代の1試合記録・勝負所の通算・アシストペアの1試合と通算。${rows}行・${namesById.size}選手）で、同じ選手が複数の表記で出ない`, multi.length === 0, multi.slice(0, 5).map(([id, v]) => `${id} ${[...v].join("／")}`).join(" / "));
  check("ニュービルは歴代・通算の表でどれも「D.J・ニュービル」", JSON.stringify([...(namesById.get(NEWBILL) ?? [])]) === JSON.stringify(["D.J・ニュービル"]), JSON.stringify([...(namesById.get(NEWBILL) ?? [])]));
  // 感度: 今の登録名にそろえないと、同じ選手が複数の表記で出る（そろえる処理が効いている）
  const withoutNames = new Set<string>();
  for (const r of queryAssistPairs({ data: pairData, gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, unit: "career", topN: ALL }).rows) {
    if (r.assisterId === NEWBILL) withoutNames.add(r.assisterName);
    if (r.scorerId === NEWBILL) withoutNames.add(r.scorerName);
  }
  console.log(`   参考: そろえない通算のアシストペアのニュービルの表記 ${JSON.stringify([...withoutNames])}（最後の試合のシーズンの表記）`);
  const separate = new Set<string>();
  for (const s of ["2022-23", "2023-24"]) {
    for (const r of queryAssistPairs({ data: pairData.filter((d) => d.index.season === s), gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, unit: "season", topN: ALL }).rows) {
      if (r.assisterId === NEWBILL) separate.add(`${s} ${r.assisterName}`);
      if (r.scorerId === NEWBILL) separate.add(`${s} ${r.scorerName}`);
    }
  }
  // ---- 4. 単一のシーズンの表は、そのシーズンの表記 ----
  check("単一のシーズンの表: ニュービルは 2022-23 が「ディージェイ・ニュービル」、2023-24 が「D.J・ニュービル」", JSON.stringify([...separate].sort()) === JSON.stringify(["2022-23 ディージェイ・ニュービル", "2023-24 D.J・ニュービル"]), JSON.stringify([...separate]));
}
{
  const s = "2016-17";
  const rows = queryPlayerGameRecords({ views: [views.get(s)!], gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies: null, stat: playerQueryStats("record").find((x) => x.key === "pts")!, includeSpecial: true, topN: ALL }).rows.filter((r) => r.playerId === KANEMARU);
  const names = [...new Set(rows.map((r) => r.playerName))];
  check(`単一のシーズンの表: 金丸 晃輔の2016-17（${rows.length}試合）は半角の空白の「金丸 晃輔」`, rows.length > 0 && JSON.stringify(names) === JSON.stringify(["金丸 晃輔"]), JSON.stringify(names));
  // 2016-17のシーズンの表の名前: マスタの名前とは別に、シーズンの表記のまま（空白だけそろえる）
  const seasonOnly = seasonNames.get(s)!;
  const differing = [...seasonOnly].filter(([id, n]) => current.has(id) && current.get(id) !== n);
  console.log(`   2016-17の索引の選手のうち、今の登録名と表記が違う選手: ${differing.length}名（単一のシーズンの表は、そのシーズンの表記のまま）。例: ${differing.slice(0, 3).map(([, n]) => n).join("・")}`);
  check("単一のシーズンの表: 2016-17の表記の中には、今の登録名と違う表記が残っている（そろえすぎていない）", differing.length > 0);
}

console.log(failures === 0 ? "\nすべて ok" : `\n${failures} 件の食い違い`);
process.exit(failures === 0 ? 0 : 1);
