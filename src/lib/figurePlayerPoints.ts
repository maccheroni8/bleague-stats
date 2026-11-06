// 画面専用（図解の選手の散布図）。選手の条件の絞り方・出場率の数え方は USG% × PPP の図と同じ。
// 値は全選手スタッツと同じ列定義（SEASON_TRADITIONAL_COLUMNS・SEASON_ADVANCED_COLUMNS）で出す。
import type { Division, TeamSeasonRawTotals } from '../../shared/types';
import { filterByGameType } from '../../shared/gameType';
import { teamTotalsForTransferredPlayer } from '../../shared/transferredTeamTotals';
import { filterGameLogs } from './situational';
import {
  buildSeasonBoxscoreCtx, sumPlayerGameLogs, sumTeamGameLogsFor, SEASON_ADVANCED_COLUMNS, SEASON_TRADITIONAL_COLUMNS,
  type PlayerSeasonRawTotals, type SeasonDisplayMode,
} from './playerSeasonBoxscore';
import { changedRegistrations, scopedPlayerMatches, scopeLogsByClassification } from './registrationScopeCore';
import { figureClassGroup } from './figureAge';
import type { ScorerData, ScorerQuery } from './figureTopScorers';

export interface PlayerFigurePoint {
  id: string; playerId: string; name: string; teamId: string; teamName: string; division?: Division;
  teamIds: string[]; games: number; teamGames: number; ratio: number;
  raw: PlayerSeasonRawTotals; team: TeamSeasonRawTotals;
}
export type PlayerFigureQuery = Omit<ScorerQuery, 'minRatio'>;

/** 移籍選手は1選手1点（所属チームは teamIds）。期間は全選手スタッツと同じく、選手の試合ログに適用する。 */
export function buildPlayerFigurePoints(data: ScorerData, q: PlayerFigureQuery): PlayerFigurePoint[] {
  const changed = changedRegistrations(data.registrations), group = figureClassGroup(q.classification);
  const ownTeams = new Map<string, string>();
  for (const [id, logs] of data.teamLogs) for (const g of logs) ownTeams.set(`${g.scheduleKey}|${g.isHome}`, id);
  const ownTeamOf = (g: { scheduleKey: string; isHome: boolean }) => ownTeams.get(`${g.scheduleKey}|${g.isHome}`);
  const scope = <T extends Parameters<typeof filterGameLogs>[0][number]>(logs: T[]) =>
    filterByGameType(filterGameLogs(logs, { range: q.range, includePlayoffs: true }, undefined, undefined, undefined, undefined, q.category), q.gameType);
  const scopedTeams = new Map([...data.teamLogs].map(([id, logs]) => [id, scope(logs)]));
  const points: PlayerFigurePoint[] = [];
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
      games: raw.gamesPlayed, teamGames, ratio: teamGames ? 100 * raw.gamesPlayed / teamGames : 0, raw, team });
  }
  return points;
}

const COLUMNS = new Map([...SEASON_TRADITIONAL_COLUMNS, ...SEASON_ADVANCED_COLUMNS].map(c => [c.key, c]));
/** 全選手スタッツと同じ列（key は pts・ast・fga・2pa・3pa・fta・fgpct・2ppct・3ppct・ftpct・efg・ts）の値。出せない値は null。 */
export function playerColumnValue(point: PlayerFigurePoint, key: string, mode: SeasonDisplayMode, season: string): number | null {
  const column = COLUMNS.get(key);
  if (!column) throw new Error(`列がありません: ${key}`);
  const ctx = buildSeasonBoxscoreCtx(point.raw, point.team, mode, Number(season.slice(0, 4)));
  const v = column.value(ctx, mode);
  return Number.isFinite(v) ? v : null;
}
export function playerColumnText(point: PlayerFigurePoint, key: string, mode: SeasonDisplayMode, season: string): string {
  const column = COLUMNS.get(key)!;
  return column.format(buildSeasonBoxscoreCtx(point.raw, point.team, mode, Number(season.slice(0, 4))), mode);
}
