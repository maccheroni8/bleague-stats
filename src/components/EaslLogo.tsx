import { useState } from 'react';
import type { CalendarClub } from '../../shared/annualSchedule';
import { ResponsiveTeamName } from './ResponsiveTeamName';
import { TeamLogo } from './TeamLogo';
import { useMediaQuery } from '../lib/useMediaQuery';
import { clubBadgeColors, clubBadgeText, easlLogoUrl } from '../lib/easlCalendar';

/** EASL の海外クラブのロゴ。ロゴが無い・読めないときは、チームカラーの札（略称）にする（空白にしない） */
export function EaslLogo({ club, size = 24 }: { club: CalendarClub; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (club.easlTeamId && !failed) {
    return <img src={easlLogoUrl(club.easlTeamId)} alt="" width={size} height={size} loading="lazy" className="team-logo" onError={() => setFailed(true)} />;
  }
  return <span className="team-logo easl-badge" style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.34)), ...clubBadgeColors(club) }} aria-hidden="true">{clubBadgeText(club)}</span>;
}

/** EASL の試合の片方のクラブの名前。B.LEAGUE のクラブは通常のチーム名（スマホ幅は略称）、海外クラブはスマホ幅で略称 */
export function EaslClubName({ club }: { club: CalendarClub }) {
  const narrow = useMediaQuery('(max-width: 560px)');
  if (club.id) return <ResponsiveTeamName teamId={club.id} name={club.name} />;
  return <>{narrow ? (club.shortName ?? club.name) : club.name}</>;
}

/** 天皇杯の試合の片方。B.LEAGUE のクラブはロゴ、まだ決まっていない相手は「?」、それ以外（B3・大学など。公式サイトにロゴが無い）はチーム名の札 */
export function CupLogo({ club, size = 24 }: { club: CalendarClub; size?: number }) {
  if (club.id) return <TeamLogo teamId={club.id} size={size} />;
  const text = club.placeholder ? '?' : club.name.slice(0, 2);
  return <span className={'team-logo cup-badge' + (club.placeholder ? ' cup-badge-pending' : '')} style={{ width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.36)) }} aria-hidden="true">{text}</span>;
}

/** 天皇杯の試合の片方のクラブの名前。B.LEAGUE のクラブは通常のチーム名（スマホ幅は略称）、それ以外は公式サイトの表記、勝者待ちは説明文 */
export function CupClubName({ club }: { club: CalendarClub }) {
  if (club.id) return <ResponsiveTeamName teamId={club.id} name={club.name} />;
  return <span className={club.placeholder ? 'cup-pending-text' : undefined}>{club.name}</span>;
}
