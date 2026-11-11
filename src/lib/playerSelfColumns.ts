// 選手の Self2M・Self3M・SelfFTM と、アシストあり／セルフの割合の列（画面専用。DESIGN.md 361章）。
// 列の元の定義（playerSeasonBoxscore.ts）は保存キーの対象なので書き換えず、このファイルを読み込んだときに Scoring の列の並び
// （SEASON_SCORING_COLUMNS。SEASON_BOX_COLUMNS.scoring と同じ配列）へ、画面側から同じ並びで差し込む。
// 全選手スタッツ・個人詳細・ランキング・比較・md・図解のどれも、この配列から列を作るので、1か所の差し込みで同じ並びになる。
// 画面の入口（src/main.tsx）とこの列を使う検証から import する。このファイルを保存キーの対象のファイルから import しないこと。
import { formatDecimal, formatPct100 } from "./format";
import { countDigits, SEASON_SCORING_COLUMNS, type PlayerSeasonRawTotals, type SeasonBoxscoreColumn } from "./playerSeasonBoxscore";
import { SELF_COUNT_DEFS, SELF_PCT_DEFS, selfCountsOf, selfPct, selfSplitOf, type SelfShotKind, type ShotMadeSource } from "./selfScoring";

const NA = "-";

/** 本人が出た試合のうち、試合の流れの記録が無い試合（2017-18 の1810）で点を取っていると、アシストの数が足りず Self が実際より多くなる。そのシーズンの行は「-」 */
export function playerSelfUnavailable(raw: PlayerSeasonRawTotals): boolean {
  return raw.pcPts !== undefined && raw.pts > raw.pcPts;
}

export function playerShotSource(t: PlayerSeasonRawTotals): ShotMadeSource {
  return {
    made2: t.fgm - t.tpm,
    made3: t.tpm,
    madeFt: t.ftm,
    ast2: t.assisted2m,
    ast3: t.assisted3m,
    astFt: t.assistedFtm,
  };
}

function pctColumn(key: string, label: string, kind: SelfShotKind, side: "ast" | "self"): SeasonBoxscoreColumn {
  const calc = (raw: PlayerSeasonRawTotals): number | null => {
    if (playerSelfUnavailable(raw)) return null;
    const sp = selfSplitOf(playerShotSource(raw), kind);
    return sp.total > 0 ? selfPct(side === "ast" ? sp.ast : sp.self, sp.total) : null;
  };
  return {
    key,
    label,
    format: (c) => {
      const v = calc(c.raw);
      return v === null ? NA : formatPct100(v);
    },
    value: (c) => calc(c.raw) ?? 0,
  };
}

export const PLAYER_SELF_COUNT_COLUMNS: SeasonBoxscoreColumn[] = SELF_COUNT_DEFS.map((d) => ({
  key: d.key,
  label: d.label,
  format: (c, mode) =>
    playerSelfUnavailable(c.raw) ? NA : formatDecimal(d.pick(selfCountsOf(playerShotSource(c.scaled))), countDigits(mode)),
  value: (c) => (playerSelfUnavailable(c.raw) ? 0 : d.pick(selfCountsOf(playerShotSource(c.scaled)))),
}));

export const PLAYER_SELF_PCT_COLUMNS: SeasonBoxscoreColumn[] = SELF_PCT_DEFS.flatMap((d) => [
  pctColumn(d.astKey, d.astLabel, d.kind, "ast"),
  pctColumn(d.selfKey, d.selfLabel, d.kind, "self"),
]);

export const PLAYER_PTS_SELF_COLUMN: SeasonBoxscoreColumn = pctColumn("pctptsself", "%PTS Self", "pts", "self");

/** Scoring の列に差し込む。ASTFTM の右に Self の本数と種類ごとの割合、%PTS ASTED の右に %PTS Self（すでにあれば何もしない） */
export function installPlayerSelfColumns(cols: SeasonBoxscoreColumn[] = SEASON_SCORING_COLUMNS): SeasonBoxscoreColumn[] {
  if (cols.some((c) => c.key === "self2m")) return cols;
  const at = (k: string) => cols.findIndex((c) => c.key === k);
  const sAstFt = at("astftm");
  const sPctAsted = at("pctptsasted");
  if (sAstFt < 0 || sPctAsted < 0) return cols;
  // 後ろから差し込む（先の位置がずれない）
  cols.splice(sPctAsted + 1, 0, PLAYER_PTS_SELF_COLUMN);
  cols.splice(sAstFt + 1, 0, ...PLAYER_SELF_COUNT_COLUMNS, ...PLAYER_SELF_PCT_COLUMNS);
  return cols;
}

installPlayerSelfColumns();

