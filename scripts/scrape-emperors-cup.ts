// 天皇杯の日程・結果の取得（大会日程専用。設計書385章）。公式サイト https://zennihon.japanbasketball.jp/{シーズン}/ の
// 組み合わせ表（ファイナルラウンド）と日程（1R・2R）を読み、data/annual-calendar.json の competition: 'cup' の行を作り直す。
//   node --experimental-strip-types scripts/scrape-emperors-cup.ts --season 2026-27 [--cup-days-only] [--today YYYY-MM-DD]
// --cup-days-only: 30分おきの更新用。天皇杯の試合がある日（予定の試合を含む）だけ公式サイトに問い合わせる（無い日は何もしない）。
// 取れなかったページは前に取れた行を残す（画面が空にならない）。最後に失敗があれば終了コード1で通知する。
import fs from 'node:fs';
import { createThrottledFetch } from './lib/throttle.ts';
import { CUP_ORIGIN, CUP_PAGES, parseCupBracket, parseCupStagePage } from './lib/emperorsCup.ts';
import { buildCupGames, cupDates, type CupNode } from '../shared/emperorsCup.ts';
import type { AnnualCalendarFile, CalendarGame } from '../shared/annualSchedule.ts';

type Stage = 'r1' | 'r2' | 'final';
const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const season = opt('--season');
if (!season || !/^\d{4}-\d{2}$/.test(season)) throw new Error('--season YYYY-YY が必要です');
const cupDaysOnly = args.includes('--cup-days-only');
const today = opt('--today') ?? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const file = 'data/annual-calendar.json';

function emit(changed: boolean) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
}

const data: AnnualCalendarFile = JSON.parse(fs.readFileSync(file, 'utf8'));
const previous = data.seasons[season] ?? { games: [], events: [], notes: [] };
const before = previous.games.filter(g => g.competition === 'cup');

// 30分おき: 天皇杯の試合がある日だけ。その日のラウンドのページだけ取る
let stages: Stage[] = ['final', 'r1', 'r2'];
if (cupDaysOnly) {
  const todays = before.filter(g => g.date === today);
  if (!cupDates(before).has(today)) { console.log(`天皇杯の試合がない日（${today}）のため、問い合わせません`); emit(false); process.exit(0); }
  stages = [...new Set(todays.map(g => g.cupStage ?? 'final'))];
}

const fetcher = createThrottledFetch(3000, 'bleague-stats (personal use)');
async function page(stage: Stage): Promise<string> {
  const response = await fetcher(`${CUP_ORIGIN}/${season}/${CUP_PAGES[stage]}`);
  if (!response.ok) throw new Error(`${response.status}: ${stage}`);
  return response.text();
}
// 終わった試合は公式の組み合わせ表に時刻・会場が載らないので、前に取れた値を引き継ぐ
const keep = new Map(before.map(g => [`${g.cupStage}:${g.matchCode}`, g]));
function inherit(nodes: CupNode[]): CupNode[] {
  return nodes.map(n => {
    const old = keep.get(`${n.stage}:${n.code}`);
    return { ...n, tipoff: n.tipoff ?? old?.tipoff, venue: n.venue ?? old?.venue };
  }).map(n => JSON.parse(JSON.stringify(n)) as CupNode);
}

const failures: string[] = [];
const next: CalendarGame[] = [];
for (const stage of ['final', 'r1', 'r2'] as const) {
  const old = before.filter(g => (g.cupStage ?? 'final') === stage);
  if (!stages.includes(stage)) { next.push(...old); continue; }
  try {
    const html = await page(stage);
    let games: CalendarGame[];
    if (stage === 'final') {
      const nodes = parseCupBracket(html, season);
      if (nodes.length < 20) throw new Error(`組み合わせ表の試合が${nodes.length}件しか読めません（形式の変更の疑い）`);
      games = buildCupGames(inherit(nodes));
    } else {
      const parsed = parseCupStagePage(html, season, stage);
      if (!parsed.cards) throw new Error('日程の試合が1件も読めません（形式の変更の疑い）');
      games = buildCupGames(inherit(parsed.nodes));
    }
    // 終わった試合が消えるのは形式の変更の疑い。前の行を残す
    const missing = old.filter(g => g.status === 'final' && !g.projected && !games.some(n => n.id === g.id));
    if (missing.length) throw new Error(`終わった試合が応答から欠けました（${missing.map(g => g.id).join('、')}）`);
    next.push(...games);
    console.log(`天皇杯 ${stage}: ${games.length}行（うち勝ち上がった場合の予定 ${games.filter(g => g.projected).length}行）`);
  } catch (error) {
    failures.push(`${stage}: ${(error as Error).message}`);
    console.warn(`天皇杯 ${stage} の取得に失敗。前回の内容を残します: ${(error as Error).message}`);
    next.push(...old);
  }
}
next.sort((a, b) => a.date.localeCompare(b.date) || (a.tipoff ?? '99:99').localeCompare(b.tipoff ?? '99:99') || a.id.localeCompare(b.id, undefined, { numeric: true }));

if (JSON.stringify(before) === JSON.stringify(next)) { console.log('天皇杯の日程・結果に変更なし'); emit(false); }
else {
  data.seasons[season] = { ...previous, games: [...previous.games.filter(g => g.competition !== 'cup'), ...next], cupUpdatedAt: new Date().toISOString() };
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  console.log(`天皇杯 ${season}: ${next.length}行を更新`);
  emit(true);
}
if (failures.length) { console.error(`天皇杯の取得に失敗: ${failures.join(' / ')}`); process.exit(1); }
