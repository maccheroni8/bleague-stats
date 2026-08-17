import { useState } from "react";
import { SeasonLink as Link } from "./SeasonLink";
import { PeriodRangeToggle } from "./PeriodRangeToggle";
import { buildPeriodRangeOptions, type PeriodRangeOption, type PeriodRangeValue } from "../lib/periodRange";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "../lib/format";
import { efgPct, safeDiv, tsPct, usagePct } from "../../shared/formulas";
import type { PlayerOnCourtRatings } from "../../shared/onCourt";
import type { BoxscoreRow, PlayByPlayEvent, PlayerSummary, SummaryRow } from "../../shared/types";
import {
  astToTovRatio,
  buildPlayTypeCounts,
  buildPlayerBoxscores,
  buildTeamCoachesCounts,
  buildTeamTotalCounts,
  computeIndividualRatings,
  computeTeamRatings,
  formatAstToRatio,
  formatMinutesFromSeconds,
  sharePct,
  sumCountsList,
  type BoxscoreCounts,
  type PlayTypeCounts,
  type PlayerBoxscore,
  type TeamRatings,
} from "../lib/boxscoreAggregate";

type BoxscoreTabKey = "traditional" | "advanced" | "misc" | "scoring";

const BOXSCORE_TABS: { key: BoxscoreTabKey; label: string }[] = [
  { key: "traditional", label: "トラディショナル" },
  { key: "advanced", label: "アドバンスド" },
  { key: "misc", label: "Misc" },
  { key: "scoring", label: "スコアリング" },
];

interface ColumnCtx {
  /** %-share・USG%の分母に使うチーム合計（選択中の期間範囲） */
  own: BoxscoreCounts;
  ownPlayType: PlayTypeCounts;
  /** チーム合計行のみ定義される（POSS/PACE/ORtg/DRtg/NetRtg用） */
  ratings?: TeamRatings;
  isPlayerRow: boolean;
  isTeamTotalRow: boolean;
  /** ペイント内外2P内訳の元になるX/Y/AreaCDが収録されているか（2022-23シーズン以降のみ。DESIGN.md参照） */
  shotChartSupported: boolean;
}

interface BoxscoreColumn {
  key: string;
  label: string;
  format: (c: BoxscoreCounts, ctx: ColumnCtx) => string;
  /**
   * トップ値ハイライト用の生数値。undefinedを返す（またはフィールド自体を省略する）列は
   * ハイライト対象外にする（FG/2P/3P/FT等の複合表示列、チーム単位でしか値を持たない列など）
   */
  value?: (c: BoxscoreCounts, ctx: ColumnCtx) => number | undefined;
  /** falseならTOV/BSR/Fのように値が小さいほど良い列。比較ページの仕組みと同じ規約（未指定はtrue扱い） */
  higherIsBetter?: boolean;
}

const plusMinusCol: BoxscoreColumn = {
  key: "plusminus",
  label: "+/-",
  format: (c) => (c.hasPlusMinus ? formatSigned(c.plusMinus, 0) : "-"),
  value: (c) => (c.hasPlusMinus ? c.plusMinus : undefined),
};

const TRADITIONAL_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec), value: (c) => c.minSec },
  { key: "pts", label: "PTS", format: (c) => String(c.pts), value: (c) => c.pts },
  { key: "fgm", label: "FGM", format: (c) => String(c.pt2m + c.pt3m), value: (c) => c.pt2m + c.pt3m },
  { key: "fga", label: "FGA", format: (c) => String(c.pt2a + c.pt3a), value: (c) => c.pt2a + c.pt3a },
  {
    key: "fgpct",
    label: "FG%",
    format: (c) => formatPct(safeDiv(c.pt2m + c.pt3m, c.pt2a + c.pt3a)),
    value: (c) => safeDiv(c.pt2m + c.pt3m, c.pt2a + c.pt3a),
  },
  { key: "2pm", label: "2PM", format: (c) => String(c.pt2m), value: (c) => c.pt2m },
  { key: "2pa", label: "2PA", format: (c) => String(c.pt2a), value: (c) => c.pt2a },
  {
    key: "2ppct",
    label: "2P%",
    format: (c) => formatPct(safeDiv(c.pt2m, c.pt2a)),
    value: (c) => safeDiv(c.pt2m, c.pt2a),
  },
  { key: "3pm", label: "3PM", format: (c) => String(c.pt3m), value: (c) => c.pt3m },
  { key: "3pa", label: "3PA", format: (c) => String(c.pt3a), value: (c) => c.pt3a },
  {
    key: "3ppct",
    label: "3P%",
    format: (c) => formatPct(safeDiv(c.pt3m, c.pt3a)),
    value: (c) => safeDiv(c.pt3m, c.pt3a),
  },
  { key: "ftm", label: "FTM", format: (c) => String(c.ftm), value: (c) => c.ftm },
  { key: "fta", label: "FTA", format: (c) => String(c.fta), value: (c) => c.fta },
  {
    key: "ftpct",
    label: "FT%",
    format: (c) => formatPct(safeDiv(c.ftm, c.fta)),
    value: (c) => safeDiv(c.ftm, c.fta),
  },
  {
    key: "efg",
    label: "eFG%",
    format: (c) => formatPct(efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a)),
    value: (c) => efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a),
  },
  {
    key: "ts",
    label: "TS%",
    format: (c) => formatPct(tsPct(c.pts, c.pt2a + c.pt3a, c.fta)),
    value: (c) => tsPct(c.pts, c.pt2a + c.pt3a, c.fta),
  },
  { key: "or", label: "OR", format: (c) => String(c.oreb), value: (c) => c.oreb },
  { key: "dr", label: "DR", format: (c) => String(c.dreb), value: (c) => c.dreb },
  { key: "tr", label: "TR", format: (c) => String(c.treb), value: (c) => c.treb },
  { key: "ast", label: "AST", format: (c) => String(c.ast), value: (c) => c.ast },
  { key: "tov", label: "TOV", format: (c) => String(c.tov), value: (c) => c.tov, higherIsBetter: false },
  {
    key: "asttov",
    label: "AST/TOV",
    format: (c) => formatAstToRatio(c.ast, c.tov),
    value: (c) => astToTovRatio(c.ast, c.tov),
  },
  { key: "stl", label: "STL", format: (c) => String(c.stl), value: (c) => c.stl },
  { key: "blk", label: "BLK", format: (c) => String(c.blk), value: (c) => c.blk },
  { key: "bsr", label: "BSR", format: (c) => String(c.bson), value: (c) => c.bson, higherIsBetter: false },
  { key: "f", label: "F", format: (c) => String(c.foul), value: (c) => c.foul, higherIsBetter: false },
  { key: "fd", label: "FD", format: (c) => String(c.foulon), value: (c) => c.foulon },
  { key: "eff", label: "EFF", format: (c) => String(c.eff), value: (c) => c.eff },
  plusMinusCol,
];

const ADVANCED_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec), value: (c) => c.minSec },
  { key: "pts", label: "PTS", format: (c) => String(c.pts), value: (c) => c.pts },
  { key: "eff", label: "EFF", format: (c) => String(c.eff), value: (c) => c.eff },
  {
    key: "usg",
    label: "USG%",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(usagePctOf(c, ctx)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? usagePctOf(c, ctx) : undefined),
  },
  {
    key: "efg",
    label: "eFG%",
    format: (c) => formatPct(efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a)),
    value: (c) => efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a),
  },
  {
    key: "ts",
    label: "TS%",
    format: (c) => formatPct(tsPct(c.pts, c.pt2a + c.pt3a, c.fta)),
    value: (c) => tsPct(c.pts, c.pt2a + c.pt3a, c.fta),
  },
  { key: "poss", label: "POSS", format: (_c, ctx) => (ctx.ratings ? formatDecimal(ctx.ratings.poss, 1) : "-") },
  {
    key: "pace",
    label: "PACE",
    format: (c, ctx) =>
      ctx.isTeamTotalRow
        ? ctx.ratings
          ? formatDecimal(ctx.ratings.pace, 1)
          : "-"
        : ctx.isPlayerRow && c.onCourtPace !== undefined
          ? formatDecimal(c.onCourtPace, 1)
          : "-",
    value: (c, ctx) => (ctx.isTeamTotalRow ? ctx.ratings?.pace : ctx.isPlayerRow ? c.onCourtPace : undefined),
  },
  {
    key: "ortg",
    label: "ORtg",
    format: (c, ctx) =>
      ctx.isTeamTotalRow
        ? ctx.ratings
          ? formatDecimal(ctx.ratings.offRtg, 1)
          : "-"
        : ctx.isPlayerRow && c.offRtg !== undefined
          ? formatDecimal(c.offRtg, 1)
          : "-",
    value: (c, ctx) => (ctx.isTeamTotalRow ? ctx.ratings?.offRtg : ctx.isPlayerRow ? c.offRtg : undefined),
  },
  {
    key: "drtg",
    label: "DRtg",
    format: (c, ctx) =>
      ctx.isTeamTotalRow
        ? ctx.ratings
          ? formatDecimal(ctx.ratings.defRtg, 1)
          : "-"
        : ctx.isPlayerRow && c.defRtg !== undefined
          ? formatDecimal(c.defRtg, 1)
          : "-",
    value: (c, ctx) => (ctx.isTeamTotalRow ? ctx.ratings?.defRtg : ctx.isPlayerRow ? c.defRtg : undefined),
    higherIsBetter: false,
  },
  {
    key: "netrtg",
    label: "NetRtg",
    format: (c, ctx) =>
      ctx.isTeamTotalRow
        ? ctx.ratings
          ? formatSigned(ctx.ratings.netRtg, 1)
          : "-"
        : ctx.isPlayerRow && c.netRtg !== undefined
          ? formatSigned(c.netRtg, 1)
          : "-",
    value: (c, ctx) => (ctx.isTeamTotalRow ? ctx.ratings?.netRtg : ctx.isPlayerRow ? c.netRtg : undefined),
  },
  plusMinusCol,
];

function usagePctOf(c: BoxscoreCounts, ctx: ColumnCtx): number {
  return usagePct(
    { fga: c.pt2a + c.pt3a, fta: c.fta, tov: c.tov, min: c.minSec / 60 },
    { fga: ctx.own.pt2a + ctx.own.pt3a, fta: ctx.own.fta, tov: ctx.own.tov, min: ctx.own.minSec / 60 },
  );
}

const MISC_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec), value: (c) => c.minSec },
  { key: "pts", label: "PTS", format: (c) => String(c.pts), value: (c) => c.pts },
  { key: "pitp", label: "PITP", format: (c) => String(c.pt2in), value: (c) => c.pt2in },
  { key: "fbps", label: "FBPS", format: (c) => String(c.ptfb), value: (c) => c.ptfb },
  { key: "2ndpts", label: "2ND PTS", format: (c) => String(c.pt2nd), value: (c) => c.pt2nd },
  {
    key: "ptsofftov",
    label: "PTSOFFTO",
    format: (c, ctx) => (ctx.isTeamTotalRow ? String(ctx.ownPlayType.pft) : String(c.ptsOffTov)),
    value: (c) => c.ptsOffTov,
  },
  { key: "dunk", label: "DUNK", format: (c) => String(c.dunks), value: (c) => c.dunks },
  { key: "and1", label: "AND1", format: (c) => String(c.basketCounts), value: (c) => c.basketCounts },
  // 低頻度なファウル2種は通常のFカラムとは別にMiscタブでのみ表示する（DUNK/AND1と異なり
  // ほぼ全選手が0になるため、ハイライト対象からは外す＝valueを持たせない）
  { key: "ufoul", label: "UFOUL", format: (c) => String(c.unsportsmanlikeFouls) },
  { key: "dqfoul", label: "DQFOUL", format: (c) => String(c.disqualifyingFouls) },
];

const SCORING_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec), value: (c) => c.minSec },
  { key: "pts", label: "PTS", format: (c) => String(c.pts), value: (c) => c.pts },
  {
    key: "pctpts",
    label: "%PTS",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pts, ctx.own.pts)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pts, ctx.own.pts) : undefined),
  },
  {
    key: "pctfgm",
    label: "%FGM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt2m + c.pt3m, ctx.own.pt2m + ctx.own.pt3m)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pt2m + c.pt3m, ctx.own.pt2m + ctx.own.pt3m) : undefined),
  },
  {
    key: "pctfga",
    label: "%FGA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt2a + c.pt3a, ctx.own.pt2a + ctx.own.pt3a)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pt2a + c.pt3a, ctx.own.pt2a + ctx.own.pt3a) : undefined),
  },
  {
    key: "pct3pm",
    label: "%3PM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt3m, ctx.own.pt3m)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pt3m, ctx.own.pt3m) : undefined),
  },
  {
    key: "pct3pa",
    label: "%3PA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt3a, ctx.own.pt3a)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pt3a, ctx.own.pt3a) : undefined),
  },
  {
    key: "pctftm",
    label: "%FTM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.ftm, ctx.own.ftm)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.ftm, ctx.own.ftm) : undefined),
  },
  {
    key: "pctfta",
    label: "%FTA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.fta, ctx.own.fta)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.fta, ctx.own.fta) : undefined),
  },
  {
    key: "paint2m",
    label: "PAINT2M",
    format: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? String(c.paint2m) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? c.paint2m : undefined),
  },
  {
    key: "paint2a",
    label: "PAINT2A",
    format: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? String(c.paint2a) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? c.paint2a : undefined),
  },
  {
    key: "paint2pct",
    label: "PAINT2%",
    format: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? formatPct(safeDiv(c.paint2m, c.paint2a)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? safeDiv(c.paint2m, c.paint2a) : undefined),
  },
  {
    key: "mid2m",
    label: "MID2M",
    format: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? String(c.nonPaint2m) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? c.nonPaint2m : undefined),
  },
  {
    key: "mid2a",
    label: "MID2A",
    format: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? String(c.nonPaint2a) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? c.nonPaint2a : undefined),
  },
  {
    key: "mid2pct",
    label: "MID2%",
    format: (c, ctx) =>
      ctx.isPlayerRow && ctx.shotChartSupported ? formatPct(safeDiv(c.nonPaint2m, c.nonPaint2a)) : "-",
    value: (c, ctx) => (ctx.isPlayerRow && ctx.shotChartSupported ? safeDiv(c.nonPaint2m, c.nonPaint2a) : undefined),
  },
];

const COLUMNS_BY_TAB: Record<BoxscoreTabKey, BoxscoreColumn[]> = {
  traditional: TRADITIONAL_COLUMNS,
  advanced: ADVANCED_COLUMNS,
  misc: MISC_COLUMNS,
  scoring: SCORING_COLUMNS,
};

interface BoxscoreTableProps {
  homeTeamName: string;
  awayTeamName: string;
  homeRows: BoxscoreRow[];
  awayRows: BoxscoreRow[];
  summaries: SummaryRow[];
  playByPlays: PlayByPlayEvent[];
  periods: number;
  classificationById: Map<string, PlayerSummary["classification"]>;
  /** ペイント内外2P内訳（スコアリングタブ）の元になるX/Y/AreaCDが収録されているか。2022-23シーズン以降のみ */
  shotChartSupported: boolean;
  /** 個人単位の在コート中OFFRTG/DEFRTG/NETRTG/PACE（shared/onCourt.ts）。shotChartSupportedがfalseなら空 */
  onCourtRatings: Record<string, PlayerOnCourtRatings>;
  homeColor?: string;
  awayColor?: string;
}

export function BoxscoreTable({
  homeTeamName,
  awayTeamName,
  homeRows,
  awayRows,
  summaries,
  playByPlays,
  periods,
  classificationById,
  shotChartSupported,
  onCourtRatings,
  homeColor,
  awayColor,
}: BoxscoreTableProps) {
  const [activeTab, setActiveTab] = useState<BoxscoreTabKey>("traditional");
  const [periodRange, setPeriodRange] = useState<PeriodRangeValue>("all");

  const periodOptions = buildPeriodRangeOptions(periods);
  const selectedOption = periodOptions.find((o) => o.value === periodRange);
  const columns = COLUMNS_BY_TAB[activeTab];

  return (
    <>
      <div className="boxscore-controls">
        <div className="mode-toggle boxscore-category-tabs">
          {BOXSCORE_TABS.map((tab) => (
            <button key={tab.key} className={tab.key === activeTab ? "active" : ""} onClick={() => setActiveTab(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
        <PeriodRangeToggle options={periodOptions} value={periodRange} onChange={setPeriodRange} />
      </div>
      <BoxscoreTeamPanel
        teamName={homeTeamName}
        ownRows={homeRows}
        oppRows={awayRows}
        side="home"
        summaries={summaries}
        playByPlays={playByPlays}
        periodOption={selectedOption}
        columns={columns}
        classificationById={classificationById}
        shotChartSupported={shotChartSupported}
        onCourtRatings={onCourtRatings}
        accentColor={homeColor}
      />
      <BoxscoreTeamPanel
        teamName={awayTeamName}
        ownRows={awayRows}
        oppRows={homeRows}
        side="away"
        summaries={summaries}
        playByPlays={playByPlays}
        periodOption={selectedOption}
        columns={columns}
        classificationById={classificationById}
        shotChartSupported={shotChartSupported}
        onCourtRatings={onCourtRatings}
        accentColor={awayColor}
      />
    </>
  );
}

/** トップ値ハイライト対象の各列について、DNPを除く選手の中でのベスト値を求める（比較ページのcompare-bestと同じ規約） */
function computeBestByColumn(
  players: PlayerBoxscore[],
  columns: BoxscoreColumn[],
  ctx: ColumnCtx,
): Map<string, number> {
  const candidates = players.filter((p) => !p.dnp);
  const best = new Map<string, number>();
  for (const col of columns) {
    if (!col.value) continue;
    const values = candidates
      .map((p) => col.value!(p.counts, ctx))
      .filter((v): v is number => v !== undefined);
    if (values.length < 2) continue;
    best.set(col.key, col.higherIsBetter === false ? Math.min(...values) : Math.max(...values));
  }
  return best;
}

/** この集計セクションでは+/-が意味を持たないため、常に「-」表示になるよう強制する */
function withoutPlusMinus(counts: BoxscoreCounts): BoxscoreCounts {
  return { ...counts, hasPlusMinus: false };
}

function BoxscoreTeamPanel({
  teamName,
  ownRows,
  oppRows,
  side,
  summaries,
  playByPlays,
  periodOption,
  columns,
  classificationById,
  shotChartSupported,
  onCourtRatings,
  accentColor,
}: {
  teamName: string;
  ownRows: BoxscoreRow[];
  oppRows: BoxscoreRow[];
  side: "home" | "away";
  summaries: SummaryRow[];
  playByPlays: PlayByPlayEvent[];
  periodOption: PeriodRangeOption | undefined;
  columns: BoxscoreColumn[];
  classificationById: Map<string, PlayerSummary["classification"]>;
  shotChartSupported: boolean;
  onCourtRatings: Record<string, PlayerOnCourtRatings>;
  accentColor?: string;
}) {
  let teamTotal = buildTeamTotalCounts(ownRows, periodOption);
  const oppTeamTotal = buildTeamTotalCounts(oppRows, periodOption);
  const coaches = buildTeamCoachesCounts(ownRows, periodOption);
  const playType = buildPlayTypeCounts(summaries, side, periodOption);
  const ratings = computeTeamRatings(teamTotal, oppTeamTotal);

  // 個人PACEは試合全体（periods===null）選択時のみマージする。PlayByPlaysのポゼッション区切り
  // 検出（shared/onCourt.ts）に依存するため、Q別・前後半選択時に「試合全体固定」の値が出ると
  // 誤解を招く（他のペイント内外2P等と同じくundefinedのままにし「-」表示にする）。
  // 一方、個人ORtg/DRtg/NetRtg（Dean Oliver方式）は選択中の期間範囲のBoxscoreCountsのみで
  // 計算できるため、期間範囲を問わず常にマージする
  const showOnCourtPace = periodOption === undefined || periodOption.periods === null;
  const players = buildPlayerBoxscores(ownRows, periodOption, playByPlays).map((p) => {
    const { offRtg, defRtg, netRtg } = computeIndividualRatings(p.counts, teamTotal, oppTeamTotal, ratings.poss);
    const onCourtPace = showOnCourtPace ? onCourtRatings[p.playerId]?.pace : undefined;
    return { ...p, counts: { ...p.counts, offRtg, defRtg, netRtg, onCourtPace } };
  });

  // F4（ダンク数・バスケットカウント・アンスポーツマンファウル・ディスクォリファイングファウル）は
  // BoxscoreRowに個人単位のフィールドが無く、buildTeamTotalCounts()（Category=3行ベース）では
  // 常に0のままなので、選手ごとの集計値を合算してチーム合計行に反映する
  const miscTeamTotals = sumCountsList(players.map((p) => p.counts));
  teamTotal = {
    ...teamTotal,
    dunks: miscTeamTotals.dunks,
    basketCounts: miscTeamTotals.basketCounts,
    unsportsmanlikeFouls: miscTeamTotals.unsportsmanlikeFouls,
    disqualifyingFouls: miscTeamTotals.disqualifyingFouls,
  };

  const starters = players.filter((p) => p.startingFlg === 1);
  const bench = players.filter((p) => p.startingFlg !== 1);
  const japanese = players.filter((p) => classificationById.get(p.playerId) === "日本人");
  const international = players.filter((p) => {
    const c = classificationById.get(p.playerId);
    return c === "外国籍" || c === "帰化選手" || c === "アジア特別枠";
  });
  const unclassifiedPlayedCount = players.filter((p) => !p.dnp && classificationById.get(p.playerId) === undefined).length;
  const classificationNote =
    "※現在の登録情報に基づく参考値" + (unclassifiedPlayedCount > 0 ? `／${unclassifiedPlayedCount}名分のデータ欠落あり` : "");

  const playerCtx: ColumnCtx = {
    own: teamTotal,
    ownPlayType: playType,
    isPlayerRow: true,
    isTeamTotalRow: false,
    shotChartSupported,
  };
  const nonPlayerCtx: ColumnCtx = {
    own: teamTotal,
    ownPlayType: playType,
    isPlayerRow: false,
    isTeamTotalRow: false,
    shotChartSupported,
  };
  const teamTotalCtx: ColumnCtx = {
    own: teamTotal,
    ownPlayType: playType,
    ratings,
    isPlayerRow: false,
    isTeamTotalRow: true,
    shotChartSupported,
  };
  // 内訳集計セクションの「チーム合計」行は+/-を除きteamTotalCtxと同じ扱い（POSS/PACE等は引き続き表示する）
  const summaryTotalCtx: ColumnCtx = teamTotalCtx;

  // ハイライトはスタメン・ベンチを跨いだチーム全体で見た「トップ値」（Bリーグ公式ボックススコアの
  // チームリーダー表示と同じ考え方）。DNPは0値で不当に最良値を取ってしまうため候補から除外する
  const bestByColumn = computeBestByColumn(players, columns, playerCtx);

  return (
    <>
      <div className="boxscore-section" style={accentColor ? { borderLeftColor: accentColor } : undefined}>
        <h3>{teamName}</h3>
        <div className="table-scroll">
          <table className="boxscore-table">
            <thead>
              <tr>
                <th className="align-left">選手</th>
                {columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <BoxscoreGroup title="スタメン" players={starters} columns={columns} ctx={playerCtx} bestByColumn={bestByColumn} />
              <BoxscoreGroup title="ベンチ" players={bench} columns={columns} ctx={playerCtx} bestByColumn={bestByColumn} />
              <BoxscoreDataRow
                label="TEAM / COACHES"
                counts={coaches}
                columns={columns}
                ctx={nonPlayerCtx}
                className="team-coaches-row"
              />
              <BoxscoreDataRow
                label="チーム合計"
                counts={teamTotal}
                columns={columns}
                ctx={teamTotalCtx}
                className="boxscore-summary-row"
              />
            </tbody>
          </table>
        </div>
      </div>

      <div className="boxscore-summary-section">
        <h4>内訳集計</h4>
        <div className="table-scroll">
          <table className="boxscore-table">
            <thead>
              <tr>
                <th className="align-left"> </th>
                {columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <BoxscoreDataRow
                label="スタメン合計"
                counts={withoutPlusMinus(sumCountsList(starters.map((p) => p.counts)))}
                columns={columns}
                ctx={nonPlayerCtx}
                className="boxscore-summary-row"
              />
              <BoxscoreDataRow
                label="ベンチ合計"
                counts={withoutPlusMinus(sumCountsList(bench.map((p) => p.counts)))}
                columns={columns}
                ctx={nonPlayerCtx}
                className="boxscore-summary-row"
              />
              <BoxscoreDataRow
                label="チーム合計"
                counts={withoutPlusMinus(teamTotal)}
                columns={columns}
                ctx={summaryTotalCtx}
                className="boxscore-summary-row boxscore-summary-grand-total"
              />
              <tr className="boxscore-summary-spacer" aria-hidden="true">
                <td colSpan={columns.length + 1} />
              </tr>
              <BoxscoreDataRow
                label="日本人選手合計"
                counts={withoutPlusMinus(sumCountsList(japanese.map((p) => p.counts)))}
                columns={columns}
                ctx={nonPlayerCtx}
                className="boxscore-summary-row"
                note={classificationNote}
              />
              <BoxscoreDataRow
                label="外国籍+帰化+アジア特別枠合計"
                counts={withoutPlusMinus(sumCountsList(international.map((p) => p.counts)))}
                columns={columns}
                ctx={nonPlayerCtx}
                className="boxscore-summary-row"
                note={classificationNote}
              />
              <BoxscoreDataRow
                label="チーム合計"
                counts={withoutPlusMinus(teamTotal)}
                columns={columns}
                ctx={summaryTotalCtx}
                className="boxscore-summary-row boxscore-summary-grand-total"
              />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function BoxscoreGroup({
  title,
  players,
  columns,
  ctx,
  bestByColumn,
}: {
  title: string;
  players: PlayerBoxscore[];
  columns: BoxscoreColumn[];
  ctx: ColumnCtx;
  bestByColumn: Map<string, number>;
}) {
  if (players.length === 0) return null;
  // DNPは各グループの下部にまとめる（出場した選手を先に見せる）。それ以外は元の並び順を保持する
  const ordered = [...players].sort((a, b) => Number(a.dnp) - Number(b.dnp));
  return (
    <>
      <tr className="boxscore-group-row">
        <td colSpan={columns.length + 1}>{title}</td>
      </tr>
      {ordered.map((p) => (
        <tr key={p.playerId} className={p.dnp ? "dnp-row" : undefined}>
          <td className="align-left">
            {p.playerId ? (
              <Link to={`/players/${p.playerId}`} className="cell-link">
                {p.nameJ}
              </Link>
            ) : (
              p.nameJ
            )}
          </td>
          {p.dnp ? (
            <td colSpan={columns.length}>DNP</td>
          ) : (
            columns.map((col) => {
              const val = col.value?.(p.counts, ctx);
              const isBest = val !== undefined && bestByColumn.get(col.key) === val;
              return (
                <td key={col.key} className={isBest ? "boxscore-best" : undefined}>
                  {col.format(p.counts, ctx)}
                </td>
              );
            })
          )}
        </tr>
      ))}
    </>
  );
}

function BoxscoreDataRow({
  label,
  counts,
  columns,
  ctx,
  className,
  note,
}: {
  label: string;
  counts: BoxscoreCounts;
  columns: BoxscoreColumn[];
  ctx: ColumnCtx;
  className?: string;
  note?: string;
}) {
  return (
    <tr className={className}>
      <td className="align-left">
        {label}
        {note && (
          <span className="row-note" title={note}>
            ※
          </span>
        )}
      </td>
      {columns.map((col) => (
        <td key={col.key}>{col.format(counts, ctx)}</td>
      ))}
    </tr>
  );
}
