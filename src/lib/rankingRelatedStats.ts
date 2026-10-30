// ランキング（個人・シーズン成績）で、割合の項目の右隣に並べる関連スタッツ（3P% なら 3PM・3PA。設計書264章）。
// 並べる値は、平均／合計の切り替えに従う（平均なら1試合あたり、合計ならシーズン合計）。割合そのものは切り替えで変わらない。
// 画面だけの変更（集計・保存キーに触れない）。表示の部品は RankedList の `related`。
import { formatDecimal } from "./format";
import { countDigits, modeFactor, type SeasonBoxscoreCtx } from "./playerSeasonBoxscore";
import type { PlayerRankMode } from "./playerSeasonRanking";
import type { PlayerSummary } from "../../shared/types";

/** ペイント内外の分割がある最初のシーズンの開始年（playerSeasonBoxscore.ts の MIN_PAINT_SPLIT_SEASON_START_YEAR と同じ。そのファイルは保存キーの対象なので、ここに写して持つ） */
const MIN_PAINT_SPLIT_SEASON_START_YEAR = 2016;

/** 関連スタッツ1つ。value は、平均なら1試合あたり・合計ならシーズン合計に直した値（出せないときは undefined → 「-」） */
interface RelatedSpec {
  label: string;
  value: (c: SeasonBoxscoreCtx, factor: number) => number | undefined;
}

const own = (label: string, get: (s: SeasonBoxscoreCtx["scaled"]) => number): RelatedSpec => ({ label, value: (c) => get(c.scaled) });
/**
 * 出場中の値（出場中の記録がそろう試合だけの合計。在コート基準の再集計）。平均はその試合数（ocGames）で割る。そろう試合が無ければ「-」
 */
const oc = (label: string, get: (r: SeasonBoxscoreCtx["raw"]) => number): RelatedSpec => ({
  label,
  // 合計は factor が1（出場1試合のときは平均も1。そのとき ocGames も1なので同じ値）
  value: (c, factor) => (c.raw.ocGames > 0 ? get(c.raw) * (factor === 1 ? 1 : 1 / c.raw.ocGames) : undefined),
});
/** ペイント内外の分割は 2016-17 シーズン以降だけ */
const paintSplit = (label: string, get: (s: SeasonBoxscoreCtx["scaled"]) => number): RelatedSpec => ({
  label,
  value: (c) => (c.seasonStartYear >= MIN_PAINT_SPLIT_SEASON_START_YEAR ? get(c.scaled) : undefined),
});

const FGM = own("FGM", (s) => s.fgm);
const FGA = own("FGA", (s) => s.fga);
const FTA = own("FTA", (s) => s.fta);
const TOV = own("TOV", (s) => s.tov);
const PTS = own("PTS", (s) => s.pts);
const TPM = own("3PM", (s) => s.tpm);
const TPA = own("3PA", (s) => s.tpa);
const PAINT2M = paintSplit("PAINT2M", (s) => s.paint2m);
const PAINT2A = paintSplit("PAINT2A", (s) => s.paint2a);
const MID2M = paintSplit("MID2M", (s) => s.mid2m);
const MID2A = paintSplit("MID2A", (s) => s.mid2a);

/**
 * 項目キー（ボックススコアの列のキー）→ 並べる関連スタッツ。分子→分母の順。
 * 対象外（ORtg・DRtg・NetRtg・PACE・PER・PPP・DD2・TD3 など、分子と分母を画面の項目として並べられないもの）は載せない。
 */
const RELATED_BY_KEY: Record<string, RelatedSpec[]> = {
  // Traditional
  fgpct: [FGM, FGA],
  "2ppct": [own("2PM", (s) => s.fgm - s.tpm), own("2PA", (s) => s.fga - s.tpa)],
  "3ppct": [TPM, TPA],
  ftpct: [own("FTM", (s) => s.ftm), FTA],
  asttov: [own("AST", (s) => s.ast), TOV],
  // Advanced（USG%・TOV% は分子が FGA＋0.44×FTA＋TOV の合計なので、その3つを並べる）
  usg: [FGA, FTA, TOV],
  tovpct: [TOV, FGA, FTA],
  efg: [FGM, TPM, FGA],
  ts: [PTS, FGA, FTA],
  pps: [PTS, FGA],
  // Scoring: 個人÷チーム全体のシェア
  // Scoring: 個人÷出場中の自チーム（在コート基準。出場中の記録がそろう試合だけ。DESIGN.md 303章）
  pctpts: [oc("PTS", (r) => r.ocPts), oc("TEAM PTS（出場中）", (r) => r.ocTeamPts)],
  pctfgm: [oc("FGM", (r) => r.ocFgm), oc("TEAM FGM（出場中）", (r) => r.ocTeamFgm)],
  pctfga: [oc("FGA", (r) => r.ocFga), oc("TEAM FGA（出場中）", (r) => r.ocTeamFga)],
  pct3pm: [oc("3PM", (r) => r.ocTpm), oc("TEAM 3PM（出場中）", (r) => r.ocTeamTpm)],
  pct3pa: [oc("3PA", (r) => r.ocTpa), oc("TEAM 3PA（出場中）", (r) => r.ocTeamTpa)],
  pct2pm: [oc("2PM", (r) => r.ocFgm - r.ocTpm), oc("TEAM 2PM（出場中）", (r) => r.ocTeamFgm - r.ocTeamTpm)],
  pct2pa: [oc("2PA", (r) => r.ocFga - r.ocTpa), oc("TEAM 2PA（出場中）", (r) => r.ocTeamFga - r.ocTeamTpa)],
  pctftm: [oc("FTM", (r) => r.ocFtm), oc("TEAM FTM（出場中）", (r) => r.ocTeamFtm)],
  pctfta: [oc("FTA", (r) => r.ocFta), oc("TEAM FTA（出場中）", (r) => r.ocTeamFta)],
  // Misc: 選手の AST%（FGにつながったアシスト ÷（出場中の自チーム FGM − 本人の FGM））
  astpct: [oc("FG AST", (r) => r.ocFgAssists), oc("TEAM FGM−FGM（出場中）", (r) => r.ocTeamFgm - r.ocFgm)],
  pctptsasted: [own("ASTED PTS", (s) => s.assisted2m * 2 + s.assisted3m * 3 + s.assistedFtm), PTS],
  paint2pct: [PAINT2M, PAINT2A],
  mid2pct: [MID2M, MID2A],
  // Scoring: 自分のFGAに占める割合
  pct3pmown: [TPM, FGA],
  pct3paown: [TPA, FGA],
  pctpaint2mown: [PAINT2M, FGA],
  pctpaint2aown: [PAINT2A, FGA],
  pctmid2mown: [MID2M, FGA],
  pctmid2aown: [MID2A, FGA],
};

/** 関連スタッツを並べる項目か（平均／合計の切り替えを使える。割合そのものは切り替えで変わらない） */
export function hasRelatedStats(category: string, statKey: string): boolean {
  if (category === "shooting") return /^.+_(2p|3p)pct$/.test(statKey);
  if (category === "profile" || category === "career") return false;
  return statKey in RELATED_BY_KEY;
}

export interface RelatedStats {
  /** 見出し・先頭に付ける名前（「3PM」「3PA」） */
  labels: string[];
  /** 行ごとの値の文字列（labels と同じ並び）。出せない行は undefined */
  of: (p: PlayerSummary) => string[] | undefined;
}

const NA = "-";

/**
 * 今のカテゴリ・項目に並べる関連スタッツ。無ければ null。
 * ctxOf は平均／合計に直す前の値（raw）を持つ ctx、shooting はシューティングの表の列（今の平均／合計の向きのもの）
 */
export function relatedStatsFor(args: {
  category: string;
  statKey: string;
  mode: PlayerRankMode;
  ctxOf: (p: PlayerSummary) => SeasonBoxscoreCtx | null;
  shooting: readonly { key: string; format?: (p: PlayerSummary) => string; sortValue: (p: PlayerSummary) => string | number }[];
}): RelatedStats | null {
  const { category, statKey, mode, ctxOf, shooting } = args;
  if (category === "shooting") {
    // 「{シュート種別}_2ppct」→「{シュート種別}_2pm」「{シュート種別}_2pa」（3Pも同じ）
    const m = /^(.+)_(2p|3p)pct$/.exec(statKey);
    if (!m) return null;
    const cols = [`${m[1]}_${m[2]!.slice(0, 1)}pm`, `${m[1]}_${m[2]!.slice(0, 1)}pa`].map((k) => shooting.find((c) => c.key === k));
    if (cols.some((c) => !c)) return null;
    const unit = m[2]!.toUpperCase();
    return {
      labels: [`${unit}M`, `${unit}A`],
      of: (p) => cols.map((c) => (c!.format ? c!.format(p) : String(c!.sortValue(p)))),
    };
  }
  if (category === "profile" || category === "career") return null;
  const specs = RELATED_BY_KEY[statKey];
  if (!specs) return null;
  const digits = countDigits(mode);
  return {
    labels: specs.map((s) => s.label),
    of: (p) => {
      const c = ctxOf(p);
      if (!c) return undefined;
      const factor = modeFactor(c.raw, mode);
      return specs.map((s) => {
        const v = s.value(c, factor);
        return v === undefined ? NA : formatDecimal(v, digits);
      });
    },
  };
}
