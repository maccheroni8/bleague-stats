import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseEaslMatches, easlLinkSlugs, easlLogoSources } from './lib/easlSchedule.ts';
import { annualLeagueGames, calendarDates, calendarResult } from '../src/lib/annualSchedule.ts';
import { buildCupGames, cupDates, type CupNode } from '../shared/emperorsCup.ts';
import { parseCupBracket, parseCupStagePage, resolveCupClub } from './lib/emperorsCup.ts';
import type { ScheduleFileExtended } from '../shared/resultOnlyGames.ts';
import type { GameSummary } from '../shared/types.ts';
import type { AnnualCalendarFile } from '../shared/annualSchedule.ts';

const teams = [{ teamId: '706', teamName: 'アルバルク東京' }, { teamId: '701', teamName: '琉球ゴールデンキングス' }];
const upcoming = { scheduleKey: '1', date: '2026-10-01', homeTeamName: teams[0]!.teamName, awayTeamName: teams[1]!.teamName };
const result = { ...upcoming, homeTeamId: '706', awayTeamId: '701', homeScore: 20, awayScore: 0, gameType: 'regular' as const, reason: 'forfeit' as const };
const schedule: ScheduleFileExtended = { season: '2026-27', generatedAt: '', scheduleKeys: ['1'], upcomingGames: [upcoming], cancelledGames: [upcoming], resultOnlyGames: [result] };
const rows = annualLeagueGames([], schedule, teams);
assert.equal(rows.length, 1);
assert.equal(rows[0]!.note, '不戦勝／不戦敗');
assert.equal(rows[0]!.gameLink, undefined);
assert.equal(calendarResult(rows[0]!, true), '○');
assert.equal(calendarResult(rows[0]!, false), '●');
const summary = { ...result, gameEndedFlg: false } as unknown as GameSummary;
const live = annualLeagueGames([summary], schedule, teams);
assert.equal(live.length, 1);
assert.equal(live[0]!.status, 'live');
assert.equal(calendarResult(live[0]!, true), '試合中');
assert.equal(annualLeagueGames([], null, teams).length, 0);
assert.equal(calendarDates('2023-24').length, 366);
assert(calendarDates('2023-24').includes('2024-02-29'));
assert.equal(calendarDates('2026-27').length, 365);
const bounded = calendarDates('2026-27', '2026-09-22', '2027-06-01');
assert.equal(bounded[0], '2026-09-22');
assert.equal(bounded.at(-1), '2027-06-01');
assert(!bounded.includes('2026-09-21'));
assert(!bounded.includes('2027-06-02'));
const fixture = { fixtureId: 'example', startTimeUTC: '2026-10-14T23:10:00', status: 'CONFIRMED', stage: { nameLocal: 'Group Stage' }, competitors: [
  { isHome: true, nameFullLocal: '琉球ゴールデンキングス', score: '91' },
  { isHome: false, nameFullLatin: 'Opponent', codeLatin: 'OPP', score: '80' },
] };
const parsed = parseEaslMatches([fixture], '2026-27')[0]!;
assert.equal(parsed.date, '2026-10-15');
assert.equal(parsed.tipoff, '08:10');
assert.equal(parsed.home.id, '701');
assert.equal(parsed.status, 'final');
assert.equal(parsed.neutral, false);
const pending = parseEaslMatches([{ ...fixture, status: 'SCHEDULED' }], '2026-27')[0]!;
assert.equal(pending.homeScore, undefined);
assert.equal(calendarResult(pending, true), '');
assert.throws(() => parseEaslMatches({}, '2026-27'));
assert.throws(() => parseEaslMatches([{ ...fixture, startTimeUTC: 'invalid' }], '2026-27'));
const data: AnnualCalendarFile = JSON.parse(fs.readFileSync('data/annual-calendar.json','utf8'));
const current = data.seasons['2026-27']!;
assert.equal(new Set(current.games.map(g => g.id)).size, current.games.length);
assert(current.games.length >= 18);
for (const id of ['706','701','2488']) assert(current.games.filter(g => g.home.id === id || g.away.id === id).length >= 6);
for (const e of current.events) { assert(e.start <= e.end); assert(e.source.startsWith('https://')); }

// --- EASL の試合ページのリンク（日時＋日本のクラブ名で選ぶ。時の0埋めがあるものとないものがある） ---
const linkHtml = '<a href="/schedules/alvarktokyovsbroncos-oct142026071000pm"></a><a href="/ja/schedules/macauhouchonvsnagasakivelca-oct32026040000pm"></a><a href="/schedules/alvarktokyovsbroncos-oct142026071000pm-cc9ec248-b040-11f1-84eb-7df2cf21e877"></a>';
assert.deepEqual(easlLinkSlugs(linkHtml).length, 3);
const linkFixture = { fixtureId: 'l1', startTimeUTC: '2026-10-14T10:10:00', startTimeLocal: '2026-10-14T19:10:00', status: 'SCHEDULED', stage: { nameLocal: 'Group Stage' }, competitors: [
  { isHome: true, nameFullLatin: 'Alvark Tokyo', teamId: 't1' }, { isHome: false, nameFullLatin: 'South Gobi Broncos', teamId: 't2', primaryColor: '00AAFF', logo: 'https://example.com/b.png' }] };
assert.equal(parseEaslMatches([linkFixture], '2026-27', easlLinkSlugs(linkHtml))[0]!.link, 'https://www.easl.basketball/schedules/alvarktokyovsbroncos-oct142026071000pm');
const unpadded = { ...linkFixture, fixtureId: 'l2', startTimeUTC: '2026-10-03T08:00:00', startTimeLocal: '2026-10-03T16:00:00', competitors: [{ isHome: true, nameFullLatin: 'Macau Hou Chon' }, { isHome: false, nameFullLocal: '長崎ヴェルカ' }] };
assert.equal(parseEaslMatches([unpadded], '2026-27', easlLinkSlugs(linkHtml))[0]!.link, 'https://www.easl.basketball/schedules/macauhouchonvsnagasakivelca-oct32026040000pm');
assert.equal(parseEaslMatches([linkFixture], '2026-27', [])[0]!.link, 'https://www.easl.basketball/schedule-results');
const foreign = parseEaslMatches([linkFixture], '2026-27')[0]!.away;
assert.equal(foreign.easlTeamId, 't2');
assert.equal(foreign.color, '00aaff');
assert.equal(easlLogoSources([linkFixture]).get('t2')?.url, 'https://example.com/b.png');
assert(!easlLogoSources([linkFixture]).has('t1'));

// --- 保存した大会日程: リンク・海外クラブのロゴ ---
const ledger: Record<string, { name: string; source: string }> = JSON.parse(fs.readFileSync('data/logos/easl/sources.json', 'utf8'));
const easlGames = current.games.filter(g => g.competition === 'easl');
for (const g of easlGames) {
  assert(g.id.startsWith('easl:'), 'EASLの試合IDは easl: で始める');
  assert(g.link?.startsWith('https://www.easl.basketball/'), `EASLの試合ページのリンクが無い: ${g.id}`);
  for (const club of [g.home, g.away]) {
    if (club.id) continue;
    assert(club.easlTeamId, `海外クラブにEASLのチームIDが無い: ${club.name}`);
    const file = path.join('data/logos/easl', `${club.easlTeamId}.png`);
    assert(fs.existsSync(file), `海外クラブのロゴが無い: ${club.name}`);
    const png = fs.readFileSync(file);
    assert.equal(png.readUInt32BE(16), 400); assert.equal(png.readUInt32BE(20), 400);
    assert(ledger[club.easlTeamId!]?.source.startsWith('https://'), `ロゴの取り先が台帳に無い: ${club.name}`);
  }
}

// --- EASL の試合は B.LEAGUE の成績・順位・ランキング・図解・スタッツに入れない ---
// ①読む場所を限る（画面は日程タブと年間スケジュールだけ。集計・共有のコードは大会日程を読まない）
function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const readers = new Set(['shared/emperorsCup.ts', 'scripts/lib/emperorsCup.ts', 'scripts/scrape-emperors-cup.ts', 'src/components/AnnualSchedule.tsx', 'src/components/EaslLogo.tsx', 'src/pages/SchedulePage.tsx', 'src/lib/easlCalendar.ts', 'src/lib/annualSchedule.ts', 'scripts/lib/dataLayout.ts', 'shared/annualSchedule.ts']); // dataLayout は元データの一覧にファイル名を書くだけ
for (const f of [...listFiles('src'), ...listFiles('shared'), ...listFiles('scripts').filter(x => !x.includes('annual-schedule') && !x.includes('easl') && !x.includes('emperors-cup') && !x.includes('emperorsCup'))]) {
  if (!/\.(ts|tsx)$/.test(f) || readers.has(f.replaceAll(path.sep, '/'))) continue;
  const text = fs.readFileSync(f, 'utf8');
  assert(!/annual-calendar|easlCalendar|easlSchedule|emperorsCup|competition:\s*'(easl|cup)'/.test(text), `EASLの大会日程をB.LEAGUEの集計・画面で読んでいる: ${f}`);
}
// ②作った集計・日程にEASLの試合が混ざっていない
for (const file of ['data/2026-27/schedule.json', 'data/2026-27/one/schedule.json']) {
  if (fs.existsSync(file)) { const t = fs.readFileSync(file, 'utf8'); assert(!t.includes('easl:'), `${file} にEASLの試合が入っている`); assert(!t.includes('cup:M') && !t.includes('zennihon'), `${file} に天皇杯の試合が入っている`); }
}
for (const file of ['games-summary.json.gz', 'teams.json.gz', 'players.json.gz', 'standings-history.json.gz', 'playoff-race.json.gz']) {
  const full = path.join('data/2026-27', file);
  if (!fs.existsSync(full)) continue; // 導出データは build:data のあとだけある
  const text = zlib.gunzipSync(fs.readFileSync(full)).toString('utf8');
  assert(!/easl/i.test(text), `${full} にEASLの試合が入っている`);
  assert(!/cup:M|zennihon/.test(text), `${full} に天皇杯の試合が入っている`);
}
// --- 天皇杯（設計書385章）: 公式サイトの読み取り・勝ち上がりの予定・置き換え・保存した日程の整合 ---
{
  const side = (code: string): CupNode['home'] => ({ from: code });
  const team = (name: string, tag?: string, score?: number): CupNode['home'] => ({ club: resolveCupClub(name, tag), ...(score !== undefined ? { score } : {}) });
  const node = (code: string, round: string, date: string, home: CupNode['home'], away: CupNode['home'], status: CupNode['status'] = 'upcoming'): CupNode =>
    ({ code, stage: 'final', round, date, tipoff: '11:00', venue: '国立代々木競技場第一体育館', status, home, away, link: 'https://example.com/schedule/final/' });
  // 名前の解決: 正式名称・略称（札なし／B1〜B3の札）。B.LEAGUE 以外は id なし。略称でも別の札（WF など）が付けば B.LEAGUE のクラブにしない
  assert.equal(resolveCupClub('長崎ヴェルカ').id, '2488');
  assert.equal(resolveCupClub('長崎', 'B1①').id, '2488');
  assert.equal(resolveCupClub('A東京').id, '706');
  assert.equal(resolveCupClub('千葉J', 'B1③').id, '704');
  assert.equal(resolveCupClub('横浜EX', 'B3①').id, '714');
  assert.equal(resolveCupClub('山形', '東北').id, undefined);
  assert.equal(resolveCupClub('山形クベーラ', '東北').id, undefined);
  assert.equal(resolveCupClub('東海ブロック代表', '東海').id, undefined);

  // 小さな組み合わせ表（長崎 vs M1勝者 → 準々決勝 M3 ← M2〔群馬 vs M0の勝者〕）で、予定の行・置き換え・消えるを確かめる
  const m1 = node('M1', '1回戦', '2027-01-05', team('東海ブロック代表', '東海'), team('徳島クラブ', '四国'));
  const m2 = node('M2', '2回戦', '2027-01-06', side('M1'), team('群馬', 'B1⑦'));
  const m4 = node('M4', '2回戦', '2027-01-06', team('長崎', 'B1①'), team('宇都宮', 'B1⑤'));
  const m3 = node('M3', '準決勝', '2027-01-08', side('M2'), side('M4'));
  const rows = buildCupGames([m1, m2, m4, m3]);
  const byId = new Map(rows.map(r => [r.id, r]));
  assert(!byId.has('cup:M1'), 'B.LEAGUE のクラブが出ない試合は出さない');
  // M2: 群馬（決まっている）と M1の勝者。M1 に B クラブはいないので予定の行は無く、群馬の行だけ。相手は説明文
  assert.equal(byId.get('cup:M2:713')?.away.name, '群馬クレインサンダーズ');
  assert.equal(byId.get('cup:M2:713')?.home.name, 'M1（東海ブロック代表 vs 徳島クラブ）の勝者');
  assert.equal(byId.get('cup:M2:713')?.home.placeholder, true);
  assert.equal(byId.get('cup:M2:713')?.projected, undefined);
  // M4: 両方決まっている → 1行（決まった試合）
  assert(byId.has('cup:M4') && !byId.get('cup:M4')!.projected);
  // M3: 群馬・長崎・宇都宮が勝ち上がった場合の3行。相手は「M4（長崎 vs 宇都宮）の勝者」のように、どの試合の勝者かが分かる
  const m3Rows = rows.filter(r => r.matchCode === 'M3');
  assert.deepEqual(m3Rows.map(r => r.id).sort(), ['cup:M3:2488', 'cup:M3:703', 'cup:M3:713']);
  assert(m3Rows.every(r => r.projected && r.round === '準決勝' && r.date === '2027-01-08' && r.tipoff === '11:00' && r.venue && r.link));
  assert.equal(byId.get('cup:M3:713')!.away.name, 'M4（長崎ヴェルカ vs 宇都宮ブレックス）の勝者');
  assert.equal(byId.get('cup:M3:2488')!.home.name, 'M2（M1の勝者 vs 群馬クレインサンダーズ）の勝者');
  assert.equal(byId.get('cup:M3:2488')!.home.placeholder, true);
  assert.equal(calendarResult(byId.get('cup:M3:713')!, true), '');
  // 結果が出る（M4 は長崎が勝った）: 公式の表が書き換わり、M3 の片側が長崎に決まる → 長崎の行は予定でなくなり、宇都宮の予定は消える
  const m4done = node('M4', '2回戦', '2027-01-06', team('長崎', 'B1①', 80), team('宇都宮', 'B1⑤', 70), 'final');
  const m3next = node('M3', '準決勝', '2027-01-08', side('M2'), team('長崎'));
  const after = buildCupGames([m1, m2, m4done, m3next]);
  const m4Row = after.find(r => r.id === 'cup:M4')!;
  assert.equal(m4Row.status, 'final');
  assert.equal(`${m4Row.homeScore}-${m4Row.awayScore}`, '80-70');
  assert.equal(calendarResult(m4Row, true), '○');
  assert(!after.some(r => r.id === 'cup:M3:703'), '負けたクラブの予定は消える');
  assert.equal(after.find(r => r.id === 'cup:M3:2488')?.projected, undefined, '決まった長崎の準決勝は予定ではない');
  assert.equal(after.find(r => r.id === 'cup:M3:2488')?.away.name, '長崎ヴェルカ');
  assert.equal(after.find(r => r.id === 'cup:M3:2488')?.home.name, 'M2（M1の勝者 vs 群馬クレインサンダーズ）の勝者');
  assert.equal(after.find(r => r.id === 'cup:M3:713')?.projected, true, '群馬の予定は残る');
  assert.equal(after.find(r => r.id === 'cup:M3:713')?.away.name, '長崎ヴェルカ', '相手は決まった長崎に置き換わる');
  // 同じ入力なら同じ結果、行のIDは重ならない
  assert.deepEqual(buildCupGames([m1, m2, m4, m3]), rows);
  assert.equal(new Set(after.map(r => r.id)).size, after.length);
  // 30分おきの更新は、予定の試合を含む試合のある日だけ
  assert(cupDates(rows).has('2027-01-08') && !cupDates(rows).has('2027-01-07'));

  // 公式サイトの形（組み合わせ表の planned / 終わった試合）の読み取り
  const plannedHtml = '<section aria-labelledby="bk-final-male"><h2 id="bk-final-male">天皇杯 ファイナルラウンド</h2>'
    + '<div data-bracket-node="M9"><span class="sr-only">2回戦<!-- --> </span><span class="flex truncate">M9<!-- -->・<!-- -->1/6<!-- --> <!-- -->11:00</span><span class="shrink-0" data-bracket-court="代々木一">代々木一</span>'
    + '<span class="bk-side"><span class="bk-name">長崎</span><span class="tag">B1①</span><span class="score--mark score--mark-home">HOME</span></span>'
    + '<span class="bk-side"><span class="bk-name">M1 の勝者</span><span class="score--mark score--mark-away">AWAY</span></span></div></section>'
    + '<section><h2>皇后杯 ファイナルラウンド</h2><div data-bracket-node="W9"><span class="sr-only">2回戦</span><span class="truncate">W9・1/5 12:00</span><span class="bk-side"><span class="bk-name">富士通</span></span><span class="bk-side"><span class="bk-name">W1 の勝者</span></span></div></section>';
  const planned = parseCupBracket(plannedHtml, '2026-27');
  assert.equal(planned.length, 1, '皇后杯は読まない');
  assert.deepEqual([planned[0]!.code, planned[0]!.date, planned[0]!.tipoff, planned[0]!.venue, planned[0]!.status], ['M9', '2027-01-06', '11:00', '国立代々木競技場第一体育館', 'upcoming']);
  assert.equal(planned[0]!.home.club?.id, '2488');
  assert.equal(planned[0]!.away.from, 'M1');
  const doneHtml = '<section><h2>天皇杯 ファイナルラウンド</h2><a data-bracket-node="M9" href="/2026-27/games/gp-1/"><span class="sr-only">2回戦</span><span class="truncate">M9・1/7（水）</span><span class="shrink-0">確定</span>'
    + '<span class="bk-side is-winner"><span class="bk-name">群馬</span><span class="score"><span class="score__value">94</span></span></span><span class="bk-side is-loser"><span class="bk-name">リンタツ</span><span class="score"><span class="score__value">59</span></span></span></a></section>';
  const done = parseCupBracket(doneHtml, '2025-26')[0]!;
  assert.deepEqual([done.date, done.status, done.home.score, done.away.score, done.link], ['2026-01-07', 'final', 94, 59, 'https://zennihon.japanbasketball.jp/2026-27/games/gp-1/'.replace('2026-27', '2026-27')]);
  // 1R・2R の日程は B.LEAGUE のクラブが出る試合だけ取る（皇后杯・B.LEAGUE 以外だけの試合は取らない）
  const stageHtml = '<h2>11/22（日）<span>3 試合</span></h2>'
    + '<article data-game-id="gp-1"><div><span>3回戦</span><span>09:00<!-- -->・延岡アリーナA</span><span>天皇杯</span><span data-live-badge="">予定</span></div><div data-side="home"><span class="truncate">宇都宮ブレックス</span></div><div data-side="away"><span class="truncate">MT10の勝者</span></div></article>'
    + '<article data-game-id="gp-2"><div><span>3回戦</span><span>09:00・延岡アリーナC</span><span>天皇杯</span><span data-live-badge="">予定</span></div><div data-side="home"><span class="truncate">白鷗大学</span></div><div data-side="away"><span class="truncate">MT12の勝者</span></div></article>'
    + '<article data-game-id="gp-3"><div><span>3回戦</span><span>09:00・延岡アリーナA</span><span>皇后杯</span><span data-live-badge="">予定</span></div><div data-side="home"><span class="truncate">宇都宮ブレックス</span></div><div data-side="away"><span class="truncate">MW10の勝者</span></div></article>';
  const stage = parseCupStagePage(stageHtml, '2026-27', 'r2');
  assert.equal(stage.cards, 2);
  assert.equal(stage.nodes.length, 1);
  assert.deepEqual([stage.nodes[0]!.date, stage.nodes[0]!.tipoff, stage.nodes[0]!.venue, stage.nodes[0]!.round], ['2026-11-22', '09:00', '延岡アリーナA', '3回戦']);
  const stageRows = buildCupGames(stage.nodes);
  assert.equal(stageRows.length, 1);
  assert.equal(stageRows[0]!.away.name, 'MT10の勝者');

  // 保存した日程
  const cup = current.games.filter(g => g.competition === 'cup');
  assert(cup.length > 0, '天皇杯の試合が保存されていない');
  assert.equal(new Set(cup.map(g => g.id)).size, cup.length);
  assert(!current.games.filter(g => g.competition !== 'cup').some(g => g.id.startsWith('cup:')));
  const fr = cup.filter(g => g.cupStage === 'final');
  assert(fr.every(g => /^cup:M\d+(:\d+)?$/.test(g.id) && g.matchCode && g.round && g.link?.startsWith('https://zennihon.japanbasketball.jp/')), '天皇杯の行にコード・回戦・公式サイトのリンクが無い');
  for (const g of cup) {
    assert(g.home.id || g.away.id, `B.LEAGUE のクラブが出ない天皇杯の試合: ${g.id}`);
    assert(!(g.home.placeholder && g.away.placeholder));
    if (g.projected) assert.equal(g.status, 'upcoming');
    if (g.status === 'final') assert(g.homeScore !== undefined && g.awayScore !== undefined);
  }
  for (const g of cup.filter(g => g.projected)) {
    assert(g.id.split(':').length === 3, `予定の行のIDにクラブが無い: ${g.id}`);
    assert([g.home.id, g.away.id].includes(g.id.split(':')[2]), `予定の行のクラブがIDと合わない: ${g.id}`);
  }
  // 日程の「勝敗の印」は付けない（日程タブは得点だけ）。年間スケジュールの勝敗は終わった試合だけ
  for (const g of cup.filter(g => g.status !== 'final')) assert.equal(calendarResult(g, true), g.status === 'live' ? '試合中' : g.status === 'cancelled' ? '中止' : '');
}

console.log('年間スケジュール: 重複・結果のみ・試合中・閏日・UTC→JST・日英チーム名・EASL18試合・天皇杯の読み取り／勝ち上がりの予定／置き換え／B.LEAGUEの集計に入っていないことの整合を確認');
