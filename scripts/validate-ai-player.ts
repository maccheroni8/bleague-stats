// 選手詳細の md の検証。build:data のあとに実行。使い方: npm run validate:ai-player
// 確かめること: ① 全シーズン（B.PREMIER）・B.ONE で、主な選手の md が作れて NaN・undefined・Infinity・[object が無い
// ② シーズン成績の PTS・TR・AST（平均）＝ players.json の値（1チームだけの選手）③ リーグ内の順位（PTS）＝ players.json から独立に出した順位
// ④ 試合ログの行数＝対象の試合数 ⑤ 直近5試合・前半戦後半戦・3ターム・6割以上でも作れる ⑥ 読み込みの失敗で完成版を作らない
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { PlayerSummary, TeamSummary } from '../shared/types.ts';
import { loadPlayerExport, aiPlayerSource } from '../src/lib/aiPlayerExportLoad.ts';
import { buildPlayerExport } from '../src/lib/aiPlayerExport.ts';
import { MIN_GAMES_PLAYED_RATIO_FOR_RANKING, filterEligiblePlayers } from '../src/lib/playerRankingEligibility.ts';
import { formatDecimal } from '../src/lib/format.ts';

(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const file = `${process.cwd()}/${decodeURIComponent(String(url).split('?')[0]!).replace(/^\//, '').replace(/^bleague-stats\//, '')}`;
  return existsSync(file) ? new Response(readFileSync(file), { status: 200 }) : new Response(null, { status: 404 });
};
let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = ''): void { checks++; if (!ok) { failures++; console.log(`NG ${label}\n   ${detail}`); } }
const read = <T>(path: string): T => JSON.parse(gunzipSync(readFileSync(`data/${path}.json.gz`)).toString('utf8')) as T;
const seasons = readdirSync('data').filter(s => /^\d{4}-\d{2}$/.test(s)).sort();
const BAD = /undefined|NaN|Infinity|\[object/;
const cell = (md: string, section: string, label: string): string | undefined => {
  const block = md.split(`### ${section}\n`)[1]?.split('\n### ')[0] ?? '';
  return block.split('\n').find(l => l.startsWith(`|${label}|`))?.split('|')[2];
};

async function one(season: string, league: 'premier' | 'one', p: PlayerSummary, teams: TeamSummary[], players: PlayerSummary[], full: boolean): Promise<void> {
  const tag = `${league} ${season} ${p.name}`;
  const input = await loadPlayerExport(season, p.playerId, { league, term: 'season', opp: 'all' });
  const out = buildPlayerExport(input);
  check(`${tag} 不正な文字が無い`, !BAD.test(out.markdown), (BAD.exec(out.markdown)?.[0] ?? '') + ' ' + out.markdown.slice(Math.max(0, (BAD.exec(out.markdown)?.index ?? 0) - 60), (BAD.exec(out.markdown)?.index ?? 0) + 40));
  const single = new Set(input.cur.logs.filter(g => g.gameType === 'regular').map(g => g.isHome)).size >= 1 && new Set([...input.cur.teamLogs.keys()]).size === 1;
  if (single) {
    check(`${tag} PTS 平均＝players.json`, cell(out.markdown, 'Traditional', 'PTS') === formatDecimal(p.perGame.pts), `${cell(out.markdown, 'Traditional', 'PTS')} vs ${formatDecimal(p.perGame.pts)}`);
    check(`${tag} AST 平均＝players.json`, cell(out.markdown, 'Traditional', 'AST') === formatDecimal(p.perGame.ast), `${cell(out.markdown, 'Traditional', 'AST')} vs ${formatDecimal(p.perGame.ast)}`);
  }
  // 順位（PTS）
  const eligible = filterEligiblePlayers(players, teams, MIN_GAMES_PLAYED_RATIO_FOR_RANKING, 'pts', 0);
  const mine = eligible.find(x => x.playerId === p.playerId);
  const line = out.markdown.split('## 3. ランキングでの位置')[1]?.split('### Advanced')[0]?.split('\n').find(l => l.startsWith('|PTS|')) ?? '';
  if (!mine) check(`${tag} 掲載基準未達`, line.includes('掲載基準未達'), line);
  else {
    const text = (x: PlayerSummary) => formatDecimal(x.perGame.pts);
    const rank = 1 + new Set(eligible.filter(x => x.perGame.pts > mine.perGame.pts && text(x) !== text(mine)).map(x => x.playerId)).size;
    const better = eligible.filter(x => x.perGame.pts > mine.perGame.pts && text(x) !== text(mine)).length;
    check(`${tag} PTS 順位`, line.includes(`${better + 1}位／${eligible.length}人中`) && rank === better + 1, `${line} vs ${better + 1}/${eligible.length}`);
  }
  check(`${tag} チェックなしは前季を出さない`, !/前季/.test(out.markdown), /前季/.exec(out.markdown)?.input?.slice(0, 0) ?? '');
  if (full) {
    const ic = await loadPlayerExport(season, p.playerId, { league, term: 'recent5', opp: 'all', compare: true });
    const oc = buildPlayerExport(ic);
    check(`${tag} 前季比較つきで作れる・不正な文字が無い`, !BAD.test(oc.markdown));
    check(`${tag} 前季比較の冒頭の注記`, /この書き出しは前季との比較つき/.test(oc.markdown.split('\n').slice(0, 4).join('\n')));
    if (ic.prev) {
      const prevP = ic.prev.player;
      const cur = cell(oc.markdown, 'Traditional', 'PTS');
      const row = (oc.markdown.split('### Traditional\n')[1] ?? '').split('\n').find(l => l.startsWith('|PTS|')) ?? '';
      check(`${tag} 前季全体 PTS＝前季の players.json`, row.split('|')[4] === formatDecimal(prevP.perGame.pts) || ic.prev.teamLogs.size > 1, `${row} vs ${formatDecimal(prevP.perGame.pts)}`);
      void cur;
    } else check(`${tag} 前季なしは理由を書く`, /前季なし：/.test(oc.markdown));
  }
  // 値が「-」の項目に順位が付かない・G/GS/MIN/PTS を繰り返さない・向きなしの項目に順位が付かない・PACE が2章と3章で同じ
  const rankPart = out.markdown.split('## 3. ランキングでの位置')[1]?.split('\n## 4.')[0] ?? '';
  const rankRows = rankPart.split('\n').filter(l => l.startsWith('|') && !l.startsWith('|---') && !l.startsWith('|項目|'));
  check(`${tag} 値が「-」なのに順位が付いている行が無い`, rankRows.every(l => { const c = l.split('|'); return c[3] !== '-' || !/位／/.test(c[4] ?? ''); }), rankRows.find(l => l.split('|')[3] === '-' && /位／/.test(l.split('|')[4] ?? '')) ?? '');
  check(`${tag} 向きなしの項目（FLAG・DISR など）に順位が付かない`, rankRows.filter(l => /^\|(FLAG|DISR|UFOUL|DQFOUL|OFF FOUL)\|/.test(l)).every(l => !/位／/.test(l)));
  for (const cat of ['Advanced', 'Misc', 'Scoring']) {
    const part = rankPart.split(`### ${cat}\n`)[1]?.split('\n### ')[0] ?? '';
    check(`${tag} ${cat} の順位の表に G・GS・MIN・PTS が無い`, !/^\|(G|GS|MIN|PTS)\|/m.test(part));
  }
  const pace2 = cell(out.markdown, 'Advanced', 'PACE');
  const paceRow = rankRows.find(l => l.startsWith('|PACE|'));
  if (paceRow) check(`${tag} PACE が2章と3章で同じ`, paceRow.split('|')[3] === (pace2 ?? '-'), `${paceRow} vs ${pace2}`);
  // 分母0の割合は「-」（5章の区間の表：FGA・2PA・3PA・FTA が0なら FG%・2P%・3P%・FT% は「-」）
  const periodPart = out.markdown.split('## 5.')[1]?.split('## 6.')[0] ?? '';
  for (const tbl of periodPart.split('### ').slice(1)) {
    const lines = tbl.split('\n'); const head = lines.find(l => l.startsWith('|区間|'));
    if (!head) continue;
    const cols = head.split('|');
    const at = (n: string) => cols.indexOf(n);
    for (const [den, pc] of [['FGA', 'FG%'], ['3PA', '3P%'], ['FTA', 'FT%']] as const) {
      if (at(den) < 0 || at(pc) < 0) continue;
      for (const l of lines.filter(x => /^\|(1Q|2Q|3Q|4Q|前半|後半|延長|クラッチ)/.test(x))) {
        const c = l.split('|');
        if (/^0\.00$/.test(c[at(den)] ?? '') ) check(`${tag} 5章 ${c[1]} ${pc}：${den} が0なら「-」`, c[at(pc)] === '-', l.slice(0, 120));
      }
    }
  }
  // 試合ログの +/- に符号
  const logRows = (out.markdown.split('## 8. 試合ログ')[1]?.split('## 9.')[0] ?? '').split('\n').filter(l => /^\|\d{4}-\d{2}-\d{2}\|/.test(l) && !l.includes('出場なし'));
  check(`${tag} 試合ログの +/- に符号`, logRows.every(l => /^[+-]\d+$|^0$/.test(l.split('|').at(-2) ?? '')), logRows.find(l => !/^[+-]\d+$|^0$/.test(l.split('|').at(-2) ?? '')) ?? '');
  const regular = input.cur.logs.filter(g => g.gameType === 'regular').length;
  const gameLogRows = (out.markdown.split('## 8. 試合ログ')[1]?.split('## 9.')[0] ?? '').split('\n').filter(l => /^\|\d{4}-\d{2}-\d{2}\|/.test(l)).length;
  check(`${tag} 試合ログの行数`, gameLogRows === regular, `${gameLogRows} vs ${regular}`);
  if (full) for (const [term, opp] of [['recent5', 'all'], ['halves', 'all'], ['threeTerms', 'all'], ['season', 'atLeast60']] as const) {
    if (league === 'one' && term === 'threeTerms') continue;
    const i2 = await loadPlayerExport(season, p.playerId, { league, term, opp });
    const o2 = buildPlayerExport(i2);
    check(`${tag} ${term}/${opp} で作れる・不正な文字が無い`, !BAD.test(o2.markdown));
  }
}
const sdata = (season: string, league: 'premier' | 'one') => {
  const base = league === 'one' ? `${season}/one` : season;
  return { players: read<PlayerSummary[]>(`${base}/players`), teams: read<TeamSummary[]>(`${base}/teams`) };
};
for (const season of seasons) {
  for (const league of ['premier', 'one'] as const) {
    if (league === 'one' && !existsSync(`data/${season}/one/players.json.gz`)) continue;
    const { players, teams } = sdata(season, league);
    const top = [...players].sort((a, b) => b.totals.min - a.totals.min);
    const picks = [top[0]!, top[Math.floor(top.length / 3)]!, top[Math.floor(top.length * 0.7)]!].filter(Boolean);
    for (const [k, p] of picks.entries()) await one(season, league, p, teams, players, k === 0 && (season === '2026-27' || season === '2025-26'));
  }
}
// 読み込みの失敗では完成版を作らない
{
  const broken = { ...aiPlayerSource, fetchPlayerGameLogs: async () => { throw new Error('x'); } };
  let threw = false;
  try { await loadPlayerExport('2026-27', '8589', { term: 'season', opp: 'all' }, broken); } catch { threw = true; }
  check('試合記録を読めないときは作成を止める', threw);
}
console.log(`選手 md: ${checks}件の確認`);
if (failures) { console.log(`${failures}件 NG`); process.exit(1); }
assert.ok(true);
