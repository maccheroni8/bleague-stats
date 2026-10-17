// 在コート5人組（reconstructOnCourtのlineupStints）のうち、日本人以外（外国籍・帰化選手・
// アジア特別枠）の人数を数える。下の computeForeignPlayerCourtSeconds（scripts/aggregate.ts の外国籍選手同時出場人数フィルタ・
// On-Court Foreignチャートの元データ）・foreignCourtSecondsByPeriod（ピリオド別の索引。DESIGN.md 256章）と、試合詳細ページの
// 「オンザコート4」の枠表示で同じ判定を使う。
import type { LineupStint } from "./onCourt.ts";

export type ClassificationLookup = (playerId: string) => string | undefined;

/**
 * 5人組のうち日本人以外の人数。区分が不明な選手が1人でもいればnullを返す
 * （区分不明を日本人・外国籍のどちらかに寄せて推測しない。DESIGN.md 51章）
 */
export function foreignCountInLineup(playerIds: string[], classify: ClassificationLookup): number | null {
  let count = 0;
  for (const playerId of playerIds) {
    const classification = classify(playerId);
    if (classification === undefined) return null;
    if (classification !== "日本人") count += 1;
  }
  return count;
}

export interface CourtInterval {
  startSec: number;
  endSec: number;
  /** 区間中の自チーム/相手チームの得点（試合詳細ページの枠のツールチップ用） */
  ownPoints: number;
  oppPoints: number;
}

/**
 * 指定チームで日本人以外の選手がminCount人以上同時に在コートだった時間帯を、連続する
 * スティントをつないだ区間の配列で返す（オンザコート4の可視化用）
 */
export function foreignOnCourtIntervals(
  stints: LineupStint[],
  teamId: string,
  classify: ClassificationLookup,
  minCount: number,
): CourtInterval[] {
  const matching = stints
    .filter((s) => s.teamId === teamId && s.endSec > s.startSec)
    .filter((s) => (foreignCountInLineup(s.playerIds, classify) ?? -1) >= minCount)
    .sort((a, b) => a.startSec - b.startSec);

  const merged: CourtInterval[] = [];
  for (const s of matching) {
    const last = merged[merged.length - 1];
    if (last && s.startSec <= last.endSec) {
      last.endSec = Math.max(last.endSec, s.endSec);
      last.ownPoints += s.ownPoints;
      last.oppPoints += s.oppPoints;
    } else {
      merged.push({ startSec: s.startSec, endSec: s.endSec, ownPoints: s.ownPoints, oppPoints: s.oppPoints });
    }
  }
  return merged;
}

/**
 * 外国籍選手（外国籍/帰化選手/アジア特別枠の合算）同時出場人数別に、試合単位でチームごとの
 * 在コート秒数をバケット分けする（DESIGN.md参照）。onCourt.lineupStints
 * （reconstructOnCourtの戻り値、既に計算済みのものを再利用しPBP再走査は行わない）を、
 * 5人組のうち非日本人の人数（バケットキー。0〜5、上限クランプはしない）でバケット分けし、
 * チーム全体の在コート秒数として積算する（特定選手の出場時間には限定しない）。
 * classificationが不明（players-master.jsonに存在しない選手を含む）な5人組は、
 * どのバケットにも計上せず丸ごと除外する（推測しない方針。DESIGN.md 51章参照）。
 * 対象チームの全スティントが不明だった場合、そのチームはMapに含まれない。
 * 長さが0以下の区間は数えない（以前は、2016-17〜2019-20 の延長戦で在コートの復元が延長を抜かしていて、延長に入った区間の長さが負になっていた。
 * 2026-10-17 に復元のピリオド数を直した〔shared/onCourt.ts の onCourtPeriodCount。DESIGN.md 256章〕あとも、念のため残す）。
 * 2026-10-17 に scripts/aggregate.ts から移した（ピリオド別の索引も同じ数え方を使うため）
 */
/** 規定の最大人数を超えて除外した区間の件数・秒数（シーズンごとのログ用。DESIGN.md 84-7章） */
export interface ForeignOverLimitTally {
  stints: number;
  seconds: number;
}

export function computeForeignPlayerCourtSeconds(
  lineupStints: readonly LineupStint[],
  classify: ClassificationLookup,
  maxOnCourt: number | undefined,
  overLimit: ForeignOverLimitTally,
): Map<string, Map<number, number>> {
  const secondsByTeamBucket = new Map<string, Map<number, number>>();
  for (const stint of lineupStints) {
    const duration = stint.endSec - stint.startSec;
    if (duration <= 0) continue;

    const foreignCount = foreignCountInLineup(stint.playerIds, classify);
    if (foreignCount === null) continue;
    // 規定の最大人数（season-rules.json の maxForeignOnCourt）を超える5人組は、公式記録の選手の取り違え等によるものと
    // みなし、区分不明の5人組と同じくOn-Court Foreignの集計から丸ごと外す（数え直さない。2026-09-25、DESIGN.md 84-7章）。
    // 選手の出場時間・ラインナップ・+/-等の他の集計は lineupStints をそのまま使うので影響しない
    if (maxOnCourt !== undefined && foreignCount > maxOnCourt) {
      overLimit.stints += 1;
      overLimit.seconds += duration;
      continue;
    }

    let bucketSeconds = secondsByTeamBucket.get(stint.teamId);
    if (!bucketSeconds) {
      bucketSeconds = new Map();
      secondsByTeamBucket.set(stint.teamId, bucketSeconds);
    }
    bucketSeconds.set(foreignCount, (bucketSeconds.get(foreignCount) ?? 0) + duration);
  }
  return secondsByTeamBucket;
}

/** 人数別の秒数の並び（0〜4人の5つ）。5人（オールスター戦のアジアオールスターズだけ）は4人にまとめる。チームの値が無ければ undefined */
export function foreignCourtSecondsArray(buckets: Map<number, number> | undefined): number[] | undefined {
  if (!buckets) return undefined;
  const out = [0, 0, 0, 0, 0];
  for (const [bucket, seconds] of buckets) {
    const clamped = Math.min(bucket, 4);
    out[clamped] = out[clamped]! + seconds;
  }
  return out;
}

/** 人数（0〜4人）ごとの、1つのピリオドの在コートの値（並びはどれも [0人, 1人, 2人, 3人, 4人]） */
export interface ForeignPeriodTotals {
  seconds: number[];
  /** その人数の5人組がコートにいた間の自チームの得点・相手の得点 */
  ownPoints: number[];
  oppPoints: number[];
  /** その人数の5人組がコートにいた間の自チームの攻撃回数・相手の攻撃回数。数え上げの無い試合（2019-20以前）は null */
  ownPoss: number[] | null;
  oppPoss: number[] | null;
}

function emptyForeignPeriodTotals(withPoss: boolean): ForeignPeriodTotals {
  const z = () => [0, 0, 0, 0, 0];
  return { seconds: z(), ownPoints: z(), oppPoints: z(), ownPoss: withPoss ? z() : null, oppPoss: withPoss ? z() : null };
}

/**
 * 人数別の在コートの値を、ピリオドごとに分ける（ピリオド別の索引。DESIGN.md 256章）。区間の数え方（区分不明・規定の最大人数を超える5人組は外す）は
 * computeForeignPlayerCourtSeconds と同じ。秒数は長さが0以下の区間を飛ばし、ピリオドの切れ目をまたぐ区間は切れ目で分ける。
 * 得点・攻撃回数は、よく使われるラインナップ（scripts/aggregate.ts の processLineups）と同じく区間の長さによらず足し、区間の得点イベントのピリオド
 * （pointsByPeriod・countsByPeriod）で振り分ける。返すのは チーム → ピリオド番号 → 値（5人は4人にまとめる）。
 * 長さが0より長い数えられる区間が1つも無いチームは含めない（computeForeignPlayerCourtSeconds と同じ。全ピリオドの秒数の合計は、
 * computeForeignPlayerCourtSeconds を foreignCourtSecondsArray にした値と一致する）
 */
export function foreignCourtByPeriod(
  lineupStints: readonly LineupStint[],
  classify: ClassificationLookup,
  maxOnCourt: number | undefined,
  periodRange: (period: number) => [number, number],
  totalPeriods: number,
): Map<string, Map<number, ForeignPeriodTotals>> {
  const result = new Map<string, Map<number, ForeignPeriodTotals>>();
  const counted = new Set<string>();
  for (const stint of lineupStints) {
    const foreignCount = foreignCountInLineup(stint.playerIds, classify);
    if (foreignCount === null) continue;
    if (maxOnCourt !== undefined && foreignCount > maxOnCourt) continue;
    const bucket = Math.min(foreignCount, 4);
    const withPoss = stint.countsByPeriod !== undefined;
    let byPeriod = result.get(stint.teamId);
    if (!byPeriod) result.set(stint.teamId, (byPeriod = new Map()));
    const at = (period: number): ForeignPeriodTotals => {
      let t = byPeriod!.get(period);
      if (!t) byPeriod!.set(period, (t = emptyForeignPeriodTotals(withPoss)));
      return t;
    };
    if (stint.endSec - stint.startSec > 0) {
      counted.add(stint.teamId);
      for (let period = 1; period <= totalPeriods; period++) {
        const [ps, pe] = periodRange(period);
        const seconds = Math.min(pe, stint.endSec) - Math.max(ps, stint.startSec);
        if (seconds <= 0) continue;
        const t = at(period);
        t.seconds[bucket] = t.seconds[bucket]! + seconds;
      }
    }
    for (const [period, pts] of Object.entries(stint.pointsByPeriod)) {
      if (pts.own === 0 && pts.opp === 0) continue;
      const t = at(Number(period));
      t.ownPoints[bucket] = t.ownPoints[bucket]! + pts.own;
      t.oppPoints[bucket] = t.oppPoints[bucket]! + pts.opp;
    }
    for (const [period, pair] of Object.entries(stint.countsByPeriod ?? {})) {
      const t = at(Number(period));
      if (!t.ownPoss || !t.oppPoss) continue;
      t.ownPoss[bucket] = t.ownPoss[bucket]! + pair.own.poss;
      t.oppPoss[bucket] = t.oppPoss[bucket]! + pair.opp.poss;
    }
  }
  for (const teamId of [...result.keys()]) if (!counted.has(teamId)) result.delete(teamId);
  return result;
}
