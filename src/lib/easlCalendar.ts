import type { AnnualCalendarFile, CalendarClub, CalendarGame } from '../../shared/annualSchedule';

/** 年間スケジュールと日程タブが共通で読む大会日程（EASL・天皇杯・オールスター）。B.LEAGUE の成績・順位・ランキング・図解などは読まない */
export async function fetchCalendar(): Promise<AnnualCalendarFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/annual-calendar.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('大会日程を取得できませんでした。');
  return res.json();
}

/** EASL の海外クラブのロゴ（400×400。取り先は data/logos/easl/sources.json） */
export function easlLogoUrl(easlTeamId: string): string {
  return `${import.meta.env.BASE_URL}data/logos/easl/${easlTeamId}.png`;
}

export const EASL_SCHEDULE_URL = 'https://www.easl.basketball/schedule-results';

/** EASL の試合のリンク先（EASL 公式の試合ページ。無ければ公式の日程ページ） */
export function easlGameUrl(game: CalendarGame): string {
  return game.link ?? game.source ?? EASL_SCHEDULE_URL;
}

/** 札の文字（ロゴが無いとき）。略称、無ければ名前の頭文字 */
export function clubBadgeText(club: CalendarClub): string {
  return (club.shortName ?? club.name.split(/\s+/).map(w => w[0]).join('')).slice(0, 3).toUpperCase();
}

/** 札の背景色と文字色（EASL のチームカラー。無ければ灰色。明るさで文字を白か黒に） */
export function clubBadgeColors(club: CalendarClub): { background: string; color: string } {
  const hex = club.color ?? '6b7280';
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  const light = (0.299 * r! + 0.587 * g! + 0.114 * b!) > 160;
  return { background: `#${hex}`, color: light ? '#111' : '#fff' };
}
