// 画面専用。保存済みの値と、全選手スタッツ・個人詳細で使う計算部品を読むだけ。
import type { Division } from '../../shared/types';
import { filterByGameType } from '../../shared/gameType';
import { teamTotalsForTransferredPlayer } from '../../shared/transferredTeamTotals';
import { filterGameLogs } from './situational';
import { buildSeasonBoxscoreCtx, sumPlayerGameLogs, sumTeamGameLogsFor, SEASON_ADVANCED_COLUMNS } from './playerSeasonBoxscore';
import { changedRegistrations, scopedPlayerMatches, scopeLogsByClassification } from './registrationScopeCore';
import { figureClassGroup } from './figureAge';
import type { ScorerData, ScorerQuery } from './figureTopScorers';

export interface UsgPppPoint {
  id: string; playerId: string; name: string; teamId: string; teamName: string; division?: Division;
  teamIds: string[]; games: number; teamGames: number; ratio: number; pts: number;
  usg: number | null; ppp: number | null;
}
export type UsgPppQuery = Omit<ScorerQuery, 'minRatio'>;
const usgColumn = SEASON_ADVANCED_COLUMNS.find(c => c.key === 'usg')!;
const ortgColumn = SEASON_ADVANCED_COLUMNS.find(c => c.key === 'ortg')!;
const finite = (v: number | undefined): number | null => v !== undefined && Number.isFinite(v) ? v : null;

/** 移籍選手は1選手1点。期間は全選手スタッツと同じく、選手の試合ログに適用する。 */
export function buildUsgPpp(data: ScorerData, q: UsgPppQuery): UsgPppPoint[] {
  const changed = changedRegistrations(data.registrations), group = figureClassGroup(q.classification);
  const ownTeams = new Map<string, string>();
  for (const [id, logs] of data.teamLogs) for (const g of logs) ownTeams.set(`${g.scheduleKey}|${g.isHome}`, id);
  const ownTeamOf = (g: { scheduleKey: string; isHome: boolean }) => ownTeams.get(`${g.scheduleKey}|${g.isHome}`);
  const scope = <T extends Parameters<typeof filterGameLogs>[0][number]>(logs: T[]) =>
    filterByGameType(filterGameLogs(logs, { range: q.range, includePlayoffs: true }, undefined, undefined, undefined, undefined, q.category), q.gameType);
  const scopedTeams = new Map([...data.teamLogs].map(([id, logs]) => [id, scope(logs)]));
  const points: UsgPppPoint[] = [];
  for (const p of data.players) {
    if (!scopedPlayerMatches(p, group, changed)) continue;
    const allLogs = data.playerLogs.get(p.playerId) ?? [];
    const classLogs = scopeLogsByClassification(allLogs, p.playerId, group, changed);
    const logs = scope(classLogs);
    const raw = sumPlayerGameLogs(logs);
    if (!raw.gamesPlayed) continue;
    const full = q.range.kind === 'all' && q.gameType === 'regular' && !(group !== 'all' && changed.has(p.playerId));
    const teamLogs = data.teamLogs.get(p.teamId) ?? [];
    const transferred = teamTotalsForTransferredPlayer(classLogs, logs, ownTeamOf, scopedTeams);
    const team = transferred ?? sumTeamGameLogsFor(teamLogs, new Set((full ? scopedTeams.get(p.teamId) ?? [] : logs).map(g => g.scheduleKey)));
    const ctx = buildSeasonBoxscoreCtx(raw, team, 'perGame', Number(q.season.slice(0, 4)));
    const teamIds = [...new Set(logs.filter(g => g.min > 0).map(ownTeamOf).filter((id): id is string => !!id))];
    // 移籍選手の出場率も、分母の計算と同じ所属期間で数える。
    let teamGames = scopedTeams.get(p.teamId)?.length ?? 0;
    if (transferred) {
      teamGames = 0;
      for (const id of teamIds) {
        const dates = classLogs.filter(g => ownTeamOf(g) === id).map(g => g.date).sort();
        teamGames += (scopedTeams.get(id) ?? []).filter(g => g.date >= dates[0]! && g.date <= dates[dates.length - 1]!).length;
      }
    }
    points.push({ id: p.playerId, playerId: p.playerId, name: p.name, teamId: p.teamId, teamName: p.teamName,
      division: data.divisions?.[q.category]?.[q.season]?.[p.teamId], teamIds,
      games: raw.gamesPlayed, teamGames, ratio: teamGames ? 100 * raw.gamesPlayed / teamGames : 0,
      pts: raw.pts / raw.gamesPlayed,
      usg: full ? finite(p.advanced.usagePct) : team.min > 0 ? finite(usgColumn.value(ctx, 'perGame')) : null,
      ppp: full ? finite(p.advanced.ppp) : ortgColumn.format(ctx, 'perGame') === '-' ? null : finite(ortgColumn.value(ctx, 'perGame') / 100),
    });
  }
  return points;
}
export function usgPppDomain(values: (number | null)[], axis: 'usg' | 'ppp') {
  const [lo, hi, step] = axis === 'usg' ? [10, 40, 5] : [0.75, 1.5, 0.05];
  const valid = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const min = Math.min(lo!, ...valid.map(v => Math.floor((v + 1e-9) / step!) * step!));
  const max = Math.max(hi!, ...valid.map(v => Math.ceil((v - 1e-9) / step!) * step!));
  return { min, max, step: step!, ticks: Array.from({ length: Math.round((max - min) / step!) + 1 }, (_, i) => Number((min + i * step!).toFixed(6))) };
}
export function usgPppAverage(points: UsgPppPoint[]) {
  const average = (key: 'usg' | 'ppp') => {
    const values = points.map(p => p[key]).filter((v): v is number => v !== null);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  };
  return { usg: average('usg'), ppp: average('ppp') };
}
