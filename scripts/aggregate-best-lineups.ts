// data/best-lineups-{2,3,4,5}.json.gz（図解「歴代最強ラインナップ」。DESIGN.md 370章）を作る。全シーズンをまたぐ導出データで、デプロイのたびに作り直す。
//
// 対象: B.PREMIER（旧B1）の 2020-21 以降（実際のポゼッションを数えているシーズン）。今季は途中経過。B.ONE・旧B2・2019-20 以前は入れない。
// 材料: チームの出場区間（data/{season}/team-stints/）。数え方はチーム詳細の5人組の表（src/lib/lineupsByCondition.ts）・ランキングの2人／3人の組み合わせ
// （shared/onCourtTotals.ts の onCourtByGroup）と同じ: その組が同時にコートにいた区間の時間・得点・失点・攻守のポゼッションを足し、
// 時間か数え上げのあった試合を試合数に数える。試合区分は試合一覧（games-summary）のレギュラーシーズン／ポストシーズン。
// OC: 区間ごとに、その試合の日の登録区分（shared/registration.ts の makeClassifier。2025-26 以前は選手マスタ）で組の中の外国籍・帰化・アジア特別枠の人数を数える
// （shared/foreignOnCourt.ts の foreignCountInLineup。区分の分からない選手がいる組・規定の最大人数を超える組は数えない＝-1）。
// 形は shared/bestLineups.ts。
//
// 使い方:
//   npm run aggregate:best-lineups
//   npm run aggregate:best-lineups -- --measure   （書き出さずに、人数・下限ごとの組の数と大きさを出す）

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import { currentSeason } from "./lib/season.ts";
import { substitutionModelForSeason } from "../shared/onCourt.ts";
import { foreignCountInLineup } from "../shared/foreignOnCourt.ts";
import { makeClassifier, type SeasonRegistrationFile } from "../shared/registration.ts";
import { seasonRuleFor } from "../shared/seasonRules.ts";
import {
  BEST_LINEUP_FIRST_SEASON,
  BEST_LINEUP_MIN_POSS_OPTIONS,
  BEST_LINEUP_SIZES,
  BL_GAMES,
  BL_OPP,
  BL_OPP_POSS,
  BL_OWN_POSS,
  BL_PTS,
  BL_SEC,
  BL_SUM_WIDTH,
  bestLineupFileName,
  type BestLineupSize,
  type BestLineupsFile,
} from "../shared/bestLineups.ts";
import type { GameSummary, PlayerMasterEntry, SeasonRules, TeamStintsFile } from "../shared/types.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;
const FIXED_COLUMNS = 9;
const MEASURE = process.argv.includes("--measure");

interface Acc {
  teamIdx: number;
  ids: string[];
  oc: number;
  /** [レギュラー×幅, ポスト×幅] */
  sums: Float64Array;
  /** 最後に数えた試合（試合区分ごと。試合数を数えるため） */
  lastGame: number[];
  /** 選手の番号（シーズンの表記ごとの辞書の番号）。チームのファイルを読み終えてから付ける */
  nos: number[] | null;
}

function subsets(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const rec = (start: number) => {
    if (cur.length === k) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
    }
  };
  rec(0);
  return out;
}

async function main(): Promise<void> {
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .filter((s) => s >= BEST_LINEUP_FIRST_SEASON && s <= currentSeason() && substitutionModelForSeason(s) === "modern")
    .filter((s) => existsSync(path.join(DATA_DIR, s, "team-stints")))
    .sort();

  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const masterById = new Map(master.map((p) => [p.playerId, p]));
  const rules = (await readJson<SeasonRules[]>(path.join(DATA_DIR, "season-rules.json"))) ?? [];

  const teams: [number, string, string][] = [];
  const playerIndex = new Map<string, number>();
  const players: [string, string][] = [];
  const latestDates: Record<string, string> = {};
  const accs = new Map<BestLineupSize, Map<string, Acc>>(BEST_LINEUP_SIZES.map((s) => [s, new Map()]));
  const subsetsBySize = new Map<BestLineupSize, number[][]>(BEST_LINEUP_SIZES.map((s) => [s, subsets(5, s)]));

  for (const [si, season] of seasons.entries()) {
    const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
    const gameByKey = new Map(summaries.map((g) => [g.scheduleKey, g]));
    const registrations = await readJson<SeasonRegistrationFile>(path.join(DATA_DIR, season, "registrations.json"));
    const classifyAt = makeClassifier(season, registrations, masterById);
    const maxOnCourt = seasonRuleFor(rules, season, "premier")?.maxForeignOnCourt;
    const seasonPlayers = (await readJson<{ playerId: string; name: string }[]>(path.join(DATA_DIR, season, "players.json"))) ?? [];
    const nameOf = new Map(seasonPlayers.map((p) => [p.playerId, p.name]));
    const seasonTeams = (await readJson<{ teamId: string; teamName: string }[]>(path.join(DATA_DIR, season, "teams.json"))) ?? [];
    const teamNameOf = new Map(seasonTeams.map((t) => [t.teamId, t.teamName]));
    // 選手の番号は「シーズンの表記」ごと（同じIDで同じ名前なら同じ番号）
    const playerNo = (id: string): number => {
      const name = (nameOf.get(id) ?? masterById.get(id)?.name ?? id).replace(/\s+/g, " ").trim();
      const key = `${id}\u0000${name}`;
      let n = playerIndex.get(key);
      if (n === undefined) {
        n = players.length;
        players.push([id, name]);
        playerIndex.set(key, n);
      }
      return n;
    };

    const dir = path.join(DATA_DIR, season, "team-stints");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort()) {
      const stints = await readJson<TeamStintsFile>(path.join(dir, file.replace(/\.gz$/, "")));
      if (!stints) continue;
      const teamIdx = teams.length;
      teams.push([si, stints.teamId, teamNameOf.get(stints.teamId) ?? stints.teamName]);
      const nKeys = stints.countKeys.length;
      const ptsIdx = stints.countKeys.indexOf("pts");
      const possIdx = stints.countKeys.indexOf("poss");
      if (ptsIdx < 0 || possIdx < 0) throw new Error(`${season} ${stints.teamId}: 数え上げに pts・poss がありません`);
      // 試合ごとの区分（0=レギュラー、1=ポスト、-1=対象外）と日付
      const gameKind = stints.games.map((key) => {
        const g = gameByKey.get(key);
        if (!g) return -1;
        if (g.gameType === "regular") return 0;
        if (g.gameType === "playoff") return 1;
        return -1;
      });
      const gameDate = stints.games.map((key) => gameByKey.get(key)?.date);
      for (const row of stints.rows) {
        const game = row[0]!;
        const kind = gameKind[game]!;
        if (kind < 0) continue;
        const date = gameDate[game];
        if (date && (!latestDates[season] || date > latestDates[season]!)) latestDates[season] = date;
        const seconds = row[3]! - row[2]!;
        const own = row[FIXED_COLUMNS + ptsIdx]!;
        const opp = row[FIXED_COLUMNS + nKeys + ptsIdx]!;
        const ownPoss = row[FIXED_COLUMNS + possIdx]!;
        const oppPoss = row[FIXED_COLUMNS + nKeys + possIdx]!;
        const active = seconds > 0 || own !== 0 || opp !== 0 || ownPoss !== 0 || oppPoss !== 0;
        const five = [row[4]!, row[5]!, row[6]!, row[7]!, row[8]!].map((n) => stints.players[n]!).sort();
        for (const size of BEST_LINEUP_SIZES) {
          const map = accs.get(size)!;
          for (const sub of subsetsBySize.get(size)!) {
            const ids = sub.map((i) => five[i]!);
            const count = foreignCountInLineup(ids, (id) => classifyAt(id, date));
            const oc = count === null || (maxOnCourt !== undefined && count > maxOnCourt) ? -1 : count;
            const key = `${teamIdx}|${ids.join(",")}|${oc}`;
            let acc = map.get(key);
            if (!acc) {
              acc = { teamIdx, ids, oc, sums: new Float64Array(BL_SUM_WIDTH * 2), lastGame: [-1, -1], nos: null };
              map.set(key, acc);
            }
            const b = kind * BL_SUM_WIDTH;
            const s = acc.sums;
            s[b + BL_SEC] = s[b + BL_SEC]! + seconds;
            s[b + BL_PTS] = s[b + BL_PTS]! + own;
            s[b + BL_OPP] = s[b + BL_OPP]! + opp;
            s[b + BL_OWN_POSS] = s[b + BL_OWN_POSS]! + ownPoss;
            s[b + BL_OPP_POSS] = s[b + BL_OPP_POSS]! + oppPoss;
            if (active && acc.lastGame[kind] !== game) {
              s[b + BL_GAMES] = s[b + BL_GAMES]! + 1;
              acc.lastGame[kind] = game;
            }
          }
        }
      }
      // 選手の番号はチームのファイルを読み終えてから付ける（名前はシーズンの表記）
      for (const size of BEST_LINEUP_SIZES) {
        for (const acc of accs.get(size)!.values()) {
          if (acc.teamIdx === teamIdx && acc.nos === null) acc.nos = acc.ids.map(playerNo);
        }
      }
    }
  }

  for (const size of BEST_LINEUP_SIZES) {
    const map = accs.get(size)!;
    // 組（チーム×選手）ごとの、すべての OC・全試合の合計
    const whole = new Map<string, { own: number; opp: number }>();
    for (const acc of map.values()) {
      const k = `${acc.teamIdx}|${acc.ids.join(",")}`;
      const w = whole.get(k) ?? { own: 0, opp: 0 };
      w.own += acc.sums[BL_OWN_POSS]! + acc.sums[BL_SUM_WIDTH + BL_OWN_POSS]!;
      w.opp += acc.sums[BL_OPP_POSS]! + acc.sums[BL_SUM_WIDTH + BL_OPP_POSS]!;
      whole.set(k, w);
    }
    const options = BEST_LINEUP_MIN_POSS_OPTIONS[size];
    const minPoss = Math.min(...options);
    if (MEASURE) {
      const regular = new Map<string, { own: number; opp: number }>();
      for (const acc of map.values()) {
        const k = `${acc.teamIdx}|${acc.ids.join(",")}`;
        const w = regular.get(k) ?? { own: 0, opp: 0 };
        w.own += acc.sums[BL_OWN_POSS]!;
        w.opp += acc.sums[BL_OPP_POSS]!;
        regular.set(k, w);
      }
      const counts = [100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1800, 2000, 2200, 2400].map((n) => {
        let c = 0;
        for (const w of regular.values()) if (Math.min(w.own, w.opp) >= n) c += 1;
        return `${n}:${c}`;
      });
      console.log(`${size}人 組の数（全体）${whole.size}  レギュラーで攻守とも N 以上: ${counts.join(" ")}`);
    }
    const rows: number[][] = [];
    for (const acc of map.values()) {
      const w = whole.get(`${acc.teamIdx}|${acc.ids.join(",")}`)!;
      if (Math.min(w.own, w.opp) < minPoss) continue;
      rows.push([acc.teamIdx, ...acc.nos!, acc.oc, ...Array.from(acc.sums, (v) => Math.round(v))]);
    }
    rows.sort((a, b) => a[0]! - b[0]! || a.slice(1, 1 + size + 1).join(",").localeCompare(b.slice(1, 1 + size + 1).join(",")));
    // 使う選手・チームだけに絞った辞書にする
    const usedPlayers = new Map<number, number>();
    const usedTeams = new Map<number, number>();
    const outPlayers: [string, string][] = [];
    const outTeams: [number, string, string][] = [];
    for (const r of rows) {
      if (!usedTeams.has(r[0]!)) {
        usedTeams.set(r[0]!, outTeams.length);
        outTeams.push(teams[r[0]!]!);
      }
      r[0] = usedTeams.get(r[0]!)!;
      for (let i = 1; i <= size; i++) {
        if (!usedPlayers.has(r[i]!)) {
          usedPlayers.set(r[i]!, outPlayers.length);
          outPlayers.push(players[r[i]!]!);
        }
        r[i] = usedPlayers.get(r[i]!)!;
      }
    }
    const file: BestLineupsFile = { version: 1, size, minPoss, seasons, latestDates, teams: outTeams, players: outPlayers, rows };
    const json = JSON.stringify(file);
    const groups = new Set(rows.map((r) => `${r[0]}|${r.slice(1, 1 + size).join(",")}`)).size;
    const mixed = rows.length - groups;
    console.log(
      `${size}人: 組 ${groups}（OC で分かれた行 ${mixed}）・行 ${rows.length}・JSON ${(json.length / 1e6).toFixed(3)}MB・圧縮 ${(gzipSync(json).length / 1e6).toFixed(3)}MB`,
    );
    if (!MEASURE) await writeJsonIfChanged(path.join(DATA_DIR, bestLineupFileName(size).replace(/\.gz$/, "")), file as unknown as Record<string, unknown>, [], false);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
