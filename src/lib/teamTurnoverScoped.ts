// 全チームスタッツ・ランキング（チーム）の Forced TOV を、選んだ条件（期間・相手・ホーム／アウェー・試合区分など）に当てはまる試合ログの合計から出す
// （DESIGN.md 339章。試合ごとの値は TeamGameLog に保存済み〔333章〕）。画面専用（保存キーの対象のファイルから import しないこと）。
import type { TeamForcedTurnovers, TeamGameLog } from "../../shared/types";
import { lacksForcedTurnoverLogs, sumForcedTurnoversFromLogs } from "./opponentSplit";

export interface ScopedTurnoverTeam {
  teamId: string;
  /** 条件に当てはまる試合の数（平均の分母。teams.json の gamesPlayed と同じ数え方） */
  games: number;
  forced: TeamForcedTurnovers;
  committed: TeamForcedTurnovers;
}

export interface ScopedTurnovers {
  teams: Map<string, ScopedTurnoverTeam>;
  /** リーグ平均: 記録のあるチームの合計 ÷ 試合のあるチーム数（teams.json の league-average と同じ作り方） */
  league: { games: number; forced: TeamForcedTurnovers; committed: TeamForcedTurnovers } | null;
}

const KEYS: (keyof TeamForcedTurnovers)[] = ["gamesWithData", "offensiveFoul", "violation24sec", "backcourtViolation", "violation5sec", "violation8sec", "otherDead", "live"];
const scale = (d: TeamForcedTurnovers, k: number): TeamForcedTurnovers => Object.fromEntries(KEYS.map((key) => [key, d[key] * k])) as unknown as TeamForcedTurnovers;
const add = (a: TeamForcedTurnovers, b: TeamForcedTurnovers): TeamForcedTurnovers => Object.fromEntries(KEYS.map((key) => [key, a[key] + b[key]])) as unknown as TeamForcedTurnovers;

/** 試合ログに試合ごとの値が無い（古いデータ）ときは null。記録が1試合も無いチームは teams に入れない */
export function scopedTurnovers(logsByTeam: ReadonlyMap<string, readonly TeamGameLog[]>): ScopedTurnovers | null {
  const teams = new Map<string, ScopedTurnoverTeam>();
  let played = 0, games = 0;
  let forcedSum: TeamForcedTurnovers | null = null, committedSum: TeamForcedTurnovers | null = null;
  for (const [teamId, logs] of logsByTeam) {
    if (lacksForcedTurnoverLogs(logs)) return null;
    if (logs.length === 0) continue;
    played++;
    games += logs.length;
    const { forced, committed } = sumForcedTurnoversFromLogs(logs);
    if (forced.gamesWithData === 0) continue;
    teams.set(teamId, { teamId, games: logs.length, forced, committed });
    forcedSum = forcedSum ? add(forcedSum, forced) : forced;
    committedSum = committedSum ? add(committedSum, committed) : committed;
  }
  const league = forcedSum && committedSum && played > 0 ? { games: games / played, forced: scale(forcedSum, 1 / played), committed: scale(committedSum, 1 / played) } : null;
  return { teams, league };
}
