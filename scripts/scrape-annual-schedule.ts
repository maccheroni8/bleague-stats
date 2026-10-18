// 年間カレンダー専用のEASL日程・結果。公式サイトが使用する公開APIを直列に取得。
// 天皇杯・オールスターの大会期間は公式発表を確認してannual-calendar.jsonに記録する。
import fs from 'node:fs';
import { load } from 'cheerio';
import { createThrottledFetch } from './lib/throttle.ts';
import { parseEaslMatches } from './lib/easlSchedule.ts';
import type { AnnualCalendarFile } from '../shared/annualSchedule.ts';

const args = process.argv.slice(2);
const season = args[args.indexOf('--season') + 1];
if (!args.includes('--season') || !season || !/^\d{4}-\d{2}$/.test(season)) throw new Error('--season YYYY-YY が必要です');
const file = 'data/annual-calendar.json';
const data: AnnualCalendarFile = JSON.parse(fs.readFileSync(file, 'utf8'));
const fetcher = createThrottledFetch(3000, 'bleague-stats (personal use)');
async function get(url: string) {
  const response = await fetcher(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response;
}
const html = await (await get('https://www.easl.basketball/schedule-results')).text();
const $ = load(html);
const seasonId = $('#Season option').filter((_, el) => $(el).text().trim() === `EASL ${season}`).attr('value');
if (!seasonId) throw new Error(`EASL公式の日程に ${season} がありません。前回のデータを保持します`);
const all: unknown[] = [];
for (const type of ['schedule', 'results']) {
  const response: unknown = await (await get(`https://easl.joshricha.com/api/v1/matches?type=${type}&seasonId=${encodeURIComponent(seasonId)}`)).json();
  if (!Array.isArray(response)) throw new Error('EASLの応答形式が変わりました');
  all.push(...response);
}
const games = [...new Map(parseEaslMatches(all, season).map(g => [g.id, g])).values()];
if (!games.length) throw new Error('EASLの日程が0件のため前回のデータを保持します');
const previous = data.seasons[season] ?? { games: [], events: [], notes: ['天皇杯・オールスターの大会期間は未収録です。'] };
const before = previous.games.filter(g => g.competition === 'easl');
if (before.some(g => !games.some(n => n.id === g.id))) throw new Error('EASLの既存試合が応答から欠けました。削除せず前回のデータを保持します');
if (JSON.stringify(before) === JSON.stringify(games)) console.log('EASLの日程・結果に変更なし');
else {
  data.seasons[season] = { ...previous, games: [...previous.games.filter(g => g.competition !== 'easl'), ...games], easlUpdatedAt: new Date().toISOString() };
  fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(`${file}.tmp`, file);
  console.log(`EASL ${season}: ${games.length}試合を更新`);
}
