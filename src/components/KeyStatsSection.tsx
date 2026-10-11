import type { BoxscoreRow, SummaryRow } from "../../shared/types";
import { efgPct, ftRate, orbPct, safeDiv, tovPct } from "../../shared/formulas";
import { buildTeamTotalCounts, computeTeamRatings } from "../lib/boxscoreAggregate";
import { formatDecimal, formatSigned } from "../lib/format";
import { OpposedBarRow, OpposedValueRow } from "./OpposedBar";
import { ShootingDonut } from "./ShootingDonut";

interface KeyStatsSectionProps {
  homeTotal: BoxscoreRow;
  awayTotal: BoxscoreRow;
  /**
   * チームの全行（Category=3 の合計行を含む）。テンポと効率（POSS・PACE・ORtg・DRtg・NetRtg）を、
   * ボックススコアのアドバンスドの「チーム合計」行と同じ関数（computeTeamRatings）で出すために使う
   */
  homeRows: BoxscoreRow[];
  awayRows: BoxscoreRow[];
  /** 延長のある試合か（テンポと効率の注記を出す） */
  hasOvertime: boolean;
  /** ベンチ得点算出用（Category=1・PeriodCategory=18の個人行） */
  homePlayers: BoxscoreRow[];
  awayPlayers: BoxscoreRow[];
  /**
   * プレータイプ内訳（Points off TO/Fastbreak/Second Chance/Points in Paint）用。PeriodCategory=18の1件。
   * フィールド対応（genius_game_new2208.jsのレンダリング処理で確認済み。DESIGN.md 6章参照）:
   * PT2IN=Points in the Paint, PTFB=Fast Break Points, PT2ND=Second Chance Points,
   * PTPFT=Points From Turnover（Points off TOV）
   */
  gameSummary?: SummaryRow;
  homeColor?: string;
  awayColor?: string;
}

function benchPoints(rows: BoxscoreRow[]): number {
  return rows.filter((r) => r.StartingFlg !== 1).reduce((sum, r) => sum + r.Point, 0);
}

function fgPct(row: BoxscoreRow): number {
  return safeDiv(row.PT2M + row.PT3M, row.PT2A + row.PT3A) * 100;
}

const pct1 = (v: number) => `${v.toFixed(1)}%`;
const dec1 = (v: number) => formatDecimal(v, 1);
const signed1 = (v: number) => formatSigned(v, 1);
const int0 = (v: number) => String(Math.round(v));

export function KeyStatsSection({
  homeTotal,
  awayTotal,
  homeRows,
  awayRows,
  hasOvertime,
  homePlayers,
  awayPlayers,
  gameSummary,
  homeColor,
  awayColor,
}: KeyStatsSectionProps) {
  const home = homeColor ?? "var(--accent)";
  const away = awayColor ?? "var(--muted)";

  const homeFga = homeTotal.PT2A + homeTotal.PT3A;
  const awayFga = awayTotal.PT2A + awayTotal.PT3A;

  // テンポと効率: ボックススコアのアドバンスドの「チーム合計」行と同じ値（推定式。全シーズン共通。チーム詳細の値とも同じ）
  const homeCounts = buildTeamTotalCounts(homeRows, undefined);
  const awayCounts = buildTeamTotalCounts(awayRows, undefined);
  const homeRatings = computeTeamRatings(homeCounts, awayCounts);
  const awayRatings = computeTeamRatings(awayCounts, homeCounts);
  const homeEfg = efgPct(homeTotal.PT2M + homeTotal.PT3M, homeTotal.PT3M, homeFga) * 100;
  const awayEfg = efgPct(awayTotal.PT2M + awayTotal.PT3M, awayTotal.PT3M, awayFga) * 100;
  // TOV% は標準式 TOV ÷ (FGA + 0.44×FTA + TOV)（アドバンスドの TOV% と同じ。以前は TO ÷ ポゼッションだった。設計書232章）
  const homeTovPct = tovPct(homeTotal.TO, homeFga, homeTotal.FTA);
  const awayTovPct = tovPct(awayTotal.TO, awayFga, awayTotal.FTA);
  const homeOrbPct = orbPct(homeTotal.RB_OFF, awayTotal.RB_DEF);
  const awayOrbPct = orbPct(awayTotal.RB_OFF, homeTotal.RB_DEF);
  const homeFtr = ftRate(homeTotal.FTA, homeFga) * 100;
  const awayFtr = ftRate(awayTotal.FTA, awayFga) * 100;

  // バーの長さの基準: 長い方が100%にならない（数値ボックスがカードの外へはみ出さない）よう、最大値に余白を持たせる。
  // POSS と PACE（ポゼッションの数）、ORtg と DRtg（100ポゼッションあたりの得点）はそれぞれ同じ基準で並べる
  const BAR_HEADROOM = 1.3;
  const possBarMax = Math.max(homeRatings.poss, awayRatings.poss, homeRatings.pace, awayRatings.pace, 1) * BAR_HEADROOM;
  const ratingBarMax = Math.max(homeRatings.offRtg, awayRatings.offRtg, homeRatings.defRtg, awayRatings.defRtg, 1) * BAR_HEADROOM;

  const homeBench = benchPoints(homePlayers);
  const awayBench = benchPoints(awayPlayers);

  return (
    <>
      <h2>キースタッツ</h2>

      <section className="key-stats-card">
        <h3>シュート%</h3>
        <div className="shooting-donut-row">
          <ShootingDonut label="FG%" value={fgPct(homeTotal)} color={home} />
          <div className="shooting-donut-divider" />
          <ShootingDonut label="FG%" value={fgPct(awayTotal)} color={away} />
        </div>
        <OpposedBarRow
          label="2P%"
          homeValue={safeDiv(homeTotal.PT2M, homeTotal.PT2A) * 100}
          awayValue={safeDiv(awayTotal.PT2M, awayTotal.PT2A) * 100}
          homeColor={home}
          awayColor={away}
          format={pct1}
          scale="fixed100"
        />
        <OpposedBarRow
          label="3P%"
          homeValue={safeDiv(homeTotal.PT3M, homeTotal.PT3A) * 100}
          awayValue={safeDiv(awayTotal.PT3M, awayTotal.PT3A) * 100}
          homeColor={home}
          awayColor={away}
          format={pct1}
          scale="fixed100"
        />
        <OpposedBarRow
          label="FT%"
          homeValue={safeDiv(homeTotal.FTM, homeTotal.FTA) * 100}
          awayValue={safeDiv(awayTotal.FTM, awayTotal.FTA) * 100}
          homeColor={home}
          awayColor={away}
          format={pct1}
          scale="fixed100"
        />
      </section>

      <section className="key-stats-card">
        <h3>ボリューム系</h3>
        <OpposedBarRow label="PTS" homeValue={homeTotal.Point} awayValue={awayTotal.Point} homeColor={home} awayColor={away} format={int0} />
        <OpposedBarRow label="REB" homeValue={homeTotal.RB_TOT} awayValue={awayTotal.RB_TOT} homeColor={home} awayColor={away} format={int0} />
        <OpposedBarRow label="OREB" homeValue={homeTotal.RB_OFF} awayValue={awayTotal.RB_OFF} homeColor={home} awayColor={away} format={int0} />
        <OpposedBarRow label="DREB" homeValue={homeTotal.RB_DEF} awayValue={awayTotal.RB_DEF} homeColor={home} awayColor={away} format={int0} />
        <OpposedBarRow label="AST" homeValue={homeTotal.AS} awayValue={awayTotal.AS} homeColor={home} awayColor={away} format={int0} />
        <OpposedBarRow label="STL" homeValue={homeTotal.ST} awayValue={awayTotal.ST} homeColor={home} awayColor={away} format={int0} />
        <OpposedBarRow label="BLK" homeValue={homeTotal.BS} awayValue={awayTotal.BS} homeColor={home} awayColor={away} format={int0} />
        <OpposedBarRow
          label="STOCKS"
          homeValue={homeTotal.ST + homeTotal.BS}
          awayValue={awayTotal.ST + awayTotal.BS}
          homeColor={home}
          awayColor={away}
          format={int0}
        />
        <OpposedBarRow label="TO" homeValue={homeTotal.TO} awayValue={awayTotal.TO} homeColor={home} awayColor={away} format={int0} />
        <OpposedBarRow label="PF" homeValue={homeTotal.FOUL} awayValue={awayTotal.FOUL} homeColor={home} awayColor={away} format={int0} />
      </section>

      {gameSummary && (
        <section className="key-stats-card">
          <h3>プレータイプ内訳</h3>
          <OpposedBarRow
            label="Points off TO"
            homeValue={gameSummary.HomeTeamPTPFT}
            awayValue={gameSummary.AwayTeamPTPFT}
            homeColor={home}
            awayColor={away}
            format={int0}
          />
          <OpposedBarRow
            label="Fastbreak Pts"
            homeValue={gameSummary.HomeTeamPTFB}
            awayValue={gameSummary.AwayTeamPTFB}
            homeColor={home}
            awayColor={away}
            format={int0}
          />
          <OpposedBarRow
            label="2nd Chance Pts"
            homeValue={gameSummary.HomeTeamPT2ND}
            awayValue={gameSummary.AwayTeamPT2ND}
            homeColor={home}
            awayColor={away}
            format={int0}
          />
          <OpposedBarRow
            label="Points in Paint"
            homeValue={gameSummary.HomeTeamPT2IN}
            awayValue={gameSummary.AwayTeamPT2IN}
            homeColor={home}
            awayColor={away}
            format={int0}
          />
          <OpposedBarRow label="Bench Pts" homeValue={homeBench} awayValue={awayBench} homeColor={home} awayColor={away} format={int0} />
        </section>
      )}

      <section className="key-stats-card">
        <h3>テンポと効率</h3>
        <OpposedBarRow label="POSS" homeValue={homeRatings.poss} awayValue={awayRatings.poss} homeColor={home} awayColor={away} format={dec1} maxValue={possBarMax} />
        <OpposedBarRow label="PACE" homeValue={homeRatings.pace} awayValue={awayRatings.pace} homeColor={home} awayColor={away} format={dec1} maxValue={possBarMax} />
        <OpposedBarRow label="ORtg" homeValue={homeRatings.offRtg} awayValue={awayRatings.offRtg} homeColor={home} awayColor={away} format={dec1} maxValue={ratingBarMax} />
        <OpposedBarRow label="DRtg" homeValue={homeRatings.defRtg} awayValue={awayRatings.defRtg} homeColor={home} awayColor={away} format={dec1} maxValue={ratingBarMax} />
        <OpposedValueRow label="NetRtg" homeValue={homeRatings.netRtg} awayValue={awayRatings.netRtg} homeColor={home} awayColor={away} format={signed1} />
        {hasOvertime && <p className="key-stats-note">延長を含む試合です。POSS は延長分を含み、PACE は40分に換算しています。</p>}
      </section>

      <section className="key-stats-card">
        <h3>Four Factors</h3>
        <OpposedBarRow label="eFG%" homeValue={homeEfg} awayValue={awayEfg} homeColor={home} awayColor={away} format={pct1} scale="fixed100" />
        <OpposedBarRow
          label="TOV%"
          homeValue={homeTovPct}
          awayValue={awayTovPct}
          homeColor={home}
          awayColor={away}
          format={pct1}
          scale="fixed100"
        />
        <OpposedBarRow
          label="OREB%"
          homeValue={homeOrbPct}
          awayValue={awayOrbPct}
          homeColor={home}
          awayColor={away}
          format={pct1}
          scale="fixed100"
        />
        <OpposedBarRow label="FT Rate" homeValue={homeFtr} awayValue={awayFtr} homeColor={home} awayColor={away} format={pct1} scale="fixed100" />
      </section>
    </>
  );
}
