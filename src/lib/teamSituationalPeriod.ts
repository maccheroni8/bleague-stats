// チーム詳細 > チームスタッツ > シチュエーション別成績の、区間別（1Q〜4Q・前半・後半・延長。DESIGN.md 273章）。
// 以前は区間を選ぶと試合の生データ（ボックススコア・プレーバイプレーなど）を読んで計算していた。
// 全チームスタッツの区間別（teamPeriodTotals.ts の sumTeamPeriodTotals。チームのピリオド別の索引から作る）と同じ関数で値を作り、
// 行の表（BoxscoreColumn。自チーム・opp・+/- のどの視点でも使える）に渡せる形に直す。
// 同じ値・同じ数え方（PITP・FBPS・ペイント内外・ポゼッションなど）になる。
// 索引に無い項目（BSR・EFF・OFF FOUL・CHARGE・LIVETOV・DEADTOV）は「-」にする（INDEX_UNAVAILABLE_COLUMN_KEYS）。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { offensiveRating, pace } from "../../shared/formulas";
import type { TeamGameLog } from "../../shared/types";
import { scaleCounts, sumCountsList, type BoxscoreCounts, type PlayTypeCounts } from "./boxscoreAggregate";
import type { BoxscoreColumn } from "../components/BoxscoreTable";
import type { SeasonDisplayMode, TeamGameBoxTotals, TeamPointsBreakdownResult } from "./playerSeasonBoxscore";
import { sumTeamPeriodTotals, type TeamPeriodSource, type TeamPeriodValue } from "./teamPeriodTotals";
import type { TeamTotals } from "./teamStatsColumns";

/** チームのピリオド別の索引に無い項目の列。区間を選んでいる間は「-」にする */
export const INDEX_UNAVAILABLE_COLUMN_KEYS: ReadonlySet<string> = new Set([
  "bsr",
  "eff",
  "offfoul",
  "charge",
  "livetov",
  "deadtov",
  "livetovpct",
  "deadtovpct",
]);

/** 列のうち、索引から出せないものを「-」にする（並びは変えない） */
export function withIndexUnavailableColumns(columns: BoxscoreColumn[]): BoxscoreColumn[] {
  return columns.map((col) =>
    INDEX_UNAVAILABLE_COLUMN_KEYS.has(col.key) ? { ...col, format: () => "-", value: undefined } : col,
  );
}

function zeroCounts(): BoxscoreCounts {
  // sumCountsList([]) は boxscoreAggregate.ts の定数そのものを返すので、書き換えないよう必ず写しを作る
  return { ...sumCountsList([]) };
}

/** TeamTotals（自チーム側）を BoxscoreCounts に直す。opp が true なら相手側の項目から作る */
function countsOf(t: TeamTotals, opp: boolean): BoxscoreCounts {
  const c = zeroCounts();
  const pick = (own: number, against: number) => (opp ? against : own);
  const fgm = pick(t.fgm, t.oppFgm);
  const fga = pick(t.fga, t.oppFga);
  const tpm = pick(t.tpm, t.oppTpm);
  const tpa = pick(t.tpa, t.oppTpa);
  const pts = pick(t.pts, t.oppPts);
  const otherPts = pick(t.oppPts, t.pts);
  return {
    ...c,
    minSec: t.min * 60,
    pts,
    pt2m: fgm - tpm,
    pt2a: fga - tpa,
    pt3m: tpm,
    pt3a: tpa,
    ftm: pick(t.ftm, t.oppFtm),
    fta: pick(t.fta, t.oppFta),
    oreb: pick(t.oreb, t.oppOreb),
    dreb: pick(t.dreb, t.oppDreb),
    treb: opp ? t.oppOreb + t.oppDreb : t.reb,
    ast: pick(t.ast, t.oppAst),
    tov: pick(t.tov, t.oppTov),
    stl: pick(t.stl, t.oppStl),
    blk: pick(t.blk, t.oppBlk),
    foul: pick(t.pf, t.oppPf),
    foulon: pick(t.fd, t.oppFd),
    // 全チームスタッツの +/- と同じく、区間の得点の差（視点が相手のときは逆）
    plusMinus: pts - otherPts,
    hasPlusMinus: true,
    pt2in: pick(t.pt2in, t.oppPt2in),
    ptfb: pick(t.fb, t.oppFb),
    pt2nd: pick(t.pt2nd, t.oppPt2nd),
    ptsOffTov: pick(t.pft, t.oppPft),
    dunks: pick(t.dunks, t.oppDunks),
    basketCounts: pick(t.basketCounts, t.oppBasketCounts),
    technicalFouls: pick(t.technicalFouls, t.oppTechnicalFouls),
    unsportsmanlikeFouls: pick(t.unsportsmanlikeFouls, t.oppUnsportsmanlikeFouls),
    disqualifyingFouls: pick(t.disqualifyingFouls, t.oppDisqualifyingFouls),
    technicalFoulsCat1: pick(t.technicalFoulsCat1, t.oppTechnicalFoulsCat1),
    technicalFoulsCat2: pick(t.technicalFoulsCat2, t.oppTechnicalFoulsCat2),
    flagrantFouls: pick(t.flagrantFouls, t.oppFlagrantFouls),
    disruptiveFouls: pick(t.disruptiveFouls, t.oppDisruptiveFouls),
    assisted2m: pick(t.assisted2m, t.oppAssisted2m),
    assisted3m: pick(t.assisted3m, t.oppAssisted3m),
    assistedFtm: pick(t.assistedFtm, t.oppAssistedFtm),
    paint2m: pick(t.paint2m, t.oppPaint2m),
    paint2a: pick(t.paint2a, t.oppPaint2a),
    nonPaint2m: pick(t.mid2m, t.oppMid2m),
    nonPaint2a: pick(t.mid2a, t.oppMid2a),
  };
}

function playTypeOf(t: TeamTotals, opp: boolean): PlayTypeCounts {
  return opp
    ? { pft: t.oppPft, fb: t.oppFb, pt2nd: t.oppPt2nd, pt2in: t.oppPt2in }
    : { pft: t.pft, fb: t.fb, pt2nd: t.pt2nd, pt2in: t.pt2in };
}

function scalePlayType(p: PlayTypeCounts, factor: number): PlayTypeCounts {
  return { pft: p.pft * factor, fb: p.fb * factor, pt2nd: p.pt2nd * factor, pt2in: p.pt2in * factor };
}

export interface TeamPeriodRowValues {
  /** 区間の値がある試合（平均の分母・勝敗の数え方に使う） */
  games: TeamGameLog[];
  boxTotals: TeamGameBoxTotals;
  /** ベンチ／スタメン得点・登録区分別の得点（合計または1試合平均） */
  points: TeamPointsBreakdownResult;
}

/**
 * 絞り込み済みの試合ログ（行に属する試合）の、区間の値。区間の値がある試合（1Q〜後半は特別な試合を除く全試合、延長は延長のあった試合）が無ければ null。
 * mode が "total" 以外は、数えた試合で割った1試合平均（ポゼッション系・レーティングは比率なのでどちらでも同じ）
 */
export function buildTeamPeriodRowValues(
  source: TeamPeriodSource,
  logs: readonly TeamGameLog[],
  value: TeamPeriodValue,
  mode: SeasonDisplayMode,
  flags: { shotChartSupported: boolean; yahooPbpSupported: boolean },
): TeamPeriodRowValues | null {
  const { games, totals } = sumTeamPeriodTotals(source, logs, value);
  if (games.length === 0) return null;
  const factor = mode === "total" ? 1 : 1 / games.length;
  const ownSum = countsOf(totals, false);
  const oppSum = countsOf(totals, true);
  const poss = totals.poss;
  const offRtg = offensiveRating(totals.pts, poss);
  const defRtg = offensiveRating(totals.oppPts, poss);
  const teamPace = pace(poss, totals.min);
  const own = scaleCounts(ownSum, factor);
  const opp = scaleCounts(oppSum, factor);
  const ctxBase = { isPlayerRow: false, isTeamTotalRow: true, shotChartSupported: flags.shotChartSupported, yahooPbpSupported: flags.yahooPbpSupported };
  const possShown = poss * factor;
  return {
    games,
    boxTotals: {
      own,
      opp,
      ownCtx: {
        ...ctxBase,
        own,
        ownPlayType: scalePlayType(playTypeOf(totals, false), factor),
        ratings: { poss: possShown, pace: teamPace, offRtg, defRtg, netRtg: offRtg - defRtg },
      },
      oppCtx: {
        ...ctxBase,
        own: opp,
        ownPlayType: scalePlayType(playTypeOf(totals, true), factor),
        ratings: { poss: possShown, pace: teamPace, offRtg: defRtg, defRtg: offRtg, netRtg: defRtg - offRtg },
      },
    },
    points: {
      own: {
        bench: totals.benchPoints * factor,
        starter: totals.starterPoints * factor,
        japanese: totals.japanesePoints * factor,
        international: totals.internationalPoints * factor,
      },
      opp: {
        bench: totals.oppBenchPoints * factor,
        starter: totals.oppStarterPoints * factor,
        japanese: totals.oppJapanesePoints * factor,
        international: totals.oppInternationalPoints * factor,
      },
      gamesPlayed: games.length,
    },
  };
}
