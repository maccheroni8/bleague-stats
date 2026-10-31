// 個人の Advanced に FTR（フリースロー獲得率 = FTA / FGA）を足す、画面だけの列の差し替え。
// 列の元の定義（playerSeasonBoxscore.ts）は保存キーの対象なので書き換えず、読む側がここを通して列を受け取る。
// このファイルを保存キーの対象のファイルから import しないこと。
import { ftRate } from "../../shared/formulas";
import { formatPct } from "./format";
import { SEASON_ADVANCED_COLUMNS, seasonBoxColumnsFor, type SeasonBoxscoreColumn, type SeasonBoxTabKey } from "./playerSeasonBoxscore";

/** FGA が 0 のとき FTR は出せない（「-」。0.00% にしない）。合計・平均のどちらでも率は同じ */
export function ftrOf(raw: { fta: number; fga: number }): number | undefined {
  return raw.fga > 0 ? ftRate(raw.fta, raw.fga) : undefined;
}

export const FTR_COLUMN: SeasonBoxscoreColumn = {
  key: "ftr",
  label: "FTR",
  format: (c) => {
    const v = ftrOf(c.raw);
    return v === undefined ? "-" : formatPct(v);
  },
  // 算出不能は他の列と同じく 0（ランキングは FGA が 0 の選手を並べない）
  value: (c) => ftrOf(c.raw) ?? 0,
};

/** Advanced の列に FTR を TS% の次へ足す（すでにあれば足さない） */
export function withFtrColumn(columns: SeasonBoxscoreColumn[]): SeasonBoxscoreColumn[] {
  if (columns.some((c) => c.key === FTR_COLUMN.key)) return columns;
  const at = columns.findIndex((c) => c.key === "ts");
  const next = [...columns];
  next.splice(at === -1 ? next.length : at + 1, 0, FTR_COLUMN);
  return next;
}

export const SEASON_ADVANCED_COLUMNS_WITH_FTR: SeasonBoxscoreColumn[] = withFtrColumn(SEASON_ADVANCED_COLUMNS);

/** seasonBoxColumnsFor の FTR 入り版（Advanced だけ FTR が増える） */
export function seasonBoxColumnsWithFtr(tab: SeasonBoxTabKey, foulSplit: boolean): SeasonBoxscoreColumn[] {
  return tab === "advanced" ? SEASON_ADVANCED_COLUMNS_WITH_FTR : seasonBoxColumnsFor(tab, foulSplit);
}
