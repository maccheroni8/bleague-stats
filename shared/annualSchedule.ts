/** 年間カレンダー専用。リーグの順位・スタッツの集計には渡さない。 */
export interface CalendarClub {
  id?: string;
  name: string;
  shortName?: string;
  /** EASL公式のチームID。海外クラブのロゴ（data/logos/easl/{easlTeamId}.png）の鍵 */
  easlTeamId?: string;
  /** EASL公式のチームカラー（#なし6桁）。ロゴが無いときの札の色 */
  color?: string;
  /** 天皇杯: まだ決まっていない相手（「M10（M2の勝者 vs 群馬）の勝者」のような説明文）。クラブではない */
  placeholder?: boolean;
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
  /** EASL公式の試合ページ（日程タブから新しいタブで開く）。見つからなければ公式の日程ページ */
  link?: string;
  note?: string;
  /** 天皇杯: 回戦の名前（1回戦・2回戦・準々決勝・準決勝・決勝など。公式の表記） */
  round?: string;
  /** 天皇杯: 公式の試合番号（ファイナルラウンドは M1〜M23。それ以外は公式の試合ID） */
  matchCode?: string;
  /** 天皇杯: 取得したラウンド（1R=r1・2R=r2・ファイナルラウンド=final） */
  cupStage?: 'r1' | 'r2' | 'final';
  /** 天皇杯: 前の試合に勝ち上がった場合の予定の試合（まだ決まっていない）。決まった試合とは別の行 */
  projected?: boolean;
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
  /** 天皇杯の日程・結果に変更があった時点（取得して変わったときだけ書き換える） */
  cupUpdatedAt?: string;
  notes: string[];
}
export interface AnnualCalendarFile {
  version: 1;
  seasons: Record<string, AnnualCalendarSeason>;
}
