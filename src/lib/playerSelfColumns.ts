// 選手の SELF2PM・SELF3PM・SELFFTM・アシストの有無の4項目（ASTFGM・SELFFGM・ASTPTS・SELFPTS）・アシストあり／セルフの割合・MID PTS・MID PTS% の列（画面専用。DESIGN.md 362章・465〜467章）。
// 元の定義の AST2M・AST3M の見出しも、ここで AST2PM・AST3PM に直す（元の定義の文字列は変えない。キー・URL・保存した設定は古い表記のまま）。
// 列の元の定義（playerSeasonBoxscore.ts）は保存キーの対象なので書き換えず、このファイルを読み込んだときに Scoring の列の並び
// （SEASON_SCORING_COLUMNS。SEASON_BOX_COLUMNS.scoring と同じ配列）へ、画面側から同じ並びで差し込む。
// 全選手スタッツ・個人詳細・ランキング・比較・md・図解のどれも、この配列から列を作るので、1か所の差し込みで同じ並びになる。
// 画面の入口（src/main.tsx）とこの列を使う検証から import する。このファイルを保存キーの対象のファイルから import しないこと。
import { PLAYER_GAME_RECORD_STATS } from "../../shared/playerGameRecords";
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

const MID_SPLIT_FIRST_YEAR = 2016;

/** ミッドレンジの2P（MID2M）で決めた得点＝MID2M×2。内訳が無いシーズン・試合は MID2M と同じ扱い */
export const PLAYER_MID_PTS_COLUMN: SeasonBoxscoreColumn = {
  key: "midpts",
  label: "MID PTS",
  format: (c, mode) => (c.seasonStartYear >= MID_SPLIT_FIRST_YEAR ? formatDecimal(c.scaled.mid2m * 2, countDigits(mode)) : NA),
  value: (c) => (c.seasonStartYear >= MID_SPLIT_FIRST_YEAR ? c.scaled.mid2m * 2 : 0),
};

/**
 * 得点の割合（得点に占める、ペイント内・ミッドレンジ・3P・FT・2Pの得点。合計でも平均でも同じ値。DESIGN.md 468章）。ペイント内＋ミッドレンジ＋3P＋FT＝100%。
 * 試合の流れの記録が無い試合（2017-18 の1810）で点を取った選手は、ペイント内・ミッドレンジの内訳が数えられないので「-」（Self と同じ扱い）。
 * 得点が0なら「-」
 */
function pointsShareOf(c: { raw: PlayerSeasonRawTotals; seasonStartYear: number }, kind: "pitp" | "mid" | "p3" | "ft" | "p2"): number | null {
  const r = c.raw;
  if (!(r.pts > 0)) return null;
  if ((kind === "pitp" || kind === "mid") && (c.seasonStartYear < MID_SPLIT_FIRST_YEAR || playerSelfUnavailable(r))) return null;
  const part = kind === "pitp" ? r.pt2in : kind === "mid" ? 2 * r.mid2m : kind === "p3" ? 3 * r.tpm : kind === "ft" ? r.ftm : 2 * (r.fgm - r.tpm);
  return (100 * part) / r.pts;
}

const pointsShareColumn = (key: string, label: string, kind: "pitp" | "mid" | "p3" | "ft" | "p2"): SeasonBoxscoreColumn => ({
  key,
  label,
  format: (c) => {
    const v = pointsShareOf(c, kind);
    return v === null ? NA : formatPct100(v);
  },
  value: (c) => pointsShareOf(c, kind) ?? 0,
});

/** 得点の割合の列（Scoring の %FTA の右。チームと同じ並び）。%PTSMID は旧 MID PTS%（key midptspct）・旧 %PoutP */
export const PLAYER_POINTS_SHARE_COLUMNS: SeasonBoxscoreColumn[] = [
  pointsShareColumn("pitppct", "%PTSPITP", "pitp"),
  pointsShareColumn("midptspct", "%PTSMID", "mid"),
  pointsShareColumn("pct3p", "%PTS3P", "p3"),
  pointsShareColumn("pctft", "%PTSFT", "ft"),
  pointsShareColumn("pct2p", "%PTS2P", "p2"),
];

/** 元の定義（保存キーの対象）の見出し → 画面の見出し。元の定義は書き換えない */
const RENAMED_LABELS: Record<string, string> = {
  AST2M: "AST2PM",
  AST3M: "AST3PM",
  "%PTS ASTED": "%PTSAST",
  "3PM/FGA": "%FGA3PM",
  "3PA/FGA": "%FGA3P",
  "PAINT2M/FGA": "%FGAPAINT2M",
  "PAINT2A/FGA": "%FGAPAINT2",
  "MID2M/FGA": "%FGAMID2M",
  "MID2A/FGA": "%FGAMID2",
};

export const PLAYER_PTS_SELF_COLUMN: SeasonBoxscoreColumn = pctColumn("pctptsself", "%PTSSELF", "pts", "self");

/** Scoring の列に差し込む。ASTFTM の右に Self の本数と種類ごとの割合、%PTS ASTED の右に %PTS SELF（すでにあれば何もしない） */
export function installPlayerSelfColumns(cols: SeasonBoxscoreColumn[] = SEASON_SCORING_COLUMNS): SeasonBoxscoreColumn[] {
  if (cols.some((c) => c.key === "self2m")) return cols;
  for (const c of cols) c.label = RENAMED_LABELS[c.label] ?? c.label;
  for (const r of PLAYER_GAME_RECORD_STATS) r.label = RENAMED_LABELS[r.label] ?? r.label;
  const at = (k: string) => cols.findIndex((c) => c.key === k);
  const sAstFt = at("astftm");
  const sPctAsted = at("pctptsasted");
  if (sAstFt < 0 || sPctAsted < 0) return cols;
  // 後ろから差し込む（先の位置がずれない）。得点の割合は %FTA の右（チームの Scoring の先頭と同じ並び）
  const sFta = at("pctfta");
  cols.splice(sPctAsted + 1, 0, PLAYER_PTS_SELF_COLUMN);
  cols.splice(sAstFt + 1, 0, ...PLAYER_SELF_COUNT_COLUMNS, ...PLAYER_SELF_PCT_COLUMNS);
  if (sFta >= 0) cols.splice(sFta + 1, 0, ...PLAYER_POINTS_SHARE_COLUMNS);
  return cols;
}

installPlayerSelfColumns();

