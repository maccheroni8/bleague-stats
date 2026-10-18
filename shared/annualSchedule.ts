/** 年間カレンダー専用。リーグの順位・スタッツの集計には渡さない。 */
export interface CalendarClub {
  id?: string;
  name: string;
  shortName?: string;
}
export interface CalendarGame {
  id: string;
  date: string;
  competition: 'league' | 'easl' | 'cup';
  home: CalendarClub;
  away: CalendarClub;
  status: 'upcoming' | 'live' | 'final' | 'cancelled';
  homeScore?: number;
  awayScore?: number;
  neutral?: boolean;
  tipoff?: string;
  venue?: string;
  gameLink?: string;
  source?: string;
  note?: string;
}
export interface CalendarEvent {
  id: string;
  start: string;
  end: string;
  label: string;
  competition: 'cup' | 'allstar';
  source: string;
  note?: string;
}
export interface AnnualCalendarSeason {
  /** 公式発表のFINALS最終戦予定日（対戦カードが未定でも保持）。 */
  finalsEnd?: string;
  finalsSource?: string;
  events: CalendarEvent[];
  games: CalendarGame[];
  /** 日程・結果に変更があった時点。毎日の取得だけでは書き換えない。 */
  easlUpdatedAt?: string;
  notes: string[];
}
export interface AnnualCalendarFile {
  version: 1;
  seasons: Record<string, AnnualCalendarSeason>;
}
