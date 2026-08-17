import type { BoxscoreRow, SummaryRow } from "../../shared/types";
import { efgPct, estimatedPossessions, ftRate, orbPct, safeDiv } from "../../shared/formulas";
import { OpposedBarRow } from "./OpposedBar";
import { ShootingDonut } from "./ShootingDonut";

interface KeyStatsSectionProps {
  homeTotal: BoxscoreRow;
  awayTotal: BoxscoreRow;
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

/**
 * 1試合分のポゼッション数を確定する。公式POSS値がある試合（fullティア）はそれをそのまま使う
 * （ホーム/アウェイ双方の行で同一値になることをDESIGN.mdで確認済みなのでhome側のみ見ればよい）。
 * 無い試合（POSSフィールド自体が存在しないシーズン）はscripts/aggregate.tsと同じ推定式で代替する
 */
function gamePossessions(home: BoxscoreRow, away: BoxscoreRow): number {
  if (home.POSS !== undefined) return home.POSS;
  return estimatedPossessions(
    {
      fga: home.PT2A + home.PT3A,
      fgm: home.PT2M + home.PT3M,
      fta: home.FTA,
      oreb: home.RB_OFF,
      dreb: home.RB_DEF,
      tov: home.TO,
    },
    {
      fga: away.PT2A + away.PT3A,
      fgm: away.PT2M + away.PT3M,
      fta: away.FTA,
      oreb: away.RB_OFF,
      dreb: away.RB_DEF,
      tov: away.TO,
    },
  );
}

const pct1 = (v: number) => `${v.toFixed(1)}%`;
const int0 = (v: number) => String(Math.round(v));

export function KeyStatsSection({
  homeTotal,
  awayTotal,
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

  const poss = gamePossessions(homeTotal, awayTotal);
  const homeEfg = efgPct(homeTotal.PT2M + homeTotal.PT3M, homeTotal.PT3M, homeFga) * 100;
  const awayEfg = efgPct(awayTotal.PT2M + awayTotal.PT3M, awayTotal.PT3M, awayFga) * 100;
  const homeTovPct = safeDiv(homeTotal.TO, poss) * 100;
  const awayTovPct = safeDiv(awayTotal.TO, poss) * 100;
  const homeOrbPct = orbPct(homeTotal.RB_OFF, awayTotal.RB_DEF);
  const awayOrbPct = orbPct(awayTotal.RB_OFF, homeTotal.RB_DEF);
  const homeFtr = ftRate(homeTotal.FTA, homeFga) * 100;
  const awayFtr = ftRate(awayTotal.FTA, awayFga) * 100;

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
          label="ORB%"
          homeValue={homeOrbPct}
          awayValue={awayOrbPct}
          homeColor={home}
          awayColor={away}
          format={pct1}
          scale="fixed100"
        />
        <OpposedBarRow label="FTR" homeValue={homeFtr} awayValue={awayFtr} homeColor={home} awayColor={away} format={pct1} scale="fixed100" />
      </section>
    </>
  );
}
