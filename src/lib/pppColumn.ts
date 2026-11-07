// 個人の PPP の列（画面専用。DESIGN.md 334章）。PPP ＝ PTS ÷ (FGA + 0.44×FTA + TOV)。個人ORtg（アシスト・OREBの貢献を含む）とは別の式。
// 列の元の定義（playerSeasonBoxscore.ts）は保存キーの対象なので書き換えず、読む側がここを通して列を受け取る。
// このファイルを保存キーの対象のファイルから import しないこと。
import { playerPpp } from "../../shared/formulas";
import { formatDecimal } from "./format";
import { seasonBoxColumnsWithFtr } from "./ftrColumn";
import { seasonBoxColumnsFor, type SeasonBoxscoreColumn, type SeasonBoxTabKey } from "./playerSeasonBoxscore";

/** 合計でも平均でも同じ値（比）。分母が0なら undefined */
export function pppOfRaw(raw: { pts: number; fga: number; fta: number; tov: number }): number | undefined {
  return playerPpp(raw.pts, raw.fga, raw.fta, raw.tov);
}

export const PPP_COLUMN: SeasonBoxscoreColumn = {
  key: "ppp",
  label: "PPP",
  format: (c) => {
    const v = pppOfRaw(c.raw);
    return v === undefined ? "-" : formatDecimal(v, 2);
  },
  value: (c) => pppOfRaw(c.raw) ?? 0,
};

/** Advanced の ORtg の右に PPP を足す（すでにあれば足さない） */
export function withPppColumn(cols: SeasonBoxscoreColumn[]): SeasonBoxscoreColumn[] {
  const i = cols.findIndex((c) => c.key === "ortg");
  if (i < 0 || cols.some((c) => c.key === "ppp")) return cols;
  return [...cols.slice(0, i + 1), PPP_COLUMN, ...cols.slice(i + 1)];
}

/** seasonBoxColumnsWithFtr の PPP 入り版（Advanced だけ ORtg の右に PPP が増える。個人詳細・Q別・md） */
export function seasonBoxColumnsWithFtrPpp(tab: SeasonBoxTabKey, foulSplit: boolean): SeasonBoxscoreColumn[] {
  const cols = seasonBoxColumnsWithFtr(tab, foulSplit);
  return tab === "advanced" ? withPppColumn(cols) : cols;
}

/** seasonBoxColumnsFor の PPP 入り版（比較・対戦相手別。FTR は足さない） */
export function seasonBoxColumnsWithPpp(tab: SeasonBoxTabKey, foulSplit: boolean): SeasonBoxscoreColumn[] {
  const cols = seasonBoxColumnsFor(tab, foulSplit);
  return tab === "advanced" ? withPppColumn(cols) : cols;
}
