// 選手詳細の md：「出場有無」の章。個人詳細の「出場有無」タブと同じ部品（buildPlayedSplit・playedSplitStatColumns・標準の列）を呼ぶだけ。
// 対象はそのシーズンのレギュラーシーズン全体（タブの初期の条件。md の「ターム」「対戦相手の条件」は反映しない）。保存キーの対象外。
import type { Column } from '../components/SortableTable';
import type { GameSummary, PlayerGameLog, TeamGameLog } from '../../shared/types';
import { CATEGORY_LABELS } from './categoryLabels';
import { foulColumnsSplit } from './ruleChange';
import { scoringCompositionColumns, periodColumns, standardColumns, type OpponentSplitRow } from './opponentSplit';
import { buildPlayedSplit, formatWinPct, formatWinPctDiff, playedSplitStatColumns, DIFF_LABEL, NOT_PLAYED_LABEL, PLAYED_LABEL, type PlayedSplitBlock, type TenureRange } from './playedSplit';
import { buildGameTeamsByScheduleKey, resolveOwnTeam } from './situational';
import type { TeamPerspective } from './teamStatsColumns';
import { teamNameInSeason } from './teamLabel';
import { mdTable, type UsedLabels } from './aiPlayerCommon';
import type { PlayerMdInput, PlayerMdSeason } from './aiPlayerScope';

type Cat = 'traditional' | 'advanced' | 'misc' | 'scoring' | 'scoringComposition' | 'periods';
const CATS: Cat[] = ['traditional', 'advanced', 'misc', 'scoring', 'scoringComposition', 'periods'];
const PERSPECTIVES: { value: TeamPerspective; label: string }[] = [{ value: 'own', label: '自チーム' }, { value: 'opp', label: '相手（opp）' }];

/** その選手・シーズンの出場有無の表（チームごと）。タブと同じく試合区分はレギュラーシーズン */
export function playedBlocksOf(s: PlayerMdSeason): PlayedSplitBlock[] {
  const gameTeams = buildGameTeamsByScheduleKey(s.summaries as GameSummary[]);
  const ownTeamOf = (g: { scheduleKey: string; isHome: boolean }) => resolveOwnTeam(g, gameTeams);
  return buildPlayedSplit({ logs: s.logs as PlayerGameLog[], gameType: 'regular', ownTeamOf, teamLogsByTeamId: s.teamLogs as ReadonlyMap<string, readonly TeamGameLog[]> });
}

function baseColumns(cat: Cat, season: string, perspective: TeamPerspective): Column<OpponentSplitRow>[] {
  switch (cat) {
    case 'scoringComposition': return scoringCompositionColumns(perspective, { paintSupported: true });
    case 'periods': return periodColumns('perGame', perspective);
    default: return standardColumns(cat, 'perGame', perspective, { paintSupported: true, foulSplit: foulColumnsSplit([season]) });
  }
}

const tenureText = (ranges: readonly TenureRange[]): string =>
  ranges.map(r => (r.from === null && r.toExclusive === null ? 'シーズンの全試合' : `${r.from ?? 'シーズンの初め'} 〜 ${r.toExclusive === null ? 'シーズンの終わり' : `${r.toExclusive} の前日`}`)).join('、');

const recordCells = (b: PlayedSplitBlock) => [
  ['G', String(b.played.gamesPlayed), String(b.notPlayed.gamesPlayed), '-'],
  ['勝敗', `${b.played.wins}-${b.played.losses}`, `${b.notPlayed.wins}-${b.notPlayed.losses}`, '-'],
  ['勝率', formatWinPct(b.played.wins, b.played.losses), formatWinPct(b.notPlayed.wins, b.notPlayed.losses), formatWinPctDiff(b.played, b.notPlayed)],
];

/** 項目名 → [出場した, しなかった, 差]。値がすべて「-」の項目は除く */
function statRows(b: PlayedSplitBlock, cat: Cat, season: string, perspective: TeamPerspective, used: UsedLabels): Map<string, string[]> {
  const cols = playedSplitStatColumns(baseColumns(cat, season, perspective), b);
  const out = new Map<string, string[]>();
  for (const c of cols) {
    const f = c.format!;
    const v = [f(b.played), f(b.notPlayed), f(b.diff)];
    if (v.every(x => x === '-')) continue;
    used.add(c.label);
    out.set(c.label, v);
  }
  return out;
}

export function sectionPlayed(i: PlayerMdInput, used: UsedLabels): string[] {
  const out: string[] = ['## 5-2. 出場有無（本人が出場した試合と、出場しなかった試合のチームの成績）', ''];
  let cur: PlayedSplitBlock[];
  try { cur = playedBlocksOf(i.cur); } catch { return [...out, '- 出せません：チームの試合記録を確認できませんでした。', '']; }
  if (!cur.length) return [...out, '- 該当する試合がありません。', ''];
  let prev: PlayedSplitBlock[] | null = null;
  if (i.compare && i.prev) { try { prev = playedBlocksOf(i.prev); } catch { prev = null; } }
  used.notes.push('出場有無（5-2章）の数え方：「出場した試合」＝本人の出場時間が0より大きい試合。「出場しなかった試合」＝そのチームでの在籍期間のうち、本人が出場しなかったチームの試合（ベンチ入りして出場時間0の試合・ベンチ外の試合を含む）。在籍期間は、1チームだけの選手ならそのシーズンのレギュラーシーズン全試合、移籍した選手は次のチームでの最初の出場日で区切る（名簿に日付つきの移籍・契約の記録が無いため、本人の試合ログの日付だけで決める）。そのため、加入前や契約解除後の試合が「出場しなかった試合」に入ることがある。差＝出場した試合の平均−出場しなかった試合の平均（時間は分:秒、％の項目は％どうしの差）。');
  out.push(
    `- ${i.season}シーズンのレギュラーシーズン全体（md の「ターム」「対戦相手の条件」は反映しない）。個人詳細の「出場有無」タブの初期の条件（平均）と同じ部品・同じ式。移籍した選手はチームごとに分けて書く。`,
    '- 「出場した試合」＝本人の出場時間が0より大きい試合。「出場しなかった試合」＝そのチームでの在籍期間の、本人が出場しなかったチームの試合。差＝出場した試合−出場しなかった試合（どちらかの試合が無い、または値が「-」のときは「-」）。値は各条件のチームの1試合平均で、割合・率は合計から出した値。分母が0の項目は「-」。',
    '- チームの成績（本人以外の要因も含む）の比較であり、本人の影響の大きさを示すものではない。試合数が少ない条件の差は不安定。', '');
  if (i.compare) out.push(prev ? `- 前季全体＝${i.prevName}シーズンのレギュラーシーズン全体の出場有無。同じチームのときだけ並べ、別のチームのときは別の表にする。` : `- 前季なし：${i.prevReason ?? '前季の出場有無を出せません'}`, '');

  const teamName = (b: PlayedSplitBlock, season: string) => teamNameInSeason(i.history, b.teamId, season, b.teamName);
  const prevOf = (b: PlayedSplitBlock) => prev?.find(x => x.teamId === b.teamId) ?? null;
  const usedPrev = new Set<string>();
  type Entry = { title: string; cur: PlayedSplitBlock | null; prev: PlayedSplitBlock | null };
  const entries: Entry[] = cur.map(b => { const p = prevOf(b); if (p) usedPrev.add(p.teamId); return { title: teamName(b, i.season), cur: b, prev: p }; });
  for (const p of prev ?? []) if (!usedPrev.has(p.teamId)) entries.push({ title: `${teamName(p, i.prevName ?? '')}（前季のみ）`, cur: null, prev: p });

  const showTitle = entries.length > 1 || entries.some(e => !e.cur);
  for (const e of entries) {
    out.push(`### ${showTitle ? e.title : '全体'}`, '');
    out.push(`- 在籍期間の決め方：${e.cur ? `${i.season}は ${tenureText(e.cur.tenure)}` : ''}${e.cur && e.prev ? '。' : ''}${e.prev ? `${i.prevName}は ${tenureText(e.prev.tenure)}` : ''}。`, '');
    const head = (label: string) => [label,
      ...(e.cur ? [PLAYED_LABEL, NOT_PLAYED_LABEL, DIFF_LABEL].map(x => (i.compare ? `${i.season} ${x}` : x)) : []),
      ...(e.prev ? [PLAYED_LABEL, NOT_PLAYED_LABEL, DIFF_LABEL].map(x => `${i.prevName} ${x}`) : i.compare ? ['前季'] : [])];
    const blank = i.compare && !e.prev ? ['前季なし'] : [];
    // 試合数・勝敗・勝率
    const rc = e.cur ? recordCells(e.cur) : null, rp = e.prev ? recordCells(e.prev) : null;
    out.push('#### 試合数・勝敗・勝率', '', mdTable(head('項目'), recordCellsRows(rc, rp, blank)), '');
    for (const cat of CATS) {
      for (const pv of PERSPECTIVES) {
        const a = e.cur ? statRows(e.cur, cat, i.season, pv.value, used) : null;
        const b = e.prev ? statRows(e.prev, cat, i.prevName ?? i.season, pv.value, used) : null;
        const labels = [...new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])])];
        if (!labels.length) continue;
        const rows = labels.map(l => [l, ...(a ? a.get(l) ?? ['-', '-', '-'] : []), ...(b ? b.get(l) ?? ['-', '-', '-'] : blank)]);
        out.push(`#### ${CATEGORY_LABELS[cat]}（${pv.label}・1試合平均）`, '', mdTable(head('項目'), rows), '');
      }
    }
  }
  return out;
}

function recordCellsRows(rc: string[][] | null, rp: string[][] | null, blank: string[]): string[][] {
  const n = (rc ?? rp)!.length;
  return Array.from({ length: n }, (_, k) => [(rc ?? rp)![k]![0]!, ...(rc ? rc[k]!.slice(1) : []), ...(rp ? rp[k]!.slice(1) : blank)]);
}
