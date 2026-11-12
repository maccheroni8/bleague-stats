// 選手詳細の md の後半の章（4 シュート／5 時間帯／6 チームへの影響／7 条件別／9 通算と記録）。値は今の画面と同じ計算を呼ぶだけ。保存キーの対象外。
import type { PlayerGameLog, PlayerSummary, TeamGameLog } from '../../shared/types';
import { normalizePlayerName } from '../../shared/playerName';
import { compactStints, onCourtByGroup, onOffByPlayer } from '../../shared/onCourtTotals';
import { assistPairPoints } from '../../shared/assistPairs';
import { PLAYER_GAME_RECORD_STATS } from '../../shared/playerGameRecords';
import { ownTeamMap, type PlayerMdInput, type PlayerScope } from './aiPlayerScope';
import { ctxForLogs, mdTable, statsRows, UsedLabels, diffText, prevCtxOf, prevLogsOf } from './aiPlayerCommon';
import { buildShotEvents } from './shotChart';
import { buildZoneStats } from './shotChart';
import { playerShots, playerShootingColumns } from './aiDetailedYahoo';
import { sortShotTypeKeys } from './shotTypeBreakdown';
import { onOffTotalsFromLogs, onOffUnavailableReason, SEASON_ONOFF_COLUMNS } from './playerOnOffColumns';
import { buildBackToBackStatus } from './situational';
import { sumPlayerGameLogs, countDoubleTripleDoubles, type SeasonBoxTabKey } from './playerSeasonBoxscore';
import { ratingsFromPossessions } from './lineupRatings';
import { teamNameInSeason } from './teamLabel';
import { formatMinutesFromSeconds } from './boxscoreAggregate';
import { formatDecimal } from './format';
import type { SeasonPeriodSource } from './seasonPeriod';
import type { PeriodRangeValue } from './periodRange';
import { teamShortName } from '../../shared/teamNames';

const pct = (m: number, a: number) => (a > 0 ? `${((100 * m) / a).toFixed(2)}%` : '-');

// ---- 4. シュート ----
export function sectionShooting(i: PlayerMdInput, scope: PlayerScope, used: UsedLabels): string[] {
  const out: string[] = ['## 4. シュート', ''];
  const played = scope.playedUnion;
  if (!played.length) return [...out, '- 対象期間に出場した試合がありません。', ''];
  const id = i.playerId;
  // エリア別（試合の生データの座標）
  out.push('### エリア別（ショットチャートのゾーン）', '');
  if (i.rawGames.size === 0) {
    out.push(`- 出せません：${i.season < '2022-23' ? '2022-23より前のシーズンは、シュートの座標の記録が無い' : '試合の生データを読み込めなかった'}。`, '');
  } else {
    const zonesOf = (logs: PlayerGameLog[], games: ReadonlyMap<string, { raw: { PlayByPlays: Parameters<typeof buildShotEvents>[0] } }>) =>
      buildZoneStats(logs.flatMap(g => { const gm = games.get(g.scheduleKey); return gm ? buildShotEvents(gm.raw.PlayByPlays).filter(s => s.playerId === id) : []; }));
    const zones = zonesOf(played, i.rawGames);
    const total = zones.reduce((a, z) => a + z.attempts, 0);
    const read = played.filter(g => i.rawGames.has(g.scheduleKey)).length;
    const pl = prevLogsOf(i)?.filter(g => g.min > 0);
    const pz = pl && i.prevRawGames.size ? zonesOf(pl, i.prevRawGames) : null;
    const ptotal = pz ? pz.reduce((a, z) => a + z.attempts, 0) : 0;
    out.push(`- 座標のある試投だけの集計（試合の生データから。${read}／${played.length}試合）。センターラインより後ろからのシュート等、どのゾーンにも入らない試投は含まない。割合＝全ゾーンの試投に占める割合。`);
    if (i.compare) out.push(pz ? `- 前季全体＝${i.prevName}シーズンのレギュラーシーズン全体（${pl!.filter(g => i.prevRawGames.has(g.scheduleKey)).length}／${pl!.length}試合）。成功率・割合の差は「pt」（ポイント）。` : `- 前季なし${i.prevReason ? `：${i.prevReason}` : `：前季（${i.prevName}）はシュートの座標の記録が無い（2022-23より前）`}`);
    out.push('', mdTable(['ゾーン', '試投', '成功', '成功率', '試投の割合', ...(i.compare ? ['前季全体 試投', '前季全体 成功率', '成功率の差（pt）', '前季全体 試投の割合', '割合の差（pt）'] : [])],
      zones.map((z, k) => [z.zone.label, String(z.attempts), String(z.makes), pct(z.makes, z.attempts), pct(z.attempts, total), ...(i.compare ? (pz ? [String(pz[k]!.attempts), pct(pz[k]!.makes, pz[k]!.attempts), diffText(pct(z.makes, z.attempts), pct(pz[k]!.makes, pz[k]!.attempts)), pct(pz[k]!.attempts, ptotal), diffText(pct(z.attempts, total), pct(pz[k]!.attempts, ptotal))] : Array(5).fill('前季なし')) : [])])), '');
  }
  // シュートタイプ（スポーツナビ）
  out.push('### シュートタイプ（スポーツナビの記録。2023-24以降）', '');
  if (i.league === 'one' || !i.cur.player.shotTypes) {
    out.push(`- 出せません：${i.league === 'one' ? 'B.ONE にはスポーツナビの記録が無い' : '2022-23以前のシーズンにはシュートタイプの記録が無い'}。`, '');
  } else {
    const keys = new Set(played.map(g => g.scheduleKey));
    const zero = i.cur.logs.filter(g => g.gameType === 'regular' && g.min <= 0 && scope.union.some(x => x.scheduleKey === g.scheduleKey)).map(g => g.scheduleKey);
    const data = playerShots(id, keys, i.pbps, zero);
    const cols = playerShootingColumns(sortShotTypeKeys(Object.keys(data.breakdown)));
    const pdata = prevLogsOf(i) && i.prev ? playerShots(id, new Set(prevLogsOf(i)!.filter(g => g.min > 0).map(g => g.scheduleKey)), i.prevPbps, prevLogsOf(i)!.filter(g => g.min <= 0).map(g => g.scheduleKey)) : null;
    const pcols = pdata ? playerShootingColumns(sortShotTypeKeys(Object.keys(pdata.breakdown))) : [];
    const keys2 = [...new Set([...cols.map(c => c.label), ...pcols.map(c => c.label)])];
    const val = (cs: typeof cols, d: typeof data | null, l: string) => { const c = cs.find(x => x.label === l); return c && c.format && d ? c.format(d) : '-'; };
    const rows = keys2.map(l => [l, val(cols, data, l), ...(i.compare ? [pdata ? val(pcols, pdata, l) : '前季なし', pdata ? diffText(val(cols, data, l), val(pcols, pdata, l)) : '-'] : [])]).filter(r => r.slice(1).some(v => v !== '-' && v !== '前季なし'));
    out.push(`- 1試合平均の成功数（M）・試投数（A）と成功率。**分母は記録がある試合だけ**（記録がある試合 ${data.games}／出場 ${played.length}）。「Jump Shot」（無印）にはキャッチアンドシュート等が含まれる。`, '',
      ...(i.compare ? [pdata ? `- 前季全体＝${i.prevName}シーズンのレギュラーシーズン全体（記録がある試合 ${pdata.games}／出場 ${prevLogsOf(i)!.filter(g => g.min > 0).length}）。％の差は「pt」。` : `- 前季なし：${i.prevReason ?? `前季（${i.prevName}）にはシュートタイプの記録が無い`}`, ''] : []),
      rows.length ? mdTable(['項目', '値', ...(i.compare ? ['前季全体', '差（今回−前季全体）'] : [])], rows) : '- 記録のある試合がありません。', '');
  }
  // Self／AST
  out.push('### Self／AST の内訳（アシストされた得点とアシストなしの得点）', '');
  const ctx = ctxForLogs(i.cur, id, played);
  if (!ctx) return [...out, '- 値がありません。', ''];
  const r = ctx.raw;
  const pc = prevCtxOf(i);
  const row = (label: string, made: number, ast: number, pm?: number, pa?: number) => [label, String(made), String(ast), String(made - ast), pct(ast, made), pct(made - ast, made),
    ...(i.compare ? (pm === undefined || pa === undefined ? ['前季なし', '前季なし', '-'] : [pct(pa, pm), pct(pm - pa, pm), diffText(pct(ast, made), pct(pa, pm))]) : [])];
  out.push('- AST＝アシストが付いた成功数、Self＝アシストが付かなかった成功数（成功数−AST）。プレーバイプレーの記録が無い試合は除く。期間の合計。', '',
    ...(i.compare ? [pc ? `- 前季全体＝${i.prevName}シーズンのレギュラーシーズン全体。ASTの割合の差は「pt」。` : `- 前季なし：${i.prevReason ?? '-'}`, ''] : []),
    mdTable(['種類', '成功数', 'AST', 'Self', 'ASTの割合', 'Selfの割合', ...(i.compare ? ['前季全体 ASTの割合', '前季全体 Selfの割合', 'ASTの割合の差（pt）'] : [])],
      [row('2PM', r.fgm - r.tpm, r.assisted2m, pc ? pc.raw.fgm - pc.raw.tpm : undefined, pc?.raw.assisted2m), row('3PM', r.tpm, r.assisted3m, pc?.raw.tpm, pc?.raw.assisted3m), row('FTM', r.ftm, r.assistedFtm, pc?.raw.ftm, pc?.raw.assistedFtm)]), '');
  void used;
  return out;
}

// ---- 5. 時間帯 ----
const PERIODS: { value: PeriodRangeValue; label: string }[] = [
  { value: 'q1', label: '1Q' }, { value: 'q2', label: '2Q' }, { value: 'q3', label: '3Q' }, { value: 'q4', label: '4Q' },
  { value: 'h1', label: '前半（1Q・2Q）' }, { value: 'h2', label: '後半（3Q・4Q）' }, { value: 'ot', label: '延長' }, { value: 'clutch', label: 'クラッチ' },
];
export function sectionPeriods(i: PlayerMdInput, scope: PlayerScope, used: UsedLabels): string[] {
  const out: string[] = ['## 5. 時間帯（Q別・前後半・延長・クラッチ）', ''];
  const source: SeasonPeriodSource | null = i.periodSource;
  if (!source) return [...out, '- 出せません：区間の索引を読み込めなかった。', ''];
  if (!scope.playedUnion.length) return [...out, '- 対象期間に出場した試合がありません。', ''];
  out.push('- 1試合平均。G＝その区間の記録がある試合（延長・クラッチはその区間に出た試合だけ。平均もその試合数で割る）。前後半5分の特別な試合・ボックススコアが手入力の試合は区間の値が無いので数えない。',
    '- 延長：延長のあった試合の、すべての延長の合計。クラッチ：第4Q・延長の残り5:00以下で、5点差以内の時間帯（被ファウル・2020-21以降のEFFは「-」）。', '');
  if (i.compare) out.push(prevCtxOf(i) ? `- 前季全体の区間＝${i.prevName}シーズンのレギュラーシーズン全体の同じ区間。区間ごとに「今回」「前季全体」「差（今回−前季全体。％の項目は pt）」の3つの表を並べる。` : `- 前季なし：${i.prevReason ?? '-'}`, '');
  for (const cat of ['traditional', 'advanced', 'misc', 'scoring'] as SeasonBoxTabKey[]) {
    const ctxs = PERIODS.map(p => ctxForLogs(i.cur, i.playerId, scope.union, p.value, source));
    const rows = statsRows(cat, i.season, ctxs, used, false);
    const prevs = i.compare && prevCtxOf(i) ? PERIODS.map(p => prevCtxOf(i, p.value)) : null;
    const prows = prevs ? statsRows(cat, i.prevName!, prevs, used, false) : null;
    const grid = (get: (r: (typeof rows)[number], k: number) => string) => PERIODS.map((p, k) => [p.label, ...rows.map(r => get(r, k))]);
    const body = grid((r, k) => r.avg[k]!);
    const keep = rows.map((_, c) => body.some(b => b[c + 1] !== '-'));
    const table = (b: string[][]) => mdTable(['区間', ...rows.filter((_, c) => keep[c]).map(r => r.label)], b.map(x => [x[0]!, ...x.slice(1).filter((_, c) => keep[c])]));
    const name = `${cat[0]!.toUpperCase()}${cat.slice(1)}`;
    out.push(`### ${name}${prows ? '（今回）' : ''}`, '', table(body), '');
    if (prows) {
      const pg = grid((r, k) => prows.find(x => x.key === r.key)?.avg[k] ?? '-');
      out.push(`### ${name}（前季全体）`, '', table(pg), '', `### ${name}（差：今回−前季全体）`, '', table(grid((r, k) => ['G', 'GS'].includes(r.label) ? '-' : diffText(r.avg[k]!, prows.find(x => x.key === r.key)?.avg[k] ?? '-'))), '');
    }
  }
  return out;
}

// ---- 6. チームへの影響 ----
export function sectionTeamImpact(i: PlayerMdInput, scope: PlayerScope, used: UsedLabels): string[] {
  const out: string[] = ['## 6. チームへの影響', '', '### On/Off（出場中と、出場した試合で本人がコートにいない間のチームの成績）', ''];
  const reason = onOffUnavailableReason(i.season, false);
  const played = scope.playedUnion;
  if (reason) out.push(`- 出せません：${reason}`, '');
  else {
    const ctx = ctxForLogs(i.cur, i.playerId, played);
    const teamLogOf = (g: PlayerGameLog): TeamGameLog | undefined => {
      const t = scope.ownBy.get(g.scheduleKey)?.teamId;
      return t ? i.cur.teamLogs.get(t)?.find(x => x.scheduleKey === g.scheduleKey) : undefined;
    };
    const totals = onOffTotalsFromLogs(played, teamLogOf);
    if (!ctx || !totals) out.push('- 出場中の記録がそろう試合が無いため「-」です。', '');
    else {
      const c = { ...ctx, onOff: totals };
      // 前季全体の On/Off
      let pRows: string[] | null = null;
      const plogs = prevLogsOf(i)?.filter(g => g.min > 0);
      if (i.compare && plogs && i.prev && !onOffUnavailableReason(i.prevName, false)) {
        const pOwn = ownTeamMap(i.prev);
        const pTotals = onOffTotalsFromLogs(plogs, g => { const t = pOwn.get(g.scheduleKey)?.teamId; return t ? i.prev!.teamLogs.get(t)?.find(x => x.scheduleKey === g.scheduleKey) : undefined; });
        const pctx = prevCtxOf(i);
        if (pTotals && pctx) { const pc = { ...pctx, onOff: pTotals }; pRows = SEASON_ONOFF_COLUMNS.map(col => col.format(pc, 'perGame')); }
      }
      const rows = SEASON_ONOFF_COLUMNS.map((col, k) => { const cur = col.format(c, 'perGame'); return [used.add(col.label), cur, ...(i.compare ? [pRows ? pRows[k]! : '前季なし', pRows && col.label !== 'G' ? diffText(cur, pRows[k]!) : '-'] : [])]; });
      out.push('- On＝本人がコートにいる間、Off＝本人が出場した試合でコートにいない間。ORtg・DRtg・NetRtg は得点と攻撃回数を足してから100攻撃あたりに直した値。個人の ORtg・DRtg（Advanced）とは別の項目。Min は材料のある試合の1試合平均。', '');
      if (i.compare) out.push(pRows ? `- 前季全体＝${i.prevName}シーズンのレギュラーシーズン全体。差は今回−前季全体（時間は分:秒）。` : `- 前季なし：${i.prevReason ?? `前季（${i.prevName}）は on/off を出していない、または出せる試合がありません`}`, '');
      out.push(mdTable(['項目', '値', ...(i.compare ? ['前季全体', '差（今回−前季全体）'] : [])], rows), '');
    }
  }
  // 組み合わせ
  if (i.compare) out.push('> 組み合わせ・アシストペア・条件別（この章の以降と7章）は、組や条件が毎季変わるため、前季全体との比較は付けない（今回の対象期間の値だけ）。', '');
  out.push('### よく組む組み合わせ（出場時間の長い順の上位）', '');
  const stints = i.extra?.stints;
  if (!stints || stints.size === 0) out.push('- 出せません：出場区間の記録を読み込めなかった。', '');
  else {
    const names = new Map(i.cur.players.map(p => [p.playerId, normalizePlayerName(p.name)]));
    const keySet = new Set(played.map(g => g.scheduleKey));
    for (const size of [2, 3] as const) {
      const rows: { names: string; sec: number; games: number; off: number | null; def: number | null; net: number | null; team: string }[] = [];
      for (const [teamId, c] of stints) {
        const groups = onCourtByGroup(c, size, { includeGame: k => keySet.has(k), periods: null, keys: ['pts', 'poss'] });
        for (const g of groups) {
          if (!g.playerIds.includes(i.playerId) || g.on.seconds <= 0) continue;
          const r = ratingsFromPossessions(g.on.own[0]!, g.on.opp[0]!, g.on.own[1]!, g.on.opp[1]!);
          rows.push({ names: g.playerIds.map(x => names.get(x) ?? x).join(' ／ '), sec: g.on.seconds, games: g.on.games, ...r, team: teamId });
        }
      }
      rows.sort((a, b) => b.sec - a.sec);
      const f = (v: number | null) => (v === null ? '-' : v.toFixed(2));
      out.push(`#### ${size}人の組み合わせ`, '', rows.length ? mdTable(['組み合わせ', '同時出場時間', '試合数', 'ORtg', 'DRtg', 'NetRtg'], rows.slice(0, 8).map(r => [r.names, formatMinutesFromSeconds(Math.round(r.sec)), String(r.games), f(r.off), f(r.def), f(r.net)])) : '- 該当なし', '');
    }
    out.push('- 同時出場時間は期間内の合計（分:秒）、試合数は同時に出た試合。NetRtg=ORtg−DRtg（100攻撃あたり）。出場時間が短い組は値が不安定。', '');
    void onOffByPlayer; void compactStints;
  }
  // アシストペア
  out.push('### アシストペア（期間内のアシスト付きの得点）', '');
  const pairs = i.extra?.assistPairs;
  if (!pairs) out.push(`- 出せません：${i.league === 'one' ? 'B.ONE のアシストペアの記録を読み込めなかった' : 'アシストペアの記録を読み込めなかった'}。`, '');
  else {
    const keySet = new Set(played.map(g => g.scheduleKey));
    const names = new Map(i.cur.players.map(p => [p.playerId, normalizePlayerName(p.name)]));
    type Acc = { n2: number; n3: number; nf: number; games: number };
    const given = new Map<string, Acc>(), received = new Map<string, Acc>();
    const r = pairs.rows;
    for (let k = 0; k < r.game.length; k++) {
      if (!keySet.has(pairs.keys[r.game[k]!]!)) continue;
      const a = pairs.players[r.assister[k]!]!, s = pairs.players[r.scorer[k]!]!;
      const add = (m: Map<string, Acc>, who: string) => { const x = m.get(who) ?? { n2: 0, n3: 0, nf: 0, games: 0 }; x.n2 += r.n2[k]!; x.n3 += r.n3[k]!; x.nf += r.nf[k]!; x.games += 1; m.set(who, x); };
      if (a === i.playerId) add(given, s);
      if (s === i.playerId) add(received, a);
    }
    const table = (m: Map<string, Acc>) => [...m].map(([who, x]) => ({ who, x, pts: assistPairPoints(x) })).sort((a, b) => b.pts - a.pts).slice(0, 5)
      .map(({ who, x, pts }) => [names.get(who) ?? who, String(pts), `${x.n2}／${x.n3}／${x.nf}`, String(x.games)]);
    const head = (who: string) => [who, 'アシスト経由の得点', '2P／3P／FTの成功数', '試合数'];
    out.push('#### 誰へのアシストが多いか（本人がアシストした）', '', given.size ? mdTable(head('得点した選手'), table(given)) : '- 該当なし', '',
      '#### 誰からのアシストが多いか（本人が得点した）', '', received.size ? mdTable(head('アシストした選手'), table(received)) : '- 該当なし', '',
      '- 得点＝2P成功×2＋3P成功×3＋FT成功。上位5組。', '');
  }
  return out;
}

// ---- 7. 条件別 ----
const COMPACT = ['G', 'MIN', 'PTS', 'FG%', '3P%', 'FT%', 'TR', 'AST', 'STL', 'BLK', 'TOV', 'EFF', '+/-', 'eFG%', 'TS%', 'USG%', 'ORtg', 'DRtg', 'NetRtg'];
export function sectionConditions(i: PlayerMdInput, scope: PlayerScope, used: UsedLabels): string[] {
  const out: string[] = ['## 7. 条件別', ''];
  const played = scope.playedUnion;
  if (!played.length) return [...out, '- 対象期間に出場した試合がありません。', ''];
  const status = buildBackToBackStatus(i.cur.summaries);
  const b2b = (g: PlayerGameLog) => status.get(g.scheduleKey)?.get(scope.ownBy.get(g.scheduleKey)?.teamId ?? '');
  const groups: { group: string; label: string; logs: PlayerGameLog[] }[] = [
    { group: '会場', label: 'ホーム', logs: played.filter(g => g.isHome) },
    { group: '会場', label: 'アウェイ', logs: played.filter(g => !g.isHome) },
    { group: '勝敗', label: 'チームが勝った試合', logs: played.filter(g => g.win) },
    { group: '勝敗', label: 'チームが負けた試合', logs: played.filter(g => !g.win) },
    ...[1, 2, 3].map(n => ({ group: '連戦', label: `GAME${n}`, logs: played.filter(g => b2b(g) === `GAME${n}`) })),
  ];
  const opps = [...new Set(played.map(g => g.opponentTeamId))];
  for (const o of opps) {
    const ls = played.filter(g => g.opponentTeamId === o);
    groups.push({ group: '対戦相手', label: teamNameInSeason(i.history, o, i.season, ls[0]!.opponentTeamName), logs: ls });
  }
  const rowsOf = (cat: SeasonBoxTabKey) => groups.map(gr => ({ gr, ctx: ctxForLogs(i.cur, i.playerId, gr.logs) })).filter(x => x.ctx);
  const cols = (cat: SeasonBoxTabKey, ctxs: ReturnType<typeof rowsOf>) => statsRows(cat, i.season, ctxs.map(x => x.ctx), used, false);
  out.push('- 各条件に当てはまる試合だけで数えた1試合平均（G＝その条件で出場した試合数）。連戦＝同じ相手と中1日以内に続けて行った試合の1試合目が GAME1、2試合目が GAME2（3試合以上続くときは GAME3…。当てはまる試合が無い行は省く）。対戦相手別は対戦した全相手。USG%・ORtg・DRtg の分母はその条件の試合のチーム合計。', '');
  const trad = rowsOf('traditional'), adv = rowsOf('advanced');
  const tr = cols('traditional', trad), ad = cols('advanced', adv);
  const pick = (all: { label: string; avg: string[] }[], labels: string[]) => all.filter(r => labels.includes(r.label));
  const sel = [...pick(tr, COMPACT), ...pick(ad, COMPACT).filter(r => !tr.some(t => t.label === r.label))];
  const idx = new Map(trad.map((x, k) => [x.gr.label, k] as const));
  const advIdx = new Map(adv.map((x, k) => [x.gr.label, k] as const));
  const valueAt = (r: { label: string; avg: string[] }, label: string) => {
    const inTr = tr.includes(r as never);
    const k = (inTr ? idx : advIdx).get(label);
    return k === undefined ? '-' : r.avg[k]!;
  };
  const cond = new Map<string, { group: string }>(groups.map(g => [g.label, g]));
  for (const group of ['会場', '勝敗', '連戦', '対戦相手']) {
    const rows = trad.filter(x => x.gr.group === group);
    if (!rows.length) continue;
    out.push(`### ${group}`, '', mdTable(['条件', ...sel.map(r => r.label)], rows.map(x => [x.gr.label, ...sel.map(r => valueAt(r, x.gr.label))])), '');
  }
  void cond;
  return out;
}

// ---- 9. 通算と記録 ----
export function sectionCareer(i: PlayerMdInput): string[] {
  const out: string[] = ['## 9. 通算と記録', ''];
  const seasons = i.career;
  if (!seasons.length) return [...out, '- 出場記録がありません。', ''];
  const regular = (c: { logs: PlayerGameLog[] }) => c.logs.filter(g => g.gameType === 'regular' && g.min > 0);
  const line = (label: string, ls: PlayerGameLog[]) => {
    const t = sumPlayerGameLogs(ls);
    const n = ls.length;
    const avg = (v: number) => formatDecimal(v / n);
    return [label, String(n), formatMinutesFromSeconds(Math.round((t.min * 60) / n)), avg(t.pts), avg(t.reb), avg(t.ast), avg(t.stl), avg(t.blk), avg(t.tov), pct(t.fgm, t.fga), pct(t.tpm, t.tpa), pct(t.ftm, t.fta), String(t.pts), String(t.reb), String(t.ast)];
  };
  const head = ['シーズン', 'G', 'MIN', 'PTS', 'TR', 'AST', 'STL', 'BLK', 'TOV', 'FG%', '3P%', 'FT%', 'PTS合計', 'TR合計', 'AST合計'];
  const rows = seasons.map(c => ({ c, ls: regular(c) })).filter(x => x.ls.length).map(x => line(`${x.c.season}${x.c.league === 'one' ? '（B.ONE）' : ''}`, x.ls));
  const all = seasons.flatMap(regular);
  out.push('### 通算成績（レギュラーシーズン。この選手のこのサイトにある全シーズンの合計と1試合平均）', '',
    '- 平均は各行の出場試合数 G で割った値、合計は PTS・TR・AST の合計。ポストシーズンは入れない。', '',
    mdTable(head, [...rows, line('通算', all)]), '');
  // キャリアハイ
  const defs = PLAYER_GAME_RECORD_STATS.filter(d => ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'ftm', 'fgm', 'eff', 'min'].includes(d.key));
  const gameLabel = (c: { season: string; summaries: { scheduleKey: string }[] }, g: PlayerGameLog) => `${g.date} vs ${g.opponentTeamName}`;
  const ctxOf = new Map(seasons.flatMap(c => regular(c).map(g => [g.scheduleKey + c.season, c] as const)));
  const highs = defs.map(d => {
    let best: { v: number; g: PlayerGameLog; c: (typeof seasons)[number] } | null = null;
    for (const c of seasons) for (const g of regular(c)) { const v = d.value({ ...g, season: c.season }); if (Number.isFinite(v) && (!best || v > best.v)) best = { v, g, c }; }
    const fmt = (v: number) => (d.key === 'min' ? formatMinutesFromSeconds(Math.round(v * 60)) : String(Math.round(v * 100) / 100));
    return best ? [d.label, fmt(best.v), `${best.c.season} ${gameLabel(best.c, best.g)}`] : [d.label, '-', '-'];
  });
  void ctxOf;
  out.push('### キャリアハイ（1試合の最高。レギュラーシーズン。同じ値の試合が複数あるときは最も古い試合）', '', mdTable(['項目', '値', '試合'], highs), '');
  // 達成記録（簡易）
  const count = (f: (g: PlayerGameLog) => boolean) => all.filter(f).length;
  const seasonLogs = regular({ logs: i.cur.logs });
  const dd = (ls: PlayerGameLog[]) => countDoubleTripleDoubles(ls);
  const achieve: [string, (g: PlayerGameLog) => boolean][] = [
    ['PTS 20以上', g => g.pts >= 20], ['PTS 30以上', g => g.pts >= 30], ['PTS 40以上', g => g.pts >= 40], ['TR 10以上', g => g.reb >= 10], ['AST 10以上', g => g.ast >= 10],
    ['3PM 5以上', g => g.tpm >= 5], ['STL 5以上', g => g.stl >= 5], ['BLK 5以上', g => g.blk >= 5],
  ];
  out.push('### 達成した試合数（1試合のスタッツが基準以上だった試合の数）', '',
    '- ランキング「達成記録」と同じ考え方の、代表的な基準だけの集計（順位は付けない）。レギュラーシーズン。', '',
    mdTable(['基準', `${i.season}（全試合）`, '通算'], [...achieve.map(([l, f]) => [l, String(seasonLogs.filter(f).length), String(count(f))]),
      ['ダブルダブル', String(dd(seasonLogs).dd), String(dd(all).dd)], ['トリプルダブル', String(dd(seasonLogs).td), String(dd(all).td)]]), '');
  void ownTeamMap; void teamShortName;
  return out;
}

const CAREER_LABEL: Record<string, string> = {
  wins: '勝利数（出場した試合のチームの勝ち）', games: '出場試合数', minMinutes: '出場時間', pts: 'PTS', fgm: 'FGM', fga: 'FGA', twoPm: '2PM', twoPa: '2PA', tpm: '3PM', tpa: '3PA', ftm: 'FTM', fta: 'FTA',
  oreb: 'OR', dreb: 'DR', reb: 'TR', ast: 'AST', tov: 'TOV', stl: 'STL', blk: 'BLK', stocks: 'STOCKS', pf: 'F', foulsDrawn: 'FD', blockedAgainst: 'BSR', plusMinus: '+/-',
  fbps: 'FBPS', pitp: 'PITP', secondChancePts: '2ND PTS', ptsOffTov: 'PTSOFFTO', dunks: 'DUNK', doubleDoubles: 'ダブルダブル回数', tripleDoubles: 'トリプルダブル回数', astedPct: '%PTS ASTED',
};
// ---- 3 の続き：記録のランキングに名前が載っているか ----
export function sectionRankRecords(i: PlayerMdInput): string[] {
  const out: string[] = ['### 記録のランキングに名前が載っているもの', ''];
  const ex = i.extra;
  if (!ex) return [...out, '- 記録のファイルを読み込めなかったため出せません。', ''];
  const label = new Map(PLAYER_GAME_RECORD_STATS.map(d => [d.key, d]));
  const rowsOf = (tables: Record<string, { rank: number; value: number; playerId: string; date: string; opponentTeamName: string; season?: string }[]> | undefined, scopeLabel: string) => {
    const rows: string[][] = [];
    for (const [key, list] of Object.entries(tables ?? {})) {
      const d = label.get(key);
      for (const e of list) if (e.playerId === i.playerId) {
        const v = d?.kind === 'pct' ? `${(e.value * 100).toFixed(2)}%` : d?.key === 'min' ? formatMinutesFromSeconds(Math.round(e.value * 60)) : String(Math.round(e.value * 100) / 100);
        rows.push([scopeLabel, d?.label ?? key, `${e.rank}位`, v, `${e.date} vs ${e.opponentTeamName}`]);
      }
    }
    return rows;
  };
  const season = rowsOf(ex.seasonRecords?.byGameType.regular, `${i.season}シーズンの1試合`);
  const allTime = rowsOf(ex.allTimeRecords?.byGameType.regular, '歴代の1試合（B.PREMIER）');
  if (i.league === 'one') out.push('- B.ONE には歴代・通算のランキングが無いため、載っているのは今季の1試合記録だけ。', '');
  out.push('- ランキング > 個人 > 1試合記録（レギュラーシーズン・全選手・上位20位まで。同じ値は同順位でまとめて載る）に、この選手の名前が載っているもの。成功率の項目には、ランキングと同じ成功数の基準がある（FG 5本・2P 5本・3P 3本・FT 8本以上成功した試合だけが対象）。同じ値（100%など）の試合は全部同順位で載るので、同じ順位が何件も並ぶ。', '',
    season.length || allTime.length ? mdTable(['記録', '項目', '順位', '値', '試合'], [...season, ...allTime]) : '- 該当なし（上位20位に載っている記録はありません）。', '');
  const career: string[][] = [];
  const top = ex.careerTop;
  if (top) for (const group of [top.career?.regular, top.careerCounts?.regular] as (Record<string, { playerId: string; value: number; rank: number }[]> | undefined)[]) {
    for (const [key, list] of Object.entries(group ?? {})) for (const e of list) if (e.playerId === i.playerId) career.push([CAREER_LABEL[key] ?? key, `${e.rank}位`, key === 'minMinutes' ? formatMinutesFromSeconds(Math.round(e.value * 60)) : key === 'astedPct' ? `${e.value.toFixed(2)}%` : String(Math.round(e.value * 100) / 100)]);
  }
  out.push('#### 通算記録の上位（ランキング > 個人 > 通算。B.PREMIER・レギュラーシーズン・上位20位まで）', '',
    top ? (career.length ? mdTable(['項目（通算の合計）', '順位', '値'], career) : '- 該当なし') : i.league === 'one' ? '- 出せません：B.ONE には通算記録・歴代記録のランキングが無い。' : '- 通算記録のファイルを読み込めなかったため出せません。', '');
  void (null as unknown as PlayerSummary);
  return out;
}
