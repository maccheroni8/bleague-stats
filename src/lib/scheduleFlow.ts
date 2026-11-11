// 日程の終わった試合の行に添える、両チームの最大リード・最大ラン（DESIGN.md 361章）。
// 値はチームの1試合行の索引（team-game-index。試合ログと同じ最大リード・最大ランを持つ）から、試合番号で引く。試合の流れの記録が無い試合は出さない。
// 画面だけ。このファイルを保存キーの対象のファイルから import しないこと。
import type { TeamGameIndexView } from "./gameIndex";

export interface ScheduleFlow {
  homeLead: number;
  awayLead: number;
  homeRun?: number;
  awayRun?: number;
}

export function buildScheduleFlow(view: TeamGameIndexView | null): Map<string, ScheduleFlow> {
  const out = new Map<string, ScheduleFlow>();
  if (!view) return out;
  const { games, rows } = view.file;
  const runs = (rows.stats as { maxRun?: number[] }).maxRun;
  for (let g = 0; g < games.key.length; g++) {
    const homeLead = games.homeMaxLead[g]!;
    const awayLead = games.awayMaxLead[g]!;
    if (homeLead < 0 || awayLead < 0) continue;
    const homeRun = runs?.[g * 2] ?? -1;
    const awayRun = runs?.[g * 2 + 1] ?? -1;
    out.set(games.key[g]!, {
      homeLead,
      awayLead,
      ...(homeRun >= 0 && awayRun >= 0 ? { homeRun, awayRun } : {}),
    });
  }
  return out;
}

/** 「最大リード 宇都宮 18／琉球 5」「最大ラン 宇都宮 12／琉球 8」の2つ（ラン無しはリードだけ） */
export function scheduleFlowTexts(flow: ScheduleFlow, home: string, away: string): string[] {
  const texts = [`最大リード ${home} ${flow.homeLead}／${away} ${flow.awayLead}`];
  if (flow.homeRun !== undefined && flow.awayRun !== undefined) texts.push(`最大ラン ${home} ${flow.homeRun}／${away} ${flow.awayRun}`);
  return texts;
}
