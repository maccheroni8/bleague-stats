// ランキング > 個人 の「現役」の絞り込み（DESIGN.md 222章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 導出データを作ったあと（`npm run build:data` のあと）に実行する。
//  1. 現役の選手ID（今季の players.json ＋ registered-players.json。画面の useActivePlayerIds と同じ）が、別の元（current-roster.json＝公式の「在籍中」の一覧）の
//     選手をすべて含む。名簿に無い選手（今季出場したが今は在籍中の一覧に無い）の人数も出す
//  2. 通算記録（league-player-career-top.json の byActive）: 載っている選手は全員が現役。league-player-rankings.json から現役だけを取り出して順位をつけ直した
//     上位20位と、全項目（通算成績 × 会場3 × 試合区分3 ＋ 回数・在籍）・登録区分3通り（すべて・日本人・外国籍等）で一致する
//  3. 歴代の1試合記録・勝負所の通算・アシストペア（1試合・通算）: activeIds を渡した結果が、渡さない結果から現役の選手（ペアは両方が現役）だけを残したものと一致し、
//     今季の名簿に無い選手が1人も出ない。現役でない選手が絞り込み前の上位に含まれていること（絞り込みが効いていること）も確かめる
//
// 使い方: npm run validate:active-filter（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { currentSeason } from "./lib/season.ts";
import { CLASS_KEYS, classKeyOf, type ClassKey } from "../shared/classificationKey.ts";
import { PLAYER_GAME_RECORD_STATS } from "../shared/playerGameRecords.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import type { AssistPairsFile } from "../shared/assistPairs.ts";
import type {
  CurrentRosterFile,
  LeaguePlayerCareerTopEntry,
  LeaguePlayerCareerTopFile,
  LeaguePlayerRankingsFile,
  PlayerCareersFile,
  PlayerMasterEntry,
  PlayerSummary,
} from "../shared/types.ts";
import { viewPlayerGameIndex } from "../src/lib/gameIndex.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS } from "../src/lib/gameRecordConditions.ts";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions.ts";
import { queryAssistPairs, queryClutch, type PairUnit } from "../src/lib/clutchQuery.ts";
import { playerQueryStats, queryPlayerGameRecords } from "../src/lib/gameRecordQuery.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

const ALL = 1_000_000;
const season = currentSeason();

// ---- 1. 現役の選手ID ----
const active = new Set<string>();
for (const file of ["players.json", "registered-players.json"]) {
  for (const p of (await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, file))) ?? []) active.add(p.playerId);
}
const roster = (await readJson<CurrentRosterFile>(path.join(DATA_DIR, "current-roster.json")))!;
const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
const masterIds = new Set(master.map((p) => p.playerId));
{
  const rosterInMaster = roster.players.filter((p) => masterIds.has(p.playerId));
  const missing = rosterInMaster.filter((p) => !active.has(p.playerId));
  console.log(`   現役（${season}の players.json＋registered-players.json）${active.size}名、在籍中の一覧（${roster.season}）${roster.players.length}名`);
  check(`在籍中の一覧（${roster.season}）の選手が、現役にすべて含まれる`, roster.season === season && missing.length === 0, `含まれない: ${missing.map((p) => p.playerId).join(",")}`);
  const notOnRoster = [...active].filter((id) => !roster.players.some((p) => p.playerId === id));
  console.log(`   今季出場したが在籍中の一覧に無い選手: ${notOnRoster.length}名（現役には含める。既存の「そのシーズンに登録していた選手」の判定のまま）`);
}

// ---- 2. 通算記録 ----
const top = (await readJson<LeaguePlayerCareerTopFile>(path.join(DATA_DIR, "league-player-career-top.json")))!;
const rankings = (await readJson<LeaguePlayerRankingsFile>(path.join(DATA_DIR, "league-player-rankings.json")))!;
const careers = (await readJson<PlayerCareersFile>(path.join(DATA_DIR, "player-careers.json"))) ?? null;
const classKeyById = new Map(master.map((p) => [p.playerId, classKeyOf(p.classification)]));
check("byActive がある（すべて・日本人・外国籍等）", !!top.byActive && ["all", ...CLASS_KEYS].every((k) => !!top.byActive![k as "all" | ClassKey]));
{
  const GAME_TYPES = ["regular", "playoff", "both"] as const;
  const venues = ["career", "careerHome", "careerAway"] as const;
  let tables = 0;
  let notActive = 0;
  const diffs: string[] = [];
  const topOf = (items: { playerId: string; value: number }[]): LeaguePlayerCareerTopEntry[] => {
    const sorted = [...items].sort((a, b) => b.value - a.value || Number(a.playerId) - Number(b.playerId));
    const out: LeaguePlayerCareerTopEntry[] = [];
    let rank = 0;
    sorted.forEach((e, i) => {
      if (i === 0 || e.value !== sorted[i - 1]!.value) rank = i + 1;
      if (rank <= 20) out.push({ ...e, rank });
    });
    return out;
  };
  const same = (a: LeaguePlayerCareerTopEntry[], b: LeaguePlayerCareerTopEntry[]) => JSON.stringify(a.map((e) => [e.playerId, e.value, e.rank])) === JSON.stringify(b.map((e) => [e.playerId, e.value, e.rank]));
  for (const key of ["all", ...CLASS_KEYS] as const) {
    const inScope = (id: string) => active.has(id) && (key === "all" || classKeyById.get(id) === key);
    const t = top.byActive![key];
    for (const venue of venues) {
      for (const gt of GAME_TYPES) {
        for (const [stat, byPlayer] of Object.entries(rankings[venue][gt])) {
          const want = topOf(Object.entries(byPlayer).filter(([id]) => inScope(id)).map(([id, e]) => ({ playerId: id, value: e.value })));
          const have = t[venue][gt][stat] ?? [];
          tables += 1;
          notActive += have.filter((e) => !active.has(e.playerId)).length;
          if (!same(want, have)) diffs.push(`${key} ${venue} ${gt} ${stat}`);
        }
      }
    }
    // 回数・在籍: 各選手の最新の累計
    const latest = new Map<string, Record<string, number | undefined>>();
    for (const s of Object.keys(careers?.seasons ?? {}).sort()) for (const [id, c] of Object.entries(careers!.seasons[s]!)) latest.set(id, c as unknown as Record<string, number | undefined>);
    for (const [stat, have] of Object.entries(t.careerCounts)) {
      const want = topOf([...latest].filter(([id]) => inScope(id) && rankings.players[id] !== undefined).map(([id, c]) => ({ playerId: id, value: c[stat] ?? 0 })).filter((e) => e.value > 0));
      tables += 1;
      notActive += have.filter((e) => !active.has(e.playerId)).length;
      if (!same(want, have)) diffs.push(`${key} 回数・在籍 ${stat}`);
    }
  }
  check(`通算記録（byActive）の${tables}表に、現役でない選手が1人もいない`, notActive === 0, `${notActive}件`);
  check(`通算記録（byActive）が、全選手の順位から現役だけを取り出して順位をつけ直した上位20位と一致する（${tables}表）`, diffs.length === 0, diffs.slice(0, 8).join(" / "));
  const allTop = top.byActive!.all.career.regular.pts!.slice(0, 5).map((e) => `${e.rank}位 ${top.players[e.playerId]?.name} ${e.value}`);
  console.log(`   現役の通算得点（レギュラー）上位: ${allTop.join(" / ")}`);
  const fullTop = top.career.regular.pts!.slice(0, 5).map((e) => `${e.rank}位 ${top.players[e.playerId]?.name} ${e.value}`);
  console.log(`   全選手の通算得点（レギュラー）上位: ${fullTop.join(" / ")}`);
  check("感度: 全選手の通算得点の上位20位に、現役でない選手が含まれる（絞り込みが効いている）", top.career.regular.pts!.some((e) => !active.has(e.playerId)));
}

// ---- 3. 索引から作る表 ----
const seasons = readdirSync(DATA_DIR)
  .filter((s) => /^\d{4}-\d{2}$/.test(s) && existsSync(path.join(DATA_DIR, s, "player-game-index.json.gz")))
  .sort();
const views = [];
const pairData = [];
for (const s of seasons) {
  const index = viewPlayerGameIndex((await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, s, "player-game-index.json")))!);
  views.push(index);
  pairData.push({ pairs: (await readJson<AssistPairsFile>(path.join(DATA_DIR, s, "assist-pairs.json")))!, index });
}
const gameTypes = ["regular", "playoff", "both"] as const;
{
  // 歴代の1試合記録
  const stats = playerQueryStats("record");
  let compared = 0;
  const bad: string[] = [];
  let nonActiveInUnfilteredTop = 0;
  for (const stat of stats) {
    for (const gameType of gameTypes) {
      const base = { views, gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all" as const, positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies: null, stat, includeSpecial: true, topN: ALL };
      const full = queryPlayerGameRecords(base).rows;
      const got = queryPlayerGameRecords({ ...base, activeIds: active }).rows;
      const kept = full.filter((r) => active.has(r.playerId));
      const wantKeys = kept.map((r) => `${r.scheduleKey}-${r.playerId}:${r.value}`);
      const haveKeys = got.map((r) => `${r.scheduleKey}-${r.playerId}:${r.value}`);
      compared += 1;
      if (got.some((r) => !active.has(r.playerId))) bad.push(`${stat.key} ${gameType}: 現役でない選手が出る`);
      if (JSON.stringify(wantKeys) !== JSON.stringify(haveKeys)) bad.push(`${stat.key} ${gameType}: 絞り込み前から現役だけを残した並びと一致しない`);
      if (full.slice(0, 20).some((r) => !active.has(r.playerId))) nonActiveInUnfilteredTop += 1;
    }
  }
  check(`歴代の1試合記録（${stats.length}項目 × 試合区分3）: 現役の指定が、絞り込み前から現役だけを残した並びと一致し、現役でない選手が出ない（${compared}表）`, bad.length === 0, bad.slice(0, 6).join(" / "));
  check("感度: 絞り込み前の上位20位に現役でない選手が含まれる表がある", nonActiveInUnfilteredTop > 0, `${nonActiveInUnfilteredTop}表`);
}
{
  // 勝負所（通算）
  let compared = 0;
  const bad: string[] = [];
  for (const window of ["5", "2", "1"] as const) {
    for (const measure of ["goAhead", "tie", "winner"] as const) {
      for (const gameType of gameTypes) {
        const base = { views, gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all" as const, rookies: null, measure, window, topN: ALL };
        const full = queryClutch(base).rows;
        const got = queryClutch({ ...base, activeIds: active }).rows;
        const kept = full.filter((r) => active.has(r.playerId));
        const fmt = (r: { playerId: string; value: number; fg: number; ft: number }) => `${r.playerId}:${r.value}:${r.fg}:${r.ft}`;
        compared += 1;
        if (got.some((r) => !active.has(r.playerId))) bad.push(`${window}分 ${measure} ${gameType}: 現役でない選手が出る`);
        if (JSON.stringify(kept.map(fmt)) !== JSON.stringify(got.map(fmt))) bad.push(`${window}分 ${measure} ${gameType}: 並びが一致しない`);
      }
    }
  }
  check(`勝負所（通算）: 窓3 × 種類3 × 試合区分3 の${compared}表で、現役の指定が現役だけを残した並びと一致し、現役でない選手が出ない`, bad.length === 0, bad.slice(0, 6).join(" / "));
}
{
  // アシストペア（1試合・通算）。両方が現役の組だけ
  let compared = 0;
  const bad: string[] = [];
  let someNonActive = 0;
  for (const unit of ["game", "career"] as PairUnit[]) {
    for (const gameType of gameTypes) {
      const base = { data: pairData, gameType, conditions: DEFAULT_GAME_RECORD_CONDITIONS, unit, topN: ALL };
      const full = queryAssistPairs(base).rows;
      const got = queryAssistPairs({ ...base, activeIds: active }).rows;
      const kept = full.filter((r) => active.has(r.assisterId) && active.has(r.scorerId));
      const fmt = (r: { assisterId: string; scorerId: string; value: number; scheduleKey?: string }) => `${r.assisterId}>${r.scorerId}:${r.value}:${r.scheduleKey ?? ""}`;
      compared += 1;
      if (got.some((r) => !active.has(r.assisterId) || !active.has(r.scorerId))) bad.push(`${unit} ${gameType}: 現役でない選手が出る`);
      if (JSON.stringify(kept.map(fmt)) !== JSON.stringify(got.map(fmt))) bad.push(`${unit} ${gameType}: 並びが一致しない`);
      if (full.slice(0, 20).some((r) => !active.has(r.assisterId) || !active.has(r.scorerId))) someNonActive += 1;
    }
  }
  check(`アシストペア（1試合・通算 × 試合区分3）: 現役の指定が、両方が現役の組だけを残した並びと一致し、現役でない選手が出ない（${compared}表）`, bad.length === 0, bad.slice(0, 6).join(" / "));
  check("感度: 絞り込み前の上位20位に、現役でない選手を含む組がある", someNonActive > 0, `${someNonActive}表`);
}

console.log(failures === 0 ? "\nすべて ok" : `\n${failures} 件の食い違い`);
process.exit(failures === 0 ? 0 : 1);
