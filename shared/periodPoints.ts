// 1試合の1Q〜4Qの得点（クォーター別・前後半別の記録・平均用。DESIGN.md 143章）。延長戦は含めない。
//
// 公式のクォーター別スコア（StoredGame.quarterScores、公式APIの HomeTeamScore01〜）をそのまま使う。例外は2つ:
// - 2016-17・2017-18 のCSで、1勝1敗のときに行った前後半5分の特別な試合（公式記録もプレーバイプレーも2ピリオドだけ）は
//   クォーターではないので対象外（null を返す）
// - 公式のスコアが途中のピリオドまでしか無い試合（2021-22 茨城 vs 新潟 = 3Qまで、2024-25 越谷 vs 京都 = 2Qまで）は、
//   プレーバイプレーの得点イベントをピリオドごとに足した値で補う。ただし「1Q〜4Qの合計が最終スコアと一致」かつ
//   「公式のスコアが残っている区間でプレーバイプレーの値が公式と一致」の両方を満たすときだけ。満たさなければ欠けている区間は null。
//   補った区間は fromPbp に記録する（公式の試合ファイルは書き換えない）
import type { PlayByPlayEvent, StoredGame } from "./types.ts";

/** 得点イベントの ActionCD1 と得点（shared/onCourt.ts の POINTS_BY_ACTION_CD1 と同じ対応） */
const POINTS_BY_ACTION_CD1: Record<number, number> = { 1: 3, 3: 2, 4: 2, 7: 1, 44: 2 };

export const REGULATION_PERIODS = 4;

export interface RegulationPeriodScores {
  /** 1Q〜4Q（長さ4）。欠けていて補えなかった区間は null */
  home: (number | null)[];
  away: (number | null)[];
  /** プレーバイプレーから補った区間（1始まりのピリオド番号）。公式のまま使えた試合は空 */
  fromPbp: number[];
}

/** プレーバイプレーの得点イベントをチーム・ピリオドごとに足す（1Q〜4Q） */
export function pbpRegulationPoints(events: PlayByPlayEvent[], homeTeamId: string, awayTeamId: string): { home: number[]; away: number[] } {
  const home = [0, 0, 0, 0];
  const away = [0, 0, 0, 0];
  for (const ev of events) {
    const points = POINTS_BY_ACTION_CD1[ev.ActionCD1];
    if (points === undefined || ev.Period < 1 || ev.Period > REGULATION_PERIODS) continue;
    if (ev.TeamID === homeTeamId) home[ev.Period - 1]! += points;
    else if (ev.TeamID === awayTeamId) away[ev.Period - 1]! += points;
  }
  return { home, away };
}

function maxPbpPeriod(events: PlayByPlayEvent[]): number {
  return events.reduce((m, ev) => Math.max(m, ev.Period ?? 0), 0);
}

/** 1Q〜4Qの得点。対象外の試合（前後半5分の特別な試合）は null */
export function regulationPeriodScores(game: StoredGame): RegulationPeriodScores | null {
  const official = game.quarterScores;
  const officialLength = Math.min(official.home.length, official.away.length);
  if (officialLength >= REGULATION_PERIODS) {
    return { home: official.home.slice(0, REGULATION_PERIODS), away: official.away.slice(0, REGULATION_PERIODS), fromPbp: [] };
  }
  const events = game.raw.PlayByPlays ?? [];
  // 公式記録もプレーバイプレーも4ピリオドに届かない試合 = 前後半5分の特別な試合
  if (maxPbpPeriod(events) < REGULATION_PERIODS) return null;

  const pbp = pbpRegulationPoints(events, game.homeTeam.id, game.awayTeam.id);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const totalsMatch = sum(pbp.home) === game.homeScore && sum(pbp.away) === game.awayScore;
  let officialMatch = true;
  for (let i = 0; i < officialLength; i += 1) {
    if (pbp.home[i] !== official.home[i] || pbp.away[i] !== official.away[i]) officialMatch = false;
  }
  const home: (number | null)[] = [];
  const away: (number | null)[] = [];
  const fromPbp: number[] = [];
  for (let i = 0; i < REGULATION_PERIODS; i += 1) {
    if (i < officialLength) {
      home.push(official.home[i]!);
      away.push(official.away[i]!);
    } else if (totalsMatch && officialMatch) {
      home.push(pbp.home[i]!);
      away.push(pbp.away[i]!);
      fromPbp.push(i + 1);
    } else {
      home.push(null);
      away.push(null);
    }
  }
  return { home, away, fromPbp };
}
