// 選手詳細の md（AI向けMarkdown・詳しい版だけ）。画面・通信とは独立した純粋な組み立て。値は今の画面と同じ計算（既存の列の式・集計）を呼ぶだけ。
// 読み込みは aiPlayerExportLoad.ts、対象期間は aiPlayerScope.ts。保存キーの対象外。
import type { PlayerGameLog, PlayerSummary } from '../../shared/types';
import { countDoubleTripleDoubles } from './playerSeasonBoxscore';
import { formatDecimal } from './format';
import { normalizePlayerName } from '../../shared/playerName';
import { isRegularSeasonComplete } from '../../shared/regularSeasonComplete';
import { OPPONENT_KIND_LABELS, TERM_KIND_LABELS } from './aiExportScope';
import { playerScope, ownTeamMap, type PlayerMdInput, type PlayerMdSeason, type PlayerScope } from './aiPlayerScope';
import { buildRankLines, RANK_CATEGORY_LABEL, RANK_ELIGIBILITY_TEXT, type RankLine } from './aiPlayerRank';
import { ctxForLogs, mdTable, statsRows, UsedLabels, CATS, CAT_NAME, record, diffText, prevCtxOf, prevLogsOf } from './aiPlayerCommon';
import { sectionShooting, sectionPeriods, sectionTeamImpact, sectionConditions, sectionCareer, sectionRankRecords } from './aiPlayerSections';
import { ageBaseDate, ageForSeason, formatBaseDateLabel } from './age';
import { positionText, heightText, weightText } from './profileMark';
import { registrationLabel } from './registrationLabel';
import { teamNameInSeason } from './teamLabel';
import { statDescription } from './statDescriptions';
import { formatMinutesFromSeconds } from './boxscoreAggregate';

export interface PlayerMdOutput { markdown: string; filename: string; characters: number; empty: boolean; notes: string[] }

function baseDateOf(i: PlayerMdInput): string {
  return i.cur.summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg).map(g => g.date).sort().at(-1) ?? '-';
}

export function buildPlayerExport(i: PlayerMdInput): PlayerMdOutput {
  const scope = playerScope(i);
  const used = new UsedLabels();
  const notes: string[] = [];
  const out: string[] = [];
  const p = i.cur.player;
  const name = normalizePlayerName(p.name);
  const ended = baseDateOf(i);
  const complete = isRegularSeasonComplete({ schedule: i.cur.schedule, summaries: i.cur.summaries });
  const filename = `${name}_${i.season}${i.league === 'one' ? '_B.ONE' : ''}_選手情報_${TERM_KIND_LABELS[i.term]}${i.opp !== 'all' ? '_対6割以上' : ''}${i.compare ? '_前季比較' : ''}_${ended}.md`.replace(/[\\/:*?"<>|\s]+/g, '');
  out.push(`# ${name} ${i.season} 選手情報（詳しい版）`, '');
  if (i.compare) {
    const whole = i.term === 'season' && i.opp === 'all';
    const now = `${TERM_KIND_LABELS[i.term]}${i.opp === 'all' ? '' : `・${OPPONENT_KIND_LABELS[i.opp]}`}`;
    out.push(whole
      ? `> **この書き出しは前季との比較つき**：今回の値は${i.season}シーズンのレギュラーシーズン全体、比べる相手は${i.prevName ?? '前季'}シーズンのレギュラーシーズン全体${i.prevReason ? `（前季なし：${i.prevReason}）` : ''}。`
      : `> **この書き出しは前季との比較つき**：今回の値は「${i.season}シーズンの${now}」（シーズン全体ではない）、比べる相手は**${i.prevName ?? '前季'}シーズンのレギュラーシーズン全体**です。対象期間が違うので、差は「今回の期間の値 − 前季全体の値」であって、同じ長さの期間どうしの比較ではありません。${i.prevReason ? `（前季なし：${i.prevReason}）` : ''}`, '');
  }
  out.push(...sectionBasic(i, scope, name, ended, complete));
  out.push(...sectionStats(i, scope, used));
  out.push(...sectionRank(i, p, notes));
  out.push(...sectionShooting(i, scope, used));
  out.push(...sectionPeriods(i, scope, used));
  out.push(...sectionTeamImpact(i, scope, used));
  out.push(...sectionConditions(i, scope, used));
  out.push(...sectionGameLog(i, scope));
  out.push(...sectionCareer(i));
  out.push(...sectionDefinitions(used));
  const markdown = out.join('\n');
  return { markdown, filename, characters: Array.from(markdown).length, empty: scope.playedUnion.length === 0, notes };
}

// ---- 1. 基本情報 ----
function sectionBasic(i: PlayerMdInput, scope: PlayerScope, name: string, ended: string, complete: boolean): string[] {
  const p = i.cur.player;
  const teams = [...new Map([...scope.ownBy.values()].map(t => [t.teamId, teamNameInSeason(i.history, t.teamId, i.season, t.teamName)])).values()];
  const games = scope.terms.map(t => {
    const w = t.teamGames.filter(g => g.win).length;
    return [t.label, t.rule, `${t.teamGames.length}試合 ${record(w, t.teamGames.length - w)}`, `${t.logs.filter(g => g.min > 0).length}試合`, t.excluded ? `${t.excluded}試合` : '-'];
  });
  const reg = i.registrations?.players[p.playerId];
  const rows: string[][] = [
    ['選手', `${name}（選手ID ${p.playerId}）`],
    ['リーグ', i.league === 'one' ? (i.season >= '2026-27' ? 'B.ONE' : 'B2（B.ONE の前身）') : i.season >= '2026-27' ? 'B.PREMIER' : 'B1（B.PREMIER の前身）'],
    ['シーズン', `${i.season}${complete ? '' : '（シーズン途中）'}（レギュラーシーズンだけ。ポストシーズンは入れない）`],
    ['チーム', `${teams.join(' → ')}${teams.length > 1 ? '（シーズン途中で移籍）' : ''}`],
    ['ポジション', positionText(p) ?? '-'],
    ['登録区分', registrationLabel(i.season, p.classification, reg)],
    ['年齢', p.birthDate ? `${ageForSeason(p.birthDate, i.season)}歳（${formatBaseDateLabel(ageBaseDate(i.season)).replace(' 現在', '')}時点。基準は各シーズンの6月30日、進行中のシーズンは書き出した日）` : '-'],
    ['生年月日', p.birthDate ?? '-'],
    ['身長・体重', `${heightText(p) ?? '-'}・${weightText(p) ?? '-'}（${complete ? '当時の値（そのシーズンの1月15日に固定）' : '現在の値'}。「＊」は当時の値が無く別の時点の値で補った印）`],
    ['データの基準日', `${ended}（収録済みのリーグの最新の終了試合日）`],
    ['対象期間', `${TERM_KIND_LABELS[i.term]}${i.opp === 'all' ? '' : `・${OPPONENT_KIND_LABELS[i.opp]}`}`],
    ['試合区分', 'レギュラーシーズン'],
    ...(i.compare ? [['前季全体との比較', i.prevReason ? `前季なし：${i.prevReason}` : `あり（比べる相手＝${i.prevName}シーズンのレギュラーシーズン全体。${prevTeams(i)}）`]] : []),
    ['書き出した日', i.exportedAt],
  ];
  const out = ['## 1. 基本情報', '', mdTable(['項目', '内容'], rows), '', '### 対象期間の試合', '',
    mdTable(['ターム', '期間・決め方', 'チームの試合（勝敗・勝率）', 'この選手が出場した試合', '相手の条件で外した試合'], games), ''];
  const careerRows = careerHistory(i);
  if (careerRows.length) out.push('### 所属歴（このサイトに記録のあるシーズン）', '', mdTable(['シーズン', 'リーグ', 'チーム', '出場'], careerRows), '');
  if (i.awards.length) out.push('### 個人賞', '', ...i.awards.map(a => `- ${a.season} ${a.name}${a.category ? `（${a.category}）` : ''}`), '');
  if (i.nameHistory.length > 1) out.push(`- 登録名の変更：${i.nameHistory.map(n => n.name).join(' → ')}`, '');
  return out;
}

/** 前季のチーム名（別のチームにいたときも分かるように） */
export function prevTeams(i: PlayerMdInput): string {
  if (!i.prev) return '';
  const ownBy = ownTeamMap(i.prev);
  const names = [...new Map([...ownBy.values()].map(t => [t.teamId, teamNameInSeason(i.history, t.teamId, i.prevName ?? '', t.teamName)])).values()];
  return `前季のチーム：${names.join(' → ') || '-'}${names.length && !names.includes(teamNameInSeason(i.history, i.cur.player.teamId, i.season, i.cur.player.teamName)) ? '（今季とは別のチーム）' : ''}`;
}

function careerHistory(i: PlayerMdInput): string[][] {
  return i.career.map(c => {
    const ownBy = ownTeamMap({ summaries: c.summaries, logs: c.logs });
    const ids = [...new Map([...ownBy.values()].map(t => [t.teamId, t.teamName])).values()];
    const g = c.logs.filter(x => x.gameType === 'regular' && x.min > 0).length;
    return [c.season, c.league === 'one' ? 'B.ONE' : c.season >= '2026-27' ? 'B.PREMIER' : 'B1', ids.join(' → ') || '-', `${g}試合`];
  });
}

// ---- 2. シーズン成績 ----
function sectionStats(i: PlayerMdInput, scope: PlayerScope, used: UsedLabels): string[] {
  const p = i.cur.player;
  const out: string[] = ['## 2. シーズン成績', ''];
  if (scope.playedUnion.length === 0) return [...out, '- 対象期間にこの選手が出場した試合はありません。', ''];
  const multi = scope.terms.length > 1;
  const cols = multi ? [...scope.terms, scope.seasonTerm] : [scope.terms[0]!];
  const ctxs = cols.map(t => ctxForLogs(i.cur, p.playerId, t.logs));
  const prevName = i.prevName;
  const prevCtx = prevCtxOf(i);
  const cmp = i.compare && !!prevName;
  out.push(
    '- 平均＝1試合平均（分母＝その選手が出場した試合数 G）。合計＝期間の合計。割合・率の項目は平均も合計も同じ値。数字の書き方はサイトと同じ（小数第2位、分母0は「-」、時間は分:秒）。',
    '- %PTS・USG%・ORtg・DRtg などの分母は、その選手が出た試合のチーム合計。', '');
  if (cmp) out.push(prevCtx ? `- **前季全体＝${prevName}シーズンのレギュラーシーズン全体**（今回の対象期間とは別。${prevTeams(i)}）。差＝今回の平均 − 前季全体の平均（複数のタームのときは、シーズン全体の平均との差）。％の項目の差は「pt」（ポイント＝割合どうしの差）、時間は分:秒。G・GS は差を出さない。` : `- 前季なし：${i.prevReason ?? '-'}`, '');
  for (const cat of CATS) {
    const rows = statsRows(cat, i.season, ctxs, used, cat !== 'traditional');
    const prevRows = prevCtx ? statsRows(cat, prevName!, [prevCtx], used, cat !== 'traditional') : null;
    const head = ['項目', ...cols.map(c => `${c.label} 平均`), ...(multi ? [] : ['合計']), ...(cmp ? ['前季全体 平均', '差（今回−前季全体）'] : [])];
    const body = rows.map(r => {
      const pv = prevRows?.find(x => x.key === r.key)?.avg[0] ?? '-';
      const cur = r.avg[multi ? cols.length - 1 : 0]!;
      const d = cmp ? [prevCtx ? pv : '前季なし', prevCtx && !['G', 'GS'].includes(r.label) ? diffText(cur, pv) : '-'] : [];
      return [r.label, ...r.avg, ...(multi ? [] : [r.differs ? r.total[0]! : r.avg[0]!]), ...d];
    });
    // サイトの選手の表にある、期間では出せない項目を足す（PER＝シーズン全体の値だけ、DD2・TD3・PTS10＝試合全体の達成の数）
    if (cat === 'advanced') {
      const wholeOk = (t: unknown) => t === scope.seasonTerm && i.opp === 'all';
      const per = (pl: PlayerSummary | undefined) => (pl && pl.advanced.per !== undefined && Number.isFinite(pl.advanced.per) ? formatDecimal(pl.advanced.per) : '-');
      const pp = i.compare && i.prev ? per(i.prev.player) : '-';
      const cur = per(p);
      body.push(['PER', ...cols.map(c => (wholeOk(c) ? cur : '-')), ...(multi ? [] : [wholeOk(cols[0]) ? cur : '-']), ...(cmp ? [prevCtx ? pp : '前季なし', prevCtx && wholeOk(multi ? cols[cols.length - 1] : cols[0]) ? diffText(cur, pp) : '-'] : [])]);
      used.add('PER');
    }
    if (cat === 'traditional') {
      const dd = (ls: PlayerGameLog[]) => { const x = countDoubleTripleDoubles(ls.filter(g => g.min > 0)); const n = ls.filter(g => g.min > 0).length; return { dd: x.dd, td: x.td, p10: x.p10, n }; };
      const cs = cols.map(t => dd(t.logs));
      const pl = prevLogsOf(i);
      const pd = pl ? dd(pl) : null;
      const avgT = (n: number, g: number) => (g > 0 ? `${((100 * n) / g).toFixed(2)}%` : '-');
      for (const [label, f] of [['DD2', (x: ReturnType<typeof dd>) => x.dd], ['TD3', (x: ReturnType<typeof dd>) => x.td], ['PTS10', (x: ReturnType<typeof dd>) => x.p10]] as const) {
        const avgs = cs.map(x => avgT(f(x), x.n));
        const curAvg = avgs[multi ? cols.length - 1 : 0]!;
        const pv = pd ? avgT(f(pd), pd.n) : '-';
        body.push([used.add(label), ...avgs, ...(multi ? [] : [String(f(cs[0]!))]), ...(cmp ? [pd ? pv : '前季なし', pd ? diffText(curAvg, pv) : '-'] : [])]);
      }
    }
    const keep = body.filter(r => r.slice(1).some(v => v !== '-' && v !== '前季なし'));
    const dropped = body.filter(r => !keep.includes(r)).map(r => r[0]!);
    out.push(`### ${CAT_NAME[cat]}`, '', keep.length ? mdTable(head, keep) : '- 値のある項目がありません。', '');
    if (dropped.length) out.push(`- 全期間で値が無いため省略した項目（${dropped.length}項目）：${dropped.join('、')}。`, '');
    if (cat === 'advanced') out.push('- PER はシーズン全体の値だけ（期間では出せないので、期間の列は「-」。対戦相手で絞ったときも「-」）。', '');
    if (cat === 'traditional') out.push('- DD2・TD3・PTS10：平均の欄は出場した試合のうち達成した試合の割合、合計の欄は達成した試合数（DD2＝ダブルダブル、TD3＝トリプルダブル、PTS10＝10点以上の試合）。', '');
  }
  void p;
  return out;
}

// ---- 3. ランキングでの位置 ----
function sectionRank(i: PlayerMdInput, p: PlayerSummary, notes: string[]): string[] {
  const out: string[] = ['## 3. ランキングでの位置', ''];
  if (!i.rank) { notes.push('リーグ内の順位の材料を読み込めなかった'); return [...out, '- 順位の材料（リーグ全体のデータ）がないため出せません。', '']; }
  const lines = buildRankLines(i.rank, p);
  const prevLines = i.compare && i.prevRank && i.prev ? buildRankLines(i.prevRank, i.prev.player) : null;
  const cmp = i.compare;
  out.push(
    `- 順位は**${i.season}シーズンのレギュラーシーズン全体**の1試合平均（対象期間・対戦相手の絞り込みは反映しない）。ランキング > 個人 > シーズン成績の、条件なし・全選手の表と同じ決め方。`,
    `- 掲載基準：${RANK_ELIGIBILITY_TEXT}。基準を満たさない項目は「掲載基準未達」とし、順位は付けない。`,
    '- 順位の付け方：同じ値（表示の文字が同じ）は同じ順位、次は飛ばす（1位・2位・2位・4位）。「順位の向き」が「少ない順」の項目（TOV など）は少ないほうが上位。値が「-」の人は順位を付けず、人数にも入れない。同じ値の人が多い項目（0.00 など）は「同じ値の人 N人」と書く。', '- シュートタイプの成功率には、ランキングのページに試投数の基準が無い（1本中1本で100%＝1位になりうる）。md の順位の欄に「試投数の基準なし」と書いた。', '- FLAG・DISR・UFOUL・DQFOUL・OFF FOUL は、ランキングのページで良し悪しの向きを決めていないので順位を付けない。', '');
  if (cmp) out.push(prevLines ? `- 前季全体＝${i.prevName}シーズンのレギュラーシーズン全体の順位（そのシーズンの掲載基準・対象人数で出したもの）。差は順位の差（今回−前季。マイナスは順位が上がった）。` : `- 前季なし：${i.prevReason ?? '-'}`, '');
  for (const cat of ['traditional', 'advanced', 'misc', 'scoring', 'shooting']) {
    const ls = lines.filter(l => l.category === cat);
    if (!ls.length) continue;
    const rk = (l: RankLine | undefined) => (!l ? '-' : l.rank ? `${l.rank}位／${l.total}人中${l.ties > 1 ? `（同じ値の人 ${l.ties}人）` : ''}${cat === 'shooting' && /%$/.test(l.value) ? '（試投数の基準なし）' : ''}` : l.note || '-');
    const body = ls.map(l => {
      const pl = prevLines?.find(x => x.category === cat && x.key === l.key);
      const diff = l.rank && pl?.rank ? `${l.rank - pl.rank > 0 ? '+' : ''}${l.rank - pl.rank}` : '-';
      return [l.label, l.direction === 'none' ? '向きなし' : l.direction, l.value, rk(l), ...(cmp ? (prevLines ? [pl?.value ?? '-', rk(pl), diff] : ['前季なし', '前季なし', '-']) : [])];
    });
    out.push(`### ${RANK_CATEGORY_LABEL[cat]}`, '', mdTable(['項目', '順位の向き', '値（平均）', 'リーグ内の順位（掲載基準を満たし、値がある人数中）', ...(cmp ? ['前季全体の値（平均）', '前季全体の順位', '順位の差（今回−前季）'] : [])], body), '');
  }
  if (!lines.some(l => l.category === 'shooting')) out.push('### Shooting', '', `- 出せません：${i.league === 'one' ? 'B.ONE にはスポーツナビの記録が無い' : 'このシーズンにはシュートタイプの記録が無い（2023-24以降）'}。`, '');
  out.push(...sectionRankRecords(i));
  return out;
}

// ---- 8. 試合ログ ----
function sectionGameLog(i: PlayerMdInput, scope: PlayerScope): string[] {
  const out: string[] = ['## 8. 試合ログ', ''];
  const logs = scope.union;
  if (!logs.length) return [...out, '- 対象の試合はありません。', ''];
  const opp = (g: PlayerGameLog) => teamNameInSeason(i.history, g.opponentTeamId, i.season, g.opponentTeamName);
  const body = logs.map(g => g.min > 0 ? [
    g.date, opp(g), g.isHome ? 'H' : 'A', g.win ? '勝' : '敗', g.isStarter ? '○' : '', formatMinutesFromSeconds(Math.round(g.min * 60)),
    String(g.pts), `${g.fgm}/${g.fga}`, `${g.tpm}/${g.tpa}`, `${g.ftm}/${g.fta}`, String(g.oreb), String(g.dreb), String(g.reb), String(g.ast), String(g.stl), String(g.blk), String(g.tov), String(g.pf), g.plusMinus > 0 ? `+${g.plusMinus}` : String(g.plusMinus),
  ] : [g.date, opp(g), g.isHome ? 'H' : 'A', g.win ? '勝' : '敗', '', '出場なし', ...Array(13).fill('-')]);
  out.push('- 対象期間の全試合を1行1試合で並べる（日付順）。H＝ホーム、A＝アウェイ、勝敗はチームの結果。先発は○。FG・3P・FT は成功/試投。MIN は分:秒。', '',
    mdTable(['日付', '相手', '会場', '勝敗', '先発', 'MIN', 'PTS', 'FG', '3P', 'FT', 'OR', 'DR', 'TR', 'AST', 'STL', 'BLK', 'TOV', 'PF', '+/-'], body), '');
  return out;
}

function sectionDefinitions(used: UsedLabels): string[] {
  const out = ['## 10. 定義', '', '- この書き出しの中で使った指標の説明（サイトの用語集と同じ文）。', ''];
  for (const l of [...used.set].sort()) { const d = statDescription(l); if (d) out.push(`- **${l}**：${d}`); }
  return [...out, ''];
}
