// 最大リード・最大ランの合計（チームスタッツ用。画面専用。DESIGN.md 362章）。
// 試合ごとの値は試合ログ（TeamGameLog の maxLead・maxDeficit・maxRun）に保存済み。試合ログに無い「相手の最大ラン」は、
// チームの1試合行の索引（team-game-index）の相手の行から、試合ログを読み込むとき（data.ts の fetchTeamGameLogs）に添える。
// このファイルを保存キーの対象のファイルから import しないこと。
import type { TeamGameLog } from "../../shared/types";

const OPPONENT_RUN = new WeakMap<object, number>();

/** 試合ログに、相手の最大ランを添える（保存はしない。読み込みのとき一度だけ） */
export function setOpponentRun(log: object, run: number): void {
  OPPONENT_RUN.set(log, run);
}

/** 相手の最大ラン。添えていない（索引が無い・相手の得点の流れが無い）ときは undefined */
export function opponentRunOf(log: object): number | undefined {
  return OPPONENT_RUN.get(log);
}

/** 最大リード・最大ビハインド（自チーム視点。ビハインド＝相手の最大リード）・最大ランの合計。平均は〜Games で割る */
export interface GameFlowTotals {
  leadGames: number;
  leadSum: number;
  leadMax: number;
  deficitSum: number;
  deficitMax: number;
  runGames: number;
  runSum: number;
  runMax: number;
  oppRunGames: number;
  oppRunSum: number;
  oppRunMax: number;
}

export const EMPTY_GAME_FLOW: GameFlowTotals = {
  leadGames: 0,
  leadSum: 0,
  leadMax: 0,
  deficitSum: 0,
  deficitMax: 0,
  runGames: 0,
  runSum: 0,
  runMax: 0,
  oppRunGames: 0,
  oppRunSum: 0,
  oppRunMax: 0,
};

/** 合計を足す。〜Max は最大を取る（リーグ全体の行など） */
export function addGameFlow(a: GameFlowTotals, b: GameFlowTotals): GameFlowTotals {
  return {
    leadGames: a.leadGames + b.leadGames,
    leadSum: a.leadSum + b.leadSum,
    leadMax: Math.max(a.leadMax, b.leadMax),
    deficitSum: a.deficitSum + b.deficitSum,
    deficitMax: Math.max(a.deficitMax, b.deficitMax),
    runGames: a.runGames + b.runGames,
    runSum: a.runSum + b.runSum,
    runMax: Math.max(a.runMax, b.runMax),
    oppRunGames: a.oppRunGames + b.oppRunGames,
    oppRunSum: a.oppRunSum + b.oppRunSum,
    oppRunMax: Math.max(a.oppRunMax, b.oppRunMax),
  };
}

/** 試合ログ1試合分を足す。試合の流れの記録が無い試合（1810）は数えない */
export function addGameFlowLog(
  acc: GameFlowTotals,
  g: Pick<TeamGameLog, "maxLead" | "maxDeficit" | "maxRun">,
  oppRun: number | undefined,
): GameFlowTotals {
  const hasLead = g.maxLead !== undefined && g.maxDeficit !== undefined;
  const hasRun = g.maxRun !== undefined;
  const hasOppRun = oppRun !== undefined;
  return {
    leadGames: acc.leadGames + (hasLead ? 1 : 0),
    leadSum: acc.leadSum + (hasLead ? g.maxLead! : 0),
    leadMax: hasLead ? Math.max(acc.leadMax, g.maxLead!) : acc.leadMax,
    deficitSum: acc.deficitSum + (hasLead ? g.maxDeficit! : 0),
    deficitMax: hasLead ? Math.max(acc.deficitMax, g.maxDeficit!) : acc.deficitMax,
    runGames: acc.runGames + (hasRun ? 1 : 0),
    runSum: acc.runSum + (hasRun ? g.maxRun! : 0),
    runMax: hasRun ? Math.max(acc.runMax, g.maxRun!) : acc.runMax,
    oppRunGames: acc.oppRunGames + (hasOppRun ? 1 : 0),
    oppRunSum: acc.oppRunSum + (hasOppRun ? oppRun! : 0),
    oppRunMax: hasOppRun ? Math.max(acc.oppRunMax, oppRun!) : acc.oppRunMax,
  };
}

export function sumGameFlow(logs: readonly TeamGameLog[]): GameFlowTotals {
  return logs.reduce<GameFlowTotals>((acc, g) => addGameFlowLog(acc, g, opponentRunOf(g)), { ...EMPTY_GAME_FLOW });
}

export type GameFlowKey = "avglead" | "maxlead" | "avgrun" | "maxrun";

export const GAME_FLOW_LABELS: Record<GameFlowKey, string> = {
  avglead: "AVG LEAD",
  maxlead: "MAX LEAD",
  avgrun: "AVG RUN",
  maxrun: "MAX RUN",
};

const avgOf = (sum: number, n: number) => (n > 0 ? sum / n : null);

/** 自チームの値と相手側の値（相手側＝最大リードは自チームの最大ビハインド、最大ランは相手の最大ラン）。出せないときは null */
export function gameFlowSides(f: GameFlowTotals, key: GameFlowKey): { own: number | null; opp: number | null } {
  switch (key) {
    case "avglead":
      return { own: avgOf(f.leadSum, f.leadGames), opp: avgOf(f.deficitSum, f.leadGames) };
    case "maxlead":
      return { own: f.leadGames > 0 ? f.leadMax : null, opp: f.leadGames > 0 ? f.deficitMax : null };
    case "avgrun":
      return { own: avgOf(f.runSum, f.runGames), opp: avgOf(f.oppRunSum, f.oppRunGames) };
    default:
      return { own: f.runGames > 0 ? f.runMax : null, opp: f.oppRunGames > 0 ? f.oppRunMax : null };
  }
}

/** 視点（自チーム／opp／差）に応じた値。出せないときは null */
export function gameFlowValue(f: GameFlowTotals, key: GameFlowKey, perspective: "own" | "opp" | "diff"): number | null {
  const { own, opp } = gameFlowSides(f, key);
  if (perspective === "own") return own;
  if (perspective === "opp") return opp;
  return own === null || opp === null ? null : own - opp;
}

/** 表の文字（平均は小数第2位、最大は整数。差は符号つき。出せないときは「-」） */
export function formatGameFlow(v: number | null, key: GameFlowKey, perspective: "own" | "opp" | "diff"): string {
  if (v === null) return "-";
  const d = key.startsWith("avg") ? 2 : 0;
  const text = v.toFixed(d);
  return perspective === "diff" && v > 0 ? `+${text}` : text;
}

const FLOW_BY_VALUE = new WeakMap<object, GameFlowTotals>();

/** 合計の値（シーズンの Misc の合計など）に、最大リード・最大ランの合計を添える（selfScoring.ts の withNoFlow と同じ作り） */
export function withGameFlow<T extends object>(value: T, totals: GameFlowTotals): T {
  FLOW_BY_VALUE.set(value, totals);
  return value;
}

export const gameFlowOf = (value: object): GameFlowTotals => FLOW_BY_VALUE.get(value) ?? EMPTY_GAME_FLOW;
