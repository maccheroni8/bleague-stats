import type { CalendarClub, CalendarGame } from '../../shared/annualSchedule.ts';

const JAPAN: Record<string, CalendarClub> = {
  'Alvark Tokyo': { id: '706', name: 'アルバルク東京' },
  'Nagasaki Velca': { id: '2488', name: '長崎ヴェルカ' },
  'Ryukyu Golden Kings': { id: '701', name: '琉球ゴールデンキングス' },
  'Utsunomiya Brex': { id: '703', name: '宇都宮ブレックス' },
  'Chiba Jets': { id: '704', name: '千葉ジェッツ' },
};
for (const club of Object.values(JAPAN)) JAPAN[club.name] = club;
interface Competitor { isHome: boolean; nameFullLatin?: string; nameFullLocal?: string; codeLatin?: string; codeLocal?: string; score?: string | number | null }
interface Match { fixtureId: string; startTimeUTC: string; status: string; competitors: Competitor[]; venue?: { nameLocal?: string; nameLatin?: string }; stage?: { nameLocal?: string } }
export function parseEaslMatches(input: unknown, season: string): CalendarGame[] {
  if (!Array.isArray(input)) throw new Error('EASLの応答が配列ではありません');
  const games: CalendarGame[] = [];
  for (const raw of input) {
    const g = raw as Match;
    if (!g.fixtureId || !Array.isArray(g.competitors) || !g.startTimeUTC) throw new Error('EASLの日程の形式が変わりました');
    const named = g.competitors.map(t => ({ ...t, nameFullLatin: t.nameFullLatin || t.nameFullLocal || '' }));
    const home = named.find(t => t.isHome);
    const away = named.find(t => !t.isHome);
    if (!home?.nameFullLatin || !away?.nameFullLatin) throw new Error('EASLの対戦相手が不明です');
    if (!JAPAN[home.nameFullLatin] && !JAPAN[away.nameFullLatin]) continue;
    // 公式ページと同じく、タイムゾーン表記がない日時はUTCとして扱う。
    const utc = /(?:Z|[+-]\d\d:\d\d)$/.test(g.startTimeUTC) ? g.startTimeUTC : `${g.startTimeUTC}Z`;
    const ms = Date.parse(utc);
    if (!Number.isFinite(ms)) throw new Error('EASLの日付を解釈できません');
    const jst = new Date(ms + 9 * 3600000).toISOString();
    const year = Number(season.slice(0, 4));
    if (jst.slice(0,10) < `${year}-07-01` || jst.slice(0,10) >= `${year+1}-07-01`) throw new Error('EASLのシーズンと日付が一致しません');
    const score = (v: unknown): number | undefined => v !== null && v !== undefined && v !== '' && Number.isInteger(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
    const hs = score(home.score), as = score(away.score);
    const status = ['CONFIRMED','COMPLETE','COMPLETED','FINISHED','FINAL'].includes(g.status) && hs !== undefined && as !== undefined ? 'final' : /CANCEL/i.test(g.status) ? 'cancelled' : /LIVE|IN_PROGRESS/i.test(g.status) ? 'live' : 'upcoming';
    const club = (t: Competitor): CalendarClub => JAPAN[t.nameFullLatin ?? ''] ?? { name: t.nameFullLatin || t.nameFullLocal || '未定', shortName: t.codeLatin || t.codeLocal };
    games.push({ id: `easl:${g.fixtureId}`, competition: 'easl', date: jst.slice(0,10), tipoff: jst.slice(11,16), home: club(home), away: club(away), status,
      ...(status === 'final' || status === 'live' ? { homeScore: hs, awayScore: as } : {}),
      // 決勝大会は中立開催。グループステージだけホーム／アウェーとして扱う。
      neutral: g.stage?.nameLocal !== 'Group Stage', venue: g.venue?.nameLatin || g.venue?.nameLocal,
      source: 'https://www.easl.basketball/schedule-results' });
  }
  return games.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
