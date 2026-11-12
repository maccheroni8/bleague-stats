import type { CalendarClub, CalendarGame } from '../../shared/annualSchedule.ts';

export const EASL_SCHEDULE_URL = 'https://www.easl.basketball/schedule-results';
const EASL_ORIGIN = 'https://www.easl.basketball';
const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
/** 公式の試合ページのURL末尾の日時（会場の現地時間。例 oct142026071000pm）。時の0埋めがあるものとないものがある */
function localTimeTags(local: string | undefined): string[] {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(local ?? '');
  if (!m) return [];
  const [, y, mo, d, h, mi] = m;
  const hour = Number(h);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const base = `${MONTHS[Number(mo) - 1]}${Number(d)}${y}`;
  return [...new Set([`${base}${String(h12).padStart(2, '0')}${mi}00${suffix}`, `${base}${h12}${mi}00${suffix}`])];
}
/** 公式の日程ページのHTMLから、試合ページへのリンク（/schedules/…）を集める */
export function easlLinkSlugs(html: string): string[] {
  return [...new Set([...html.matchAll(/href="\/(?:[a-z]{2}\/)?schedules\/([A-Za-z0-9-]+)"/g)].map(m => m[1]!.toLowerCase()))];
}
/** 試合の日時と日本のクラブ名でリンクを選ぶ。見つからなければ公式の日程ページ */
function easlGameLink(g: Match, home: Competitor, away: Competitor, slugs: string[]): string {
  const tags = localTimeTags(g.startTimeLocal);
  // 公式のページ名は英語表記。日本のクラブ側の名前（API では日本語のことがある）で選ぶ
  const names = [home, away].map(t => JAPAN[t.nameFullLatin ?? '']?.id).filter((id): id is string => !!id).map(id => JAPAN_SLUG[id]!);
  const hits = slugs.filter(s => tags.some(tag => s === `-${tag}` || s.includes(`-${tag}`)) && names.some(n => s.includes(n)));
  const best = hits.sort((a, b) => a.length - b.length)[0];
  return best ? `${EASL_ORIGIN}/schedules/${best}` : EASL_SCHEDULE_URL;
}
/** 取得したチームのロゴの取り先（EASL公式の試合データが持つロゴのURL）。日本のクラブは自前のロゴがあるので含めない */
export function easlLogoSources(input: unknown[]): Map<string, { name: string; url: string }> {
  const out = new Map<string, { name: string; url: string }>();
  for (const raw of input) for (const t of (raw as Match).competitors ?? []) {
    const name = t.nameFullLatin || t.nameFullLocal || '';
    if (!t.teamId || !t.logo || !name || JAPAN[name]) continue;
    out.set(t.teamId, { name, url: t.logo });
  }
  return out;
}
const JAPAN_SLUG: Record<string, string> = { '706': 'alvarktokyo', '2488': 'nagasakivelca', '701': 'ryukyugoldenkings', '703': 'utsunomiyabrex', '704': 'chibajets' };
const JAPAN: Record<string, CalendarClub> = {
  'Alvark Tokyo': { id: '706', name: 'アルバルク東京' },
  'Nagasaki Velca': { id: '2488', name: '長崎ヴェルカ' },
  'Ryukyu Golden Kings': { id: '701', name: '琉球ゴールデンキングス' },
  'Utsunomiya Brex': { id: '703', name: '宇都宮ブレックス' },
  'Chiba Jets': { id: '704', name: '千葉ジェッツ' },
};
for (const club of Object.values(JAPAN)) JAPAN[club.name] = club;
interface Competitor { isHome: boolean; teamId?: string; primaryColor?: string; logo?: string; nameFullLatin?: string; nameFullLocal?: string; codeLatin?: string; codeLocal?: string; score?: string | number | null }
interface Match { fixtureId: string; startTimeLocal?: string; startTimeUTC: string; status: string; competitors: Competitor[]; venue?: { nameLocal?: string; nameLatin?: string }; stage?: { nameLocal?: string } }
export function parseEaslMatches(input: unknown, season: string, links: string[] = []): CalendarGame[] {
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
    const club = (t: Competitor): CalendarClub => JAPAN[t.nameFullLatin ?? ''] ?? {
      name: t.nameFullLatin || t.nameFullLocal || '未定', shortName: t.codeLatin || t.codeLocal,
      ...(t.teamId ? { easlTeamId: t.teamId } : {}), ...(/^[0-9a-f]{6}$/i.test(t.primaryColor ?? '') ? { color: t.primaryColor!.toLowerCase() } : {}),
    };
    games.push({ id: `easl:${g.fixtureId}`, competition: 'easl', date: jst.slice(0,10), tipoff: jst.slice(11,16), home: club(home), away: club(away), status,
      ...(status === 'final' || status === 'live' ? { homeScore: hs, awayScore: as } : {}),
      // 決勝大会は中立開催。グループステージだけホーム／アウェーとして扱う。
      neutral: g.stage?.nameLocal !== 'Group Stage', venue: g.venue?.nameLatin || g.venue?.nameLocal,
      source: EASL_SCHEDULE_URL, link: easlGameLink(g, home, away, links) });
  }
  return games.sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
