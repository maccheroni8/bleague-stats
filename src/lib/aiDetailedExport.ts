// AI向けMarkdown（詳しい版）。画面・通信とは独立した純粋な組み立て。値は今の画面と同じ計算（既存の列の式・集計）を呼ぶだけ。
// 読み込みは aiDetailedExportLoad.ts、タームの試合の選び方は aiExportScope.ts。保存キーの対象外。
import type { GameSummary, PlayerGameLog, PlayerSummary, TeamGameLog, TeamHistoryEntry, TeamSummary } from '../../shared/types';
import type { ScheduleFileExtended } from '../../shared/resultOnlyGames';
import { isRegularSeasonComplete } from '../../shared/regularSeasonComplete';
import { normalizePlayerName } from '../../shared/playerName';
import { gameOvertimes } from './gameFacts';
import { sumTeamGameLogs, EMPTY_TOTALS, type AllTeamsRow, type TeamPerspective } from './teamStatsColumns';
import { seasonPeriodFormatters } from './teamSeasonPeriod';
import { buildTeamSplitRowsFromPeriodSource } from './seasonPeriod';
import { sumTeamGameLogsFor } from './playerSeasonBoxscore';
import { seasonBoxColumnsWithFtr } from './ftrColumn';
import { teamScoringShareFromTotals, teamClassificationShareFromTotals, fgaShare } from './shareCharts';
import { buildBackToBackStatus } from './situational';
import { buildOpponentSeasonWinRates } from './opponentSeasonWinRate';
import { teamNameInSeason } from './teamLabel';
import { previousSeason } from './seasonCompare';
import { buildSituationalRecordGroups, teamSeasonColumnLabels } from '../pages/TeamDetailPage';
import {
  buildTermsWithOpponent, MIN_OPP_GAMES, OPPONENT_KIND_LABELS, TERM_KIND_LABELS, TIME_SLICE_CHOICES,
  type OpponentKind, type Term, type TermKind, type TimeSlice,
} from './aiExportScope';

export type DetailedKind = 'team' | 'player';
export interface DetailedSeason {
  season: string;
  teams: TeamSummary[];
  team: TeamSummary;
  /** このチームのレギュラーシーズンの試合ログ（日付→ScheduleKey の順） */
  regular: TeamGameLog[];
  summaries: GameSummary[];
  schedule: ScheduleFileExtended;
  division: unknown;
}
export interface DetailedInput {
  kind: DetailedKind;
  season: string;
  teamId: string;
  term: TermKind;
  opp: OpponentKind;
  /** TIME_SLICE_CHOICES の key */
  timeSlice: string;
  /** 前季比較（チーム情報だけ） */
  compare: boolean;
  history: TeamHistoryEntry[];
  cur: DetailedSeason;
  prev: DetailedSeason | null;
  players: { player: PlayerSummary; logs: PlayerGameLog[] }[];
  /** 「書き出した日」に書く文字列 */
  exportedAt: string;
}
export interface DetailedOutput { markdown: string; filename: string; characters: number; empty: boolean }

type FTerm = Term & { tooFew: number; excluded: number };

// ---- 書式 ----
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const table = (head: string[], rows: string[][]) => [head, head.map(() => '---'), ...rows].map(r => `|${r.map(esc).join('|')}|`).join('\n');
const winPct = (w: number, n: number) => (n === 0 ? '-' : (w / n).toFixed(3).replace(/^0/, ''));
const record = (w: number, l: number) => `${w}勝${l}敗（${winPct(w, w + l)}）`;
const SLICE_LABEL: Record<TimeSlice, string> = { game: '試合全体', h1: '前半（1Q・2Q）', h2: '後半（3Q・4Q）' };
/** 表ごとに使える時間帯の宣言。使えない時間帯は表を出さず、欠けているものに理由を書く */
const supportsSlice = (slice: TimeSlice): boolean => slice === 'game';
/** 試合ログの合計（時間帯 → その時間帯の合計）。前半・後半・クラッチタイムは、ここに枝を足す */
function sliceRow(teamId: string, logs: TeamGameLog[], slice: TimeSlice): AllTeamsRow {
  if (slice !== 'game') throw new Error('この時間帯はまだ書き出せません。');
  const wins = logs.filter(g => g.win).length;
  return { team: { teamId, teamName: '' }, gamesPlayed: logs.length, wins, losses: logs.length - wins, totals: logs.length ? sumTeamGameLogs(logs) : { ...EMPTY_TOTALS } };
}

const OPP_RULE = `その試合に入る時点（その試合は含まない）の相手のレギュラーシーズン勝率が .600 以上。相手の消化試合が${MIN_OPP_GAMES}試合未満の試合は判定せず外す。相手の勝敗はスタッツのある試合で数える（結果だけの試合は相手の勝敗に数えない）。チームスタッツの絞り込み「対6割以上」と同じ`;
// 自チームだけ（相手・差に意味がない、または言い換えになる列）
const OWN_ONLY = new Set(['G', 'MIN', 'POSS', 'PACE', 'ORtg', 'DRtg', 'NetRtg', '+/-', 'EFF', 'BSR', '内訳対象']);
// 構成の章に移す列（得点・失点構成とまとめる）
const MOVED_TO_COMPOSITION = new Set(['%3PA', '%2PA', '%PAINT2A', '%MID2A', '日本人 PTS', '外国籍・帰化・アジア PTS', '%日本人 PTS', '%外国籍・帰化・アジア PTS']);
const PERSPECTIVES: [TeamPerspective, string][] = [['own', ''], ['opp', 'opp '], ['diff', '差 ']];
const PLAYER_DROP = new Set(['G', 'GS', 'MIN', 'PTS']);

/** 相手のその試合に入る時点の勝敗の文字（対象の試合の一覧用） */
function oppPreRecord(summaries: readonly GameSummary[], g: { log: TeamGameLog; date: string; scheduleKey: string }): string {
  let w = 0, l = 0;
  for (const s of summaries) {
    if (s.gameType !== 'regular' || !s.gameEndedFlg || (s.homeTeamId !== g.log.opponentTeamId && s.awayTeamId !== g.log.opponentTeamId)) continue;
    if (!(s.date < g.date || (s.date === g.date && s.scheduleKey < g.scheduleKey))) continue;
    if ((s.homeTeamId === g.log.opponentTeamId) === (s.homeScore > s.awayScore)) w++; else l++;
  }
  return record(w, l);
}

/** タームを決めてから、対戦相手で絞る（直近5試合だけは絞ってから5試合を選ぶ）。選べないときは理由つきで止める */
export function detailedTerms(d: DetailedSeason, kind: TermKind, opp: OpponentKind, teamId: string, history: TeamHistoryEntry[]): FTerm[] {
  const complete = isRegularSeasonComplete({ schedule: d.schedule, summaries: d.summaries });
  const names = [d.team.teamName, teamNameInSeason(history, teamId, d.season, d.team.teamName)];
  const r = buildTermsWithOpponent(kind, opp, { season: d.season, league: 'premier', teamId, teamNames: names, regularLogs: d.regular, summaries: d.summaries, schedule: d.schedule, complete });
  if ('unavailable' in r) throw new Error(`このタームは選べません: ${r.unavailable}`);
  return r.terms;
}

interface Col { key: string; label: string; rows: Map<TimeSlice, AllTeamsRow>; logs: TeamGameLog[]; term: Term }

export function detailedFilename(i: DetailedInput, name: string, baseDate: string): string {
  const parts = [name, i.season, i.kind === 'team' ? 'チーム情報' : '選手情報', TERM_KIND_LABELS[i.term], baseDate];
  if (i.opp !== 'all') parts.splice(4, 0, '対6割以上');
  return `${parts.join('_')}.md`.replace(/[\\/:*?"<>|\s]+/g, '');
}

function aboutTable(i: DetailedInput, ctx: { name: string; ended: string; complete: boolean; terms: FTerm[]; slices: TimeSlice[]; extra: string[][] }): string {
  return table(['項目', '内容'], [
    ['データの基準日', `${ctx.ended}（収録済みのリーグの最新の終了試合日）`],
    ['リーグ', `${i.season >= '2026-27' ? 'B.PREMIER' : 'B1'}（レギュラーシーズンだけ。ポストシーズンは入れない）`],
    ['チーム', `${ctx.name}${ctx.complete ? '' : '（シーズン途中）'}`],
    ['ターム', TERM_KIND_LABELS[i.term]],
    ['時間帯', ctx.slices.length === 1 ? '試合全体（延長を含む）' : ctx.slices.map(s => SLICE_LABEL[s]).join('・')],
    ['対戦相手', i.opp === 'all' ? '全チーム' : `${OPPONENT_KIND_LABELS[i.opp]}（${OPP_RULE}）。${i.term === 'recent5' ? '直近5試合は、相手で絞ってから最後の5試合を選ぶ（ほかのタームは期間を決めてから絞る）' : 'タームを先に決めてから絞る（直近5試合だけは、相手で絞ってから最後の5試合を選ぶ）'}`],
    ...ctx.extra,
    ['書き出した日', i.exportedAt],
  ]);
}

function gameTable(i: DetailedInput, terms: FTerm[]): string {
  const withOpp = i.opp !== 'all';
  return table(['ターム', '期間・決め方', `試合（勝敗・勝率）${withOpp ? '※絞り込みのあと' : ''}`, 'スタッツの対象', '結果だけの試合', withOpp ? '相手の条件で外した試合（うち相手が5試合未満で判定できない）' : '今後の予定'], terms.map(t => {
    const w = t.games.filter(g => g.win).length;
    const ro = t.games.filter(g => g.resultOnly);
    const games = t.games.length ? `${t.games.length}試合 ${record(w, t.games.length - w)}` : '0試合（対象の試合なし）';
    return [t.label, withOpp ? t.rule : `${t.games[0]?.date ?? '-'}〜${t.games.at(-1)?.date ?? '-'}。${t.rule}`, games, `${t.statLogs.length}試合`, ro.length ? ro.map(g => `${g.date}（${g.win ? '勝' : '敗'}）`).join('、') : 'なし', withOpp ? `${t.excluded}試合（うち${t.tooFew}試合）` : t.upcoming ? `${t.upcoming}試合` : '-'];
  }));
}

function gameListTable(i: DetailedInput, terms: FTerm[], teamsOf: DetailedSeason, history: TeamHistoryEntry[]): string {
  return table(['日付', '相手', '会場', '結果', '相手の勝敗（試合前）'], terms.flatMap(t => t.games).map(g => {
    const opp = teamsOf.teams.find(t => t.teamId === g.log.opponentTeamId);
    return [g.date, opp ? teamNameInSeason(history, opp.teamId, i.season, opp.teamName) : g.log.opponentTeamId, g.isHome ? 'ホーム' : 'アウェイ', `${g.win ? '勝' : '敗'} ${g.resultOnly ? '（結果だけ）' : `${g.log.teamScore}-${g.log.opponentScore}`}`, oppPreRecord(teamsOf.summaries, g)];
  }));
}

const EMPTY_NOTE = (i: DetailedInput) => ['## この条件に当てはまる試合はありません', '', `- ${TERM_KIND_LABELS[i.term]}${i.opp === 'all' ? '' : `・${OPPONENT_KIND_LABELS[i.opp]}`}の条件に当てはまる試合が1つも無いため、表は出しません。`, ''];

export function buildDetailedExport(i: DetailedInput): DetailedOutput {
  const choice = TIME_SLICE_CHOICES.find(c => c.key === i.timeSlice);
  if (!choice || !choice.available(i.season)) throw new Error('この時間帯はまだ書き出せません。');
  const slices = [...choice.slices];
  const startYear = Number(i.season.slice(0, 4));
  const foulSplit = i.season >= '2026-27';
  const { cur, teamId } = i;
  const name = teamNameInSeason(i.history, teamId, i.season, cur.team.teamName);
  const ended = cur.summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg).map(g => g.date).sort().at(-1) ?? '-';
  const complete = isRegularSeasonComplete({ schedule: cur.schedule, summaries: cur.summaries });
  const terms = detailedTerms(cur, i.term, i.opp, teamId, i.history);
  const filename = detailedFilename(i, name, ended);
  const out: string[] = [];
  const finish = (empty = false): DetailedOutput => { const markdown = out.join('\n'); return { markdown, filename, characters: Array.from(markdown).length, empty }; };
  const allEmpty = terms.every(t => t.games.length === 0);

  if (i.kind === 'player') {
    out.push(`# ${name} ${i.season} 選手情報（詳しい版）`, '', '## この書き出しについて', '');
    out.push(aboutTable(i, { name, ended, complete, terms, slices, extra: [['対象の選手', `このチームで出場した${i.players.length}人（移籍した選手は、このチームでの試合だけ）`]] }), '');
    out.push('### チームの試合', '', gameTable(i, terms), '');
    if (i.opp !== 'all') out.push('#### 対象の試合（相手と、その試合に入る時点の相手の勝敗）', '', gameListTable(i, terms, cur, i.history), '');
    if (allEmpty) { out.push(...EMPTY_NOTE(i)); return finish(true); }
    out.push('### 数字の書き方', '', '- 1試合平均（分母は、その選手がそのターム・時間帯に出場した試合数＝各表の G）。%系（%PTS など）の分母は、その選手が出た試合のチームの合計（今の選手スタッツタブと同じ）。小数は第2位まで、時間は 分:秒。「-」は値が無い。',
      '- ORtg・DRtg・NetRtg・USG% も、分母は「その選手が出た試合のチーム合計」（チーム詳細の選手スタッツタブと同じ）。全選手スタッツの同じ項目は「チームの全試合の合計」で割るので、出ていない試合が多い選手ほど少し違う。',
      '- 列の重複を減らすため、G・GS・MIN・PTS は Traditional の表だけに出し、他の表では省く。', '- 出場の無い選手は、そのタームの表から省く。', '');
    const own = { teamId, teamName: cur.team.teamName };
    let section = 1;
    for (const t of terms) {
      out.push(`## ${section++}. ${t.label}（${t.games[0]?.date ?? '-'}〜${t.games.at(-1)?.date ?? '-'}、チーム${t.statLogs.length}試合）`, '');
      const keys = new Set(t.statLogs.map(g => g.scheduleKey));
      for (const slice of slices) {
        if (!supportsSlice(slice)) continue;
        const rows = i.players.flatMap(({ player, logs }) => {
          const mine = logs.filter(g => keys.has(g.scheduleKey));
          if (!mine.length) return [];
          const ownBy = new Map(mine.map(g => [g.scheduleKey, { ...own, isHome: g.isHome } as never]));
          const teamTotals = sumTeamGameLogsFor(t.statLogs, new Set(mine.map(g => g.scheduleKey)));
          const r = buildTeamSplitRowsFromPeriodSource(player.playerId, mine, ownBy, new Map([[teamId, teamTotals]]), 'perGame', startYear, player.playerId, 'all', null)[0];
          return r ? [{ player, ctx: r.ctx }] : [];
        }).sort((a, b) => b.ctx.raw.min - a.ctx.raw.min);
        if (!rows.length) { out.push('- このタームに出場した選手はいません。', ''); continue; }
        for (const tab of ['traditional', 'advanced', 'misc', 'scoring'] as const) {
          const cs = seasonBoxColumnsWithFtr(tab, foulSplit).filter(c => tab === 'traditional' || !PLAYER_DROP.has(c.label));
          const body = rows.map(x => [normalizePlayerName(x.player.name), ...cs.map(c => c.format(x.ctx, 'perGame'))]);
          const keep = cs.map((_, k) => body.some(r => r[k + 1] !== '-'));
          out.push(`### ${tab[0]!.toUpperCase()}${tab.slice(1)}${slices.length > 1 ? `・${SLICE_LABEL[slice]}` : ''}`, '', table(['選手', ...cs.filter((_, k) => keep[k]).map(c => c.label)], body.map(r => [r[0]!, ...r.slice(1).filter((_, k) => keep[k])])), '');
        }
      }
    }
    return finish();
  }

  // ---- チーム情報 ----
  const mkCol = (key: string, label: string, t: Term, tid = teamId): Col => ({ key, label, logs: t.statLogs, term: t, rows: new Map(slices.map(s => [s, sliceRow(tid, t.statLogs, s)])) });
  const cols: Col[] = terms.map(t => mkCol(t.key, t.label, t));
  let prevCol: Col | null = null;
  let prevName = '';
  if (i.compare && i.prev) {
    prevName = teamNameInSeason(i.history, teamId, i.prev.season, i.prev.team.teamName);
    const pt = detailedTerms(i.prev, 'season', i.opp, teamId, i.history)[0]!;
    prevCol = mkCol('prev', `前季全体（${i.prev.season}${i.opp === 'all' ? '' : `・${OPPONENT_KIND_LABELS[i.opp]}`}）`, pt);
  }
  out.push(`# ${name} ${i.season} チーム情報（詳しい版）`, '', '## この書き出しについて', '');
  out.push(aboutTable(i, { name, ended, complete, terms, slices, extra: [['前季との比較', prevCol ? `する（「チームのまとめ」だけ。${i.prev!.season} ${prevName} の前季全体${i.opp === 'all' ? '' : '（前季も同じ相手の条件で絞る）'}と比べる）` : i.compare ? 'しない（前季にこのチームの記録がない）' : 'しない']] }), '');
  out.push('### 対象試合', '', gameTable(i, terms), '');
  if (i.opp !== 'all') out.push('#### 対象の試合（相手と、その試合に入る時点の相手の勝敗）', '', gameListTable(i, terms, cur, i.history), '');
  if (allEmpty) { out.push(...EMPTY_NOTE(i)); return finish(true); }
  out.push('### 欠けているもの', '', '- 次の表はこの版にまだ入っていない：Shooting・Forced TOV・オンザコート別・Time to Shot・Streaks（準備中）', '');
  out.push('### 数字の書き方', '',
    '- 平均は1試合平均（分母はその表のスタッツの対象試合数）。割合（%）は合計の分子÷合計の分母（試合ごとの割合の平均ではない）。小数は第2位まで。',
    '- 勝率は .750 の形、時間は 分:秒。「差」は自チーム−相手（構成比・成功率の差はパーセントポイント）。「opp」は相手チームの値。',
    '- 「-」は値が無い（分母が0・その区間の記録が無い・そのシーズンに無い項目）。0 は実際に0。',
    '- 結果だけの試合（不戦勝・ボックススコアの無い試合）は、勝敗・試合数には数え、スタッツには入れない。', '');

  const fm = new Map(PERSPECTIVES.map(([p]) => [p, seasonPeriodFormatters('perGame', p, foulSplit)]));
  const numFm = (p: TeamPerspective, label: string, r: AllTeamsRow): number => Number(String(fm.get(p)!.get(label)!(r, startYear)).replace(/[%+]/g, ''));
  const heading = (slice: TimeSlice) => (slices.length > 1 ? [`### ${SLICE_LABEL[slice]}`, ''] : []);

  // 1. チームのまとめ
  out.push('## 1. チームのまとめ', '');
  const allCols = prevCol ? [...cols, prevCol] : cols;
  const SUMMARY: [TeamPerspective, string, string][] = [
    ['own', 'PTS', '得点'], ['opp', 'PTS', '失点'], ['own', '+/-', '得失点差'], ['own', 'ORtg', ''], ['own', 'DRtg', ''], ['own', 'NetRtg', ''], ['own', 'PACE', ''],
    ['own', 'eFG%', ''], ['opp', 'eFG%', ''], ['own', 'TOV%', ''], ['opp', 'TOV%', ''], ['own', 'OR%', ''], ['opp', 'OR%', ''], ['own', 'FTR', ''], ['opp', 'FTR', ''],
    ['own', '3P%', ''], ['opp', '3P%', ''], ['own', '%3PA', '3PA の割合（FGAに占める）'], ['own', 'AST', ''], ['own', 'TOV', ''],
  ];
  for (const slice of slices) {
    if (!supportsSlice(slice)) continue;
    out.push(...heading(slice));
    const main = cols.at(-1)!;
    const head = ['項目', ...allCols.map(c => c.label), ...(prevCol ? [`差（${main.label}−前季全体）`] : [])];
    const rows: string[][] = [];
    rows.push(['試合（勝敗）', ...allCols.map(c => `${c.term.games.length}（${c.term.games.filter(g => g.win).length}-${c.term.games.filter(g => !g.win).length}）`), ...(prevCol ? ['-'] : [])]);
    for (const [p, label, ja] of SUMMARY) {
      const f = fm.get(p)!.get(label);
      if (!f) continue;
      const cells = allCols.map(c => { const r = c.rows.get(slice)!; return r.gamesPlayed ? f(r, startYear) : '-'; });
      let diff = '-';
      if (prevCol) {
        const a = main.rows.get(slice)!, b = prevCol.rows.get(slice)!;
        if (a.gamesPlayed && b.gamesPlayed) {
          const v = numFm(p, label, a) - numFm(p, label, b);
          diff = `${v > 0 ? '+' : ''}${v.toFixed(2)}${/%/.test(label) || label === 'FTR' ? 'ポイント' : ''}`;
        }
      }
      rows.push([`${p === 'opp' ? 'opp ' : ''}${label}${ja ? `（${ja}）` : ''}`, ...cells, ...(prevCol ? [diff] : [])]);
    }
    out.push(table(head, rows), '');
  }

  // 2. シチュエーション別勝敗（試合の最終勝敗。結果だけの試合は入らない＝今の画面と同じ）
  const withOpp = i.opp !== 'all';
  out.push('## 2. シチュエーション別勝敗', '', `スタッツのある試合の最終勝敗（今の画面と同じく、結果だけの試合は入らない）。「対戦相手の強さ（最新勝率）」の行は概要の表と同じく相手の今季（基準日時点）の勝率で分ける${withOpp ? '（上の絞り込みは試合前の勝率なので、基準が違う）' : ''}。1Q・前半・3Q終了時点は試合ログのクォーター別得点から判定する。月別は出さない（タームと重なる）。`, '');
  const groups = buildSituationalRecordGroups(cur.regular, teamId, buildBackToBackStatus(cur.summaries), buildOpponentSeasonWinRates(cur.teams), cur.division as never, i.season, 'premier');
  const checkpoint = (g: TeamGameLog, q: number) => {
    const own = (g.periodPoints ?? []).slice(0, q), opp = (g.opponentPeriodPoints ?? []).slice(0, q);
    if (own.length < q || opp.length < q || own.some(v => v == null) || opp.some(v => v == null)) return undefined;
    const a = own.reduce<number>((s, v) => s + (v ?? 0), 0), b = opp.reduce<number>((s, v) => s + (v ?? 0), 0);
    return a > b ? 'lead' : a < b ? 'behind' : 'tie';
  };
  const CHECKPOINT_Q: Record<string, number> = { q1status: 1, halfStatus: 2, q3status: 3 };
  const hasOt = (g: TeamGameLog) => { const n = gameOvertimes(g); if (n !== undefined) return n > 0; const pp = g.periodPoints ?? []; return pp.length >= 4 ? pp.slice(0, 4).reduce<number>((s, v) => s + (v ?? 0), 0) !== g.teamScore : undefined; };
  const sitRows: string[][] = [];
  for (const gr of groups) {
    if (gr.key === 'month') continue;
    for (const row of gr.rows) {
      const pred = gr.key in CHECKPOINT_Q ? (g: TeamGameLog) => checkpoint(g, CHECKPOINT_Q[gr.key]!) === row.key
        : gr.key === 'overtime' ? (g: TeamGameLog) => hasOt(g) === (row.key === 'ot')
        : (g: TeamGameLog) => row.predicate(g, undefined as never);
      const cells = cols.map(c => { const m = c.logs.filter(pred); const w = m.filter(g => g.win).length; return m.length ? `${w}-${m.length - w}` : '-'; });
      if (cells.every(v => v === '-')) continue;
      sitRows.push([gr.label, row.label, ...cells]);
    }
  }
  out.push(table(['区分', '条件', ...cols.map(c => `${c.label}（勝-敗）`)], sitRows), '');

  // 3. 得点・失点構成
  out.push('## 3. 得点・失点構成', '', '1試合平均の得点（失点）と、総得点（総失点）に占める割合。FG試投構成はFGAに占める割合。', '');
  for (const slice of slices) {
    if (!supportsSlice(slice)) continue;
    out.push(...heading(slice));
    const rows: string[][] = [];
    for (const side of ['own', 'opponent'] as const) {
      const sl = side === 'own' ? '得点' : '失点';
      const shares = cols.map(c => { const r = c.rows.get(slice)!; return r.gamesPlayed ? teamScoringShareFromTotals(r.totals as never, r.gamesPlayed, side) : null; });
      ['3P', 'FT', 'Mid-range', 'Paint'].forEach((n, k) => rows.push([`${sl}：${n}`, ...shares.map(s => (s ? `${s.values[k]!.toFixed(2)}（${s.pct[k]!.toFixed(2)}%）` : '-'))]));
      const cl = cols.map(c => { const r = c.rows.get(slice)!; return r.gamesPlayed ? teamClassificationShareFromTotals(r.totals as never, r.gamesPlayed, side) : null; });
      ['日本人', '外国籍・帰化・アジア'].forEach((n, k) => rows.push([`${sl}：${n}`, ...cl.map(s => (s ? `${s.values[k]!.toFixed(2)}（${s.pct[k]!.toFixed(2)}%）` : '-'))]));
      const fg = cols.map(c => { const r = c.rows.get(slice)!; const t = r.totals; const o = side === 'own'; return r.gamesPlayed ? fgaShare({ games: r.gamesPlayed, tpa: o ? t.tpa : t.oppTpa, mid2a: o ? t.mid2a : t.oppMid2a, paint2a: o ? t.paint2a : t.oppPaint2a }) : null; });
      ['3P', 'Mid-range', 'Paint'].forEach((n, k) => rows.push([`${side === 'own' ? '' : 'opp '}FG試投：${n}`, ...fg.map(s => (s ? `${s.values[k]!.toFixed(2)}（${s.pct[k]!.toFixed(2)}%）` : '-'))]));
    }
    out.push(table(['項目（平均・割合）', ...cols.map(c => c.label)], rows), '');
  }

  // 4. チームスタッツ（Traditional・Advanced・Misc・Scoring）
  out.push('## 4. チームスタッツ', '', 'チーム詳細 > チームスタッツ > シーズン別成績と同じ列・同じ式。opp・差は意味のある項目だけ。', '');
  for (const [cat, labels] of Object.entries(teamSeasonColumnLabels())) {
    for (const slice of slices) {
      if (!supportsSlice(slice)) continue;
      const rows: string[][] = [];
      for (const [p, prefix] of PERSPECTIVES) {
        for (const label of labels) {
          if (MOVED_TO_COMPOSITION.has(label) || (p !== 'own' && OWN_ONLY.has(label))) continue;
          const f = fm.get(p)!.get(label);
          const cells = cols.map(c => { const r = c.rows.get(slice)!; return f && r.gamesPlayed > 0 ? f(r, startYear) : '-'; });
          if (cells.every(v => v === '-')) continue;
          rows.push([`${prefix}${label}`, ...cells]);
        }
      }
      out.push(`### ${cat}${slices.length > 1 ? `・${SLICE_LABEL[slice]}` : ''}`, '', table(['項目', ...cols.map(c => c.label)], rows), '');
    }
  }
  out.push('## 用語', '', '- 略称の意味はサイトの用語集と同じ（例：ORtg＝100ポゼッションあたりの得点、POSS・PACE は B.LEAGUE 公式の推定式）。', '- ペイント内外（Paint・Mid-range）は公式の区分。', '');
  return finish();
}
