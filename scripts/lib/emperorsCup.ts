// 天皇杯（全日本バスケットボール選手権）の公式サイト https://zennihon.japanbasketball.jp/{シーズン}/ の取得・読み取り。
// 大会日程専用（B.LEAGUE の成績・順位・ランキング・図解・スタッツには渡さない。設計書385章）。
import { load } from 'cheerio';
import { TEAM_NAMES, ONE_TEAM_NAMES } from './divisions.ts';
import { TEAM_SHORT_NAMES } from '../../shared/teamNames.ts';
import type { CalendarClub, CalendarGame } from '../../shared/annualSchedule.ts';
import type { CupNode, CupSide } from '../../shared/emperorsCup.ts';

export const CUP_ORIGIN = 'https://zennihon.japanbasketball.jp';
export const cupBase = (season: string) => `${CUP_ORIGIN}/${season}`;
/** 取得するページ。ファイナルラウンドは組み合わせ表（勝ち上がりの予定まで載っている） */
export const CUP_PAGES = { r1: 'schedule/r1/?sex=male', r2: 'schedule/r2/', final: 'bracket/final/' } as const;
/** 試合ページが無い試合の飛び先（その日の日程ページ） */
export const cupSchedulePage = (season: string, stage: 'r1' | 'r2' | 'final') => `${cupBase(season)}/schedule/${stage}/`;

const FULL = new Map<string, string>(Object.entries({ ...TEAM_NAMES, ...ONE_TEAM_NAMES }).map(([id, name]) => [name, id]));
const SHORT = new Map<string, string>(Object.entries(TEAM_SHORT_NAMES).map(([id, name]) => [name, id]));
const FULL_BY_ID: Record<string, string> = { ...TEAM_NAMES, ...ONE_TEAM_NAMES };

/** 公式の表記（正式名称・略称）から B.PREMIER／B.ONE のクラブを決める。略称は、札（B1〜B3＝リーグの順位の印、WF・WP・地区名など）が付いていないか B1〜B3 のときだけ。勝ち上がった後の行は札が付かない */
export function resolveCupClub(name: string, tag?: string): CalendarClub {
  const clean = name.replace(/\s+/g, ' ').trim();
  const id = FULL.get(clean) ?? (!tag || /^B[123]/.test(tag) ? SHORT.get(clean) : undefined);
  return id ? { id, name: FULL_BY_ID[id] ?? clean } : { name: clean };
}

function jstDate(season: string, month: number, day: number): string {
  const start = Number(season.slice(0, 4));
  const year = month >= 7 ? start : start + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
const COURTS: Record<string, string> = { '代々木一': '国立代々木競技場第一体育館', '代々木二': '国立代々木競技場第二体育館' };
function statusOf(text: string, scored: boolean): CalendarGame['status'] {
  if (/中止|延期/.test(text)) return 'cancelled';
  if (/試合中|LIVE|進行中/i.test(text)) return 'live';
  if (/確定|終了/.test(text) && scored) return 'final';
  if (scored && !/予定/.test(text)) return 'live'; // 得点が出ていて、確定でも予定でもない
  return 'upcoming';
}
const intOf = (s: string): number | undefined => /^\d+$/.test(s.trim()) ? Number(s) : undefined;

/** ファイナルラウンドの組み合わせ表（天皇杯の側だけ）。M1〜M23 の試合を返す */
export function parseCupBracket(html: string, season: string): CupNode[] {
  const $ = load(html);
  const nodes: CupNode[] = [];
  const section = $('section').filter((_, el) => $(el).find('h2').first().text().trim().startsWith('天皇杯'));
  section.find('[data-bracket-node]').each((_, el) => {
    const $n = $(el);
    const code = $n.attr('data-bracket-node')!;
    const round = $n.find('.sr-only').first().text().trim();
    const header = $n.find('span.truncate').first().text().replace(/\s+/g, ' ').trim();
    const md = /(\d{1,2})\/(\d{1,2})/.exec(header);
    if (!md) throw new Error(`天皇杯の組み合わせ表の日付を読めません: ${code}`);
    const time = /(\d{1,2}:\d{2})/.exec(header.slice(md.index + md[0].length))?.[1];
    const court = $n.find('[data-bracket-court]').first().text().trim();
    const statusText = $n.find('span.shrink-0').not('[data-bracket-court]').first().text().trim();
    const href = $n.is('a') ? $n.attr('href') : undefined;
    const sides = $n.find('.bk-side').toArray().map((s): CupSide => {
      const $s = $(s);
      const name = $s.find('.bk-name').first().text().replace(/\s+/g, ' ').trim();
      const tag = $s.find('.bk-name').first().nextAll('span').filter((_, t) => !$(t).is('.score, [class*="score--mark"]')).first().text().trim();
      const score = intOf($s.find('.score__value').first().text());
      const wait = /^(M\d+)\s*の勝者$/.exec(name);
      return wait ? { from: wait[1] } : { club: resolveCupClub(name, tag), ...(score !== undefined ? { score } : {}) };
    });
    if (sides.length !== 2) throw new Error(`天皇杯の組み合わせ表の形が変わりました: ${code}`);
    const scored = sides.every(s => s.score !== undefined);
    nodes.push({
      code, stage: 'final', round, date: jstDate(season, Number(md[1]), Number(md[2])),
      ...(time ? { tipoff: time.padStart(5, '0') } : {}), ...(court ? { venue: COURTS[court] ?? court } : {}),
      status: statusOf(statusText, scored), home: sides[0]!, away: sides[1]!,
      link: href ? `${CUP_ORIGIN}${href}` : cupSchedulePage(season, 'final'),
    });
  });
  return nodes;
}

/** 1R（都道府県）・2R（ブロック）の日程の一覧。B.PREMIER／B.ONE のクラブが出る試合だけを返す（今季は該当なし） */
export function parseCupStagePage(html: string, season: string, stage: 'r1' | 'r2'): { nodes: CupNode[]; cards: number } {
  const $ = load(html);
  const nodes: CupNode[] = [];
  let cards = 0;
  let headingDate: string | undefined;
  $('h2, h3, article').each((_, el) => {
    const $e = $(el);
    if (!$e.is('article')) {
      const m = /^(\d{1,2})\/(\d{1,2})/.exec($e.text().trim());
      if (m) headingDate = jstDate(season, Number(m[1]), Number(m[2]));
      return;
    }
    const id = $e.attr('data-game-id') ?? $e.attr('data-prefectural-id');
    if (!id) return;
    const badgeText = $e.text();
    if (stage === 'r2' && !/天皇杯/.test(badgeText)) return; // 皇后杯
    cards += 1;
    const spans = $e.children().first().children('span').toArray().map(s => $(s).text().replace(/\s+/g, ' ').trim());
    const own = spans.map(t => /^(\d{1,2})\/(\d{1,2})/.exec(t)).find(Boolean);
    const date = own ? jstDate(season, Number(own[1]), Number(own[2])) : headingDate;
    if (!date) return;
    const timeVenue = spans.find(t => /^\d{1,2}:\d{2}/.test(t));
    const [time, ...venue] = (timeVenue ?? '').split('・');
    const round = stage === 'r1' ? `${spans[0] ?? ''}予選` : (spans[0] ?? '');
    const sideEls = $e.find('[data-side]').length ? $e.find('[data-side]').toArray() : $e.find('.h-team-row').toArray();
    const sides = sideEls.map((s): CupSide => {
      const $s = $(s);
      const name = $s.find('.truncate').first().clone().children().remove().end().text().replace(/\s+/g, ' ').trim();
      const score = intOf($s.find('.score__value').first().text());
      const wait = /^([A-Z]+\d+)\s*の勝者$/.exec(name);
      return wait ? { from: wait[1] } : { club: resolveCupClub(name), ...(score !== undefined ? { score } : {}) };
    });
    if (sides.length !== 2) return;
    if (!sides.some(s => s.club?.id)) return;
    const scored = sides.every(s => s.score !== undefined);
    const href = $e.find('a[href*="/games/"]').first().attr('href');
    nodes.push({
      code: id, stage, round, date, ...(time && /^\d/.test(time) ? { tipoff: time.padStart(5, '0') } : {}), ...(venue.length ? { venue: venue.join('・') } : {}),
      status: statusOf($e.find('[data-live-badge]').first().text(), scored), home: sides[0]!, away: sides[1]!,
      link: href ? `${CUP_ORIGIN}${href}` : cupSchedulePage(season, stage),
    });
  });
  return { nodes, cards };
}
