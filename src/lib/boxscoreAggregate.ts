// ボックススコア（試合詳細ページ）の期間別集計ロジック。
// GeniusAPI生データは選手/チーム行ごとに「1Q/2Q/3Q/4Q/前半/後半/延長合計/試合全体」の
// 集計済み行(PeriodCategory)を個別に持っているため、試合全体(=18)以外の範囲を選んだ場合は
// 該当するPeriodCategory=1..4(・OT分)の行を自前で合算する（15/16/17は「前半/後半/延長合計」
// 専用の集計行で、PeriodRangeOptionのOTを含む「後半」等とは範囲が一致しないケースがあるため使わない）。

import type { BoxscoreRow, PlayByPlayEvent, SummaryRow, YahooTurnoverEvent } from "../../shared/types";
import type { PeriodRangeOption } from "./periodRange";
import { periodInRange } from "./periodRange";
import {
  estimatedPossessions,
  individualDefRtg,
  individualOffRtg,
  offensiveRating,
  pace,
  safeDiv,
  type OliverBoxStats,
} from "../../shared/formulas";
import { computePointsOffTurnovers } from "../../shared/pointsOffTurnovers";
import { computeFastbreakPoints, computePointsInPaint, computeSecondChancePoints } from "../../shared/playTypePoints";
import { computeAssistedScoring, type AssistedScoringCounts, type AssistPair } from "../../shared/assistedScoring";
import { buildShotEvents, paintSplitForShot, type ShotEvent } from "./shotChart";

export interface BoxscoreCounts {
  minSec: number;
  pts: number;
  pt2m: number;
  pt2a: number;
  pt3m: number;
  pt3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  treb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  bson: number;
  foul: number;
  foulon: number;
  eff: number;
  plusMinus: number;
  /** 2022-23シーズン以降のみ存在するフィールドのため、値0と未収録を区別するためのフラグ */
  hasPlusMinus: boolean;
  /**
   * PITP（ペイント内での得点）。sumCounts()はBoxscoreRow.PT2IN（生フィールド、実体は
   * 「シュート成功本数」でありスケールが得点と異なる）をそのまま加算するが、
   * buildPlayerBoxscores()がPlayByPlaysのPlayTextタグ（"インサイドペイント"）から
   * 算出した正しい得点値で事後的に上書きする（shared/playTypePoints.ts）。チーム合計行
   * （buildTeamTotalCounts()経由）はこの上書きを経由しないためBoxscoreRowの生フィールド値
   * （本数）のままで、表示側がSummaries由来のPlayTypeCountsを別途使う（BoxscoreTable.tsx参照）
   */
  pt2in: number;
  /** 2ND PTS（セカンドチャンスによる得点）。pt2inと同じ上書きパターン（shared/playTypePoints.ts） */
  pt2nd: number;
  /** FBPS（ファストブレイクによる得点）。pt2inと同じ上書きパターン（shared/playTypePoints.ts） */
  ptfb: number;
  /**
   * ターンオーバーからの得点（PTSOFFTO）。他のフィールドと異なりBoxscoreRowには個人単位の
   * フィールドが無いため、PlayByPlaysのPlayTextタグから別途算出する
   * （shared/pointsOffTurnovers.ts）。そのためsumCounts()では常に0のままで、
   * buildPlayerBoxscores()が事後的に上書きする。2016-17シーズンのみタグ自体が存在せず
   * 常に0になる（「0点」ではなく「算出不能」。shared/pointsOffTurnovers.ts参照）
   */
  ptsOffTov: number;
  /**
   * ペイント内／ペイント外の2Pシュート内訳（ショットチャートと同じゾーン分類を再利用）。
   * ptsOffTovと同様にBoxscoreRowには個人単位のフィールドが無いため、sumCounts()では常に0のままで、
   * buildPlayerBoxscores()がPlayByPlaysのX/Y/AreaCDから事後的に上書きする。X/Y自体が
   * 2022-23シーズン以降のみ存在するため（shotChart.ts参照）、それより前のシーズンでは
   * 常に0になる（呼び出し側でshotChartSupportedを見て「-」表示にケアする）
   */
  paint2m: number;
  paint2a: number;
  nonPaint2m: number;
  nonPaint2a: number;
  /**
   * 個人ORtg/DRtg/NetRtg（Dean Oliver方式、shared/formulas.tsのindividualOffRtg/
   * individualDefRtg参照）。BoxscoreTeamPanel側でbuildPlayerBoxscores()の呼び出し後に
   * 事後的にマージする。基本ボックススコアのみで計算できるため全シーズンで算出可能だが、
   * 分母が0になる（出場時間0・シュート試投0等）場合はundefinedのまま＝呼び出し側で「-」表示にする
   */
  offRtg?: number;
  defRtg?: number;
  netRtg?: number;
  /**
   * 個人PACE（在コート区間ベース、shared/onCourt.ts参照）。ORtg/DRtgとは異なりPlayByPlaysの
   * ポゼッション区切り検出に依存するため、coverage==="full"のシーズン・試合全体選択時のみ
   * 算出する。それ以外はundefinedのまま＝呼び出し側で「-」表示にする
   */
  onCourtPace?: number;
  /**
   * ダンク数・バスケットカウント（アンドワン）・アンスポーツマンファウル・
   * ディスクォリファイングファウル（DESIGN.md 15-6章・F4）。いずれもBoxscoreRowには個人単位の
   * フィールドが無いため、PlayByPlaysのActionCD1・PlayTextタグから別途算出する。
   * ptsOffTovと同様にsumCounts()では常に0のままで、buildPlayerBoxscores()が事後的に上書きする
   */
  dunks: number;
  basketCounts: number;
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
  /**
   * オフェンスファウルを犯した回数（ActionCD1=23）・チャージを取った回数
   * （相手のActionCD1=23の直後にペアになるActionCD1=15〔ファウルドローン〕、
   * 通常のシューティングファウルに伴うファウルドローンとは区別する）。
   * dunks等と同様sumCounts()では常に0のままで、buildPlayerBoxscores()が事後的に上書きする
   */
  offensiveFoulsCommitted: number;
  chargesDrawn: number;
  /**
   * アシストからの得点（得点者視点の被アシスト内訳。shared/assistedScoring.ts参照）。
   * アシストイベント自体にはどの得点に紐づくか示すタグが無いため、PlayByPlays配列内の
   * 構造的な隣接パターン（DESIGN.md該当章の調査で確認済み）からペアリングして算出する。
   * dunks等と同様sumCounts()では常に0のままで、buildPlayerBoxscores()が事後的に上書きする
   */
  assisted2m: number;
  assisted3m: number;
  assistedFtm: number;
  /**
   * ターンオーバーのライブボール/デッドボール内訳（Yahoo!スポーツplay-by-play由来。
   * shared/types.tsのYahooTurnoverBallType参照。DESIGN.md参照）。2023-24シーズン以降のみ、
   * かつ該当試合が実際に取得済みの場合のみ算出される。sumCounts()では常に0のままで、
   * buildPlayerBoxscores()がyahooTurnovers引数から事後的に上書きする（ptsOffTov等と同じ扱い）。
   * 「そのシーズン/試合でデータが無く算出不能」と「実際に0件だった」は区別できないため、
   * 呼び出し側はYahoo PBP対応可否（useYahooPbpCoverage）を別途見て「-」表示にケアする
   */
  liveTov: number;
  deadTov: number;
  /**
   * テクニカルファウル数。選手行はActionCD1=24（選手個人のテクニカル）のみを計上する。
   * チーム合計行・TEAM/COACHES行はHC/ベンチテクニカル（ActionCD1=20/21、選手に紐付かず
   * チームに帰属する）も含む（DESIGN.md 2-2章参照）。BoxscoreRowに個人単位のフィールドが
   * 無いため、他のPlayByPlays由来フィールドと同様sumCounts()では常に0のままで、
   * buildPlayerBoxscores()・BoxscoreTeamPanel側が事後的に上書きする
   */
  technicalFouls: number;
}

const ZERO_COUNTS: BoxscoreCounts = {
  minSec: 0,
  pts: 0,
  pt2m: 0,
  pt2a: 0,
  pt3m: 0,
  pt3a: 0,
  ftm: 0,
  fta: 0,
  oreb: 0,
  dreb: 0,
  treb: 0,
  ast: 0,
  tov: 0,
  stl: 0,
  blk: 0,
  bson: 0,
  foul: 0,
  foulon: 0,
  eff: 0,
  plusMinus: 0,
  hasPlusMinus: false,
  pt2in: 0,
  pt2nd: 0,
  ptfb: 0,
  ptsOffTov: 0,
  paint2m: 0,
  paint2a: 0,
  nonPaint2m: 0,
  nonPaint2a: 0,
  dunks: 0,
  basketCounts: 0,
  unsportsmanlikeFouls: 0,
  disqualifyingFouls: 0,
  offensiveFoulsCommitted: 0,
  chargesDrawn: 0,
  assisted2m: 0,
  assisted3m: 0,
  assistedFtm: 0,
  liveTov: 0,
  deadTov: 0,
  technicalFouls: 0,
};

/**
 * "MM:SS" または "DNP" 形式のPlayTimeを秒に変換する。
 * Category=2（TEAM/COACHES）行はPlayTimeフィールド自体を持たないため、未定義/空文字も0扱いにする
 */
export function playTimeToSeconds(playTime: string | undefined): number {
  if (!playTime || playTime === "DNP") return 0;
  const [m, s] = playTime.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

/** 合計秒数を"MM:SS"に戻す（5人×試合時間の合計等、99分を超えうる） */
export function formatMinutesFromSeconds(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 生データの数値フィールドを安全な数値に変換する。Category=2（TEAM/COACHES）行は
 * Q別・OT別ではFOUL/RB_OFF/RB_DEF/RB_TOT/TO以外のほぼ全フィールドが空文字("")になる
 * （型定義上はnumberだが実データはそうなっていない、既知のAPI仕様）。空文字や未定義は0扱いにする
 */
function num(value: number | string | undefined): number {
  return typeof value === "number" ? value : 0;
}

export function sumCounts(rows: BoxscoreRow[]): BoxscoreCounts {
  return rows.reduce(
    (acc, r) => ({
      minSec: acc.minSec + playTimeToSeconds(r.PlayTime),
      pts: acc.pts + num(r.Point),
      pt2m: acc.pt2m + num(r.PT2M),
      pt2a: acc.pt2a + num(r.PT2A),
      pt3m: acc.pt3m + num(r.PT3M),
      pt3a: acc.pt3a + num(r.PT3A),
      ftm: acc.ftm + num(r.FTM),
      fta: acc.fta + num(r.FTA),
      oreb: acc.oreb + num(r.RB_OFF),
      dreb: acc.dreb + num(r.RB_DEF),
      treb: acc.treb + num(r.RB_TOT),
      ast: acc.ast + num(r.AS),
      tov: acc.tov + num(r.TO),
      stl: acc.stl + num(r.ST),
      blk: acc.blk + num(r.BS),
      bson: acc.bson + num(r.BSON),
      foul: acc.foul + num(r.FOUL),
      foulon: acc.foulon + num(r.FOULON),
      eff: acc.eff + num(r.EFF),
      plusMinus: acc.plusMinus + num(r.PLUSMINUS),
      hasPlusMinus: acc.hasPlusMinus || typeof r.PLUSMINUS === "number",
      pt2in: acc.pt2in + num(r.PT2IN),
      pt2nd: acc.pt2nd + num(r.PT2ND),
      ptfb: acc.ptfb + num(r.PTFB),
      // BoxscoreRowにフィールドが無いため常に0のまま（buildPlayerBoxscores()が事後的に上書きする）
      ptsOffTov: acc.ptsOffTov,
      paint2m: acc.paint2m,
      paint2a: acc.paint2a,
      nonPaint2m: acc.nonPaint2m,
      nonPaint2a: acc.nonPaint2a,
      dunks: acc.dunks,
      basketCounts: acc.basketCounts,
      unsportsmanlikeFouls: acc.unsportsmanlikeFouls,
      disqualifyingFouls: acc.disqualifyingFouls,
      offensiveFoulsCommitted: acc.offensiveFoulsCommitted,
      chargesDrawn: acc.chargesDrawn,
      assisted2m: acc.assisted2m,
      assisted3m: acc.assisted3m,
      assistedFtm: acc.assistedFtm,
      liveTov: acc.liveTov,
      deadTov: acc.deadTov,
      technicalFouls: acc.technicalFouls,
    }),
    ZERO_COUNTS,
  );
}

/** 選択中の期間範囲に該当するPeriodCategoryの行だけを残す。「試合」選択時はPeriodCategory=18の1行に絞る */
export function rowsInPeriodRange<T extends { PeriodCategory: number }>(
  rows: T[],
  option: PeriodRangeOption | undefined,
): T[] {
  if (!option || option.periods === null) return rows.filter((r) => r.PeriodCategory === 18);
  const periods = option.periods;
  return rows.filter((r) => periods.includes(r.PeriodCategory));
}

/**
 * BoxscoreCountsの全数値フィールドをfactor倍する（チーム詳細ページ「比較」タブ用。複数試合分の
 * 合計値を1/試合数倍して「1試合あたり平均」に変換する）。型駆動（typeof value === "number"のみ
 * 対象）で全フィールドを機械的に処理するため、フィールド追加時に個別対応が要らない。
 * hasPlusMinus（真偽値）はそのまま、offRtg/defRtg/netRtg/onCourtPace（未定義ならそのまま）は
 * 個人ORtg/DRtg等のレート指標で乗算しても意味を持たないためスケール対象外にする。
 *
 * minSecのみ整数秒に丸める（formatMinutesFromSeconds()がMM:SS表記のために整数の秒を前提と
 * しているため、小数のままだと秒の部分がそのまま小数表示されてしまう）。それ以外のフィールドは
 * あえて丸めない: %系列はsafeDiv()で分子分母を毎回計算し直すため丸めていない生の値のほうが
 * 正確（先に丸めるとポイント差が生じる）。表示時の小数第1位までの整形は呼び出し側
 * （TeamDetailPage.tsxのteamCompareDefs）が担当する
 */
export function scaleCounts(counts: BoxscoreCounts, factor: number): BoxscoreCounts {
  const RATE_FIELDS = new Set(["offRtg", "defRtg", "netRtg", "onCourtPace"]);
  const result = { ...counts };
  for (const key of Object.keys(result) as (keyof BoxscoreCounts)[]) {
    if (RATE_FIELDS.has(key)) continue;
    const value = result[key];
    if (typeof value === "number") {
      const scaled = value * factor;
      (result[key] as number) = key === "minSec" ? Math.round(scaled) : scaled;
    }
  }
  return result;
}

/** 複数選手の集計済みBoxscoreCountsを合算する（スタメン合計・ベンチ合計等の内訳集計用） */
export function sumCountsList(list: BoxscoreCounts[]): BoxscoreCounts {
  return list.reduce(
    (acc, c) => ({
      minSec: acc.minSec + c.minSec,
      pts: acc.pts + c.pts,
      pt2m: acc.pt2m + c.pt2m,
      pt2a: acc.pt2a + c.pt2a,
      pt3m: acc.pt3m + c.pt3m,
      pt3a: acc.pt3a + c.pt3a,
      ftm: acc.ftm + c.ftm,
      fta: acc.fta + c.fta,
      oreb: acc.oreb + c.oreb,
      dreb: acc.dreb + c.dreb,
      treb: acc.treb + c.treb,
      ast: acc.ast + c.ast,
      tov: acc.tov + c.tov,
      stl: acc.stl + c.stl,
      blk: acc.blk + c.blk,
      bson: acc.bson + c.bson,
      foul: acc.foul + c.foul,
      foulon: acc.foulon + c.foulon,
      eff: acc.eff + c.eff,
      plusMinus: acc.plusMinus + c.plusMinus,
      hasPlusMinus: acc.hasPlusMinus || c.hasPlusMinus,
      pt2in: acc.pt2in + c.pt2in,
      pt2nd: acc.pt2nd + c.pt2nd,
      ptfb: acc.ptfb + c.ptfb,
      ptsOffTov: acc.ptsOffTov + c.ptsOffTov,
      paint2m: acc.paint2m + c.paint2m,
      paint2a: acc.paint2a + c.paint2a,
      nonPaint2m: acc.nonPaint2m + c.nonPaint2m,
      nonPaint2a: acc.nonPaint2a + c.nonPaint2a,
      dunks: acc.dunks + c.dunks,
      basketCounts: acc.basketCounts + c.basketCounts,
      unsportsmanlikeFouls: acc.unsportsmanlikeFouls + c.unsportsmanlikeFouls,
      disqualifyingFouls: acc.disqualifyingFouls + c.disqualifyingFouls,
      offensiveFoulsCommitted: acc.offensiveFoulsCommitted + c.offensiveFoulsCommitted,
      chargesDrawn: acc.chargesDrawn + c.chargesDrawn,
      assisted2m: acc.assisted2m + c.assisted2m,
      assisted3m: acc.assisted3m + c.assisted3m,
      assistedFtm: acc.assistedFtm + c.assistedFtm,
      liveTov: acc.liveTov + c.liveTov,
      deadTov: acc.deadTov + c.deadTov,
      technicalFouls: acc.technicalFouls + c.technicalFouls,
    }),
    ZERO_COUNTS,
  );
}

interface PaintSplitCounts {
  paint2m: number;
  paint2a: number;
  nonPaint2m: number;
  nonPaint2a: number;
}

const ZERO_PAINT_SPLIT: PaintSplitCounts = { paint2m: 0, paint2a: 0, nonPaint2m: 0, nonPaint2a: 0 };

/** ショットチャートと同じX/Y/AreaCDベースのゾーン分類で、選手ごとのペイント内外2P内訳を求める */
function buildPaintSplitByPlayer(shots: ShotEvent[]): Map<string, PaintSplitCounts> {
  const byPlayer = new Map<string, PaintSplitCounts>();
  for (const shot of shots) {
    const split = paintSplitForShot(shot);
    if (!split) continue;
    const entry = byPlayer.get(shot.playerId) ?? { ...ZERO_PAINT_SPLIT };
    if (split === "paint") {
      entry.paint2a += 1;
      if (shot.made) entry.paint2m += 1;
    } else {
      entry.nonPaint2a += 1;
      if (shot.made) entry.nonPaint2m += 1;
    }
    byPlayer.set(shot.playerId, entry);
  }
  return byPlayer;
}

interface MiscEventCounts {
  dunks: number;
  basketCounts: number;
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
  /** 選手個人のテクニカルファウル数（ActionCD1=24のみ。HC/ベンチ分はここに含めない） */
  technicalFouls: number;
}

const ZERO_MISC_EVENTS: MiscEventCounts = {
  dunks: 0,
  basketCounts: 0,
  unsportsmanlikeFouls: 0,
  disqualifyingFouls: 0,
  technicalFouls: 0,
};

const ZERO_ASSISTED_SCORING: AssistedScoringCounts = { assisted2m: 0, assisted3m: 0, assistedFtm: 0 };

// ダンク成功はActionCD1=4（2Pシュートインサイドペイント成功）のうちPlayTextに「ダンク」タグが
// 付くもの、バスケットカウント（アンドワン）は単独のマーカーイベント（ActionCD1=16）、
// アンスポーツマンファウル・ディスクォリファイングファウルはそれぞれActionCD1=25・26
// （いずれもDESIGN.md 15-6章で確定済み。実データで裏付け済み）。選手個人のテクニカルファウルは
// ActionCD1=24（HC/ベンチテクニカルの20/21はPlayerID1を持たずここには乗らない。DESIGN.md 2-2章参照）
const DUNK_ACTION_CD1 = 4;
const BASKET_COUNT_ACTION_CD1 = 16;
const UNSPORTSMANLIKE_FOUL_ACTION_CD1 = 25;
const DISQUALIFYING_FOUL_ACTION_CD1 = 26;
const TECHNICAL_FOUL_ACTION_CD1 = 24;
/** HC/ベンチテクニカルファウル（選手に紐付かずチームに帰属する。DESIGN.md 2-2章参照） */
const HC_TECHNICAL_FOUL_ACTION_CD1 = 20;
const BENCH_TECHNICAL_FOUL_ACTION_CD1 = 21;

/** F4（ダンク数・バスケットカウント・アンスポーツマンファウル・ディスクォリファイングファウル）＋
 * 選手個人のテクニカルファウル数を選手ごとに集計する */
function buildMiscEventCounts(events: PlayByPlayEvent[]): Map<string, MiscEventCounts> {
  const byPlayer = new Map<string, MiscEventCounts>();
  const bump = (playerId: string | null, key: keyof MiscEventCounts) => {
    if (!playerId) return;
    const entry = byPlayer.get(playerId) ?? { ...ZERO_MISC_EVENTS };
    entry[key] += 1;
    byPlayer.set(playerId, entry);
  };
  for (const ev of events) {
    if (ev.ActionCD1 === DUNK_ACTION_CD1 && ev.PlayText.includes("ダンク")) {
      bump(ev.PlayerID1, "dunks");
    } else if (ev.ActionCD1 === BASKET_COUNT_ACTION_CD1) {
      bump(ev.PlayerID1, "basketCounts");
    } else if (ev.ActionCD1 === UNSPORTSMANLIKE_FOUL_ACTION_CD1) {
      bump(ev.PlayerID1, "unsportsmanlikeFouls");
    } else if (ev.ActionCD1 === DISQUALIFYING_FOUL_ACTION_CD1) {
      bump(ev.PlayerID1, "disqualifyingFouls");
    } else if (ev.ActionCD1 === TECHNICAL_FOUL_ACTION_CD1) {
      bump(ev.PlayerID1, "technicalFouls");
    }
  }
  return byPlayer;
}

interface OffensiveFoulCounts {
  offensiveFoulsCommitted: number;
  chargesDrawn: number;
}

const ZERO_OFFENSIVE_FOUL_COUNTS: OffensiveFoulCounts = { offensiveFoulsCommitted: 0, chargesDrawn: 0 };

/** オフェンスファウル（DESIGN.md 2-2章）。直後にペアになるファウルドローン（15）が
 * チャージを取った守備側選手を示す（相手チームの選手のみを対象とし、通常のシューティング
 * ファウルに伴うファウルドローンと混同しないよう、23の直後N件以内に限定して探索する） */
const OFFENSIVE_FOUL_ACTION_CD1 = 23;
const FOUL_DRAWN_ACTION_CD1 = 15;
const MAX_CHARGE_PAIRING_FORWARD_STEPS = 3;

/**
 * オフェンスファウルを犯した回数・チャージを取った回数を選手ごとに集計する。
 * ActionCD1=23（オフェンスファウル）の直後（配列内で3件以内）に出現する、相手チームの
 * ActionCD1=15（ファウルドローン）とペアリングし、その相手選手をチャージを取った選手とする
 * （assistedScoring.tsの隣接イベントペアリングと同じ発想。ただし前方スキャン・相手チーム限定）
 */
function buildOffensiveFoulCounts(events: PlayByPlayEvent[]): Map<string, OffensiveFoulCounts> {
  const byPlayer = new Map<string, OffensiveFoulCounts>();
  const bump = (playerId: string | null, key: keyof OffensiveFoulCounts) => {
    if (!playerId) return;
    const entry = byPlayer.get(playerId) ?? { ...ZERO_OFFENSIVE_FOUL_COUNTS };
    entry[key] += 1;
    byPlayer.set(playerId, entry);
  };
  for (let i = 0; i < events.length; i++) {
    const foulEvent = events[i];
    if (!foulEvent || foulEvent.ActionCD1 !== OFFENSIVE_FOUL_ACTION_CD1) continue;
    bump(foulEvent.PlayerID1, "offensiveFoulsCommitted");
    for (let j = i + 1; j < events.length && j <= i + MAX_CHARGE_PAIRING_FORWARD_STEPS; j++) {
      const candidate = events[j];
      if (!candidate) continue;
      if (candidate.ActionCD1 !== FOUL_DRAWN_ACTION_CD1) continue;
      if (candidate.TeamID && candidate.TeamID !== foulEvent.TeamID) {
        bump(candidate.PlayerID1, "chargesDrawn");
      }
      break;
    }
  }
  return byPlayer;
}

/** HC/ベンチテクニカルファウル（ActionCD1=20/21）を選択中の期間範囲・チーム単位で数える。
 * 選手に紐付かないためbuildMiscEventCounts()の対象外で、TEAM/COACHES行・チーム合計行の
 * テクニカルファウル数にのみ計上する（DESIGN.md 2-2章参照） */
export function countTeamGeneratedTechnicalFouls(
  events: PlayByPlayEvent[],
  teamId: string | null,
  option: PeriodRangeOption | undefined,
): number {
  if (!teamId) return 0;
  let count = 0;
  for (const ev of events) {
    if (!periodInRange(option, ev.Period)) continue;
    if (ev.TeamID !== teamId) continue;
    if (ev.ActionCD1 === HC_TECHNICAL_FOUL_ACTION_CD1 || ev.ActionCD1 === BENCH_TECHNICAL_FOUL_ACTION_CD1) count += 1;
  }
  return count;
}

interface YahooTovCounts {
  liveTov: number;
  deadTov: number;
}

const ZERO_YAHOO_TOV: YahooTovCounts = { liveTov: 0, deadTov: 0 };

/**
 * ターンオーバーのライブ/デッドボール内訳を選手ごとに集計する（Yahoo!スポーツplay-by-play由来。
 * ballType==="unknown"（低頻度の未分類）はどちらにもカウントしない。isTeamTurnover===trueの
 * （24秒バイオレーション強制等、個人に紐付かない）ターンオーバーはチーム側の集計であり
 * 個人には計上しない
 */
function buildYahooTovCounts(turnovers: YahooTurnoverEvent[]): Map<string, YahooTovCounts> {
  const byPlayer = new Map<string, YahooTovCounts>();
  for (const to of turnovers) {
    if (to.isTeamTurnover || !to.playerId || to.ballType === "unknown") continue;
    const entry = byPlayer.get(to.playerId) ?? { ...ZERO_YAHOO_TOV };
    if (to.ballType === "live") entry.liveTov += 1;
    else entry.deadTov += 1;
    byPlayer.set(to.playerId, entry);
  }
  return byPlayer;
}

export interface PlayerBoxscore {
  playerId: string;
  playerNo: string;
  nameJ: string;
  startingFlg: 1 | null | "";
  /** 試合を通じて出場が無かったか（選択中の期間に関わらず一定） */
  dnp: boolean;
  counts: BoxscoreCounts;
  /**
   * ダブルダブル/トリプルダブルの達成バッジ。PTS/REB/AST/STL/BLKのうち2桁到達が2部門なら"DD"、
   * 3部門以上なら"TD"（両方満たす場合はTDのみ）。選択中の期間トグルに関わらず常に試合全体
   * （PeriodCategory=18）の成績で判定する（達成状況は試合全体で決まるものであり、Q別表示に
   * 切り替えても変わるべきではないため）
   */
  statBadge: "DD" | "TD" | null;
}

const DOUBLE_DIGIT_CATEGORY_COUNT_FOR_DD = 2;
const DOUBLE_DIGIT_CATEGORY_COUNT_FOR_TD = 3;

/** 試合全体の生行（PeriodCategory=18）からPTS/REB/AST/STL/BLKの2桁到達数を数え、DD/TDを判定する */
function computeStatBadge(gameRow: BoxscoreRow): "DD" | "TD" | null {
  const categories = [num(gameRow.Point), num(gameRow.RB_TOT), num(gameRow.AS), num(gameRow.ST), num(gameRow.BS)];
  const doubleDigitCount = categories.filter((v) => v >= 10).length;
  if (doubleDigitCount >= DOUBLE_DIGIT_CATEGORY_COUNT_FOR_TD) return "TD";
  if (doubleDigitCount >= DOUBLE_DIGIT_CATEGORY_COUNT_FOR_DD) return "DD";
  return null;
}

/**
 * 選手ごとの全期間行(Category=1)から、選択中の期間範囲に絞った集計を作る。
 * 名前・背番号・スタメン区分・DNP判定は常に試合全体(PeriodCategory=18)の行を基準にする
 * （出場時間や成績は期間で変わるが、これらの属性は試合を通じて固定のため）
 */
export function buildPlayerBoxscores(
  allRows: BoxscoreRow[],
  option: PeriodRangeOption | undefined,
  playByPlays: PlayByPlayEvent[] = [],
  yahooTurnovers: YahooTurnoverEvent[] = [],
): PlayerBoxscore[] {
  const gameRows = allRows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
  const rowsByPlayer = new Map<string, BoxscoreRow[]>();
  for (const r of allRows) {
    if (r.Category !== 1) continue;
    const list = rowsByPlayer.get(r.PlayerID) ?? [];
    list.push(r);
    rowsByPlayer.set(r.PlayerID, list);
  }
  // PlayByPlaysは選手行のようなPeriodCategory集計行を持たず、イベントごとにPeriodを直接持つため
  // periodInRange()でそのまま絞り込める（rowsInPeriodRangeのPeriodCategoryベースの絞り込みとは別経路）
  const periodFilteredPbp = playByPlays.filter((e) => periodInRange(option, e.Period));
  const { byPlayer: ptsOffTovByPlayer } = computePointsOffTurnovers(periodFilteredPbp);
  const { byPlayer: pitpByPlayer } = computePointsInPaint(periodFilteredPbp);
  const { byPlayer: fbpsByPlayer } = computeFastbreakPoints(periodFilteredPbp);
  const { byPlayer: secondChanceByPlayer } = computeSecondChancePoints(periodFilteredPbp);
  // buildShotEvents()はX/Y未収録の行を自然に除外するため、2022-23シーズンより前は
  // 常に空配列になり、以降の集計もpaint2m等が常に0のままになる（呼び出し側でshotChartSupportedを
  // 見て「-」表示にケアする）
  const paintSplitByPlayer = buildPaintSplitByPlayer(buildShotEvents(periodFilteredPbp));
  const miscEventsByPlayer = buildMiscEventCounts(periodFilteredPbp);
  const offensiveFoulCountsByPlayer = buildOffensiveFoulCounts(periodFilteredPbp);
  const assistedScoringByPlayer = computeAssistedScoring(periodFilteredPbp).byScorer;
  // YahooTurnoverEventはbleague.jp本体のPlayByPlaysとは別データ源・別のPeriod体系（periodRange.ts
  // のperiodInRangeはPeriod番号の数値だけを見るため、そのまま流用できる）
  const periodFilteredYahooTov = yahooTurnovers.filter((e) => periodInRange(option, e.period));
  const yahooTovByPlayer = buildYahooTovCounts(periodFilteredYahooTov);
  return gameRows.map((meta) => {
    const periodRows = rowsInPeriodRange(rowsByPlayer.get(meta.PlayerID) ?? [], option);
    const paintSplit = paintSplitByPlayer.get(meta.PlayerID) ?? ZERO_PAINT_SPLIT;
    const miscEvents = miscEventsByPlayer.get(meta.PlayerID) ?? ZERO_MISC_EVENTS;
    const offensiveFoulCounts = offensiveFoulCountsByPlayer.get(meta.PlayerID) ?? ZERO_OFFENSIVE_FOUL_COUNTS;
    const assistedScoring = assistedScoringByPlayer.get(meta.PlayerID) ?? ZERO_ASSISTED_SCORING;
    const yahooTov = yahooTovByPlayer.get(meta.PlayerID) ?? ZERO_YAHOO_TOV;
    return {
      playerId: meta.PlayerID,
      playerNo: meta.PlayerNo,
      nameJ: meta.PlayerNameJ,
      startingFlg: meta.StartingFlg,
      dnp: meta.PlayTime === "DNP",
      statBadge: computeStatBadge(meta),
      counts: {
        ...sumCounts(periodRows),
        ptsOffTov: ptsOffTovByPlayer.get(meta.PlayerID) ?? 0,
        // PT2IN/PTFB/PT2ND（sumCounts()の値、BoxscoreRowの生フィールド由来）は「得点」ではなく
        // 「シュート成功本数」のため、PBPタグ集計（得点）で上書きする（ptsOffTovと同じパターン）
        pt2in: pitpByPlayer.get(meta.PlayerID) ?? 0,
        ptfb: fbpsByPlayer.get(meta.PlayerID) ?? 0,
        pt2nd: secondChanceByPlayer.get(meta.PlayerID) ?? 0,
        ...paintSplit,
        ...miscEvents,
        ...offensiveFoulCounts,
        ...assistedScoring,
        ...yahooTov,
      },
    };
  });
}

/**
 * アシスト者-得点者のペア単位カウント（shared/assistedScoring.ts参照）。「誰から誰への
 * アシストが多いか」というランキングを将来作れるようにするためのデータ構造で、今回は
 * ランキングUI自体は未実装（データを用意するところまで。ユーザー確認済み）
 */
export function buildAssistPairs(playByPlays: PlayByPlayEvent[], option: PeriodRangeOption | undefined): AssistPair[] {
  const periodFilteredPbp = playByPlays.filter((e) => periodInRange(option, e.Period));
  return [...computeAssistedScoring(periodFilteredPbp).pairs.values()];
}

/**
 * チーム発生イベント行（TEAM/COACHES、Category=2）を選択中の期間範囲で集計する。
 * テクニカルファウル数のみ、Category=2行のFOULに他のチーム発生ファウルと混ざって計上されて
 * しまうため（DESIGN.md 2-2章）、PlayByPlaysからHC/ベンチテクニカル（ActionCD1=20/21）を
 * 個別に数えて上書きする
 */
export function buildTeamCoachesCounts(
  allRows: BoxscoreRow[],
  option: PeriodRangeOption | undefined,
  playByPlays: PlayByPlayEvent[] = [],
): BoxscoreCounts {
  const teamId = allRows.find((r) => r.TeamID)?.TeamID ?? null;
  return {
    ...sumCounts(rowsInPeriodRange(allRows.filter((r) => r.Category === 2), option)),
    technicalFouls: countTeamGeneratedTechnicalFouls(playByPlays, teamId, option),
  };
}

/** チーム合計行（Category=3）を選択中の期間範囲で集計する */
export function buildTeamTotalCounts(allRows: BoxscoreRow[], option: PeriodRangeOption | undefined): BoxscoreCounts {
  return sumCounts(rowsInPeriodRange(allRows.filter((r) => r.Category === 3), option));
}

export interface PlayTypeCounts {
  /** Points From Turnover（PTSOFFTO）。DESIGN.md 6章参照 */
  pft: number;
  /** Fast Break Points（FBPS） */
  fb: number;
  /** Second Chance Points（2NDPTS） */
  pt2nd: number;
  /** Points in the Paint（PITP）。個人行にもPT2INがあるためチーム単位で使うのはPFTのみだが、
   *  参考としてまとめて保持しておく */
  pt2in: number;
}

/** SummariesはHome/AwayTeamプレフィックス付きなので、側を指定して選択中の期間範囲で合算する */
export function buildPlayTypeCounts(
  summaries: SummaryRow[],
  side: "home" | "away",
  option: PeriodRangeOption | undefined,
): PlayTypeCounts {
  const rows = rowsInPeriodRange(summaries, option);
  const pftKey = side === "home" ? "HomeTeamPTPFT" : "AwayTeamPTPFT";
  const fbKey = side === "home" ? "HomeTeamPTFB" : "AwayTeamPTFB";
  const pt2ndKey = side === "home" ? "HomeTeamPT2ND" : "AwayTeamPT2ND";
  const pt2inKey = side === "home" ? "HomeTeamPT2IN" : "AwayTeamPT2IN";
  return rows.reduce(
    (acc, r) => ({
      pft: acc.pft + (r[pftKey] ?? 0),
      fb: acc.fb + (r[fbKey] ?? 0),
      pt2nd: acc.pt2nd + (r[pt2ndKey] ?? 0),
      pt2in: acc.pt2in + (r[pt2inKey] ?? 0),
    }),
    { pft: 0, fb: 0, pt2nd: 0, pt2in: 0 },
  );
}

export interface TeamRatings {
  poss: number;
  pace: number;
  offRtg: number;
  defRtg: number;
  netRtg: number;
}

/**
 * チームのPOSS/PACE/ORtg/DRtg/NetRtgを選択中の期間範囲の集計値から推定する。
 * 生データのPOSS/OFFRTG/DEFRTGフィールドは試合全体(PeriodCategory=18)にしか存在しないため
 * （Q別・前後半では空欄）、トグルのどの範囲を選んでも一貫した値になるよう常に
 * `estimatedPossessions`の推定式で計算する（KeyStatsSectionが試合全体で生データ優先・
 * フォールバックで推定式を使うのとは異なる方針。範囲間の値の一貫性を優先した）。
 * PACEは`aggregate.ts`のシーズン集計と同じく常に40分換算で正規化する（延長込みの実試合時間
 * ではなく固定値を使う既存の方針に合わせる）
 */
export function computeTeamRatings(own: BoxscoreCounts, opp: BoxscoreCounts): TeamRatings {
  const poss = estimatedPossessions(
    { fga: own.pt2a + own.pt3a, fgm: own.pt2m + own.pt3m, fta: own.fta, oreb: own.oreb, dreb: own.dreb, tov: own.tov },
    { fga: opp.pt2a + opp.pt3a, fgm: opp.pt2m + opp.pt3m, fta: opp.fta, oreb: opp.oreb, dreb: opp.dreb, tov: opp.tov },
  );
  const offRtg = offensiveRating(own.pts, poss);
  const defRtg = offensiveRating(opp.pts, poss);
  return {
    poss,
    offRtg,
    defRtg,
    netRtg: offRtg - defRtg,
    pace: pace(poss, own.minSec / 60),
  };
}

/** BoxscoreCountsをDean Oliver方式の個人/チームORtg/DRtg計算式（shared/formulas.ts）の入力形に変換する */
function toOliverBox(c: BoxscoreCounts): OliverBoxStats {
  return {
    min: c.minSec / 60,
    fgm: c.pt2m + c.pt3m,
    fga: c.pt2a + c.pt3a,
    fg3m: c.pt3m,
    ftm: c.ftm,
    fta: c.fta,
    pts: c.pts,
    ast: c.ast,
    oreb: c.oreb,
    dreb: c.dreb,
    tov: c.tov,
    stl: c.stl,
    blk: c.blk,
    pf: c.foul,
  };
}

export interface IndividualRatings {
  offRtg?: number;
  defRtg?: number;
  netRtg?: number;
}

/**
 * 個人ORtg/DRtg/NetRtg（Dean Oliver方式）。teamPossessionsには既存のPOSS推定値
 * （computeTeamRatings()のratings.poss）をそのまま渡す。基本ボックススコアのみで計算できる
 * ため選択中の期間範囲・シーズンを問わず動作する（PlayByPlaysには依存しない）
 */
export function computeIndividualRatings(
  player: BoxscoreCounts,
  team: BoxscoreCounts,
  opponent: BoxscoreCounts,
  teamPossessions: number,
): IndividualRatings {
  const playerBox = toOliverBox(player);
  const teamBox = toOliverBox(team);
  const opponentBox = toOliverBox(opponent);
  const offRtg = individualOffRtg(playerBox, teamBox, opponentBox);
  const defRtg = individualDefRtg(playerBox, teamBox, opponentBox, teamPossessions);
  return {
    offRtg,
    defRtg,
    netRtg: offRtg !== undefined && defRtg !== undefined ? offRtg - defRtg : undefined,
  };
}

/** AST/TOV。TOV=0の場合はAST数をそのまま比率として使う（一般的な慣例） */
export function astToTovRatio(ast: number, tov: number): number {
  return tov === 0 ? ast : ast / tov;
}

export function formatAstToRatio(ast: number, tov: number): string {
  return astToTovRatio(ast, tov).toFixed(1);
}

/** %-shareスタッツ（個人の数値／チームの数値 × 100）。Bリーグ公式定義（DESIGN.md 6章） */
export function sharePct(playerValue: number, teamValue: number): number {
  return safeDiv(100 * playerValue, teamValue);
}
