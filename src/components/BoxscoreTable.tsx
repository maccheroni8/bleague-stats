import { useState } from "react";
import { SeasonLink as Link } from "./SeasonLink";
import { PeriodRangeToggle } from "./PeriodRangeToggle";
import { buildPeriodRangeOptions, periodInRange, type PeriodRangeOption, type PeriodRangeValue } from "../lib/periodRange";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "../lib/format";
import { efgPct, tsPct, usagePct } from "../../shared/formulas";
import type { BoxscoreRow, PlayerSummary, SummaryRow } from "../../shared/types";
import {
  buildPlayTypeCounts,
  buildPlayerBoxscores,
  buildTeamCoachesCounts,
  buildTeamTotalCounts,
  computeTeamRatings,
  formatAstToRatio,
  formatMinutesFromSeconds,
  formatShotLine,
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
}

interface BoxscoreColumn {
  key: string;
  label: string;
  format: (c: BoxscoreCounts, ctx: ColumnCtx) => string;
}

const plusMinusCol: BoxscoreColumn = {
  key: "plusminus",
  label: "+/-",
  format: (c) => (c.hasPlusMinus ? formatSigned(c.plusMinus, 0) : "-"),
};

const TRADITIONAL_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec) },
  { key: "pts", label: "PTS", format: (c) => String(c.pts) },
  { key: "fg", label: "FG", format: (c) => formatShotLine(c.pt2m + c.pt3m, c.pt2a + c.pt3a) },
  { key: "2p", label: "2P", format: (c) => formatShotLine(c.pt2m, c.pt2a) },
  { key: "3p", label: "3P", format: (c) => formatShotLine(c.pt3m, c.pt3a) },
  { key: "ft", label: "FT", format: (c) => formatShotLine(c.ftm, c.fta) },
  { key: "efg", label: "eFG%", format: (c) => formatPct(efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a)) },
  { key: "ts", label: "TS%", format: (c) => formatPct(tsPct(c.pts, c.pt2a + c.pt3a, c.fta)) },
  { key: "or", label: "OR", format: (c) => String(c.oreb) },
  { key: "dr", label: "DR", format: (c) => String(c.dreb) },
  { key: "tr", label: "TR", format: (c) => String(c.treb) },
  { key: "ast", label: "AST", format: (c) => String(c.ast) },
  { key: "tov", label: "TOV", format: (c) => String(c.tov) },
  { key: "asttov", label: "AST/TOV", format: (c) => formatAstToRatio(c.ast, c.tov) },
  { key: "stl", label: "STL", format: (c) => String(c.stl) },
  { key: "blk", label: "BLK", format: (c) => String(c.blk) },
  { key: "bsr", label: "BSR", format: (c) => String(c.bson) },
  { key: "f", label: "F", format: (c) => String(c.foul) },
  { key: "fd", label: "FD", format: (c) => String(c.foulon) },
  { key: "eff", label: "EFF", format: (c) => String(c.eff) },
  plusMinusCol,
];

const ADVANCED_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec) },
  { key: "pts", label: "PTS", format: (c) => String(c.pts) },
  { key: "eff", label: "EFF", format: (c) => String(c.eff) },
  {
    key: "usg",
    label: "USG%",
    format: (c, ctx) =>
      ctx.isPlayerRow
        ? formatPct100(
            usagePct(
              { fga: c.pt2a + c.pt3a, fta: c.fta, tov: c.tov, min: c.minSec / 60 },
              { fga: ctx.own.pt2a + ctx.own.pt3a, fta: ctx.own.fta, tov: ctx.own.tov, min: ctx.own.minSec / 60 },
            ),
          )
        : "-",
  },
  { key: "efg", label: "eFG%", format: (c) => formatPct(efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a)) },
  { key: "ts", label: "TS%", format: (c) => formatPct(tsPct(c.pts, c.pt2a + c.pt3a, c.fta)) },
  { key: "poss", label: "POSS", format: (_c, ctx) => (ctx.ratings ? formatDecimal(ctx.ratings.poss, 1) : "-") },
  { key: "pace", label: "PACE", format: (_c, ctx) => (ctx.ratings ? formatDecimal(ctx.ratings.pace, 1) : "-") },
  { key: "ortg", label: "ORtg", format: (_c, ctx) => (ctx.ratings ? formatDecimal(ctx.ratings.offRtg, 1) : "-") },
  { key: "drtg", label: "DRtg", format: (_c, ctx) => (ctx.ratings ? formatDecimal(ctx.ratings.defRtg, 1) : "-") },
  { key: "netrtg", label: "NetRtg", format: (_c, ctx) => (ctx.ratings ? formatSigned(ctx.ratings.netRtg, 1) : "-") },
  plusMinusCol,
];

const MISC_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec) },
  { key: "pts", label: "PTS", format: (c) => String(c.pts) },
  { key: "pitp", label: "PITP", format: (c) => String(c.pt2in) },
  { key: "fbps", label: "FBPS", format: (c) => String(c.ptfb) },
  { key: "2ndpts", label: "2ND PTS", format: (c) => String(c.pt2nd) },
  {
    key: "ptsofftov",
    label: "PTSOFFTO",
    format: (_c, ctx) => (ctx.isTeamTotalRow ? String(ctx.ownPlayType.pft) : "-"),
  },
];

const SCORING_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec) },
  { key: "pts", label: "PTS", format: (c) => String(c.pts) },
  {
    key: "pctpts",
    label: "%PTS",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pts, ctx.own.pts)) : "-"),
  },
  {
    key: "pctfgm",
    label: "%FGM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt2m + c.pt3m, ctx.own.pt2m + ctx.own.pt3m)) : "-"),
  },
  {
    key: "pctfga",
    label: "%FGA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt2a + c.pt3a, ctx.own.pt2a + ctx.own.pt3a)) : "-"),
  },
  {
    key: "pct3pm",
    label: "%3PM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt3m, ctx.own.pt3m)) : "-"),
  },
  {
    key: "pct3pa",
    label: "%3PA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt3a, ctx.own.pt3a)) : "-"),
  },
  {
    key: "pctftm",
    label: "%FTM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.ftm, ctx.own.ftm)) : "-"),
  },
  {
    key: "pctfta",
    label: "%FTA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.fta, ctx.own.fta)) : "-"),
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
  periods: number;
  classificationById: Map<string, PlayerSummary["classification"]>;
  homeColor?: string;
  awayColor?: string;
}

export function BoxscoreTable({
  homeTeamName,
  awayTeamName,
  homeRows,
  awayRows,
  summaries,
  periods,
  classificationById,
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
        periodOption={selectedOption}
        columns={columns}
        classificationById={classificationById}
        accentColor={homeColor}
      />
      <BoxscoreTeamPanel
        teamName={awayTeamName}
        ownRows={awayRows}
        oppRows={homeRows}
        side="away"
        summaries={summaries}
        periodOption={selectedOption}
        columns={columns}
        classificationById={classificationById}
        accentColor={awayColor}
      />
    </>
  );
}

function BoxscoreTeamPanel({
  teamName,
  ownRows,
  oppRows,
  side,
  summaries,
  periodOption,
  columns,
  classificationById,
  accentColor,
}: {
  teamName: string;
  ownRows: BoxscoreRow[];
  oppRows: BoxscoreRow[];
  side: "home" | "away";
  summaries: SummaryRow[];
  periodOption: PeriodRangeOption | undefined;
  columns: BoxscoreColumn[];
  classificationById: Map<string, PlayerSummary["classification"]>;
  accentColor?: string;
}) {
  const players = buildPlayerBoxscores(ownRows, periodOption);
  const teamTotal = buildTeamTotalCounts(ownRows, periodOption);
  const oppTeamTotal = buildTeamTotalCounts(oppRows, periodOption);
  const coaches = buildTeamCoachesCounts(ownRows, periodOption);
  const playType = buildPlayTypeCounts(summaries, side, periodOption);
  const ratings = computeTeamRatings(teamTotal, oppTeamTotal);

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

  const playerCtx: ColumnCtx = { own: teamTotal, ownPlayType: playType, isPlayerRow: true, isTeamTotalRow: false };
  const nonPlayerCtx: ColumnCtx = { own: teamTotal, ownPlayType: playType, isPlayerRow: false, isTeamTotalRow: false };
  const teamTotalCtx: ColumnCtx = { own: teamTotal, ownPlayType: playType, ratings, isPlayerRow: false, isTeamTotalRow: true };

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
              <BoxscoreGroup title="スタメン" players={starters} columns={columns} ctx={playerCtx} />
              <BoxscoreGroup title="ベンチ" players={bench} columns={columns} ctx={playerCtx} />
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
        <div className="table-scroll">
          <table className="boxscore-table">
            <thead>
              <tr>
                <th className="align-left">内訳集計</th>
                {columns.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {starters.length > 0 && (
                <BoxscoreDataRow
                  label="スタメン合計"
                  counts={sumCountsList(starters.map((p) => p.counts))}
                  columns={columns}
                  ctx={nonPlayerCtx}
                  className="boxscore-summary-row"
                />
              )}
              {bench.length > 0 && (
                <BoxscoreDataRow
                  label="ベンチ合計"
                  counts={sumCountsList(bench.map((p) => p.counts))}
                  columns={columns}
                  ctx={nonPlayerCtx}
                  className="boxscore-summary-row"
                />
              )}
              {japanese.length > 0 && (
                <BoxscoreDataRow
                  label="日本人選手合計"
                  counts={sumCountsList(japanese.map((p) => p.counts))}
                  columns={columns}
                  ctx={nonPlayerCtx}
                  className="boxscore-summary-row"
                  note={classificationNote}
                />
              )}
              {international.length > 0 && (
                <BoxscoreDataRow
                  label="外国籍+帰化+アジア特別枠合計"
                  counts={sumCountsList(international.map((p) => p.counts))}
                  columns={columns}
                  ctx={nonPlayerCtx}
                  className="boxscore-summary-row"
                  note={classificationNote}
                />
              )}
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
}: {
  title: string;
  players: PlayerBoxscore[];
  columns: BoxscoreColumn[];
  ctx: ColumnCtx;
}) {
  if (players.length === 0) return null;
  return (
    <>
      <tr className="boxscore-group-row">
        <td colSpan={columns.length + 1}>{title}</td>
      </tr>
      {players.map((p) => (
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
            columns.map((col) => <td key={col.key}>{col.format(p.counts, ctx)}</td>)
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
