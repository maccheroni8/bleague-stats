// 試合詳細の md の材料を集める（見本づくり・検証用。ブラウザの代わりにファイルから読む）。試合詳細ページが集める材料と同じ関数を使う
import { readFileSync, existsSync } from 'node:fs';
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const file = `${process.cwd()}/${decodeURIComponent(String(url).split('?')[0]!).replace(/^\//, '').replace(/^bleague-stats\//, '')}`;
  return existsSync(file) ? new Response(readFileSync(file), { status: 200 }) : new Response(null, { status: 404 });
};
const data = await import('../../src/lib/data.ts');
const { makeClassifier } = await import('../../shared/registration.ts');
const { loadSeasonRegistrations } = await import('../../src/lib/registrationScope.ts');
const { splitClassificationSeason } = await import('../../src/lib/classificationFilter.ts');
const { distinctTeamColors } = await import('../../src/lib/teamColorPairs.ts');
const { LEAGUE_LABELS } = await import('../../src/lib/league.ts');
const { seasonRuleFor } = await import('../../shared/seasonRules.ts');
const { isPbpSupported, isShotChartSupported } = await import('../../src/lib/useSeasonCoverage.ts');

export async function loadGameMdInput(season: string, scheduleKey: string, league: 'premier' | 'one') {
  const game = await data.fetchGame(season, scheduleKey, league);
  const seasons = await data.fetchSeasons();
  const seasonInfo = seasons.find((s) => s.season === season);
  const coverage = seasonInfo?.coverage ?? null;
  const players = await data.fetchPlayers(season, league);
  const registrations = splitClassificationSeason(season) ? await loadSeasonRegistrations(season, league).catch(() => null) : null;
  const classifyAt = makeClassifier(season, registrations, new Map(players.map((p) => [p.playerId, p] as const)));
  const classificationById = new Map([...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores].map((r) => [r.PlayerID, classifyAt(r.PlayerID, game.date)] as const));
  const teamColors = await data.fetchTeamColors().catch(() => ({}) as Record<string, never>);
  const [homeColor, awayColor] = distinctTeamColors([(teamColors as Record<string, object>)[game.homeTeam.id] ?? {}, (teamColors as Record<string, object>)[game.awayTeam.id] ?? {}]);
  const seasonRules = await data.fetchSeasonRules().catch(() => null);
  const yahooSupported = league === 'premier' && (seasonInfo?.yahooPbp ?? false);
  const yahooPbp = yahooSupported ? await data.fetchYahooGamePbp(season, scheduleKey, league) : null;
  return {
    game, league, leagueLabel: LEAGUE_LABELS[league], classificationById, homeColor, awayColor,
    pbpSupported: isPbpSupported(coverage), shotChartSupported: isShotChartSupported(coverage),
    maxForeignOnCourt: seasonRules ? seasonRuleFor(seasonRules, game.season, league)?.maxForeignOnCourt : undefined,
    yahooPbp, exportedAt: new Date().toISOString().slice(0, 10),
  };
}
