// 選手詳細の md：共通の書式と、表の1行分の計算（画面と同じ関数を呼ぶ）。保存キーの対象外。
import type { PlayerGameLog } from '../../shared/types';
import { ownTeamMap, type PlayerMdSeason } from './aiPlayerScope';
import { buildTeamSplitRowsFromPeriodSource, type SeasonPeriodSource } from './seasonPeriod';
import { buildSeasonBoxscoreCtx, sumTeamTotalsForLogs, type SeasonBoxscoreCtx, type SeasonBoxTabKey } from './playerSeasonBoxscore';
import { seasonBoxColumnsWithFtrPpp } from './pppColumn';
import { displayModeApplies } from './playerSeasonRanking';
import { foulColumnsSplit } from './ruleChange';
import { displayedDiff } from './seasonCompare';
import type { PlayerMdInput } from './aiPlayerScope';

// ---- 書式 ----
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
export const mdTable = (head: string[], rows: string[][]) => [head, head.map(() => '---'), ...rows].map(r => `|${r.map(esc).join('|')}|`).join('\n');
export const winPct = (w: number, n: number) => (n === 0 ? '-' : (w / n).toFixed(3).replace(/^0/, ''));
export const record = (w: number, l: number) => `${w}勝${l}敗（${winPct(w, w + l)}）`;
export const CATS: SeasonBoxTabKey[] = ['traditional', 'advanced', 'misc', 'scoring'];
export const CAT_NAME: Record<string, string> = { traditional: 'Traditional', advanced: 'Advanced', misc: 'Misc', scoring: 'Scoring' };

/** 使った指標の名前を集める（最後の「定義」の章用） */
export class UsedLabels { readonly set = new Set<string>(); add(l: string): string { this.set.add(l); return l; } }

/** 試合ログ（出場した試合）から表の1行分の ctx。移籍した選手は「複数チーム」の合計行。区間（q1…・clutch）を指定できる */
export function ctxForLogs(season: PlayerMdSeason, playerId: string, logs: PlayerGameLog[], period: Parameters<typeof buildTeamSplitRowsFromPeriodSource>[7] = 'all', source: SeasonPeriodSource | null = null): SeasonBoxscoreCtx | null {
  const played = logs.filter(g => g.min > 0);
  if (played.length === 0) return null;
  const ownBy = ownTeamMap({ summaries: season.summaries, logs: played });
  const teamTotals = sumTeamTotalsForLogs(played, ownBy, season.teamLogs);
  const rows = buildTeamSplitRowsFromPeriodSource('md', played, ownBy, teamTotals, 'perGame', Number(season.season.slice(0, 4)), playerId, period, source);
  return (rows.find(r => r.isCombined) ?? rows[0])?.ctx ?? null;
}
const totalCtx = (c: SeasonBoxscoreCtx) => buildSeasonBoxscoreCtx(c.raw, c.team, 'total', c.seasonStartYear);

/**
 * 割合の項目で、分母が0のとき true（サイトの決まりは「-」。一部の列は 0.00% と出すので、md では「-」にそろえる）。
 * 平均・合計・差・順位のすべてでこの判定を使う
 */
export function zeroDenominator(key: string, label: string, raw: SeasonBoxscoreCtx['raw']): boolean {
  const fga = raw.fga, fta = raw.fta;
  switch (key) {
    case 'fgpct': case 'ftr': case 'pct3pmown': case 'pct3paown': case 'pctpaint2mown': case 'pctpaint2aown': case 'pctmid2mown': case 'pctmid2aown': return fga <= 0;
    case '2ppct': return fga - raw.tpa <= 0;
    case '3ppct': return raw.tpa <= 0;
    case 'ftpct': return fta <= 0;
    case 'efg': case 'pps': return fga <= 0;
    case 'ts': return fga + 0.44 * fta <= 0;
    case 'ppp': case 'tovpct': return fga + 0.44 * fta + raw.tov <= 0;
    case 'paint2pct': return raw.paint2a <= 0;
    case 'mid2pct': return raw.mid2a <= 0;
    default: return false;
  }
}

/** 項目（行）×対象（列）の表。対象ごとに 平均・合計。tab ごと */
export function statsRows(cat: SeasonBoxTabKey, season: string, ctxs: (SeasonBoxscoreCtx | null)[], used: UsedLabels, skipBasic = false) {
  const cols = seasonBoxColumnsWithFtrPpp(cat, foulColumnsSplit([season])).filter(c => !(skipBasic && ['G', 'GS', 'MIN', 'PTS'].includes(c.label)));
  return cols.map(c => ({
    key: c.key, label: used.add(c.label),
    avg: ctxs.map(x => (x && !zeroDenominator(c.key, c.label, x.raw) ? c.format(x, 'perGame') : '-')),
    total: ctxs.map(x => (x && !zeroDenominator(c.key, c.label, x.raw) ? c.format(totalCtx(x), 'total') : '-')),
    differs: displayModeApplies(cat, c.key),
  }));
}


/** 差の文字。％の項目は割合どうしの差なので「pt」（ポイント）で書く。時間は分:秒。読めないときは「-」 */
export function diffText(cur: string, prev: string): string {
  const d = displayedDiff(cur.replace(/^\+(\d+:\d{2})/, '$1'), prev.replace(/^\+(\d+:\d{2})/, '$1'));
  if (!d) return '-';
  return d.percent ? `${d.text.replace(/%$/, '')}pt` : d.text;
}

/** 比べる前季（シーズン全体のレギュラーシーズン）の試合ログ。チェックなし・前季なしは null */
export function prevLogsOf(i: PlayerMdInput): PlayerGameLog[] | null {
  return i.compare && i.prev ? i.prev.logs.filter(g => g.gameType === 'regular') : null;
}
/** 前季全体の ctx（区間を指定できる） */
export function prevCtxOf(i: PlayerMdInput, period: Parameters<typeof ctxForLogs>[3] = 'all'): SeasonBoxscoreCtx | null {
  const logs = prevLogsOf(i);
  return logs && i.prev ? ctxForLogs(i.prev, i.playerId, logs, period, period === 'all' ? null : i.prevPeriodSource) : null;
}
