// 天皇杯（全日本バスケットボール選手権）の大会日程専用。B.LEAGUE の成績・順位・ランキング・図解・スタッツには渡さない（設計書385章）。
// 公式の組み合わせ表（ブラケット）の試合（CupNode）から、日程タブ・年間スケジュールに出す行（CalendarGame）を作る純粋な関数。
import type { CalendarClub, CalendarGame } from './annualSchedule.ts';

/** 試合の片方。クラブが決まっている（club）か、前の試合の勝者待ち（from＝前の試合の番号。例 "M17"） */
export interface CupSide {
  club?: CalendarClub;
  from?: string;
  score?: number;
}
export interface CupNode {
  /** ファイナルラウンドは公式の試合番号（M1〜M23）。1R・2R の試合は公式の試合ID */
  code: string;
  stage: 'r1' | 'r2' | 'final';
  /** 公式の回戦の表記（1回戦・2回戦・準々決勝・準決勝・決勝など） */
  round: string;
  date: string;
  tipoff?: string;
  venue?: string;
  status: CalendarGame['status'];
  home: CupSide;
  away: CupSide;
  link?: string;
}

/** 相手がまだ決まっていないときの書き方。例「M10（M2の勝者 vs 群馬宇都宮…）の勝者」 */
function shallow(side: CupSide): string {
  return side.club ? side.club.name : `${side.from}の勝者`;
}
function pendingText(side: CupSide, byCode: Map<string, CupNode>): string {
  if (side.club) return side.club.name;
  const feeder = side.from ? byCode.get(side.from) : undefined;
  if (!feeder) return `${side.from}の勝者`;
  return `${feeder.code}（${shallow(feeder.home)} vs ${shallow(feeder.away)}）の勝者`;
}

/** その側に出てくる可能性のある B.PREMIER／B.ONE のクラブ（決まっていれば本人。勝者待ちなら前の試合の両側から） */
function candidates(side: CupSide, byCode: Map<string, CupNode>, seen = new Set<string>()): CalendarClub[] {
  if (side.club) return side.club.id ? [side.club] : [];
  const feeder = side.from ? byCode.get(side.from) : undefined;
  if (!feeder || seen.has(feeder.code)) return [];
  seen.add(feeder.code);
  const out = new Map<string, CalendarClub>();
  for (const c of [...candidates(feeder.home, byCode, seen), ...candidates(feeder.away, byCode, seen)]) out.set(c.id!, c);
  return [...out.values()];
}

/**
 * 公式の試合の一覧から、画面に出す行を作る。
 * - 両側のクラブが決まっている試合は1行（決まった試合）。B.PREMIER／B.ONE のクラブが出る試合だけ。
 * - 片側または両側が「◯◯の勝者」の試合は、その側に出てくる可能性のあるクラブごとに1行（projected＝勝ち上がった場合の予定）。
 *   相手が決まっていればそのクラブ、決まっていなければ「M22（M19の勝者 vs M20の勝者）の勝者」のような説明文（placeholder）。
 *   片側のクラブがすでに決まっていて相手が勝者待ちのときは、決まっているクラブの行（projected なし）も1行出す。
 * 勝ち上がりが決まれば公式の表が書き換わるので、次に作り直したとき自然に決まった試合に置き換わり、負けたクラブの予定は消える。
 */
export function buildCupGames(nodes: CupNode[]): CalendarGame[] {
  const byCode = new Map(nodes.map(n => [n.code, n]));
  const rows: CalendarGame[] = [];
  for (const n of nodes) {
    const base = {
      competition: 'cup' as const, date: n.date, ...(n.tipoff ? { tipoff: n.tipoff } : {}), ...(n.venue ? { venue: n.venue } : {}),
      neutral: true, source: n.link, link: n.link, round: n.round, matchCode: n.code, cupStage: n.stage,
    };
    const placeholder = (side: CupSide): CalendarClub => side.club ?? { name: pendingText(side, byCode), placeholder: true };
    if (n.home.club && n.away.club) {
      if (!n.home.club.id && !n.away.club.id) continue;
      const scored = n.status === 'final' || n.status === 'live';
      rows.push({ ...base, id: `cup:${n.code}`, home: n.home.club, away: n.away.club, status: n.status,
        ...(scored ? { homeScore: n.home.score, awayScore: n.away.score } : {}) });
      continue;
    }
    const sides = [n.home, n.away] as const;
    for (const i of [0, 1] as const) {
      const mine = sides[i];
      const other = sides[1 - i as 0 | 1];
      const make = (club: CalendarClub, projected: boolean): CalendarGame => {
        const opp = placeholder(other);
        return { ...base, id: `cup:${n.code}:${club.id}`, home: i === 0 ? club : opp, away: i === 0 ? opp : club, status: 'upcoming' as const,
          ...(projected ? { projected: true } : {}) };
      };
      if (mine.club) { if (mine.club.id) rows.push(make(mine.club, false)); continue; }
      for (const c of candidates(mine, byCode)) rows.push(make(c, true));
    }
  }
  // 同じ試合が重ならないように（勝者待ちの両側に同じクラブが出ることはないが、念のため）
  const unique = new Map(rows.map(r => [r.id, r]));
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.tipoff ?? '99:99').localeCompare(b.tipoff ?? '99:99') || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** 天皇杯の試合がある日（予定の試合を含む）。30分おきの更新はこの日だけ公式サイトに問い合わせる */
export function cupDates(games: CalendarGame[]): Set<string> {
  return new Set(games.filter(g => g.competition === 'cup').map(g => g.date));
}
