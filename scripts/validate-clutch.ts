// クラッチ（Q別・前後半の選択肢の「クラッチ」。設計書375章）の検証。導出データを作ったあと（npm run build:data のあと）に実行する。
//
// 確かめること（全シーズン・B.PREMIER と B.ONE）:
//  1. 期待値: 手で数えた試合（調査メモの4試合と、2016-17〜2019-20 の試合）のクラッチの秒数・得点・選手の記録が、索引の値と一致する
//  2. 選手の合計＝チームの合計: クラッチタイムになった試合の各チームで、選手の PTS・FGM・FGA・3PM・3PA・FTM・FTA・AST・STL・BLK の合計がチームの値と一致する。
//     選手の出場時間の合計＝チームの出場時間＝クラッチの秒数×5（出場区間の品質のビットが立っていない試合）。+/- のある試合は、選手の +/- の合計＝（得点−失点）×5
//  3. チームの勝ちの合計＝負けの合計（クラッチタイムになった試合の、両チームの行）。チームのクラッチの行の数＝試合ログの clutchGame が true の数（チームごと）
//  4. 試合の流れから数え直した値: 判定（shared/clutchTime.ts）とは別に書いた数え方で、試合の生データのプレーバイプレーからクラッチの秒数・選手の記録を数え直し、索引と一致する
//  5. 判定できない試合: 2017-18 の1810（プレーバイプレーが無い）・前後半5分の特別な試合は、クラッチの値も clutchGame も持たない
//  6. 品質の数: ターンオーバーが公式の4Q・延長の値と合わない試合、出場区間の確かめが通らない試合の数を出す（数は出力するだけ）
//
// 使い方: npm run validate:clutch [-- --season 2025-26]。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { existsSync } from "node:fs";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { CLUTCH_ATOM_INDEX, PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED, TEAM_CLUTCH_QUALITY_KEY, type PlayerPeriodIndexFile, type TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import { ROW_FLAG_HOME, type PlayerGameIndexFile, type TeamGameIndexFile } from "../shared/gameIndex.ts";
import { CLUTCH_QUALITY_ONCOURT, CLUTCH_QUALITY_TOV } from "../shared/clutchTime.ts";
import type { Category, PlayByPlayEvent, StoredGame, TeamGameLog } from "../shared/types.ts";

const args = process.argv.slice(2);
const onlySeason = args.includes("--season") ? args[args.indexOf("--season") + 1] : undefined;
const TARGETS: { season: string; category: Category }[] = [
  ...["2016-17", "2017-18", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"].map((season) => ({ season, category: "premier" as Category })),
  { season: "2025-26", category: "one" as Category },
  { season: "2026-27", category: "one" as Category },
].filter((t) => !onlySeason || t.season === onlySeason);

let ng = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (!cond) ng += 1;
  console.log(`${cond ? "ok" : "NG"} ${name}${detail ? ` ${detail}` : ""}`);
}

/** 手で数えた試合の期待値（調査メモ 7節の4試合と、旧形式の試合。秒数・両チームの得点［ホーム, アウェイ］・選手の記録） */
interface Expected {
  season: string;
  category: Category;
  key: string;
  seconds: number;
  points: [number, number];
  /** チームのターンオーバー［ホーム, アウェイ］（旧形式のチーム用のIDの13を含む） */
  tov?: [number, number];
  players?: { name: string; pts: number; fgm: number; fga: number; ftm?: number; fta?: number }[];
}
const EXPECTED: Expected[] = [
  // 2:23 に 69-64（直前8点差なのでこの3Pは除外）、2:03 に 72-64（直前5点差なのでデニスの3Pは含む）。対象は20秒
  { season: "2026-27", category: "premier", key: "506482", seconds: 20, points: [3, 0], players: [{ name: "デクスター・デニス", pts: 3, fgm: 1, fga: 1 }] },
  // 0:01 に 79-85、続くFTで 80-85。FT前は6点差なのでFTは除外。その後1秒がクラッチ。得点は両チーム0
  { season: "2025-26", category: "premier", key: "504937", seconds: 1, points: [0, 0] },
  // 3:17 に 78-83、2:55 に 78-86。最初の3Pは8点差からなので除外、ボイドの3Pは含む。22秒
  { season: "2026-27", category: "one", key: "507175", seconds: 22, points: [0, 3], players: [{ name: "トレイ・ボイド", pts: 3, fgm: 1, fga: 1 }] },
  // 4Q 5:00〜2:25 の155秒と 1:47〜0:00 の107秒、OT 300秒で計562秒。得点 27-24。富永は 13点・FG 5/7・FT 2/2
  { season: "2026-27", category: "premier", key: "506408", seconds: 562, points: [27, 24], players: [{ name: "富永 啓生", pts: 13, fgm: 5, fga: 7, ftm: 2, fta: 2 }] },
  ...LEGACY_EXPECTED(),
];

/** 2016-17〜2019-20 の、手で数えた試合（設計書375章） */
function LEGACY_EXPECTED(): Expected[] {
  return [
    // 栃木 61-59 秋田。4:33 に 58-53（直前7点差なので菅澤の2Pは除外）→ 3:39 田臥の2P（直前5点差なので含む）で 60-53 になるまでの54秒。
    // 3:15 に 60-55（直前7点差なので除外）→ 以降は5点差以内のまま終了まで195秒。計249秒。得点は 栃木3（田臥2・ギブスFT1）・秋田4（安藤2・パルマーFT2）
    {
      season: "2016-17",
      category: "premier",
      key: "11",
      seconds: 249,
      points: [3, 4],
      players: [
        { name: "田臥 勇太", pts: 2, fgm: 1, fga: 1 },
        { name: "ジェフ・ギブス", pts: 1, fgm: 0, fga: 0, ftm: 1, fta: 2 },
        { name: "ケビン・パルマー", pts: 2, fgm: 0, fga: 2, ftm: 2, fta: 2 },
        { name: "安藤 誓哉", pts: 2, fgm: 1, fga: 2 },
      ],
    },
    // 京都 65-63 三遠。5:00 に 57-52（5点差）→ 4:43 スミスの2P（直前5点差なので含む）で 59-52 になるまでの17秒。
    // 1:14 川嶋の3P（直前7点差なので除外）で 65-61 → 終了まで74秒。計91秒。得点は 京都2（スミス）・三遠2（岡田）
    {
      season: "2017-18",
      category: "premier",
      key: "1584",
      seconds: 91,
      points: [2, 2],
      players: [
        { name: "ジョシュア・スミス", pts: 2, fgm: 1, fga: 1 },
        { name: "永吉 佑也", pts: 0, fgm: 0, fga: 2, ftm: 0, fta: 2 },
        { name: "川嶋 勇人", pts: 0, fgm: 0, fga: 2 },
        { name: "岡田 慎吾", pts: 2, fgm: 1, fga: 1 },
      ],
    },
    // 京都 91-90 富山。5:00 に 81-77（4点差）で、以降一度も6点差以上にならない（5:02 のプレーは残り5:00より前なので除外）。300秒。得点は 京都10・富山13
    {
      season: "2019-20",
      category: "premier",
      key: "4183",
      seconds: 300,
      points: [10, 13],
      // 京都: 2:31 チームのターンオーバー（チーム用のIDの13）・中村 1:19・松井 0:01。富山: 3:35 チーム（17）・スミス 2:17・宇都 1:35
      tov: [3, 3],
      players: [
        { name: "デイヴィッド・サイモン", pts: 5, fgm: 2, fga: 3, ftm: 1, fta: 2 },
        { name: "松井 啓十郎", pts: 5, fgm: 1, fga: 2, ftm: 2, fta: 2 },
        { name: "レオ・ライオンズ", pts: 9, fgm: 4, fga: 4, ftm: 1, fta: 2 },
        { name: "前田 悟", pts: 3, fgm: 1, fga: 1 },
      ],
    },
  ];
}

// ---- 数え直し（shared/clutchTime.ts とは別に書いた数え方。プレーの直前の点差は、得点の記録の累計と、失敗したシュートなどの記録に付いた点差から決める） ----
const SCORE_CODES: Record<number, number> = { 1: 3, 3: 2, 4: 2, 44: 2, 7: 1 };
const rest = (e: PlayByPlayEvent) => {
  const m = /^(\d+):(\d{2})$/.exec(e.RestTime ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
const periodEnd = (p: number) => (p <= 4 ? p * 600 : 2400 + (p - 4) * 300);
interface Recount {
  seconds: number;
  isClutch: boolean;
  /** 選手ID → [pts, fgm, fga, tpm, tpa, ftm, fta, ast, stl, blk, oreb, dreb, tov, pf] */
  players: Map<string, number[]>;
  teamPts: Map<string, number>;
}
const RECOUNT_KEYS = ["pts", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "ast", "stl", "blk", "oreb", "dreb", "tov", "pf"] as const;
function recount(game: StoredGame): Recount | null {
  const pbp = game.raw.PlayByPlays;
  if (pbp.length === 0 || Math.max(...pbp.map((e) => e.Period)) < 4) return null;
  const scoring = pbp
    .map((e, index) => ({ e, index, m: SCORE_CODES[e.ActionCD1] !== undefined ? /^(\d+)-(\d+)$/.exec(e.Score ?? "") : null }))
    .filter((x) => x.m)
    .map((x) => ({ index: x.index, period: x.e.Period, t: periodEnd(x.e.Period) - rest(x.e), h: Number(x.m![1]), a: Number(x.m![2]) }))
    .sort((x, y) => x.t - y.t || x.period - y.period || x.h + x.a - (y.h + y.a) || x.index - y.index);
  if (scoring.length === 0 || scoring[scoring.length - 1]!.h !== game.homeScore || scoring[scoring.length - 1]!.a !== game.awayScore) return null;
  // 時間帯（プロトタイプと同じ数え方）
  let seconds = 0;
  {
    let h = 0;
    let a = 0;
    let si = 0;
    const maxP = Math.max(...pbp.map((e) => e.Period));
    for (let p = 1; p <= maxP; p++) {
      let prev = periodEnd(p) - (p <= 4 ? 600 : 300);
      while (si < scoring.length && scoring[si]!.period === p) {
        const s = scoring[si]!;
        const lo = Math.max(prev, periodEnd(p) - 300);
        if (p >= 4 && Math.abs(h - a) <= 5 && s.t > lo) seconds += s.t - lo;
        prev = Math.max(prev, s.t);
        h = s.h;
        a = s.a;
        si++;
      }
      const lo = Math.max(prev, periodEnd(p) - 300);
      if (p >= 4 && Math.abs(h - a) <= 5 && periodEnd(p) > lo) seconds += periodEnd(p) - lo;
    }
  }
  // 各プレーの直前の点差: 得点は並べ直した累計の1つ前、それ以外は配列でそれより前にある得点の数（同じ秒の並びの逆転は得点だけを直す）
  const beforeOfScore = new Map<number, [number, number]>();
  scoring.forEach((s, i) => beforeOfScore.set(s.index, i === 0 ? [0, 0] : [scoring[i - 1]!.h, scoring[i - 1]!.a]));
  const inClutch: boolean[] = [];
  let seen = 0;
  for (let i = 0; i < pbp.length; i++) {
    const e = pbp[i]!;
    let before: [number, number];
    if (beforeOfScore.has(i)) {
      before = beforeOfScore.get(i)!;
      seen++;
    } else before = seen === 0 ? [0, 0] : [scoring[seen - 1]!.h, scoring[seen - 1]!.a];
    inClutch.push(e.Period >= 4 && rest(e) <= 300 && Math.abs(before[0] - before[1]) <= 5);
  }
  // 引き継ぎ: アシストは直前の成功（同じチーム・同じピリオド。交代などは飛ばす）、ブロックは直前の相手の失敗したFG、バスケットカウントは直前の成功したFG
  const skip = new Set([15, 16, 22, 84, 85, 86, 87, 88, 89]);
  const back = (i: number, ok: (c: PlayByPlayEvent) => boolean, skipCodes: Set<number>, limit: number) => {
    for (let j = i - 1, n = 0; j >= 0 && n < limit; j--) {
      const c = pbp[j]!;
      if (c.Period !== pbp[i]!.Period) return -1;
      if (ok(c)) return j;
      if (!skipCodes.has(c.ActionCD1)) return -1;
      if (c.ActionCD1 < 80) n++;
    }
    return -1;
  };
  for (let i = 0; i < pbp.length; i++) {
    const e = pbp[i]!;
    let j = -1;
    if (e.ActionCD1 === 12) j = back(i, (c) => [1, 3, 4, 7].includes(c.ActionCD1), new Set([16, 22, 84, 85, 86, 87, 88]), 8);
    else if (e.ActionCD1 === 11) j = back(i, (c) => [2, 5, 6].includes(c.ActionCD1) && c.TeamID !== e.TeamID, skip, 4);
    else if (e.ActionCD1 === 16) j = back(i, (c) => [1, 3, 4, 44].includes(c.ActionCD1) && c.TeamID === e.TeamID, skip, 4);
    if (e.ActionCD1 === 12 && j >= 0 && pbp[j]!.TeamID !== e.TeamID) j = -1;
    if (j >= 0) inClutch[i] = inClutch[j]!;
  }
  const players = new Map<string, number[]>();
  const teamPts = new Map<string, number>();
  let anyPlay = false;
  const statCodes = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 31, 44, 91, 92, 93, 94]);
  for (let i = 0; i < pbp.length; i++) {
    if (!inClutch[i]) continue;
    const e = pbp[i]!;
    if (statCodes.has(e.ActionCD1)) anyPlay = true;
    if (e.TeamID && SCORE_CODES[e.ActionCD1]) teamPts.set(e.TeamID, (teamPts.get(e.TeamID) ?? 0) + SCORE_CODES[e.ActionCD1]!);
    if (!e.PlayerID1) continue;
    let v = players.get(e.PlayerID1);
    if (!v) players.set(e.PlayerID1, (v = RECOUNT_KEYS.map(() => 0)));
    const add = (k: (typeof RECOUNT_KEYS)[number], n = 1) => (v![RECOUNT_KEYS.indexOf(k)]! += n);
    const c = e.ActionCD1;
    if (SCORE_CODES[c]) add("pts", SCORE_CODES[c]!);
    if ([1, 3, 4, 44].includes(c)) { add("fgm"); add("fga"); }
    if ([2, 5, 6].includes(c)) add("fga");
    if (c === 1 || c === 2) { add("tpa"); if (c === 1) add("tpm"); }
    if (c === 7) { add("ftm"); add("fta"); }
    if (c === 8) add("fta");
    if (c === 12) add("ast");
    if (c === 14) add("stl");
    if (c === 11) add("blk");
    if (c === 10) add("oreb");
    if (c === 9) add("dreb");
    if (c === 13) add("tov");
    if ([22, 23, 24, 25, 26, 31, 91, 92, 93, 94].includes(c)) add("pf");
  }
  return { seconds, isClutch: seconds > 0 || anyPlay, players, teamPts };
}

const INDEX_KEYS: Record<(typeof RECOUNT_KEYS)[number], string> = {
  pts: "pts", fgm: "fgm", fga: "fga", tpm: "tpm", tpa: "tpa", ftm: "ftm", fta: "fta", ast: "ast", stl: "stl", blk: "blk", oreb: "oreb", dreb: "dreb", tov: "tov", pf: "pf",
};

async function validateSeason(season: string, category: Category): Promise<void> {
  const label = category === "one" ? `${season} B.ONE` : season;
  const dir = path.join(DATA_DIR, seasonDirName(season, category));
  if (!existsSync(path.join(dir, "player-period-index.json.gz"))) {
    check(`${label}: 索引がある`, false);
    return;
  }
  const pgi = (await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json")))!;
  const ppi = (await readJson<PlayerPeriodIndexFile>(path.join(dir, "player-period-index.json")))!;
  const tgi = (await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json")))!;
  const tpi = (await readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json")))!;
  const games = await readAllGames(season, category);
  const gameByKey = new Map(games.map((g) => [String(g.scheduleKey), g]));
  const teamNo = new Map(tgi.games.key.map((k, i) => [k, i]));
  const tc = (col: string, r: number) => tpi.rows.counts[`clutch.${col}`]?.[r] ?? -1;

  // 選手のクラッチの行: 試合の番号 → 選手ID → 行の位置
  const playerRows = new Map<number, Map<string, number>>();
  for (let k = 0; k < ppi.rows.row.length; k++) {
    if (ppi.rows.period[k] !== CLUTCH_ATOM_INDEX) continue;
    const i = ppi.rows.row[k]!;
    const g = pgi.rows.game[i]!;
    let m = playerRows.get(g);
    if (!m) playerRows.set(g, (m = new Map()));
    m.set(pgi.players[pgi.rows.player[i]!]![0], k);
  }
  const st = (col: string, k: number) => ppi.rows.stats[col as keyof typeof ppi.rows.stats]![k]!;

  // チームの試合ログ（clutchGame）
  const teamsFile = await readJson<{ teamId: string }[]>(path.join(dir, "teams.json"));
  const logFlags = new Map<string, boolean>();
  for (const t of teamsFile ?? []) {
    const logs = await readJson<TeamGameLog[] | { gameLogs: TeamGameLog[] }>(path.join(dir, "team-games", `${t.teamId}.json`));
    const list = Array.isArray(logs) ? logs : (logs?.gameLogs ?? []);
    for (const l of list) if (l.clutchGame !== undefined) logFlags.set(`${l.scheduleKey}|${t.teamId}`, l.clutchGame);
  }

  let clutchGames = 0;
  let notClutch = 0;
  let unknown = 0;
  let wins = 0;
  let losses = 0;
  let sumNg = 0;
  let minNg = 0;
  let pmNg = 0;
  let pmGames = 0;
  let recountNg = 0;
  let flagNg = 0;
  let unknownNg = 0;
  let tovFlag = 0;
  let onCourtFlag = 0;
  const examples: string[] = [];
  for (let g = 0; g < tgi.games.key.length; g++) {
    const key = tgi.games.key[g]!;
    const game = gameByKey.get(key);
    if (!game) continue;
    const rc = recount(game);
    const has = [0, 1].map((side) => tc("pts", g * 2 + side) >= 0);
    const sides = [game.homeTeam.id, game.awayTeam.id];
    const flags = sides.map((t) => logFlags.get(`${key}|${t}`));
    const short = game.raw.PlayByPlays.length > 0 && Math.max(...game.raw.PlayByPlays.map((e) => e.Period)) < 4;
    if (!rc || short) {
      unknown++;
      if (has[0] || has[1] || flags.some((f) => f !== undefined)) {
        unknownNg++;
        if (examples.length < 5) examples.push(`${key}: 判定できない試合に値がある`);
      }
      continue;
    }
    if (has[0] !== rc.isClutch || has[1] !== rc.isClutch) {
      recountNg++;
      if (examples.length < 5) examples.push(`${key}: クラッチの有無 索引=${has[0]} 数え直し=${rc.isClutch}`);
    }
    if (flags.some((f) => f !== rc.isClutch)) flagNg++;
    if (!rc.isClutch) {
      notClutch++;
      continue;
    }
    clutchGames++;
    const homeWin = game.homeScore > game.awayScore;
    for (const side of [0, 1] as const) {
      if (!has[side]) continue;
      if ((side === 0) === homeWin) wins++;
      else losses++;
      const r = g * 2 + side;
      const teamId = sides[side]!;
      const q = tc_quality(tpi, r);
      if ((q & CLUTCH_QUALITY_TOV) !== 0) tovFlag++;
      if ((q & CLUTCH_QUALITY_ONCOURT) !== 0) onCourtFlag++;
      // 選手の合計＝チームの合計
      const rows = [...(playerRows.get(pgiGameNo(pgi, key)) ?? new Map<string, number>()).entries()].filter(([, k]) => {
        const i = ppi.rows.row[k]!;
        return ((pgi.rows.flags[i]! & ROW_FLAG_HOME) !== 0) === (side === 0);
      });
      const sumOf = (col: string) => rows.reduce((n, [, k]) => n + st(col, k), 0);
      const pairs: [string, number][] = [
        ["pts", tc("pts", r)],
        ["fgm", tc("pt2m", r) + tc("pt3m", r)],
        ["fga", tc("pt2a", r) + tc("pt3a", r)],
        ["tpm", tc("pt3m", r)],
        ["tpa", tc("pt3a", r)],
        ["ftm", tc("ftm", r)],
        ["fta", tc("fta", r)],
        ["ast", tc("ast", r)],
        ["stl", tc("stl", r)],
        ["blk", tc("blk", r)],
      ];
      for (const [col, team] of pairs) {
        if (sumOf(col) !== team) {
          sumNg++;
          if (examples.length < 5) examples.push(`${key} ${teamId}: 選手の${col}の合計 ${sumOf(col)} ≠ チーム ${team}`);
        }
      }
      if ((q & CLUTCH_QUALITY_ONCOURT) === 0) {
        if (sumOf("minSec") !== tc("minSec", r) || tc("minSec", r) !== 5 * rc.seconds) {
          minNg++;
          if (examples.length < 5) examples.push(`${key} ${teamId}: 出場時間 選手 ${sumOf("minSec")}・チーム ${tc("minSec", r)}・秒×5 ${5 * rc.seconds}`);
        }
        const withPm = rows.filter(([, k]) => (ppi.rows.flags[k]! & PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED) !== 0);
        if (withPm.length > 0) {
          pmGames++;
          const own = rc.teamPts.get(teamId) ?? 0;
          const opp = rc.teamPts.get(sides[1 - side]!) ?? 0;
          if (withPm.reduce((n, [, k]) => n + st("plusMinus", k), 0) !== 5 * (own - opp)) {
            pmNg++;
            if (examples.length < 8) examples.push(`${key} ${teamId}: +/- の合計 ${withPm.reduce((n, [, k]) => n + st("plusMinus", k), 0)} ≠ ${5 * (own - opp)}（行 ${rows.length}・+/- のある行 ${withPm.length}）`);
          }
        }
      }
      // 数え直し（選手ごと）
      if (tc("pts", r) !== (rc.teamPts.get(teamId) ?? 0)) {
        recountNg++;
        if (examples.length < 5) examples.push(`${key} ${teamId}: チームの得点 索引 ${tc("pts", r)} 数え直し ${rc.teamPts.get(teamId) ?? 0}`);
      }
      const ids = new Set(rows.map(([id]) => id));
      for (const [id, v] of rc.players) {
        const row = game.raw[side === 0 ? "HomeBoxscores" : "AwayBoxscores"].find((x) => x.PlayerID === id && x.Category === 1);
        if (!row) continue;
        const k = rows.find(([pid]) => pid === id)?.[1];
        RECOUNT_KEYS.forEach((name, ci) => {
          const got = k === undefined ? 0 : st(INDEX_KEYS[name], k);
          if (got !== v[ci]) {
            recountNg++;
            if (examples.length < 8) examples.push(`${key} ${row.PlayerNameJ}: ${name} 索引 ${got} 数え直し ${v[ci]}`);
          }
        });
        ids.delete(id);
      }
    }
  }
  check(`${label}: 判定できない試合（プレーバイプレーが無い・前後半5分の特別な試合など）はクラッチの値も clutchGame も持たない（${unknown}試合）`, unknownNg === 0, `${unknownNg}`);
  check(`${label}: クラッチの有無（索引）＝数え直し（クラッチ ${clutchGames}試合・ならなかった ${notClutch}試合）`, recountNg === 0, examples.join(" / "));
  check(`${label}: 試合ログの clutchGame＝数え直し`, flagNg === 0, `${flagNg}`);
  check(`${label}: チームの勝ちの合計＝負けの合計（${wins}勝・${losses}敗）、チームの行＝試合×2`, wins === losses && wins + losses === clutchGames * 2);
  check(`${label}: 選手の合計＝チームの合計（PTS・FGM・FGA・3PM・3PA・FTM・FTA・AST・STL・BLK）`, sumNg === 0, `${sumNg}`);
  check(`${label}: 出場時間の合計＝チームの出場時間＝クラッチの秒数×5（出場区間の確かめが通った試合）`, minNg === 0, `${minNg}`);
  check(`${label}: 選手の +/- の合計＝（得点−失点）×5（${pmGames}チーム×試合）`, pmNg === 0, `${pmNg} ${pmNg > 0 ? examples.join(" / ") : ""}`);
  console.log(`  ${label}: 品質のビット ターンオーバー ${tovFlag}・出場区間 ${onCourtFlag}（チーム×試合）`);
  if (tpi.rows.counts[TEAM_CLUTCH_QUALITY_KEY] === undefined) check(`${label}: 品質の列がある`, false);

  // 期待値
  for (const ex of EXPECTED.filter((e) => e.season === season && e.category === category)) {
    const g = teamNo.get(ex.key);
    const game = gameByKey.get(ex.key);
    if (g === undefined || !game) {
      check(`${label} ${ex.key}: 期待値の試合がある`, false);
      continue;
    }
    const pts: [number, number] = [tc("pts", g * 2), tc("pts", g * 2 + 1)];
    const sec = tc("minSec", g * 2) / 5;
    let playerOk = true;
    const detail: string[] = [];
    for (const p of ex.players ?? []) {
      const k = [...(playerRows.get(pgiGameNo(pgi, ex.key)) ?? new Map<string, number>()).entries()].find(([id]) => pgi.players.find((x) => x[0] === id)?.[1] === p.name)?.[1];
      const got = k === undefined ? null : { pts: st("pts", k), fgm: st("fgm", k), fga: st("fga", k), ftm: st("ftm", k), fta: st("fta", k) };
      const okP = !!got && got.pts === p.pts && got.fgm === p.fgm && got.fga === p.fga && (p.ftm === undefined || got.ftm === p.ftm) && (p.fta === undefined || got.fta === p.fta);
      if (!okP) playerOk = false;
      detail.push(`${p.name} ${got ? `${got.pts}点 FG${got.fgm}/${got.fga} FT${got.ftm}/${got.fta}` : "行なし"}`);
    }
    const tov: [number, number] = [tc("tov", g * 2), tc("tov", g * 2 + 1)];
    const tovOk = !ex.tov || (tov[0] === ex.tov[0] && tov[1] === ex.tov[1]);
    if (ex.tov) detail.push(`TOV ${tov.join("-")}`);
    check(`${label} ${ex.key}: 手で数えた値（${ex.seconds}秒・${ex.points.join("-")}）と一致`, sec === ex.seconds && pts[0] === ex.points[0] && pts[1] === ex.points[1] && playerOk && tovOk, `索引 ${sec}秒・${pts.join("-")} ${detail.join(" / ")}`);
  }
}

function tc_quality(tpi: TeamPeriodIndexFile, r: number): number {
  return tpi.rows.counts[TEAM_CLUTCH_QUALITY_KEY]?.[r] ?? 0;
}

const gameNoCache = new WeakMap<PlayerGameIndexFile, Map<string, number>>();
function pgiGameNo(pgi: PlayerGameIndexFile, key: string): number {
  let m = gameNoCache.get(pgi);
  if (!m) gameNoCache.set(pgi, (m = new Map(pgi.games.key.map((k, i) => [k, i]))));
  return m.get(key) ?? -1;
}

for (const t of TARGETS) await validateSeason(t.season, t.category);
console.log(ng === 0 ? "クラッチの検証: すべて ok" : `クラッチの検証: NG ${ng}件`);
process.exit(ng === 0 ? 0 : 1);
