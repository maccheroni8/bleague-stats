// 個人の PPP の列（画面専用。DESIGN.md 334章）。PPP ＝ PTS ÷ (FGA + 0.44×FTA + TOV)。個人ORtg（アシスト・OREBの貢献を含む）とは別の式。
// 列の元の定義（playerSeasonBoxscore.ts）は保存キーの対象なので書き換えず、読む側がここを通して列を受け取る。
// このファイルを保存キーの対象のファイルから import しないこと。
import { playerPpp } from "../../shared/formulas";
import { formatDecimal } from "./format";
import type { SeasonBoxscoreColumn } from "./playerSeasonBoxscore";

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
