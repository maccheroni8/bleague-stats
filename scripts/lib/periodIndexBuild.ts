// ピリオド別の索引を作る（DESIGN.md 225章。形式は shared/periodIndex.ts）。
// そのシーズンの試合の生データ（games/）と、同じシーズンの1試合行の索引（player-game-index.json・team-game-index.json。先に作っておく）から作る。
// 値は、シーズン成績のQ別・前後半（src/lib/playerSeasonBoxscore.ts の computeGamePeriodTotals・computeGameTeamPeriodTotals）が呼ぶのと同じ関数
// （buildPlayerBoxscores・buildTeamTotalCounts・computeTeamRatings）に、同じ区間の定義（buildPeriodRangeOptions）を渡して出す。
// src/lib は拡張子なしの import を使うため Node で直接読めない。esbuild で1ファイルにまとめてから実行する（npm run aggregate:period-index）。
// 選手の行は、1試合行の索引の行（出場した試合）に結び付ける。前後半5分の特別な試合（1Q〜4Qが無い）の行は持たない。
import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./storage.ts";
import {
  PERIOD_ATOMS,
  PERIOD_INDEX_VERSION,
  PERIOD_POSS_KEYS,
  PERIOD_ROW_FLAG_PLUS_MINUS,
  PLAYER_PERIOD_STAT_COLUMNS,
  TEAM_PERIOD_COUNT_COLUMNS,
  type PeriodAtom,
  type PeriodPossKey,
  type PlayerPeriodIndexFile,
  type PlayerPeriodStatColumn,
  type TeamPeriodIndexFile,
} from "../../shared/periodIndex.ts";
import { GAME_FLAG_SHORT, type PlayerGameIndexFile, type TeamGameIndexFile } from "../../shared/gameIndex.ts";
import { overtimeCount } from "../../shared/gamePeriods.ts";
import type { StoredGame } from "../../shared/types.ts";
import { buildPlayerBoxscores, buildTeamTotalCounts, computeTeamRatings, type BoxscoreCounts } from "../../src/lib/boxscoreAggregate";
import { buildPeriodRangeOptions, type PeriodRangeOption } from "../../src/lib/periodRange";

/** 選手の統計の列の値（BoxscoreCounts から。PlayerGameLog・PlayerSeasonRawTotals と同じ項目への対応は buildPeriodFilteredRawTotals と同じ） */
function playerStatOf(c: BoxscoreCounts, col: PlayerPeriodStatColumn): number {
  switch (col) {
    case "fgm":
      return c.pt2m + c.pt3m;
    case "fga":
      return c.pt2a + c.pt3a;
    case "tpm":
      return c.pt3m;
    case "tpa":
      return c.pt3a;
    case "reb":
      return c.treb;
    case "blockedAgainst":
      return c.bson;
    case "foulsDrawn":
      return c.foulon;
    case "pf":
      return c.foul;
    case "mid2m":
      return c.nonPaint2m;
    case "mid2a":
      return c.nonPaint2a;
    case "plusMinus":
      return c.hasPlusMinus ? c.plusMinus : 0;
    default:
      return Number((c as unknown as Record<string, unknown>)[col] ?? 0);
  }
}

/** その試合の区間の選択肢（シーズン成績のQ別・前後半と同じ定義。試合の延長の本数で、延長の区間が決まる） */
function periodOptionsOf(game: StoredGame): { atoms: (PeriodRangeOption | null)[]; poss: Record<PeriodPossKey, PeriodRangeOption | null> } {
  const overtimes = overtimeCount(game);
  const options = buildPeriodRangeOptions(4 + overtimes);
  const pick = (value: string): PeriodRangeOption | null => options.find((o) => o.value === value) ?? null;
  const atoms = PERIOD_ATOMS.map((a) => pick(a));
  const poss = Object.fromEntries(PERIOD_POSS_KEYS.map((k) => [k, pick(k)])) as Record<PeriodPossKey, PeriodRangeOption | null>;
  return { atoms, poss };
}

function emptyPlayerColumns(): Record<PlayerPeriodStatColumn, number[]> {
  return Object.fromEntries(PLAYER_PERIOD_STAT_COLUMNS.map((c) => [c, [] as number[]])) as Record<PlayerPeriodStatColumn, number[]>;
}

function isParticipating(values: number[]): boolean {
  return values.some((v) => v !== 0);
}

async function readIndexes(season: string): Promise<{ player: PlayerGameIndexFile; team: TeamGameIndexFile } | null> {
  const dir = path.join(DATA_DIR, season);
  const player = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
  const team = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
  if (!player || !team) return null;
  return { player, team };
}

/** そのシーズンのピリオド別の索引（選手・チーム）。1試合行の索引が無いシーズンは null */
export async function buildPeriodIndex(season: string): Promise<{ player: PlayerPeriodIndexFile; team: TeamPeriodIndexFile } | null> {
  const indexes = await readIndexes(season);
  if (!indexes) return null;
  const { player: playerIndex, team: teamIndex } = indexes;
  const generatedAt = new Date().toISOString();

  // 選手の索引の行: (選手ID, 試合) → 行の番号
  const rowOf = new Map<string, number>();
  const { rows: pr, players, games } = playerIndex;
  for (let i = 0; i < pr.player.length; i++) rowOf.set(`${players[pr.player[i]!]![0]}|${games.key[pr.game[i]!]}`, i);
  const gameNumber = new Map<string, number>(games.key.map((k, i) => [k, i]));

  const allGames = (await readAllGames(season)).filter((g) => gameNumber.has(String(g.scheduleKey)));
  if (allGames.length !== games.key.length) throw new Error(`${season}: 索引の試合 ${games.key.length} 件のうち、生データがあるのは ${allGames.length} 件です`);
  allGames.sort((a, b) => gameNumber.get(String(a.scheduleKey))! - gameNumber.get(String(b.scheduleKey))!);

  // 選手: 行ごとの区間の値を集めてから (row, period) の昇順に書く
  const perRow = new Map<number, { period: number; plusMinus: boolean; values: number[] }[]>();
  // チーム: 試合番号×2＋(ホーム 0／アウェイ 1)
  const teamRows = teamIndex.games.key.length * 2;
  const teamCounts: Record<string, number[]> = {};
  for (const a of PERIOD_ATOMS) for (const c of TEAM_PERIOD_COUNT_COLUMNS) teamCounts[`${a}.${c}`] = new Array<number>(teamRows).fill(-1);
  const teamPoss = Object.fromEntries(PERIOD_POSS_KEYS.map((k) => [k, new Array<number>(teamRows).fill(-1)])) as Record<PeriodPossKey, number[]>;
  const teamGameNumber = new Map<string, number>(teamIndex.games.key.map((k, i) => [k, i]));

  for (const game of allGames) {
    const key = String(game.scheduleKey);
    const g = gameNumber.get(key)!;
    const short = (games.flags[g]! & GAME_FLAG_SHORT) !== 0;
    const tg = teamGameNumber.get(key);
    if (tg === undefined) throw new Error(`${season} ${key}: チームの索引に試合がありません`);
    const { atoms, poss } = periodOptionsOf(game);
    for (const side of [0, 1] as const) {
      const ownRows = side === 0 ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
      const oppRows = side === 0 ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
      // 前後半5分の特別な試合は、1Q〜4Q・前半・後半を持たない（クォーターではない。DESIGN.md 143章）
      const usable = (a: PeriodAtom, opt: PeriodRangeOption | null): opt is PeriodRangeOption => opt !== null && !(short && a !== "ot");
      PERIOD_ATOMS.forEach((atom, ai) => {
        const opt = atoms[ai]!;
        if (!usable(atom, opt)) return;
        for (const p of buildPlayerBoxscores(ownRows, opt, game.raw.PlayByPlays, [])) {
          if (p.dnp) continue;
          const row = rowOf.get(`${p.playerId}|${key}`);
          if (row === undefined) continue; // 出場時間が0の行（索引に無い）
          const values = PLAYER_PERIOD_STAT_COLUMNS.map((c) => playerStatOf(p.counts, c));
          if (!isParticipating(values)) continue;
          let list = perRow.get(row);
          if (!list) perRow.set(row, (list = []));
          list.push({ period: ai, plusMinus: p.counts.hasPlusMinus, values });
        }
        // チームの自チームの値（相手の値は相手の行から引く）
        const own = buildTeamTotalCounts(ownRows, opt);
        for (const c of TEAM_PERIOD_COUNT_COLUMNS) teamCounts[`${atom}.${c}`]![tg * 2 + side] = Number((own as unknown as Record<string, unknown>)[c] ?? 0);
      });
      for (const k of PERIOD_POSS_KEYS) {
        const opt = poss[k];
        if (!opt || (short && k !== "ot")) continue;
        teamPoss[k][tg * 2 + side] = computeTeamRatings(buildTeamTotalCounts(ownRows, opt), buildTeamTotalCounts(oppRows, opt)).poss;
      }
    }
  }

  // 結び付けの確認: 索引の行はすべて、いずれかの区間に値を持つ（特別な試合でも、出場が数秒だけでもないのに無いのは異常）
  const rowIds = [...perRow.keys()].sort((a, b) => a - b);
  for (let i = 0; i < pr.player.length; i++) {
    if (perRow.has(i)) continue;
    const g = pr.game[i]!;
    if ((games.flags[g]! & GAME_FLAG_SHORT) !== 0) continue;
    // 公式の記録で、試合全体の出場が1秒だけでどの区間にも記録の無い選手（全区間が DNP）。区間の値は無い（validate-period-index が確かめる）
    if (pr.stats.minSec[i]! <= 2) continue;
    throw new Error(`${season} ${games.key[g]} ${players[pr.player[i]!]![0]}: 試合に出た選手の区間の値がありません`);
  }

  const rows: PlayerPeriodIndexFile["rows"] = { row: [], period: [], flags: [], stats: emptyPlayerColumns() };
  for (const row of rowIds) {
    for (const e of perRow.get(row)!.sort((a, b) => a.period - b.period)) {
      rows.row.push(row);
      rows.period.push(e.period);
      rows.flags.push(e.plusMinus ? PERIOD_ROW_FLAG_PLUS_MINUS : 0);
      PLAYER_PERIOD_STAT_COLUMNS.forEach((c, ci) => rows.stats[c].push(e.values[ci]!));
    }
  }

  return {
    player: { version: PERIOD_INDEX_VERSION, generatedAt, season, indexRows: pr.player.length, rows },
    team: { version: PERIOD_INDEX_VERSION, generatedAt, season, indexRows: teamRows, rows: { counts: teamCounts, poss: teamPoss } },
  };
}
