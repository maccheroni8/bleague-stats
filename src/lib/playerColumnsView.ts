// 個人の列の画面向けの取り出し口（画面専用。DESIGN.md 465〜467章）。
// seasonBoxColumnsFor（playerSeasonBoxscore.ts。保存キーの対象なので書き換えない）の結果に、Misc の MID PTS（PITP の右）を足す。
// Scoring は playerSelfColumns.ts が元の配列へ差し込むので、ここでは足さない。Misc はファウル分割（2026-27以降）で配列が作り直されるため、ここで足す。
// このファイルを保存キーの対象のファイルから import しないこと。
import "./playerSelfColumns";
import { PLAYER_MID_PTS_COLUMN } from "./playerSelfColumns";
import { seasonBoxColumnsFor as baseSeasonBoxColumnsFor, type SeasonBoxscoreColumn, type SeasonBoxTabKey } from "./playerSeasonBoxscore";

const miscCache = new Map<boolean, SeasonBoxscoreColumn[]>();

/** Misc の列に MID PTS を PITP の右へ足す（すでにあれば足さない。PITP が無ければ何もしない） */
export function withMidPtsColumn(cols: SeasonBoxscoreColumn[]): SeasonBoxscoreColumn[] {
  if (cols.some((c) => c.key === PLAYER_MID_PTS_COLUMN.key)) return cols;
  const i = cols.findIndex((c) => c.key === "pitp");
  if (i < 0) return cols;
  return [...cols.slice(0, i + 1), PLAYER_MID_PTS_COLUMN, ...cols.slice(i + 1)];
}

/** seasonBoxColumnsFor の MID PTS 入り版。Misc の配列は同じ条件なら同じものを返す */
export function seasonBoxColumnsFor(tab: SeasonBoxTabKey, foulSplit: boolean): SeasonBoxscoreColumn[] {
  const base = baseSeasonBoxColumnsFor(tab, foulSplit);
  if (tab !== "misc") return base;
  let cached = miscCache.get(foulSplit);
  if (!cached) miscCache.set(foulSplit, (cached = withMidPtsColumn(base)));
  return cached;
}
