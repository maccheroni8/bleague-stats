// AI向けMarkdown（詳しい版）：Shooting と Forced TOV（スポーツナビの記録）。画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。
// 値は画面と同じ集計・同じ列の式を呼ぶ：Shooting＝shotTypeEntityColumns・shotTypeDiffColumns（全チームスタッツの Shooting）、
// Forced TOV＝sumForcedTurnovers・FORCED_TURNOVER_COLUMNS（全チームスタッツの Forced TOV）。
// 「記録がある試合」だけで数える：記録が無い試合を 0 として分母にも合計にも入れない。
import type { ShotTypeBreakdown, TeamForcedTurnovers, TeamGameLog, YahooGamePbp } from '../../shared/types';
import { buildShotTypeBreakdown, shotTypeDiffColumns, shotTypeEntityColumns, sortShotTypeKeys, sumShotTypeCounts } from './shotTypeBreakdown';
import { sumForcedTurnovers } from './opponentSplit';
import { FORCED_TURNOVER_COLUMNS } from './forcedTurnoverColumns';
import { formatDecimal } from './format';
import type { TeamPerspective } from './teamStatsColumns';

/** 視点の並びと表の見出し（自チーム／opp／差） */
export const YAHOO_PERSPECTIVES: [TeamPerspective, string][] = [['own', ''], ['opp', 'opp '], ['diff', '差 ']];

/** 表の1行の意味づけ。value は順位に使う数、text は表に出す文字（'-' は値なし）。higherIsBetter は順位の向き */
export interface Metric<T> { key: string; label: string; perspective: TeamPerspective; higherIsBetter: boolean; value: (r: T) => number; text: (r: T) => string }

/** 順位の向き：自チーム・差は多いほうが良い（全チームの Shooting・Forced TOV のランキングと同じ）、opp（相手のシュート・自チームが強制された分）は少ないほうが良い */
const directionOf = (p: TeamPerspective): boolean => p !== 'opp';

// ---- Shooting（チームの試合ログの shotTypes＝スポーツナビの記録がある試合だけに入っている） ----

/** 自チーム・相手のシュート内訳（記録がある試合の合計）と、その試合数 */
export interface ShotPair { own: ShotTypeBreakdown; opp: ShotTypeBreakdown; games: number }

export function emptyShotPair(): ShotPair { return { own: {}, opp: {}, games: 0 }; }

function mergeBreakdown(into: ShotTypeBreakdown, add: ShotTypeBreakdown | undefined): void {
  for (const [type, split] of Object.entries(add ?? {})) {
    const cur = into[type] ?? { twoPoint: { made: 0, attempted: 0 }, threePoint: { made: 0, attempted: 0 } };
    into[type] = { twoPoint: sumShotTypeCounts(cur.twoPoint, split.twoPoint), threePoint: sumShotTypeCounts(cur.threePoint, split.threePoint) };
  }
}

export function addShotPair(a: ShotPair, b: ShotPair): ShotPair {
  const r = emptyShotPair();
  for (const x of [a, b]) { mergeBreakdown(r.own, x.own); mergeBreakdown(r.opp, x.opp); r.games += x.games; }
  return r;
}

/** 試合ログの合計。shotTypes が無い試合（スポーツナビの記録が無い）は数えない */
export function sumShotPair(logs: readonly TeamGameLog[]): ShotPair {
  const r = emptyShotPair();
  for (const g of logs) {
    if (!g.shotTypes) continue;
    mergeBreakdown(r.own, g.shotTypes);
    mergeBreakdown(r.opp, g.opponentShotTypes);
    r.games += 1;
  }
  return r;
}

/** 表に出すシュートタイプ（画面と同じ並び） */
export function shotKeysOf(pairs: readonly ShotPair[]): string[] {
  return sortShotTypeKeys([...new Set(pairs.flatMap(p => [...Object.keys(p.own), ...Object.keys(p.opp)]))]);
}

/** Shooting の行（視点 × シュートタイプ × 2PM・2PA・2P%・3PM・3PA・3P%）。1試合平均（分母は記録がある試合）。全チームスタッツの Shooting と同じ列の式 */
export function shootingMetrics(keys: string[]): Metric<ShotPair>[] {
  const out: Metric<ShotPair>[] = [];
  for (const [p] of YAHOO_PERSPECTIVES) {
    const cols = p === 'diff'
      ? shotTypeDiffColumns<ShotPair>(keys, r => r.own, r => r.opp, 'perGame', r => r.games)
      : shotTypeEntityColumns<ShotPair>(keys, r => (p === 'opp' ? r.opp : r.own), 'perGame', r => r.games);
    for (const c of cols) {
      out.push({ key: c.key, label: c.label, perspective: p, higherIsBetter: directionOf(p), value: r => Number(c.sortValue(r)), text: r => (c.format ? c.format(r) : String(c.sortValue(r))) });
    }
  }
  return out;
}

// ---- Forced TOV（スポーツナビの記録から数える。試合ごとの値は保存していない） ----

/** 自チームが相手に強制した（奪った）分と、自チームが記録した（相手に強制された）分の、記録がある試合の合計 */
export interface TovPair { forced: TeamForcedTurnovers; committed: TeamForcedTurnovers }

export function emptyTovPair(): TovPair {
  const z = (): TeamForcedTurnovers => ({ gamesWithData: 0, offensiveFoul: 0, violation24sec: 0, backcourtViolation: 0, violation5sec: 0, violation8sec: 0, otherDead: 0, live: 0 });
  return { forced: z(), committed: z() };
}

const addTov = (a: TeamForcedTurnovers, b: TeamForcedTurnovers): TeamForcedTurnovers => ({
  gamesWithData: a.gamesWithData + b.gamesWithData, offensiveFoul: a.offensiveFoul + b.offensiveFoul, violation24sec: a.violation24sec + b.violation24sec,
  backcourtViolation: a.backcourtViolation + b.backcourtViolation, violation5sec: a.violation5sec + b.violation5sec, violation8sec: a.violation8sec + b.violation8sec,
  otherDead: a.otherDead + b.otherDead, live: a.live + b.live,
});
export function addTovPair(a: TovPair, b: TovPair): TovPair { return { forced: addTov(a.forced, b.forced), committed: addTov(a.committed, b.committed) }; }

/** 試合ログ（そのチームの）のうち、スポーツナビの記録（pbps）がある試合の合計 */
export function sumTovPair(logs: readonly TeamGameLog[], pbps: ReadonlyMap<string, YahooGamePbp>, teamId: string): TovPair {
  const list = logs.flatMap(g => { const p = pbps.get(g.scheduleKey); return p ? [p] : []; });
  return sumForcedTurnovers(list, teamId);
}

/** teams.json の値（シーズン全体・全試合のとき）。どちらかが無ければ null */
export function tovPairFromTeam(t: { forcedTurnovers?: TeamForcedTurnovers; turnoversCommitted?: TeamForcedTurnovers }): TovPair | null {
  return t.forcedTurnovers && t.turnoversCommitted ? { forced: t.forcedTurnovers, committed: t.turnoversCommitted } : null;
}

/** Forced TOV の行（視点 × 種類）。1試合平均（分母は記録がある試合＝データあり試合数）。視点は 自チーム＝奪った／opp＝相手に強制された（自チームが記録）／差＝奪った−記録 */
export function forcedMetrics(): Metric<TovPair>[] {
  const out: Metric<TovPair>[] = [];
  for (const [p] of YAHOO_PERSPECTIVES) {
    for (const col of FORCED_TURNOVER_COLUMNS) {
      if (col.key === 'gamesWithData') continue;
      const raw = (r: TovPair): number | null => {
        if (r.forced.gamesWithData === 0) return null;
        const own = col.value(r.forced), opp = col.value(r.committed);
        return (p === 'own' ? own : p === 'opp' ? opp : own - opp) / r.forced.gamesWithData;
      };
      out.push({
        key: col.key, label: col.label, perspective: p, higherIsBetter: directionOf(p),
        value: r => raw(r) ?? Number.NaN,
        text: r => { const v = raw(r); return v === null ? '-' : p === 'diff' ? (v > 0 ? '+' : '') + formatDecimal(v, 2) : formatDecimal(v, 2); },
      });
    }
  }
  return out;
}

// ---- 選手の Shooting（スポーツナビの記録の shots を選手で絞る） ----

/**
 * 選手のシュート内訳（記録がある試合だけ）と、平均の分母にする試合数。extraGames は、出場時間が0分なのにスポーツナビには本人のシュートの記録がある試合の数
 * （選手スタッツタブの Shooting と同じくシュートには含め、平均の分母には数えない）
 */
export interface PlayerShots { breakdown: ShotTypeBreakdown; games: number; extraGames: number }

/** 選手が出た試合（playedKeys）のうち、記録（pbps）がある試合のシュートを足す。出場0分の試合（zeroMinKeys）は、本人のシュートの記録があればシュートだけ足す */
export function playerShots(playerId: string, playedKeys: Iterable<string>, pbps: ReadonlyMap<string, YahooGamePbp>, zeroMinKeys: Iterable<string> = [], periods?: readonly number[]): PlayerShots {
  const shots = [];
  const inPeriod = (s: { period: number }) => !periods || periods.includes(s.period);
  let games = 0, extraGames = 0;
  for (const k of playedKeys) {
    const p = pbps.get(k);
    if (!p) continue;
    games += 1;
    for (const s of p.shots) if (s.playerId === playerId && inPeriod(s)) shots.push(s);
  }
  for (const k of zeroMinKeys) {
    const mine = pbps.get(k)?.shots.filter(s => s.playerId === playerId && inPeriod(s)) ?? [];
    if (!mine.length) continue;
    extraGames += 1;
    shots.push(...mine);
  }
  return { breakdown: buildShotTypeBreakdown(shots), games, extraGames };
}

/** 選手の Shooting の列（1試合平均。分母は記録がある試合）。選手スタッツの Shooting と同じ列の式 */
export function playerShootingColumns(keys: string[]) {
  return shotTypeEntityColumns<PlayerShots>(keys, r => r.breakdown, 'perGame', r => r.games);
}

// ---- 前半・後半（スポーツナビの記録の period で絞る。1Q・2Q＝前半、3Q・4Q＝後半。延長は入れない） ----

/** 区間ごとのピリオド番号 */
export const HALF_PERIODS: Record<'h1' | 'h2', readonly number[]> = { h1: [1, 2], h2: [3, 4] };

/** 試合ログ（記録がある試合＝shotTypes がある）の、指定したピリオドのシュート内訳。記録（pbps）が無ければ止める */
export function shotPairInPeriods(logs: readonly TeamGameLog[], pbps: ReadonlyMap<string, YahooGamePbp>, teamId: string, periods: readonly number[]): ShotPair {
  let r = emptyShotPair();
  for (const g of logs) {
    if (!g.shotTypes) continue;
    const p = pbps.get(g.scheduleKey);
    if (!p) throw new Error('スポーツナビの記録が読み込まれていません。');
    const mine = p.shots.filter(s => periods.includes(s.period));
    r = addShotPair(r, { own: buildShotTypeBreakdown(mine.filter(s => s.teamId === teamId)), opp: buildShotTypeBreakdown(mine.filter(s => s.teamId !== teamId)), games: 1 });
  }
  return r;
}

/** 試合ログ（記録がある試合）の、指定したピリオドの Forced TOV。記録（pbps）が無ければ止める */
export function tovPairInPeriods(logs: readonly TeamGameLog[], pbps: ReadonlyMap<string, YahooGamePbp>, teamId: string, periods: readonly number[]): TovPair {
  const list: YahooGamePbp[] = [];
  for (const g of logs) {
    if (!g.shotTypes) continue;
    const p = pbps.get(g.scheduleKey);
    if (!p) throw new Error('スポーツナビの記録が読み込まれていません。');
    list.push({ ...p, turnovers: p.turnovers.filter(t => periods.includes(t.period)) });
  }
  return sumForcedTurnovers(list, teamId);
}
