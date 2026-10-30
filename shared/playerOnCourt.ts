// 選手ごとの「出場中」の材料（在コート基準の再集計。DESIGN.md 304章）。在コートの復元（shared/onCourt.ts の reconstructOnCourt）の
// 5人組の区間（lineupStints）から、選手×ピリオドの出場中の自チーム・相手の数え上げ、Q別の +/-、FGにつながったアシストを作る。
// 数え方はチームの出場区間（team-stints。scripts/aggregate.ts の collectTeamStints）・ランキングの On/Off（shared/onCourtTotals.ts）と同じ:
// - 時間は区間をピリオドの切れ目で分ける。数え上げ（countsByPeriod）は、時間の重なりによらずそのピリオドに入れる
// - 得点（pts）は、得点の推移から求めた値（pointsByPeriod）を使う（記録の種類から数えた値は、記録が欠けた試合で食い違うことがある。DESIGN.md 207章）
// 出せるかどうかは、チームごと・試合ごとに判定する（teamOnCourtQuality）。
import { computeAssistedScoring } from "./assistedScoring.ts";
import { STINT_COUNT_KEYS, periodRangeSeconds, stintReboundsByPeriod, totalGameSeconds, type LineupStint, type OnCourtReconstruction } from "./onCourt.ts";
import type { BoxscoreRow, PlayByPlayEvent } from "./types.ts";

/** 出場中の材料の並び: [秒, own × STINT_COUNT_KEYS, opp × STINT_COUNT_KEYS]（長さ 1 + 13 × 2） */
export const ON_COURT_VALUE_LENGTH = 1 + STINT_COUNT_KEYS.length * 2;
export const ON_COURT_OWN_OFFSET = 1;
export const ON_COURT_OPP_OFFSET = 1 + STINT_COUNT_KEYS.length;

export function emptyOnCourtValues(): number[] {
  return new Array<number>(ON_COURT_VALUE_LENGTH).fill(0);
}

/** 並びの中の位置（own なら ON_COURT_OWN_OFFSET + i） */
export function onCourtKeyIndex(key: (typeof STINT_COUNT_KEYS)[number], side: "own" | "opp"): number {
  return (side === "own" ? ON_COURT_OWN_OFFSET : ON_COURT_OPP_OFFSET) + STINT_COUNT_KEYS.indexOf(key);
}

/**
 * チーム×試合の品質（ビット）。
 * - ON_COURT_QUALITY_SHARES: 5人組の区間が試合の時間をすべて覆い、区間の得点の合計＝両チームの得点、区間の FGM・FGA・3PM・3PA・FTM・FTA の合計＝公式のチーム合計。
 *   出場中の割合（%PTS など）・AST% に使う
 * - ON_COURT_QUALITY_REBOUNDS: 個人 OR% と同じ判定（区間の OR・相手 DR の合計＝公式、リバウンドを数えた区間が5人。src/lib/gameOrPct.ts と同じ）
 */
export const ON_COURT_QUALITY_SHARES = 1;
export const ON_COURT_QUALITY_REBOUNDS = 2;

function teamRow(rows: readonly BoxscoreRow[]): BoxscoreRow | undefined {
  return rows.find((r) => r.Category === 3 && r.PeriodCategory === 18);
}

/** そのチームの、ボックススコアの OR・DR（チーム合計の行。チームリバウンド込み。試合詳細の buildTeamTotalCounts と同じ） */
function boxRebounds(rows: readonly BoxscoreRow[]): { or: number; dr: number } {
  const row = teamRow(rows);
  return { or: row?.RB_OFF ?? 0, dr: row?.RB_DEF ?? 0 };
}

export function teamOnCourtQuality(
  rec: OnCourtReconstruction,
  teamId: string,
  opponentTeamId: string,
  ownRows: readonly BoxscoreRow[],
  opponentRows: readonly BoxscoreRow[],
  ownScore: number,
  opponentScore: number,
  totalPeriods: number,
): number {
  const own = rec.lineupStints.filter((s) => s.teamId === teamId);
  if (own.length === 0) return 0;
  let quality = 0;
  // 割合
  if (own.every((s) => s.countsByPeriod !== undefined)) {
    let sec = 0;
    let pts = 0;
    let oppPts = 0;
    const sums: Record<string, number> = { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
    for (const s of own) {
      sec += s.endSec - s.startSec;
      for (const v of Object.values(s.pointsByPeriod)) {
        pts += v.own;
        oppPts += v.opp;
      }
      for (const pair of Object.values(s.countsByPeriod!)) for (const k of Object.keys(sums)) sums[k]! += pair.own[k as keyof typeof pair.own];
    }
    const box = teamRow(ownRows);
    const boxSums = box
      ? { fgm: box.PT2M + box.PT3M, fga: box.PT2A + box.PT3A, tpm: box.PT3M, tpa: box.PT3A, ftm: box.FTM, fta: box.FTA }
      : null;
    if (
      boxSums &&
      sec === totalGameSeconds(totalPeriods) &&
      pts === ownScore &&
      oppPts === opponentScore &&
      Object.entries(boxSums).every(([k, v]) => sums[k] === v)
    ) {
      quality |= ON_COURT_QUALITY_SHARES;
    }
  }
  // リバウンド（gameOrPct.ts の computeTeamOrPct と同じ判定）
  const reb = new Map(rec.lineupStints.map((s) => [s, stintReboundsByPeriod(s)] as const));
  if (own.every((s) => reb.get(s) !== null)) {
    let ok = true;
    let orSum = 0;
    let oppDrSum = 0;
    for (const s of own) {
      for (const pair of Object.values(reb.get(s) ?? {})) {
        orSum += pair.own.or;
        oppDrSum += pair.opp.dr;
        if ((pair.own.or > 0 || pair.opp.dr > 0) && s.playerIds.length !== 5) ok = false;
      }
    }
    for (const s of rec.lineupStints) {
      if (s.teamId !== opponentTeamId) continue;
      for (const pair of Object.values(reb.get(s) ?? {})) if (pair.own.dr > 0 && s.playerIds.length !== 5) ok = false;
    }
    const b = boxRebounds(ownRows);
    const ob = boxRebounds(opponentRows);
    if (ok && orSum === b.or && oppDrSum === ob.dr) quality |= ON_COURT_QUALITY_REBOUNDS;
  }
  return quality;
}

/** 選手 → ピリオド → 出場中の材料（ON_COURT_VALUE_LENGTH の並び）。数え上げの無い区間（旧形式）は秒だけ */
export function playerOnCourtByPeriod(stints: readonly LineupStint[], teamId: string, totalPeriods: number): Map<string, Map<number, number[]>> {
  const out = new Map<string, Map<number, number[]>>();
  const at = (playerId: string, period: number): number[] => {
    let byPeriod = out.get(playerId);
    if (!byPeriod) out.set(playerId, (byPeriod = new Map()));
    let v = byPeriod.get(period);
    if (!v) byPeriod.set(period, (v = emptyOnCourtValues()));
    return v;
  };
  for (const s of stints) {
    if (s.teamId !== teamId) continue;
    for (let p = 1; p <= totalPeriods; p++) {
      const [ps, pe] = periodRangeSeconds(p);
      const seconds = Math.min(pe, s.endSec) - Math.max(ps, s.startSec);
      const pair = s.countsByPeriod?.[p];
      const scored = s.pointsByPeriod[p];
      if (seconds <= 0 && !pair && !scored) continue;
      for (const id of s.playerIds) {
        const v = at(id, p);
        if (seconds > 0) v[0]! += seconds;
        STINT_COUNT_KEYS.forEach((k, i) => {
          v[ON_COURT_OWN_OFFSET + i]! += k === "pts" ? (scored?.own ?? 0) : (pair?.own[k] ?? 0);
          v[ON_COURT_OPP_OFFSET + i]! += k === "pts" ? (scored?.opp ?? 0) : (pair?.opp[k] ?? 0);
        });
      }
    }
  }
  return out;
}

/** 出場中の材料を足す（into に add を加える） */
export function addOnCourtValues(into: number[], add: readonly number[]): void {
  for (let i = 0; i < into.length; i++) into[i]! += add[i] ?? 0;
}

/**
 * 試合ログに出場中の材料を持たせるか: 本人がいた区間に、時間か0でない数え上げがある（長さ0秒の区間に記録だけがある場合を含む。ランキングの On と同じ）。
 * 「出場した」（Off を数える試合）は、時間のある区間にいたこと（材料の秒 > 0。ランキングの On/Off の出場の判定と同じ）
 */
export function hasOnCourtValues(byPeriod: Map<number, number[]> | undefined): boolean {
  if (!byPeriod) return false;
  for (const v of byPeriod.values()) if (v.some((x) => x !== 0)) return true;
  return false;
}

/** Q別の +/-（ピリオドごとの、出場中の自チーム得点 − 相手得点）。材料の並びから出す */
export function plusMinusOf(values: readonly number[]): number {
  return values[onCourtKeyIndex("pts", "own")]! - values[onCourtKeyIndex("pts", "opp")]!;
}

/**
 * Q別の +/- を出せるか（チーム×試合）。5人組の区間の Q別の得点差を選手ごとに足した合計が、在コートの復元の試合全体の +/-（rec.plusMinus）と
 * 全選手で一致し、区間の得点の合計が両チームの得点と一致するとき（区間に入らなかった得点があれば、どこかの選手で合わなくなる）
 */
export function periodPlusMinusAvailable(
  rec: OnCourtReconstruction,
  byPlayer: Map<string, Map<number, number[]>>,
  teamId: string,
  ownScore: number,
  opponentScore: number,
): boolean {
  let own = 0;
  let opp = 0;
  for (const s of rec.lineupStints) {
    if (s.teamId !== teamId) continue;
    for (const v of Object.values(s.pointsByPeriod)) {
      own += v.own;
      opp += v.opp;
    }
  }
  if (own !== ownScore || opp !== opponentScore) return false;
  const players = new Set<string>([...byPlayer.keys()]);
  for (const iv of rec.intervals) if (iv.teamId === teamId) players.add(iv.playerId);
  for (const id of players) {
    let sum = 0;
    for (const v of byPlayer.get(id)?.values() ?? []) sum += plusMinusOf(v);
    if (sum !== (rec.plusMinus[id] ?? 0)) return false;
  }
  return true;
}

/**
 * FGにつながったアシスト（アシストした選手の側。shared/assistedScoring.ts のアシストと得点の対応付けで、得点が2P・3Pの成功だったもの）。
 * 選手 → ピリオド → 本数。FTにつながったアシストは数えない（公式の AST は変えない。DESIGN.md 139章）。
 * ピリオドごとにプレーバイプレーを絞って対応付ける（対応付けは同じピリオドの中だけで行うので、試合全体で対応付けた結果と同じ）
 */
export function fgAssistsByPlayer(playByPlays: readonly PlayByPlayEvent[]): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  const periods = [...new Set(playByPlays.map((e) => e.Period))];
  for (const p of periods) {
    const result = computeAssistedScoring(playByPlays.filter((e) => e.Period === p));
    for (const pair of result.pairs.values()) {
      const n = pair.assisted2m + pair.assisted3m;
      if (n === 0) continue;
      let byPeriod = out.get(pair.assisterId);
      if (!byPeriod) out.set(pair.assisterId, (byPeriod = new Map()));
      byPeriod.set(p, (byPeriod.get(p) ?? 0) + n);
    }
  }
  return out;
}

/** チームの出場区間の合計（試合全体。ON_COURT_VALUE_LENGTH の並び）。個人の Off は「この合計 − 本人の On」（ランキングの On/Off と同じ値になる） */
export function teamStintTotals(stints: readonly LineupStint[], teamId: string, totalPeriods: number): number[] {
  const total = emptyOnCourtValues();
  for (const s of stints) {
    if (s.teamId !== teamId) continue;
    for (let p = 1; p <= totalPeriods; p++) {
      const [ps, pe] = periodRangeSeconds(p);
      const seconds = Math.min(pe, s.endSec) - Math.max(ps, s.startSec);
      if (seconds > 0) total[0]! += seconds;
      const pair = s.countsByPeriod?.[p];
      const scored = s.pointsByPeriod[p];
      STINT_COUNT_KEYS.forEach((k, i) => {
        total[ON_COURT_OWN_OFFSET + i]! += k === "pts" ? (scored?.own ?? 0) : (pair?.own[k] ?? 0);
        total[ON_COURT_OPP_OFFSET + i]! += k === "pts" ? (scored?.opp ?? 0) : (pair?.opp[k] ?? 0);
      });
    }
  }
  return total;
}

/** 選手のピリオド別の材料を、試合全体に足す */
export function sumOverPeriods(byPeriod: Map<number, number[]> | undefined, periods?: (p: number) => boolean): number[] {
  const total = emptyOnCourtValues();
  for (const [p, v] of byPeriod ?? []) if (!periods || periods(p)) addOnCourtValues(total, v);
  return total;
}
