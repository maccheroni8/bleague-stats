// TTS stage 2 prototype: pure calculation only. Not imported by the production build.
// Times are PBP game-clock differences, not exact ball-control or shot-release times.
import { chronologicalPlayByPlays } from './pbpOrder.ts';
import { TECHNICAL_FT_FOUL_CODES as TECH, UNSPORTSMANLIKE_FT_FOUL_CODES as RETAIN } from './foulCodes.ts';
import type { PlayByPlayEvent, StoredGame } from './types.ts';

export const TTS_CATEGORIES = ['score', 'deadTo', 'dreb', 'steal', 'quarter', 'other', 'oreb'] as const;
export type TtsCategory = typeof TTS_CATEGORIES[number];
export interface TtsMark { index: number; period: number; clock: string; code: number; team: string | null; text: string }
export interface TtsShot {
  team: string; period: number; start: TtsMark | null; end: TtsMark;
  category: TtsCategory | null; seconds: number | null; reason: string;
  flags: string[];
}
export interface TtsNoShot { team: string; start: TtsMark; end: TtsMark; reason: string }
export interface TtsDiagnostic { reason: string; event: TtsMark; detail?: string }
export interface TtsResult { shots: TtsShot[]; noShots: TtsNoShot[]; diagnostics: TtsDiagnostic[]; events: TtsMark[] }
export interface TtsTotal { count: number; seconds: number }
const FG = new Set([1, 2, 3, 4, 5, 6]);
const MADE = new Set([1, 3, 4]);
const TO = new Set([13, 17]);
const FT = new Set([7, 8]);
const FOUL = new Set([20, 21, 22, 23, 24, 25, 26, 91, 92, 93, 94]);
const CONTROL = new Set([...FG, ...FT, ...TO, 9, 10, 18, 19, 14, 44]);
export function ttsRemaining(clock: string, period: number): number | null {
  const m = /^(\d+):(\d{2})$/.exec(clock);
  if (!m) return null;
  const sec = Number(m[1]) * 60 + Number(m[2]);
  return Number(m[2]) < 60 && sec <= (period <= 4 ? 600 : 300) ? sec : null;
}
function mark(e: PlayByPlayEvent, index: number): TtsMark {
  return { index, period: e.Period, clock: e.RestTime, code: e.ActionCD1, team: e.TeamID, text: e.PlayText ?? '' };
}
interface Segment { team: string; start: TtsMark; category: TtsCategory; reason: string; flags: string[] }
/** Never invent a start time for an implicit change of possession. Legacy is research-only. */
export function calculateTimeToShot(game: StoredGame, options: { legacyResearch?: boolean } = {}): TtsResult {
  if (game.season < '2020-21' && !options.legacyResearch) throw new Error('TTS supports 2020-21 onward');
  const es = chronologicalPlayByPlays(game.raw.PlayByPlays ?? []);
  const events = es.map(mark);
  const result: TtsResult = { shots: [], noShots: [], diagnostics: [], events };
  const home = game.homeTeam.id, away = game.awayTeam.id;
  const opponent = (t: string) => t === home ? away : home;
  const validTeam = (t: string | null): t is string => t === home || t === away;
  const legacy = game.season < '2020-21';
  if (legacy && game.quarterScores?.home.length < 4 && es.reduce((n,e)=>Math.max(n,e.Period),0)<4) {
    // Old CS tiebreakers use two five-minute halves: do not pretend they start at 10:00.
    result.shots=events.filter(e=>FG.has(e.code)).map(end=>({team:end.team??'unknown',period:end.period,start:null,end,category:null,seconds:null,reason:'short_game_periods_unhandled',flags:[]}));
    return result;
  }
  const isDreb = (c: number) => c === 9 || c === (legacy ? 19 : 18);
  const isOreb = (c: number) => c === 10 || c === (legacy ? 18 : 19);
  const diag = (reason: string, event: TtsMark, detail?: string) => result.diagnostics.push({ reason, event, detail });
  // Pair each steal with exactly one opponent TO at the same period/clock. No nearest-time guessing.
  const pairs = new Map<number, number>();
  const pairedSteals = new Set<number>();
  for (let i = 0; i < es.length; i++) {
    const e = es[i]!;
    if (!TO.has(e.ActionCD1) || !validTeam(e.TeamID)) continue;
    const candidates: number[] = [];
    for (let j = i - 1; j >= 0 && es[j]!.Period === e.Period && es[j]!.RestTime === e.RestTime; j--) candidates.push(j);
    for (let j = i + 1; j < es.length && es[j]!.Period === e.Period && es[j]!.RestTime === e.RestTime; j++) candidates.push(j);
    const j = candidates.sort((a,b) => Math.abs(a-i)-Math.abs(b-i)).find(j => es[j]!.ActionCD1 === 14 && es[j]!.TeamID === opponent(e.TeamID!) && !pairedSteals.has(j));
    if (j !== undefined) { pairs.set(i, j); pairedSteals.add(j); }
  }
  // Some special-game feeds stamp the associated STL one second later. Match only a
  // unique, adjacent unmatched steal (<=2 seconds), with no intervening control/foul.
  for(let i=0;i<es.length;i++) {
    const e=es[i]!;if(!TO.has(e.ActionCD1)||pairs.has(i)||!validTeam(e.TeamID))continue;
    const rem=ttsRemaining(e.RestTime,e.Period);if(rem===null)continue;
    const candidates=es.map((x,j)=>({x,j})).filter(({x,j})=>x.ActionCD1===14 && !pairedSteals.has(j) && x.Period===e.Period && x.TeamID===opponent(e.TeamID!) && Math.abs((ttsRemaining(x.RestTime,x.Period)??-999)-rem)<=2 && !es.slice(Math.min(i,j)+1,Math.max(i,j)).some(y=>CONTROL.has(y.ActionCD1)||FOUL.has(y.ActionCD1)));
    if(candidates.length===1){const j=candidates[0]!.j;pairs.set(i,j);pairedSteals.add(j);diag('paired_steal_clock_offset',events[i]!,events[j]!.clock);}
  }
  const state: {segment: Segment | null} = {segment: null};
  let owner: string | null = null;
  let missingReason = 'unknown_start';
  let period = 0;
  const close = (end: TtsMark, reason: string) => {
    if (state.segment) result.noShots.push({ team: state.segment.team, start: state.segment.start, end, reason: reason==='quarter_end' && state.segment.start.clock==='0:00' ? 'zero_time_at_period_end' : reason });
    state.segment = null;
  };
  const begin = (team: string, start: TtsMark, category: TtsCategory, reason = category as string) => {
    state.segment = { team, start, category, reason, flags: [] }; owner = team; missingReason = 'unknown_start';
  };
  for (let i = 0; i < es.length; i++) {
    const e = es[i]!, m = events[i]!, c = e.ActionCD1, t = e.TeamID;
    if (e.Period !== period) {
      if (period) close({ index: i-1, period, clock: '0:00', code: 83, team: null, text: 'Q終了' }, 'quarter_end');
      period = e.Period; owner = null; missingReason = 'unknown_quarter_owner';
      // Infer only the opening controlling team, not each team's first possession.
      const first = es.slice(i).find(x => x.Period === period && validTeam(x.TeamID) && (FG.has(x.ActionCD1) || TO.has(x.ActionCD1) || x.ActionCD1 === 9 || x.ActionCD1 === 10 || x.ActionCD1 === 14 || x.ActionCD1 === 22 || x.ActionCD1 === 23));
      if (first) {
        const fc = first.ActionCD1;
        const team = fc === 9 || fc === 14 || fc === 22 ? opponent(first.TeamID!) : first.TeamID!;
        begin(team, { index: i, period, clock: period <= 4 ? '10:00' : '5:00', code: 82, team, text: 'Q開始（最初のプレーから保持チームを判定）' }, 'quarter');
      }
    }
    if (c === 83 || c === 81) { close(m, 'quarter_end'); owner = null; continue; }
    if (state.segment && (FOUL.has(c) || c === 88)) {
      const flag = c === 88 ? 'timeout' : 'foul';
      if (!state.segment.flags.includes(flag)) state.segment.flags.push(flag);
    }
    if (!validTeam(t)) {
      if (FG.has(c)) result.shots.push({team: t ?? 'unknown',period,start:null,end:m,category:null,seconds:null,reason:'unknown_team',flags:[]});
      continue;
    }
    const remaining = ttsRemaining(m.clock, period);
    if (CONTROL.has(c) && remaining === null) {
      close(m, 'invalid_clock'); owner = null; missingReason = 'invalid_clock'; diag('invalid_clock', m);
      if (FG.has(c)) result.shots.push({team:t,period,start:null,end:m,category:null,seconds:null,reason:'invalid_clock',flags:[]});
      continue;
    }
    // Do not treat a paired steal as a second possession start, even when it precedes its TO.
    if (c === 14 && pairedSteals.has(i)) continue;
    if (TO.has(c)) {
      close(m, owner === t ? 'turnover' : 'implicit_change');
      const st = pairs.get(i);
      begin(opponent(t), st === undefined ? m : events[st]!, st === undefined ? 'deadTo' : 'steal');
      if (st === undefined) {
        diag('to_without_steal', m);
        // Diagnostic only: fast-break tag before a recorded stoppage is evidence to inspect, not proof.
        let nextShot: PlayByPlayEvent | undefined;
        let stopped = e.ActionCD2===34 || /24秒/.test(e.PlayText??'') || es.some(x=>x.Period===period && x.RestTime===e.RestTime && x.ActionCD1===23);
        // Clock-stop rows often precede the TO by 1–2 seconds in this feed.
        for (let j=i-1;j>=0 && es[j]!.Period===period;j--) {
          const x=es[j]!, sec=ttsRemaining(x.RestTime,period);
          if (sec===null || remaining===null || sec-remaining>3) break;
          if (x.ActionCD1===85 || x.ActionCD1===88 || FOUL.has(x.ActionCD1)) stopped=true;
        }
        const nearbySteal=es.some((x,j)=>!pairedSteals.has(j) && x.Period===period && x.ActionCD1===14 && x.TeamID===opponent(t) && x.RestTime!==m.clock && Math.abs((ttsRemaining(x.RestTime,period)??-999)-(remaining??999))<=2);
        if(nearbySteal)diag('unpaired_to_nearby_steal',m);
        for (let j=i+1;j<es.length && es[j]!.Period===period;j++) {
          const x=es[j]!;
          if ([84,85,86,87,88].includes(x.ActionCD1) || FOUL.has(x.ActionCD1)) stopped=true;
          if (FG.has(x.ActionCD1)) { nextShot=x; break; }
          if (TO.has(x.ActionCD1) || FT.has(x.ActionCD1) || x.ActionCD1===83) break;
        }
        if (nextShot?.TeamID===opponent(t) && /ファストブレイク/.test(nextShot.PlayText ?? '')) {
          diag('unpaired_to_fastbreak',m,`${nextShot.RestTime} ${nextShot.PlayText}`);
          if(!stopped)diag('unpaired_to_fastbreak_no_stop',m,`${nextShot.RestTime} ${nextShot.PlayText}`);
        }
      }
      continue;
    }
    if (c === 14) {
      close(m, 'implicit_change'); begin(t,m,'steal'); diag('steal_without_same_clock_to',m); continue;
    }
    if (isDreb(c) || isOreb(c)) {
      close(m, isDreb(c) ? 'change_without_fg' : 'rebound_before_fg');
      begin(t,m,isDreb(c)?'dreb':'oreb'); continue;
    }
    if (FG.has(c)) {
      const s: Segment | null = state.segment;
      const startSec = s ? ttsRemaining(s.start.clock,period) : null;
      const seconds = s && s.team === t && startSec !== null && remaining !== null ? startSec-remaining : null;
      const usable = seconds !== null && seconds>=0;
      result.shots.push({team:t,period,start:usable?s!.start:null,end:m,category:usable?s!.category:null,seconds:usable?seconds:null,reason:usable?s!.reason:(owner===t || owner===null ? missingReason : 'implicit_change'),flags:usable?[...s!.flags]:[]});
      if (s && s.team !== t) close(m,'implicit_change');
      state.segment=null; owner=t; missingReason='missing_rebound';
      if (MADE.has(c)) {
        const next=es.slice(i+1).find(x=>x.Period!==period || CONTROL.has(x.ActionCD1));
        const andOne=next && next.Period===period && next.RestTime===e.RestTime && FT.has(next.ActionCD1) && next.TeamID===t && next.PlayerID1===e.PlayerID1;
        if (!andOne) begin(opponent(t),m,'score','opponent_fg');
        else missingReason='awaiting_and_one';
      }
      continue;
    }
    if (FT.has(c)) {
      const block=es.filter(x=>x.Period===period && x.RestTime===e.RestTime);
      const hasTech=block.some(x=>TECH.has(x.ActionCD1));
      const hasRetain=block.some(x=>RETAIN.has(x.ActionCD1));
      const hasNormal=block.some(x=>x.ActionCD1===22 || x.ActionCD1===23);
      if ((hasTech && (hasRetain || hasNormal)) || (hasRetain && hasNormal)) {
        close(m,'ambiguous_ft'); owner=null; missingReason='ambiguous_ft'; diag('ambiguous_ft',m); continue;
      }
      if (hasTech) { diag('technical_ft_kept',m); continue; }
      if (hasRetain) {
        if (owner!==t || !state.segment) { close(m,'retained_penalty'); begin(t,m,'other','retained_penalty'); }
        diag('retained_ft',m); continue;
      }
      close(m,'free_throws'); owner=t; missingReason='awaiting_ft_rebound';
      const next=es.slice(i+1).find(x=>x.Period!==period || CONTROL.has(x.ActionCD1));
      const continues=next && next.Period===period && next.RestTime===e.RestTime && FT.has(next.ActionCD1) && next.TeamID===t && next.PlayerID1===e.PlayerID1;
      if (!continues && c===7) begin(opponent(t),m,'score','opponent_ft');
      continue;
    }
    // Explicit offensive foul without a TO is a known clock/owner change, but not a TO statistic.
    if (c===23 && !es.some(x=>x.Period===period && x.RestTime===e.RestTime && x.TeamID===t && TO.has(x.ActionCD1))) {
      close(m,'offensive_foul'); begin(opponent(t),m,'other','offensive_foul_without_to');
    }
    if (c===44) { close(m,'non_fga_score'); begin(opponent(t),m,'score','opponent_non_fga_score'); diag('non_fga_score',m); }
  }
  if (state.segment) close({index:events.length,period,clock:'0:00',code:83,team:null,text:'Q終了'},'quarter_end');
  return result;
}
export function sumTts(shots: readonly TtsShot[], team?: string, periods?: readonly number[]): Record<TtsCategory,TtsTotal> {
  const out=Object.fromEntries(TTS_CATEGORIES.map(c=>[c,{count:0,seconds:0}])) as Record<TtsCategory,TtsTotal>;
  for(const s of shots) if(s.category && s.seconds!==null && (!team||s.team===team) && (!periods||periods.includes(s.period))) { out[s.category].count++; out[s.category].seconds+=s.seconds; }
  return out;
}
