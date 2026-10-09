// ランキング > 個人 > On/Off・組み合わせ（DESIGN.md 224章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 導出データを作ったあと（`npm run build:data` のあと）に実行する。計算の核（shared/onCourtTotals.ts）と集計（src/lib/lineupRanking.ts）を、
// チーム詳細のラインナップ検索（src/lib/lineupSearch.ts の searchLineup。207章）と、独立した元（games-summary.json・team-games/・players.json・出場区間の生データ）から素直に数え直した結果と比べる:
//  1. 出場区間: 索引のチーム辞書のチームすべてに出場区間のファイルがあり、出場区間の選手すべてが索引の選手辞書にいる
//  2. 核（On/Off）: 全選手の On・Off が searchLineup と一致（試合区分3 × ピリオド3通り）。核（2人・3人）: 出た組すべてが searchLineup の On と一致（大きいシーズンは間引く）、出ていない組は On が空
//  3. 試合の条件: 索引の事実の表で判定した試合の集合が、試合の要約・チームの試合ログから求めた集合と一致（試合区分・ホーム/アウェイ・勝敗・対戦相手・延長）
//  4. 集計: 下限の適用（チームのポゼッション × 割合、絶対の下限）、登録区分・ポジション・現役・ルーキー（索引の選手辞書から別に求めた結果と一致）、通算（シーズンごとの合計）
//  5. 画面の実測の例（2025-26 レギュラーシーズン）: On/Off差の上位5人・下位5人、2人の組の上位5組が、実測した値と一致
//  6. 感度（下限を変えると結果が変わる）
//
// 使い方: npm run validate:lineup-ranking（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import { compactStints, onCourtByGroup, onOffByPlayer, teamTotals, type CompactStints } from "../shared/onCourtTotals.ts";
import type { GameSummary, PlayerSummary, RookieEligibilityFile, TeamGameLog, TeamStintsFile } from "../shared/types.ts";
import { viewPlayerGameIndex, type PlayerGameIndexView } from "../src/lib/gameIndex.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS, type GameRecordConditions } from "../src/lib/gameRecordConditions.ts";
import { gameFacts, matchesGame } from "../src/lib/gameRecordQuery.ts";
import {
  LINEUP_MIN_POSSESSIONS,
  lineupSeasonSupported,
  lineupValue,
  minPossessions,
  queryLineupRanking,
  sideRatings,
  type LineupQuery,
  type LineupRow,
  type LineupSeasonData,
  type LineupUnit,
} from "../src/lib/lineupRanking.ts";
import { searchLineup } from "../src/lib/lineupSearch.ts";
import { positionFilterValue, type PlayerGroupFilter } from "../src/lib/classificationFilter.ts";
import { formatSigned } from "../src/lib/format.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

/** 多数の比較を1つのチェックにまとめる */
class Group {
  total = 0;
  badCount = 0;
  bad: string[] = [];
  constructor(readonly label: string) {}
  add(ok: boolean, detail: () => string): void {
    this.total += 1;
    if (!ok) {
      this.badCount += 1;
      if (this.bad.length < 5) this.bad.push(detail());
    }
  }
  report(): void {
    check(`${this.label}（${this.total}件）`, this.badCount === 0, `${this.badCount}件の食い違い\n   ${this.bad.join("\n   ")}`);
  }
}

const KEYS = ["pts", "poss"] as const;
const seasons = readdirSync(DATA_DIR)
  .filter((s) => /^\d{4}-\d{2}$/.test(s) && lineupSeasonSupported(s) && existsSync(path.join(DATA_DIR, s, "player-game-index.json.gz")))
  .sort();

interface SeasonRaw {
  season: string;
  view: PlayerGameIndexView;
  raw: Map<string, TeamStintsFile>;
  compact: Map<string, CompactStints>;
  summaries: GameSummary[];
  teamGames: Map<string, TeamGameLog[]>;
}

const all: SeasonRaw[] = [];
for (const season of seasons) {
  const view = viewPlayerGameIndex((await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, season, "player-game-index.json")))!);
  const raw = new Map<string, TeamStintsFile>();
  const compact = new Map<string, CompactStints>();
  const teamGames = new Map<string, TeamGameLog[]>();
  const summaries = ((await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? []).filter(
    (g) => (g.gameType === "regular" || g.gameType === "playoff") && g.gameEndedFlg,
  );
  for (const t of view.file.teams) {
    const f = await readJson<TeamStintsFile>(path.join(DATA_DIR, season, "team-stints", `${t[0]}.json`));
    if (!f) continue;
    raw.set(t[0], f);
    compact.set(t[0], compactStints(f));
    teamGames.set(t[0], (await readJson<TeamGameLog[]>(path.join(DATA_DIR, season, "team-games", `${t[0]}.json`))) ?? []);
  }
  all.push({ season, view, raw, compact, summaries, teamGames });
}
console.log(`シーズン ${seasons.join("・")}`);

// ---- 1. 出場区間と索引の対応 ----
{
  const missing: string[] = [];
  const unknownPlayers: string[] = [];
  let teams = 0;
  let stintPlayers = 0;
  for (const s of all) {
    const dictIds = new Set(s.view.file.players.map((p) => p[0]));
    for (const t of s.view.file.teams) {
      teams += 1;
      if (!s.raw.has(t[0])) missing.push(`${s.season} ${t[0]} ${t[1]}`);
    }
    for (const f of s.raw.values()) {
      for (const id of f.players) {
        stintPlayers += 1;
        // 出場時間が0の選手は索引に入らない（時間のある区間にいた選手だけを数える）
        const seconds = f.rows.some((r) => r[3]! > r[2]! && r.slice(4, 9).includes(f.players.indexOf(id)));
        if (seconds && !dictIds.has(id)) unknownPlayers.push(`${s.season} ${f.teamId} ${id}`);
      }
    }
  }
  check(`索引のチーム辞書のチームすべてに出場区間がある（${teams}チーム・シーズン）`, missing.length === 0, missing.slice(0, 5).join("\n   "));
  check(`出場区間で時間のある選手すべてが索引の選手辞書にいる（${stintPlayers}選手・チーム・シーズン）`, unknownPlayers.length === 0, unknownPlayers.slice(0, 5).join("\n   "));
}

// ---- 2. 核 ----
{
  const gOnOff = new Group("核（On/Off）が searchLineup と一致");
  const gGroup = new Group("核（2人・3人）が searchLineup と一致");
  const gEmpty = new Group("同時に出ていない組の On は空");
  for (const s of all) {
    const byKey = new Map(s.summaries.map((g) => [g.scheduleKey, g.gameType]));
    const configs = [
      { name: "レギュラー", includeGame: (k: string) => byKey.get(k) === "regular", periods: null as number[] | null },
      { name: "ポストシーズン", includeGame: (k: string) => byKey.get(k) === "playoff", periods: null },
      { name: "合算・1Q", includeGame: (k: string) => byKey.has(k), periods: [1] },
      { name: "合算・延長", includeGame: (k: string) => byKey.has(k), periods: [5] },
    ];
    // 2人・3人は、組が多いので、大きいシーズンは間引く（組の番号で8つに1つ）
    const stride = s.season === "2025-26" || s.season === "2020-21" ? 1 : 6;
    let rng = 12345;
    const rand = () => (rng = (rng * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const cfg of configs) {
      for (const [teamId, file] of s.raw) {
        const c = s.compact.get(teamId)!;
        const opts = { includeGame: cfg.includeGame, periods: cfg.periods, keys: KEYS };
        const onOff = onOffByPlayer(c, opts);
        const same = (a: ReturnType<typeof searchLineup>, b: ReturnType<typeof teamTotals>) =>
          a.games === b.games && a.seconds === b.seconds && a.ownPoints === b.own[0] && a.oppPoints === b.opp[0] && a.ownPoss === b.own[1] && a.oppPoss === b.opp[1];
        for (const id of file.players) {
          const got = onOff.get(id);
          const ref = { on: searchLineup(file, [id], "on", cfg), off: searchLineup(file, [id], "off", cfg) };
          if (!got) {
            gOnOff.add(ref.on.games === 0 && ref.on.seconds === 0, () => `${s.season} ${cfg.name} ${teamId} ${id}: 核に無いが searchLineup の On は ${JSON.stringify(ref.on)}`);
            continue;
          }
          gOnOff.add(same(ref.on, got.on) && same(ref.off, got.off), () => `${s.season} ${cfg.name} ${teamId} ${id}: On ${JSON.stringify(ref.on)} / ${JSON.stringify(got.on)}、Off ${JSON.stringify(ref.off)} / ${JSON.stringify(got.off)}`);
        }
        if (cfg.name !== "レギュラー" && cfg.name !== "合算・1Q") continue;
        for (const size of [2, 3] as const) {
          const groups = onCourtByGroup(c, size, opts);
          const seen = new Set(groups.map((g) => g.playerIds.join(",")));
          groups.forEach((g, i) => {
            if (i % stride !== 0) return;
            const ref = searchLineup(file, g.playerIds, "on", cfg);
            gGroup.add(same(ref, g.on), () => `${s.season} ${cfg.name} ${teamId} ${g.playerIds.join("・")}: ${JSON.stringify(ref)} / ${JSON.stringify(g.on)}`);
          });
          // 出ていない組（無作為に200組）は、searchLineup でも On が空
          for (let n = 0; n < 200 && file.players.length >= size; n++) {
            const picked = new Set<number>();
            while (picked.size < size) picked.add(Math.floor(rand() * file.players.length));
            const ids = [...picked].sort((a, b) => a - b).map((p) => file.players[p]!);
            if (seen.has(ids.join(","))) continue;
            const ref = searchLineup(file, ids, "on", cfg);
            gEmpty.add(ref.games === 0 && ref.seconds === 0, () => `${s.season} ${cfg.name} ${teamId} ${ids.join("・")}: ${JSON.stringify(ref)}`);
          }
        }
      }
    }
  }
  gOnOff.report();
  gGroup.report();
  gEmpty.report();
}

// ---- 3. 試合の条件 ----
{
  const g = new Group("試合の条件（索引の事実の表）が、要約・試合ログから求めた集合と一致");
  for (const s of all) {
    const facts = gameFacts(s.view.file);
    const indexOf = new Map(s.view.file.games.key.map((k, i) => [k, i] as const));
    const summaryOf = new Map(s.summaries.map((x) => [x.scheduleKey, x]));
    const oppSample = s.view.file.teams[0]![0];
    const cases: { name: string; gameType: "regular" | "playoff" | "both"; cond: GameRecordConditions; ref: (x: GameSummary, teamId: string, log: TeamGameLog | undefined) => boolean }[] = [
      { name: "レギュラー", gameType: "regular", cond: DEFAULT_GAME_RECORD_CONDITIONS, ref: (x) => x.gameType === "regular" },
      { name: "ポストシーズン", gameType: "playoff", cond: DEFAULT_GAME_RECORD_CONDITIONS, ref: (x) => x.gameType === "playoff" },
      { name: "合算", gameType: "both", cond: DEFAULT_GAME_RECORD_CONDITIONS, ref: () => true },
      { name: "レギュラー・ホーム", gameType: "regular", cond: { opponents: [], homeAway: "home" }, ref: (x, t) => x.gameType === "regular" && x.homeTeamId === t },
      { name: "レギュラー・アウェイ", gameType: "regular", cond: { opponents: [], homeAway: "away" }, ref: (x, t) => x.gameType === "regular" && x.awayTeamId === t },
      { name: "合算・勝った試合", gameType: "both", cond: { opponents: [], result: "win" }, ref: (x, t) => (x.homeTeamId === t ? x.homeScore > x.awayScore : x.awayScore > x.homeScore) },
      { name: "合算・負けた試合", gameType: "both", cond: { opponents: [], result: "loss" }, ref: (x, t) => (x.homeTeamId === t ? x.homeScore < x.awayScore : x.awayScore < x.homeScore) },
      { name: "合算・延長あり", gameType: "both", cond: { opponents: [], overtime: "any" }, ref: (x) => (x.overtimes ?? 0) >= 1 },
      { name: "合算・対戦相手", gameType: "both", cond: { opponents: [oppSample] }, ref: (x, t) => (x.homeTeamId === t ? x.awayTeamId : x.homeTeamId) === oppSample },
    ];
    for (const cs of cases) {
      for (const [teamId, file] of s.raw) {
        const ours = new Set<string>();
        const refSet = new Set<string>();
        for (const key of file.games) {
          const gi = indexOf.get(key);
          const x = summaryOf.get(key);
          if (gi !== undefined) {
            const home = s.view.file.teams[s.view.file.games.home[gi]!]![0] === teamId;
            if (matchesGame(facts[gi * 2 + (home ? 0 : 1)]!, cs.gameType, cs.cond)) ours.add(key);
          }
          if (x && cs.ref(x, teamId, undefined)) refSet.add(key);
        }
        g.add(ours.size === refSet.size && [...ours].every((k) => refSet.has(k)), () => `${s.season} ${cs.name} ${teamId}: 索引 ${ours.size}試合 / 要約 ${refSet.size}試合`);
      }
    }
    // チームの試合ログ（チーム詳細のラインナップ検索が使う）との対応: 試合区分・ホーム/アウェイ
    for (const [teamId, file] of s.raw) {
      const logs = s.teamGames.get(teamId) ?? [];
      const reg = new Set<string>();
      const home = new Set<string>();
      for (const l of logs) {
        if (l.gameType === "regular") reg.add(l.scheduleKey);
        if (l.gameType === "regular" && l.isHome) home.add(l.scheduleKey);
      }
      const ours = (cond: GameRecordConditions) => new Set(file.games.filter((k) => {
        const gi = indexOf.get(k);
        if (gi === undefined) return false;
        const h = s.view.file.teams[s.view.file.games.home[gi]!]![0] === teamId;
        return matchesGame(facts[gi * 2 + (h ? 0 : 1)]!, "regular", cond);
      }));
      const a = ours(DEFAULT_GAME_RECORD_CONDITIONS);
      const b = ours({ opponents: [], homeAway: "home" });
      const inFile = (set: Set<string>) => new Set(file.games.filter((k) => set.has(k)));
      const eq = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every((k) => y.has(k));
      g.add(eq(a, inFile(reg)), () => `${s.season} ${teamId}: レギュラーの試合ログと不一致`);
      g.add(eq(b, inFile(home)), () => `${s.season} ${teamId}: ホームの試合ログと不一致`);
    }
  }
  g.report();
}

// ---- 4. 集計 ----
const data: LineupSeasonData[] = all.map((s) => ({ view: s.view, stints: s.compact }));
const base = (patch: Partial<LineupQuery> & { unit: LineupUnit }): LineupQuery => ({
  data,
  gameType: "regular",
  conditions: DEFAULT_GAME_RECORD_CONDITIONS,
  group: "all",
  positions: [],
  rookies: null,
  periods: null,
  sharePct: 5,
  ...patch,
});
const rookies = await readJson<RookieEligibilityFile>(path.join(DATA_DIR, "rookie-eligibility.json"));
const lastSeason = seasons[seasons.length - 1]!;
const activeIds = new Set(
  [...((await readJson<PlayerSummary[]>(path.join(DATA_DIR, lastSeason, "players.json"))) ?? []), ...((await readJson<PlayerSummary[]>(path.join(DATA_DIR, lastSeason, "registered-players.json"))) ?? [])].map((p) => p.playerId),
);

{
  const gThr = new Group("下限（チームのポゼッション × 割合、絶対100）の適用が、独立に求めた行の集合と一致（シーズンごと）");
  const gVal = new Group("行の値（On・Off）が searchLineup と一致（シーズンごと）");
  for (const s of all) {
    const byKey = new Map(s.summaries.map((g) => [g.scheduleKey, g.gameType]));
    for (const unit of ["onoff", "duo", "trio"] as const) {
      for (const sharePct of [1, 5, 15]) {
        const res = queryLineupRanking(base({ data: [{ view: s.view, stints: s.compact }], unit, sharePct }));
        // 独立: 生の出場区間から、チームのポゼッションを数え、searchLineup で行ごとの On／Off を求める
        const expected = new Set<string>();
        const opts = { includeGame: (k: string) => byKey.get(k) === "regular", periods: null };
        for (const [teamId, file] of s.raw) {
          let teamPoss = 0;
          const pi = file.countKeys.indexOf("poss");
          for (const r of file.rows) if (opts.includeGame(file.games[r[0]!]!)) teamPoss += r[9 + pi]!;
          const min = Math.max(LINEUP_MIN_POSSESSIONS, (teamPoss * sharePct) / 100);
          const c = s.compact.get(teamId)!;
          const candidates = unit === "onoff" ? file.players.map((p) => [p]) : onCourtByGroup(c, unit === "duo" ? 2 : 3, { ...opts, keys: KEYS }).map((g) => g.playerIds);
          for (const ids of candidates) {
            const on = searchLineup(file, ids, "on", opts);
            if (on.games === 0 && on.seconds === 0) continue;
            if (on.ownPoss < min) continue;
            if (unit === "onoff") {
              const off = searchLineup(file, ids, "off", opts);
              if (off.ownPoss < min) continue;
            }
            expected.add(`${teamId}:${ids.join(",")}`);
          }
        }
        const got = new Set(res.rows.map((r) => r.key));
        gThr.add(got.size === expected.size && [...got].every((k) => expected.has(k)), () => `${s.season} ${unit} ${sharePct}%: 集計 ${got.size}行 / 独立 ${expected.size}行`);
        // 値の照合（間引く）
        res.rows.forEach((r, i) => {
          if (i % (unit === "trio" ? 9 : unit === "duo" ? 4 : 1) !== 0) return;
          const file = s.raw.get(r.teamId)!;
          const ids = r.players.map((p) => p.id);
          const on = searchLineup(file, ids, "on", opts);
          const ok = on.games === r.on.games && on.seconds === r.on.seconds && on.ownPoints === r.on.ownPoints && on.oppPoints === r.on.oppPoints && on.ownPoss === r.on.ownPoss && on.oppPoss === r.on.oppPoss;
          const off = unit === "onoff" ? searchLineup(file, ids, "off", opts) : null;
          const okOff = !off || (!!r.off && off.games === r.off.games && off.seconds === r.off.seconds && off.ownPoints === r.off.ownPoints && off.oppPoints === r.off.oppPoints && off.ownPoss === r.off.ownPoss && off.oppPoss === r.off.oppPoss);
          gVal.add(ok && okOff, () => `${s.season} ${unit} ${r.key}`);
        });
      }
    }
  }
  gThr.report();
  gVal.report();
}

{
  // 登録区分・ポジション・現役・ルーキー: 絞り込みなしの結果から、索引の選手辞書で別に絞った結果と一致する（下限は選手の条件に左右されない。組は全員が当てはまるものだけ）
  const gFilter = new Group("登録区分・ポジション・現役・ルーキーの絞り込みが、辞書から別に絞った結果と一致");
  const cases: { name: string; patch: Partial<LineupQuery>; pred: (season: string, p: readonly string[]) => boolean }[] = [
    { name: "日本人", patch: { group: "日本人" as PlayerGroupFilter }, pred: (_, p) => p[5] === "jp" },
    { name: "外国籍・帰化・アジア", patch: { group: "外国籍・帰化・アジア" as PlayerGroupFilter }, pred: (_, p) => p[5] === "intl" },
    { name: "ポジションPG", patch: { positions: ["PG"] }, pred: (_, p) => !!p[2] && positionFilterValue(p[2]) === "PG" },
    { name: "現役", patch: { activeIds }, pred: (_, p) => activeIds.has(p[0]!) },
    { name: "ルーキー", patch: { group: "rookie" as PlayerGroupFilter, rookies }, pred: (season, p) => !!rookies?.seasons[season]?.includes(p[0]!) },
  ];
  for (const unit of ["onoff", "duo", "trio"] as const) {
    for (const s of all) {
      const dict = new Map(s.view.file.players.map((p) => [p[0], p] as const));
      const one = (patch: Partial<LineupQuery>) => queryLineupRanking(base({ data: [{ view: s.view, stints: s.compact }], unit, ...patch })).rows;
      const whole = one({});
      for (const cs of cases) {
        const exp = new Set(whole.filter((r) => r.players.every((p) => cs.pred(s.season, dict.get(p.id)!))).map((r) => r.key));
        const got = new Set(one(cs.patch).map((r) => r.key));
        gFilter.add(got.size === exp.size && [...got].every((k) => exp.has(k)), () => `${s.season} ${unit} ${cs.name}: 集計 ${got.size}行 / 辞書 ${exp.size}行`);
      }
    }
  }
  gFilter.report();
}

{
  // 通算: シーズンごとの行を足したものと一致（下限は通算の合計に当てはめる）
  const g = new Group("通算が、シーズンごとの行の合計と一致");
  for (const unit of ["onoff", "duo"] as const) {
    const career = queryLineupRanking(base({ unit, sharePct: 5 }));
    // 核から直接、(チーム, 選手)ごとにシーズンを足す（下限を適用する前の合計）
    const sums = new Map<string, { ownPoss: number; seconds: number; ownPoints: number; oppPoints: number; games: number }>();
    for (const s of all) {
      const byKey = new Map(s.summaries.map((x) => [x.scheduleKey, x.gameType]));
      for (const [teamId, c] of s.compact) {
        const opts = { includeGame: (k: string) => byKey.get(k) === "regular", periods: null, keys: KEYS };
        const list = unit === "onoff" ? [...onOffByPlayer(c, opts)].map(([id, t]) => ({ ids: [id], on: t.on })) : onCourtByGroup(c, 2, opts).map((x) => ({ ids: x.playerIds, on: x.on }));
        for (const x of list) {
          if (x.on.games === 0 && x.on.seconds === 0) continue;
          const key = `${teamId}:${x.ids.join(",")}`;
          const a = sums.get(key) ?? { ownPoss: 0, seconds: 0, ownPoints: 0, oppPoints: 0, games: 0 };
          a.ownPoss += x.on.own[1]!;
          a.seconds += x.on.seconds;
          a.ownPoints += x.on.own[0]!;
          a.oppPoints += x.on.opp[0]!;
          a.games += x.on.games;
          sums.set(key, a);
        }
      }
    }
    for (const r of career.rows) {
      const a = sums.get(r.key);
      g.add(!!a && a.ownPoss === r.on.ownPoss && a.seconds === r.on.seconds && a.ownPoints === r.on.ownPoints && a.oppPoints === r.on.oppPoints && a.games === r.on.games, () => `${unit} ${r.key}`);
    }
    check(`通算（${unit}）の行がある（${career.rows.length}行、下限前 ${career.beforeThreshold}行）`, career.rows.length > 0 && career.rows.length <= career.beforeThreshold);
  }
  g.report();
}

// ---- 5. 画面の実測の例（2025-26 レギュラーシーズン） ----
{
  const s = all.find((x) => x.season === "2025-26");
  if (!s) {
    check("2025-26 がある", false);
  } else {
    const one = (unit: LineupUnit, sharePct: number) => queryLineupRanking(base({ data: [{ view: s.view, stints: s.compact }], unit, sharePct })).rows;
    const nameOf = (r: LineupRow) => r.players.map((p) => p.name).join(" × ");
    const text = (r: LineupRow, unit: LineupUnit) => {
      const net = sideRatings(r.on).net!;
      const offNet = r.off ? sideRatings(r.off).net! : null;
      const v = lineupValue(r, unit, "net")!;
      return `${nameOf(r)}|${r.teamName}|${formatSigned(v)}|${formatSigned(net)}${offNet !== null ? `|${formatSigned(offNet)}` : ""}`;
    };
    const sorted = (rows: LineupRow[], unit: LineupUnit) => [...rows].sort((a, b) => lineupValue(b, unit, "net")! - lineupValue(a, unit, "net")!);
    const onoff = sorted(one("onoff", 15), "onoff");
    check(`On/Off（15%）の対象は 277人`, onoff.length === 277, String(onoff.length));
    const expectTop = [
      "ディディ・ロウザダ|サンロッカーズ渋谷|+26.4|+6.9|-19.4",
      "ヴォーディミル・ゲルン|大阪エヴェッサ|+20.8|+10.0|-10.8",
      "ニック・ケイ|島根スサノオマジック|+20.0|+2.4|-17.6",
      "ダバンテ・ガードナー|シーホース三河|+19.1|+13.1|-5.9",
      "ジョシュ・ホーキンソン|サンロッカーズ渋谷|-0.8|-0.8|-18.2",
    ];
    // 5位は田代 直希と差が同じ（+17.3）。差の表示値での順位は同じで、上位に出る順は問わない
    const top5 = onoff.slice(0, 5).map((r) => text(r, "onoff"));
    const topNames = new Set(top5.map((t) => t.split("|").slice(0, 3).join("|")));
    const wantTop = new Set(["ディディ・ロウザダ|サンロッカーズ渋谷|+26.4", "ヴォーディミル・ゲルン|大阪エヴェッサ|+20.8", "ニック・ケイ|島根スサノオマジック|+20.0", "ダバンテ・ガードナー|シーホース三河|+19.1"]);
    check("On/Off差の上位（1〜4位の名前・チーム・差）", [...wantTop].every((t) => topNames.has(t)), top5.join("\n   "));
    const fifth = onoff.slice(4, 6).map((r) => text(r, "onoff")).sort();
    check(
      "On/Off差の5位・6位（ホーキンソン・田代 +17.3）",
      JSON.stringify(fifth) === JSON.stringify(["ジョシュ・ホーキンソン|サンロッカーズ渋谷|+17.3|-0.8|-18.2", "田代 直希|千葉ジェッツ|+17.3|+20.8|+3.5"].sort()),
      fifth.join("\n   "),
    );
    void expectTop;
    const bottom = onoff.slice(-5).reverse().map((r) => text(r, "onoff"));
    const wantBottom = [
      "タイラー・クック|茨城ロボッツ|-23.4|-18.2|+5.2",
      "マシュー・アキノ|富山グラウジーズ|-21.1|-26.7|-5.6",
      "安藤 誓哉|横浜ビー・コルセアーズ|-19.9|-8.8|+11.1",
      "デレク・パードン|アルティーリ千葉|-18.0|-11.8|+6.1",
      "荒川 颯|琉球ゴールデンキングス|-16.9|-2.2|+14.7",
    ];
    check("On/Off差の下位5人（名前・チーム・差・On・Off）", JSON.stringify(bottom) === JSON.stringify(wantBottom), bottom.join("\n   "));
    const duo = sorted(one("duo", 5), "duo");
    check(`2人の組（5%）の対象は 1,385組`, duo.length === 1385, String(duo.length));
    const wantDuo = [
      "齋藤 拓実 × 小澤 飛悠|名古屋ダイヤモンドドルフィンズ|+34.4",
      "原 修太 × 田代 直希|千葉ジェッツ|+33.2",
      "ジョン・ムーニー × 田代 直希|千葉ジェッツ|+32.6",
      "ディー・ジェイ・ホグ × ギャリソン・ブルックス|千葉ジェッツ|+31.0",
      "ケリー・ブラックシアー・ジュニア × コー・フリッピン|群馬クレインサンダーズ|+30.0",
    ];
    const got = duo.slice(0, 5).map((r) => text(r, "duo").split("|").slice(0, 3).join("|"));
    check("2人の組のNetRtg 上位5組（名前・チーム・値）", JSON.stringify(got) === JSON.stringify(wantDuo), got.join("\n   "));
    const last = duo[duo.length - 1]!;
    check("2人の組の最下位（藤永 佳昭 × マシュー・アキノ −37.3）", text(last, "duo").startsWith("藤永 佳昭 × マシュー・アキノ|富山グラウジーズ|-37.3"), text(last, "duo"));
    const trio = sorted(one("trio", 5), "trio");
    check(`3人の組（5%）の対象は 1,590組`, trio.length === 1590, String(trio.length));
  }
}

// ---- 6. 感度 ----
{
  const a = queryLineupRanking(base({ unit: "onoff", sharePct: 15 })).rows.length;
  const b = queryLineupRanking(base({ unit: "onoff", sharePct: 25 })).rows.length;
  const c = queryLineupRanking(base({ unit: "onoff", sharePct: 15, gameType: "playoff" })).rows.length;
  check(`下限を変えると行数が変わる（通算 15% ${a}行、25% ${b}行）`, b < a);
  check(`試合区分を変えると行数が変わる（ポストシーズン ${c}行）`, c !== a);
  check("minPossessions は絶対の下限を下回らない", minPossessions(300, 15) === LINEUP_MIN_POSSESSIONS && minPossessions(4400, 15) === 660);
  check("2016-17〜2019-20 は対象外", !lineupSeasonSupported("2019-20") && lineupSeasonSupported("2020-21"));
}

// ---- 7. 感度（出場区間を1か所壊すと、searchLineup との照合が NG になる） ----
{
  const s = all.find((x) => x.season === "2025-26")!;
  const [teamId, file] = [...s.raw][0]!;
  const c = s.compact.get(teamId)!;
  const broken: CompactStints = { ...c, data: c.data.slice() };
  broken.data[9 + c.countKeys.indexOf("pts")] = broken.data[9 + c.countKeys.indexOf("pts")]! + 1; // 最初の区間の自チームの得点を1つ増やす
  const opts = { includeGame: () => true, periods: null, keys: KEYS };
  const id = file.players[c.data[4]!]!;
  const got = onOffByPlayer(broken, opts).get(id)!;
  const ref = searchLineup(file, [id], "on", opts);
  check("出場区間を1か所壊すと、On の得点が searchLineup と食い違う", got.on.own[0] !== ref.ownPoints, `${got.on.own[0]} / ${ref.ownPoints}`);
}

console.log(failures === 0 ? "\nすべて ok" : `\n${failures}件の NG`);
process.exit(failures === 0 ? 0 : 1);
