// AI向けMarkdown（詳しい版）：チーム情報の「リーグ順位」と「リーグ平均」。画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。
// 向き（多いほうが良い／少ないほうが良い）と列の値は、チームランキング（シーズン成績）と同じ列の定義（buildTeamCategoryColumns）から取る。
// 順位の付け方もランキングと同じ：同じ値（画面に出す丸めた文字が同じ）は同じ順位、次はその分飛ばす（1位・2位・2位・4位）
import type { TeamGameLog } from '../../shared/types';
import { buildTraditionalColumns, buildAdvancedColumns, buildMiscColumns, buildScoringColumns, buildPointsShareColumns, sumTeamGameLogs, EMPTY_TOTALS, type AllTeamsRow, type TeamPerspective } from './teamStatsColumns';
import { rankPositions } from './seasonCompare';
import { teamPeriodEffTotal } from './teamSituationalPeriod';

export interface RankDirection { sort: (r: AllTeamsRow) => number; higherIsBetter: boolean }

/** 列の名前 → 並べ替えの値と向き（ランキングの列の定義。同じ名前は先のカテゴリを使う。G・BSR・EFF はここに無い） */
export function leagueDirections(perspective: TeamPerspective, foulSplit: boolean, seasonStartYear: number): Map<string, RankDirection> {
  const m = new Map<string, RankDirection>();
  const add = (cols: ReturnType<typeof buildPointsShareColumns>) => {
    for (const c of cols) if (!m.has(c.label)) m.set(c.label, { sort: r => Number(c.sortValue(r)), higherIsBetter: c.higherIsBetter !== false });
  };
  // チームランキング（シーズン成績）が使う列と同じ定義（teamSeasonRanking.ts の buildTeamCategoryColumns と同じ引数）
  add(buildTraditionalColumns('perGame', perspective));
  add(buildAdvancedColumns('perGame', perspective));
  add(buildMiscColumns('perGame', perspective, true, foulSplit));
  add(buildScoringColumns('perGame', perspective, true, true));
  add(buildPointsShareColumns(perspective));
  // 全チームスタッツの列に無い BSR（被ブロック＝相手のBLK。少ないほうが良い）・EFF（多いほうが良い）。自チーム視点だけ（シーズン別成績と同じ）
  if (perspective === 'own') {
    m.set('BSR', { sort: r => (r.gamesPlayed > 0 ? r.totals.oppBlk / r.gamesPlayed : NaN), higherIsBetter: false });
    m.set('EFF', { sort: r => (r.gamesPlayed > 0 ? teamPeriodEffTotal(r.totals, false, seasonStartYear) / r.gamesPlayed : NaN), higherIsBetter: true });
  }
  return m;
}

/** 順位（teamId → 順位）。値のある（NaN でない）チームだけを並べる。texts はそのチームの値を画面に出す文字（同じ文字は同じ順位） */
export function leagueRanks(pool: ReadonlyMap<string, AllTeamsRow>, dir: RankDirection, text: (r: AllTeamsRow) => string): Map<string, number> {
  const entries = [...pool].map(([teamId, row]) => ({ teamId, value: dir.sort(row), text: text(row) })).filter(e => Number.isFinite(e.value));
  entries.sort((a, b) => (dir.higherIsBetter ? b.value - a.value : a.value - b.value));
  const ranks = rankPositions(entries.map(e => e.text));
  return new Map(entries.map((e, k) => [e.teamId, ranks[k]!]));
}

/** リーグ全体を1チームとみなした行（全チームの対象の試合の合計。1試合平均・成功率などを同じ式で出すため） */
export function pooledRow(rows: readonly AllTeamsRow[], allLogs: readonly TeamGameLog[]): AllTeamsRow {
  const wins = rows.reduce((a, r) => a + r.wins, 0);
  const games = rows.reduce((a, r) => a + r.gamesPlayed, 0);
  return { team: { teamId: 'league', teamName: 'リーグ平均' }, gamesPlayed: games, wins, losses: games - wins, totals: allLogs.length ? sumTeamGameLogs([...allLogs]) : { ...EMPTY_TOTALS } };
}
