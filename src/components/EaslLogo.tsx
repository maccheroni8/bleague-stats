import { useState } from 'react';
import type { CalendarClub } from '../../shared/annualSchedule';
import { ResponsiveTeamName } from './ResponsiveTeamName';
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
