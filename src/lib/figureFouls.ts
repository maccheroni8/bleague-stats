// 図解「ファウル」（チーム・選手）の集計。読むのはファウルの導出データ（shared/foulsIndex.ts）だけ。
// 試合区分・試合の範囲（全試合・直近◯試合・期間）は、チームごとの試合に当てる（選手の行は、その試合の所属チームの範囲に入る試合だけ数える）。
// 「1試合で2回」は、同じ試合で2回以上あった試合の数（TF。UF は 2025-26 まではアンスポーツマン、2026-27 からはフレグラント＋ディスラプティブ）。
// 順位は同じ数を同じ順位にして次をとばす。塗りは列ごとの順位 1〜3 の数（0 は塗らない）。
import { GAME_FLAG_PLAYOFF } from "../../shared/gameIndex";
import type { FoulsIndexFile } from "../../shared/foulsIndex";
import type { SituationalRange } from "./situational";
import { NEW_RULE_FIRST_SEASON } from "./ruleChange";

export type FoulGameType = "regular" | "playoff" | "both";
export interface FoulScope {
  gameType: FoulGameType;
  range: SituationalRange;
}

/** 2026-27 から、アンスポーツマン系をフレグラント・ディスラプティブに分ける */
export function foulSplitSeason(season: string): boolean {
  return season >= NEW_RULE_FIRST_SEASON;
}

export interface TeamFoulRow {
  teamId: string;
  teamName: string;
  /** 数えた試合（プレーバイプレーがある試合） */
  games: number;
  tf: number;
  tfCoach: number;
  tfBench: number;
  tfPlayer: number;
  uf: number;
  flagrant: number;
  disruptive: number;
  dq: number;
}

export interface PlayerFoulRow {
  playerId: string;
  name: string;
  /** 範囲の中で最後に数えた試合のチーム */
  lastTeamId: string;
  lastTeamName: string;
  tf: number;
  tfTwice: number;
  uf: number;
  ufTwice: number;
  flagrant: number;
  disruptive: number;
  dq: number;
}

/** チームの番号 → 範囲に入る試合の番号（日付順） */
function scopedGames(file: FoulsIndexFile, scope: FoulScope): Map<number, Set<number>> {
  const byTeam = new Map<number, number[]>();
  for (let g = 0; g < file.games.key.length; g++) {
    const playoff = (file.games.flags[g]! & GAME_FLAG_PLAYOFF) !== 0;
    if (scope.gameType === "regular" && playoff) continue;
    if (scope.gameType === "playoff" && !playoff) continue;
    for (const t of [file.games.home[g]!, file.games.away[g]!]) {
      const list = byTeam.get(t) ?? [];
      list.push(g);
      byTeam.set(t, list);
    }
  }
  const out = new Map<number, Set<number>>();
  for (const [t, list] of byTeam) {
    const ordered = [...list].sort((a, b) => (file.games.date[a]! < file.games.date[b]! ? -1 : file.games.date[a]! > file.games.date[b]! ? 1 : a - b));
    const range = scope.range;
    const picked =
      range.kind === "recent"
        ? ordered.slice(Math.max(0, ordered.length - range.n))
        : range.kind === "dateRange"
          ? ordered.filter((g) => (!range.start || file.games.date[g]! >= range.start) && (!range.end || file.games.date[g]! <= range.end))
          : ordered;
    out.set(t, new Set(picked));
  }
  return out;
}

export function teamFoulRows(file: FoulsIndexFile, scope: FoulScope): TeamFoulRow[] {
  const games = scopedGames(file, scope);
  const rows: TeamFoulRow[] = [];
  file.teams.forEach(([teamId, teamName], t) => {
    const set = games.get(t);
    if (!set || set.size === 0) return;
    const row: TeamFoulRow = { teamId, teamName, games: 0, tf: 0, tfCoach: 0, tfBench: 0, tfPlayer: 0, uf: 0, flagrant: 0, disruptive: 0, dq: 0 };
    for (const g of set) {
      const r = g * 2 + (file.games.home[g] === t ? 0 : 1);
      if (file.team.tfCoach[r] === -1) continue;
      row.games++;
      row.tfCoach += file.team.tfCoach[r]!;
      row.tfBench += file.team.tfBench[r]!;
      row.tfPlayer += file.team.tfPlayer[r]!;
      row.uf += file.team.uf[r]!;
      row.flagrant += file.team.flagrant[r]!;
      row.disruptive += file.team.disruptive[r]!;
      row.dq += file.team.dq[r]!;
    }
    row.tf = row.tfCoach + row.tfBench + row.tfPlayer;
    if (row.games > 0) rows.push(row);
  });
  return rows;
}

export function playerFoulRows(file: FoulsIndexFile, scope: FoulScope): PlayerFoulRow[] {
  const games = scopedGames(file, scope);
  const byPlayer = new Map<number, PlayerFoulRow & { lastGame: number }>();
  const p = file.player;
  for (let i = 0; i < p.player.length; i++) {
    const g = p.game[i]!;
    const t = p.team[i]!;
    if (!games.get(t)?.has(g)) continue;
    const [playerId, name] = file.players[p.player[i]!]!;
    const [teamId, teamName] = file.teams[t]!;
    let row = byPlayer.get(p.player[i]!);
    if (!row) {
      row = { playerId, name, lastTeamId: teamId, lastTeamName: teamName, lastGame: -1, tf: 0, tfTwice: 0, uf: 0, ufTwice: 0, flagrant: 0, disruptive: 0, dq: 0 };
      byPlayer.set(p.player[i]!, row);
    }
    const date = file.games.date[g]!;
    if (row.lastGame < 0 || date > file.games.date[row.lastGame]! || (date === file.games.date[row.lastGame]! && g > row.lastGame)) {
      row.lastGame = g;
      row.lastTeamId = teamId;
      row.lastTeamName = teamName;
    }
    row.tf += p.tf[i]!;
    row.uf += p.uf[i]!;
    row.flagrant += p.flagrant[i]!;
    row.disruptive += p.disruptive[i]!;
    row.dq += p.dq[i]!;
    if (p.tf[i]! >= 2) row.tfTwice++;
    if (p.uf[i]! >= 2) row.ufTwice++;
  }
  return [...byPlayer.values()].map(({ lastGame: _lastGame, ...row }) => row);
}

/** 多い順の順位（同じ数は同じ順位、次はとばす）。values は並べたあとの順 */
export function competitionRanks(values: readonly number[]): number[] {
  return values.map((v) => 1 + values.filter((w) => w > v).length);
}

/** 列ごとの塗りの濃さ（1＝1位〜3＝3位。0 と 4位以下は null）。順位は competitionRanks と同じ数え方 */
export function topThreeLevels(values: readonly number[]): (1 | 2 | 3 | null)[] {
  return values.map((v) => {
    if (!(v > 0)) return null;
    const rank = 1 + values.filter((w) => w > v).length;
    return rank <= 3 ? (rank as 1 | 2 | 3) : null;
  });
}

/** 多い順に並べる（同じ数はほかの列の多い順、それでも同じなら名前の順） */
export function sortByCounts<T>(rows: readonly T[], keys: readonly ((r: T) => number)[], name: (r: T) => string): T[] {
  return [...rows].sort((a, b) => {
    for (const k of keys) {
      const d = k(b) - k(a);
      if (d !== 0) return d;
    }
    return name(a).localeCompare(name(b), "ja");
  });
}

/**
 * 表の並べ替え。並べる列（sortValue）の多い順に並べ、順位はその列の多い順の順位（同じ数は同じ順位、次はとばす）。
 * 少ない順（descending=false）は、多い順の並びと順位をそのまま逆にする（順位の数字は変えない）。
 * 同じ数の中は ties（ほかの列）の多い順、それでも同じなら名前の順（少ない順はその逆）
 */
export function sortFoulRows<T>(rows: readonly T[], sortValue: (r: T) => number, ties: readonly ((r: T) => number)[], name: (r: T) => string, descending: boolean): { rows: T[]; ranks: number[] } {
  const sorted = sortByCounts(rows, [sortValue, ...ties], name);
  const ranks = competitionRanks(sorted.map(sortValue));
  return descending ? { rows: sorted, ranks } : { rows: sorted.reverse(), ranks: ranks.reverse() };
}

/** サブタイトルの並び順（「合計▼」＝多い順・「合計▲」＝少ない順。シュート成功率の表と同じ書き方） */
export const foulSortLabel = (label: string, descending: boolean) => `${label}${descending ? "▼" : "▲"}`;
