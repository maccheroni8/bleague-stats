// ランキング > 個人 > 勝負所・アシストペア・被アシスト率（DESIGN.md 221章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 導出データを作ったあと（`npm run build:data` のあと）に実行する。独立した元から数え直した結果と比べる:
//  1. 勝負所: 選手の試合ログ（player-games/ の clutch）から足し上げた順位が、索引から集計した結果（queryClutch）と完全に一致する。窓5分・2分・1分 × 勝ち越し・同点・決勝点 × 試合区分 × 通算・各シーズン、
//     条件（勝った試合・延長あり・ホーム）つき。同じ値の中は選手IDの昇順
//  2. アシストペア: 生データから作り直したペア（computeAssistedScoring）を足し上げた順位が、queryAssistPairs と一致する（1試合・シーズン・通算 × 試合区分、条件つき）。同じ値の中の並び（IDの昇順→日付）
//  3. 被アシスト率: 1試合記録（league-player-game-records.json・シーズンごとの player-game-records.json）と通算（league-player-career-top.json）が、試合ログから数え直した値と一致する
//
// 使い方: npm run validate:clutch-query（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import { withChronologicalPlayByPlays } from "../shared/pbpOrder.ts";
import { computeAssistedScoring } from "../shared/assistedScoring.ts";
import { assistPairPoints, type AssistPairsFile } from "../shared/assistPairs.ts";
import { CLUTCH_LENGTH } from "../shared/gameFlow.ts";
import { PLAYER_ASTED_MIN_POINTS, assistedPoints } from "../shared/playerGameRecords.ts";
import { PLAYER_CAREER_ASTED_MIN_POINTS } from "../shared/playerRecords.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import type { GameSummary, LeaguePlayerCareerTopFile, LeaguePlayerGameRecordsFile, PlayerGameLog, PlayerGameRecordsFile } from "../shared/types.ts";
import { viewPlayerGameIndex } from "../src/lib/gameIndex.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS, type GameRecordConditions } from "../src/lib/gameRecordConditions.ts";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions.ts";
import { CLUTCH_MEASURES, CLUTCH_WINDOWS, queryAssistPairs, queryClutch, type ClutchMeasure, type ClutchWindowKey, type PairUnit } from "../src/lib/clutchQuery.ts";
import { PLAYER_GAME_RECORD_STATS } from "../shared/playerGameRecords.ts";
import { playerQueryStats, queryPlayerGameRecords } from "../src/lib/gameRecordQuery.ts";
void DEFAULT_STAT_CONDITIONS;
void playerQueryStats;
void queryPlayerGameRecords;
void PLAYER_GAME_RECORD_STATS;

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

const ALL = 1_000_000;
const GAME_TYPES = ["regular", "playoff", "both"] as const;
type GameTypeKey = (typeof GAME_TYPES)[number];

const seasons = readdirSync(DATA_DIR)
  .filter((s) => /^\d{4}-\d{2}$/.test(s) && existsSync(path.join(DATA_DIR, s, "player-game-index.json.gz")))
  .sort();

const views = new Map<string, ReturnType<typeof viewPlayerGameIndex>>();
const pairFiles = new Map<string, AssistPairsFile>();
const logsBySeason = new Map<string, Map<string, PlayerGameLog[]>>();
for (const s of seasons) {
  views.set(s, viewPlayerGameIndex((await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, s, "player-game-index.json")))!));
  pairFiles.set(s, (await readJson<AssistPairsFile>(path.join(DATA_DIR, s, "assist-pairs.json")))!);
  const byPlayer = new Map<string, PlayerGameLog[]>();
  const dir = path.join(DATA_DIR, s, "player-games");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json.gz"))) {
    const id = f.replace(/\.json\.gz$/, "");
    byPlayer.set(id, ((await readJson<PlayerGameLog[]>(path.join(dir, `${id}.json`))) ?? []).filter((g) => g.min > 0 && (g.gameType === "regular" || g.gameType === "playoff")));
  }
  logsBySeason.set(s, byPlayer);
}
const summaryKeys = new Map<string, Set<string>>();
for (const s of seasons) {
  const sums = (await readJson<GameSummary[]>(path.join(DATA_DIR, s, "games-summary.json"))) ?? [];
  summaryKeys.set(s, new Set(sums.filter((x) => x.gameType === "regular" || x.gameType === "playoff").map((x) => x.scheduleKey)));
}

const typeOk = (g: PlayerGameLog, t: GameTypeKey) => (t === "both" ? true : g.gameType === t);
const conds: { label: string; c: GameRecordConditions; ok: (g: PlayerGameLog) => boolean }[] = [
  { label: "条件なし", c: DEFAULT_GAME_RECORD_CONDITIONS, ok: () => true },
  { label: "勝った試合", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, result: "win" }, ok: (g) => g.win },
  { label: "延長あり", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, overtime: "any" }, ok: (g) => (g.overtimes ?? 0) >= 1 },
  { label: "ホーム×負けた試合", c: { ...DEFAULT_GAME_RECORD_CONDITIONS, homeAway: "home", result: "loss" }, ok: (g) => g.isHome && !g.win },
];

// ---- 1. 勝負所 ----
{
  let compared = 0;
  const bad: string[] = [];
  for (const window of CLUTCH_WINDOWS) {
    for (const measure of CLUTCH_MEASURES) {
      const k = CLUTCH_MEASURES.indexOf(measure);
      const w = CLUTCH_WINDOWS.indexOf(window);
      for (const gameType of GAME_TYPES) {
        for (const cond of conds) {
          for (const scope of ["career", ...seasons.filter((s) => s === "2016-17" || s === "2025-26")]) {
            const useSeasons = scope === "career" ? seasons : [scope];
            // 独立した数え直し: 試合ログの clutch の配列を、選手ごとに足す
            const sum = new Map<string, { fg: number; ft: number }>();
            for (const s of useSeasons) {
              for (const [id, logs] of logsBySeason.get(s)!) {
                for (const g of logs) {
                  if (!summaryKeys.get(s)!.has(g.scheduleKey) || !typeOk(g, gameType) || !cond.ok(g)) continue;
                  const fg = g.clutch?.[w * 6 + k * 2] ?? 0;
                  const ft = g.clutch?.[w * 6 + k * 2 + 1] ?? 0;
                  if (fg + ft === 0) continue;
                  const a = sum.get(id) ?? { fg: 0, ft: 0 };
                  a.fg += fg;
                  a.ft += ft;
                  sum.set(id, a);
                }
              }
            }
            const expected = [...sum].map(([id, a]) => ({ id, value: a.fg + a.ft, fg: a.fg, ft: a.ft })).sort((a, b) => b.value - a.value || (a.id < b.id ? -1 : 1));
            const got = queryClutch({
              views: useSeasons.map((s) => views.get(s)!),
              gameType,
              conditions: cond.c,
              group: "all",
              rookies: null,
              measure: measure as ClutchMeasure,
              window: window as ClutchWindowKey,
              topN: ALL,
            }).rows;
            compared += 1;
            let rank = 0;
            const want = expected.map((e, i) => {
              if (i === 0 || e.value !== expected[i - 1]!.value) rank = i + 1;
              return `${rank}:${e.id}:${e.value}:${e.fg}:${e.ft}`;
            });
            const have = got.map((r) => `${r.rank}:${r.playerId}:${r.value}:${r.fg}:${r.ft}`);
            if (JSON.stringify(want) !== JSON.stringify(have)) bad.push(`${scope} ${gameType} ${window}分 ${measure} ${cond.label}: 索引 ${have.slice(0, 3).join(",")}… / 試合ログ ${want.slice(0, 3).join(",")}…`);
          }
        }
      }
    }
  }
  check(`勝負所: 試合ログから足し上げた順位と一致（${compared}通り。窓×種類×試合区分×条件×通算・シーズン）`, bad.length === 0, `${bad.length}件\n   ${bad.slice(0, 4).join("\n   ")}`);

  // 例: 通算の残り2分の勝ち越し弾の上位3
  const top = queryClutch({ views: seasons.map((s) => views.get(s)!), gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", rookies: null, measure: "goAhead", window: "2" }).rows;
  console.log(`   通算（レギュラー+ポスト）残り2分の勝ち越し弾 上位3: ${top.slice(0, 3).map((r) => `${r.playerName} ${r.value}(FG${r.fg}・FT${r.ft})`).join(" / ")}`);
  // 試合ごとの合計の整合: 決勝点は1試合に1つまで（試合数以内）
  const winnerTotal = queryClutch({ views: seasons.map((s) => views.get(s)!), gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", rookies: null, measure: "winner", window: "5", topN: ALL }).rows.reduce((a, r) => a + r.value, 0);
  const totalGames = seasons.reduce((a, s) => a + views.get(s)!.file.games.key.length, 0);
  check("勝負所: 決勝点（残り5分）の合計が、試合数を超えない", winnerTotal <= totalGames, `${winnerTotal} / ${totalGames}`);
}

// ---- 2. アシストペア ----
{
  // 独立した数え直し: 生データから試合ごとのペアを作る
  interface G { season: string; key: string; date: string; pairs: { a: string; s: string; n2: number; n3: number; nf: number }[]; players: Map<string, PlayerGameLog> }
  const games: G[] = [];
  for (const s of seasons) {
    const logIndex = new Map<string, PlayerGameLog>();
    for (const [id, logs] of logsBySeason.get(s)!) for (const g of logs) logIndex.set(`${id}:${g.scheduleKey}`, g);
    for (const raw of await readAllGames(s)) {
      if (!summaryKeys.get(s)!.has(raw.scheduleKey)) continue;
      const pairs = [...computeAssistedScoring(withChronologicalPlayByPlays(raw).raw.PlayByPlays ?? []).pairs.values()].map((p) => ({ a: p.assisterId, s: p.scorerId, n2: p.assisted2m, n3: p.assisted3m, nf: p.assistedFtm }));
      const players = new Map<string, PlayerGameLog>();
      for (const p of pairs) {
        const l = logIndex.get(`${p.s}:${raw.scheduleKey}`);
        if (l) players.set(p.s, l);
      }
      games.push({ season: s, key: raw.scheduleKey, date: raw.date, pairs, players });
    }
  }
  const bad: string[] = [];
  let compared = 0;
  for (const unit of ["game", "season", "career"] as PairUnit[]) {
    for (const gameType of GAME_TYPES) {
      for (const cond of conds) {
        for (const scope of unit === "season" ? ["2016-17", "2025-26"] : ["all"]) {
          const useSeasons = scope === "all" ? seasons : [scope];
          const expectedRows: { id: string; value: number; extra: string; sortKey: string }[] = [];
          const acc = new Map<string, { n2: number; n3: number; nf: number; games: number }>();
          for (const g of games) {
            if (!useSeasons.includes(g.season)) continue;
            for (const p of g.pairs) {
              const scorerLog = g.players.get(p.s);
              if (!scorerLog || !typeOk(scorerLog, gameType) || !cond.ok(scorerLog)) continue;
              if (unit === "game") {
                expectedRows.push({ id: `${p.a}>${p.s}`, value: assistPairPoints({ n2: p.n2, n3: p.n3, nf: p.nf }), extra: `${g.key}:${p.n2},${p.n3},${p.nf}`, sortKey: `${p.a}|${p.s}|${g.date}|${g.key}` });
              } else {
                const a = acc.get(`${p.a}>${p.s}`) ?? { n2: 0, n3: 0, nf: 0, games: 0 };
                a.n2 += p.n2;
                a.n3 += p.n3;
                a.nf += p.nf;
                a.games += 1;
                acc.set(`${p.a}>${p.s}`, a);
              }
            }
          }
          if (unit !== "game") for (const [id, a] of acc) expectedRows.push({ id, value: assistPairPoints(a), extra: `${a.games}:${a.n2},${a.n3},${a.nf}`, sortKey: id });
          expectedRows.sort((x, y) => y.value - x.value || (x.sortKey < y.sortKey ? -1 : x.sortKey > y.sortKey ? 1 : 0));
          const data = useSeasons.map((s) => ({ pairs: pairFiles.get(s)!, index: views.get(s)! }));
          const got = queryAssistPairs({ data, gameType, conditions: cond.c, unit, topN: ALL }).rows;
          compared += 1;
          let rank = 0;
          const want = expectedRows.map((e, i) => {
            if (i === 0 || e.value !== expectedRows[i - 1]!.value) rank = i + 1;
            return `${rank}:${e.id}:${e.value}:${e.extra}`;
          });
          const have = got.map((r) => `${r.rank}:${r.assisterId}>${r.scorerId}:${r.value}:${unit === "game" ? `${r.scheduleKey}:` : `${r.games}:`}${r.n2},${r.n3},${r.nf}`);
          if (JSON.stringify(want) !== JSON.stringify(have)) bad.push(`${unit} ${scope} ${gameType} ${cond.label}: 索引 ${have.slice(0, 2).join(",")}… / 生データ ${want.slice(0, 2).join(",")}…`);
        }
      }
    }
  }
  check(`アシストペア: 生データから作り直したペアを足し上げた順位と一致（${compared}通り。1試合・シーズン・通算 × 試合区分 × 条件）`, bad.length === 0, `${bad.length}件\n   ${bad.slice(0, 4).join("\n   ")}`);
  const top = queryAssistPairs({ data: seasons.map((s) => ({ pairs: pairFiles.get(s)!, index: views.get(s)! })), gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, unit: "career" }).rows;
  console.log(`   通算（レギュラー+ポスト）上位3: ${top.slice(0, 3).map((r) => `${r.assisterName}→${r.scorerName} ${r.value}点(${r.games}試合)`).join(" / ")}`);
}

// ---- 3. 被アシスト率 ----
{
  // 1試合記録（歴代）: 試合ログから数え直した上位（得点20以上。率→得点の多い順→新しい試合→選手ID）が、ファイルと一致
  const all: { id: string; season: string; key: string; date: string; rate: number; pts: number; ap: number }[] = [];
  for (const s of seasons) for (const [id, logs] of logsBySeason.get(s)!) for (const g of logs) if (summaryKeys.get(s)!.has(g.scheduleKey) && g.pts >= PLAYER_ASTED_MIN_POINTS) all.push({ id, season: s, key: g.scheduleKey, date: g.date, rate: assistedPoints(g) / g.pts, pts: g.pts, ap: assistedPoints(g) });
  for (const t of ["regular", "playoff", "both"] as const) {
    const pool = all.filter((r) => (t === "both" ? true : logsBySeason.get(r.season)!.get(r.id)!.find((g) => g.scheduleKey === r.key)!.gameType === t));
    pool.sort((a, b) => b.rate - a.rate || b.pts - a.pts || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const file = (await readJson<LeaguePlayerGameRecordsFile>(path.join(DATA_DIR, "league-player-game-records.json")))!;
    const entries = file.byGameType[t]["astedPct"] ?? [];
    let rank = 0;
    const want = pool.map((r, i) => {
      if (i === 0 || r.rate !== pool[i - 1]!.rate) rank = i + 1;
      return { rank, key: `${r.season}-${r.key}-${r.id}`, v: r.rate, made: r.ap, attempted: r.pts };
    }).filter((r) => r.rank <= 20);
    const have = entries.map((e) => ({ rank: e.rank, key: `${e.season}-${e.scheduleKey}-${e.playerId}`, v: e.value, made: e.made, attempted: e.attempted }));
    check(`被アシスト率 1試合記録（歴代・${t}）: 試合ログから数え直した上位${want.length}件と一致`, JSON.stringify(want) === JSON.stringify(have), `${JSON.stringify(have.slice(0, 2))} / ${JSON.stringify(want.slice(0, 2))}`);
    if (t === "both") console.log(`   歴代1位タイ ${want.filter((r) => r.rank === 1).length}件（得点${PLAYER_ASTED_MIN_POINTS}点以上で100%）、先頭: ${want.slice(0, 2).map((r) => `${r.key} ${r.attempted}点`).join(" / ")}`);
  }
  // シーズンごとのファイル（2025-26）
  const sf = (await readJson<PlayerGameRecordsFile>(path.join(DATA_DIR, "2025-26", "player-game-records.json")))!;
  const s2526 = all.filter((r) => r.season === "2025-26" && logsBySeason.get(r.season)!.get(r.id)!.find((g) => g.scheduleKey === r.key)!.gameType !== "playoff");
  s2526.sort((a, b) => b.rate - a.rate || b.pts - a.pts || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.id < b.id ? -1 : 1));
  check("被アシスト率 1試合記録（2025-26・レギュラー）: 先頭の値が試合ログと一致", (sf.byGameType.regular["astedPct"]?.[0]?.value ?? -1) === s2526[0]!.rate);

  // 通算: 通算得点が最低得点以上の選手の率を、試合ログから数え直す
  const career = new Map<string, { pts: number; ap: number }>();
  for (const s of seasons) for (const [id, logs] of logsBySeason.get(s)!) for (const g of logs) if (summaryKeys.get(s)!.has(g.scheduleKey)) {
    const c = career.get(id) ?? { pts: 0, ap: 0 };
    c.pts += g.pts;
    c.ap += assistedPoints(g);
    career.set(id, c);
  }
  const eligible = [...career].filter(([, c]) => c.pts >= PLAYER_CAREER_ASTED_MIN_POINTS).map(([id, c]) => ({ id, rate: c.ap / c.pts })).sort((a, b) => b.rate - a.rate || Number(a.id) - Number(b.id));
  const top = (await readJson<LeaguePlayerCareerTopFile>(path.join(DATA_DIR, "league-player-career-top.json")))!;
  const entries = top.career.both["astedPct"] ?? [];
  let rank = 0;
  const want = eligible.map((r, i) => {
    if (i === 0 || r.rate !== eligible[i - 1]!.rate) rank = i + 1;
    return `${rank}:${r.id}:${r.rate}`;
  }).filter((s) => Number(s.split(":")[0]) <= 20);
  check(`被アシスト率 通算（レギュラー+ポスト）: 通算${PLAYER_CAREER_ASTED_MIN_POINTS}点以上の選手の上位${want.length}件が、試合ログから数え直した値と一致（対象 ${eligible.length}人）`, JSON.stringify(want) === JSON.stringify(entries.map((e) => `${e.rank}:${e.playerId}:${e.value}`)), `${entries.slice(0, 2).map((e) => `${e.rank}:${e.playerId}:${e.value}`)} / ${want.slice(0, 2)}`);
}

// 感度: 窓を取り違えると結果が変わる（窓5分と2分で、通算の勝ち越し弾の合計が違う）
{
  const sumOf = (window: ClutchWindowKey) => queryClutch({ views: seasons.map((s) => views.get(s)!), gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", rookies: null, measure: "goAhead", window, topN: ALL }).rows.reduce((a, r) => a + r.value, 0);
  check("感度: 窓を変えると勝ち越し弾の合計が変わる（5分 > 2分 > 1分）", sumOf("5") > sumOf("2") && sumOf("2") > sumOf("1"), `${sumOf("5")} ${sumOf("2")} ${sumOf("1")}`);
}

void CLUTCH_LENGTH;
if (failures > 0) {
  console.error(`\n${failures}項目がNG`);
  process.exit(1);
}
console.log("\n全項目 ok");
