// 個人の比較（比較ページ・個人詳細の比較タブ）に、ランキング（個人・シーズン成績）にあって比較に無かった項目を足す部品。
// 足したもの: Advanced の PER、タブ Shooting・Profile・Career。値の出し方・向きはランキングと同じ部品（buildProfileItems の式・CAREER_ITEM_DEFS・shotTypeEntityColumns・PLAYER_STAT_DEFS の per）。
// 画面専用（保存キーの対象外）。このファイルを保存キーの対象のファイルから import しないこと。
import { useMemo } from "react";
import { fetchPlayerCareers, fetchPlayers, fetchRegisteredPlayers } from "./data";
import { useJsonData } from "./useJsonData";
import { leagueCacheKey, type League } from "./league";
import { CATEGORY_LABELS } from "./categoryLabels";
import { SEASON_BOX_TABS, type SeasonBoxTabKey } from "./playerSeasonBoxscore";
import { seasonBoxCompareDefs, type CompareColumnData } from "./compareShared";
import type { ComparisonStatDef } from "../components/ComparisonTable";
import { PLAYER_STAT_DEFS } from "./statDefs";
import { SHOT_TYPE_DISPLAY_ORDER, shotTypeEntityColumns } from "./shotTypeBreakdown";
import { CAREER_ITEM_DEFS } from "./playerConditionItems";
import { heightText, weightText } from "./profileMark";
import { ageForSeason } from "./age";
import { profileItemHasValue } from "./playerSeasonRanking";
import { rankDirectionOf } from "./rankDirection";
import { rankPositions } from "./seasonCompare";
import type { RankLine } from "./aiPlayerRank";
import type { PlayerCareerCounts, PlayerSummary } from "../../shared/types";

export type PlayerCompareTabKey = SeasonBoxTabKey | "shooting" | "profile" | "career";

/** ランキング（個人・シーズン成績）と同じ並び: Traditional・Advanced・Misc・Scoring・Shooting・Profile・Career */
const EXTRA_TABS: { key: PlayerCompareTabKey; label: string }[] = [
  { key: "shooting", label: CATEGORY_LABELS.shooting },
  { key: "profile", label: CATEGORY_LABELS.profile },
  { key: "career", label: CATEGORY_LABELS.career },
];

/** 個人の比較のタブ。B.ONE には、リーグをまたぐ経歴（Career）・シュートの種類（Shooting）の記録が無い（ランキングと同じ） */
export function playerCompareTabs(league: League): { key: PlayerCompareTabKey; label: string }[] {
  const tabs: { key: PlayerCompareTabKey; label: string }[] = [...SEASON_BOX_TABS];
  for (const t of EXTRA_TABS) {
    if (league === "one" && (t.key === "shooting" || t.key === "career")) continue;
    tabs.push(t);
  }
  return tabs;
}

export const PLAYER_COMPARE_TAB_KEYS: readonly PlayerCompareTabKey[] = [...SEASON_BOX_TABS.map((t) => t.key), ...EXTRA_TABS.map((t) => t.key)];

export function isBoxTab(tab: string): tab is SeasonBoxTabKey {
  return SEASON_BOX_TABS.some((t) => t.key === tab);
}

/** 比べる枠の、試合ログの絞り込みに左右されない選手のシーズンの記録（PER・Shooting・Profile・Career の元） */
export interface CompareExtraData {
  summary: PlayerSummary | null;
  /** そのシーズン終了時点までの経歴の累計（B.ONE・記録なしは null） */
  career: PlayerCareerCounts | null;
  /** 読み込みが終わったか（枠が使われていない間は true） */
  ready: boolean;
}

/**
 * 枠（シーズン・選手）の PlayerSummary と経歴。Career は、そのタブを開いたときだけ経歴のファイルを読む
 */
export function usePlayerCompareExtra(opts: { season: string; league: League; playerId: string; active: boolean; needCareer: boolean }): CompareExtraData {
  const { season, league, playerId, active, needCareer } = opts;
  const { data: players } = useJsonData(
    () => (active ? fetchPlayers(season, league).then((list) => ({ key: leagueCacheKey(season, league), list })) : Promise.resolve(null)),
    [active, season, league],
    { discardStale: true },
  );
  const careerOn = active && needCareer && league === "premier";
  const { data: careers } = useJsonData(() => (careerOn ? fetchPlayerCareers() : Promise.resolve(null)), [careerOn]);
  return useMemo(() => {
    const summary = players?.key === leagueCacheKey(season, league) ? (players.list.find((p) => p.playerId === playerId) ?? null) : null;
    const career = careers?.seasons[season]?.[playerId] ?? null;
    const ready = !active || (players?.key === leagueCacheKey(season, league) && (!careerOn || careers !== null));
    return { summary, career, ready };
  }, [players, careers, season, league, playerId, active, careerOn]);
}

/** 試合区分・絞り込み・区間を掛けていない枠か（PER・Shooting は絞り込みの効かない、シーズン全体の値） */
function unfiltered(r: CompareColumnData): boolean {
  return !r.filtered;
}

function perDef(): ComparisonStatDef<CompareColumnData> {
  const d = PLAYER_STAT_DEFS.find((x) => x.key === "per")!;
  return {
    key: d.key,
    label: d.label,
    value: (r) => (r.summary && unfiltered(r) ? d.value(r.summary) : 0),
    format: (r) => (r.summary && unfiltered(r) ? d.format(r.summary) : "-"),
    higherIsBetter: rankDirectionOf(d.key) !== "lower",
  };
}

function shootingDefs(): ComparisonStatDef<CompareColumnData>[] {
  const cols = shotTypeEntityColumns<CompareColumnData>(
    SHOT_TYPE_DISPLAY_ORDER,
    (r) => (unfiltered(r) ? r.summary?.shotTypes : undefined),
    "perGame",
    (r) => r.summary?.gamesPlayed ?? 0,
  );
  return cols.map((c) => ({
    key: c.key,
    label: c.label,
    value: (r) => Number(c.sortValue(r)),
    format: (r) => (c.format ? c.format(r) : String(c.sortValue(r))),
    higherIsBetter: rankDirectionOf(c.key) !== "lower",
  }));
}

function profileDefs(): ComparisonStatDef<CompareColumnData>[] {
  const season = (r: CompareColumnData) => r.season ?? "";
  return [
    {
      key: "height",
      label: "身長",
      value: (r) => r.summary?.heightCm ?? 0,
      format: (r) => (r.summary ? (heightText(r.summary) ?? "-") : "-"),
      higherIsBetter: true,
    },
    {
      key: "weight",
      label: "体重",
      value: (r) => r.summary?.weightKg ?? 0,
      format: (r) => (r.summary ? (weightText(r.summary) ?? "-") : "-"),
      higherIsBetter: true,
    },
    {
      key: "age",
      label: "年齢",
      value: (r) => (r.summary?.birthDate ? ageForSeason(r.summary.birthDate, season(r)) : 0),
      format: (r) => (r.summary?.birthDate ? `${ageForSeason(r.summary.birthDate, season(r))}歳` : "-"),
      higherIsBetter: true,
    },
  ];
}

function careerDefs(): ComparisonStatDef<CompareColumnData>[] {
  return CAREER_ITEM_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    value: (r: CompareColumnData) => r.career?.[d.key] ?? 0,
    format: (r: CompareColumnData) => (r.career ? `${r.career[d.key] ?? 0}${d.unit}` : "-"),
    higherIsBetter: true,
  }));
}

/** 個人の比較の項目（タブごと。ランキングの項目と同じ並び） */
export function playerCompareDefs(tab: PlayerCompareTabKey, foulSplit: boolean): ComparisonStatDef<CompareColumnData>[] {
  if (isBoxTab(tab)) {
    const defs = seasonBoxCompareDefs(tab, foulSplit);
    // ランキングの Advanced は、末尾に PER（シーズン全体の記録なので、絞り込みのある枠は「-」）
    return tab === "advanced" ? [...defs, perDef()] : defs;
  }
  if (tab === "shooting") return shootingDefs();
  if (tab === "profile") return profileDefs();
  return careerDefs();
}

/** この枠の名前の下に出す「絞り込みの効かない項目」の注記が要るタブか */
export function tabIgnoresFilters(tab: PlayerCompareTabKey): boolean {
  return tab === "shooting" || tab === "profile" || tab === "career";
}

/**
 * Profile・Career の順位（ランキングと同じ: そのシーズンに登録していた選手全員〔試合に出ていない登録選手も含む〕の中で、値のある人だけ。
 * 同じ表示の値は同じ順位・次は飛ばす）。RankLine の形で返し、playerRankLabels に渡す
 */
export function buildRegisteredRankLines(
  tab: "profile" | "career",
  season: string,
  pool: readonly PlayerSummary[],
  careerOf: (p: PlayerSummary) => PlayerCareerCounts | undefined,
  target: PlayerSummary,
): RankLine[] {
  const lines: RankLine[] = [];
  const keys = tab === "profile" ? ["height", "weight", "age"] : CAREER_ITEM_DEFS.map((d) => d.key as string);
  for (const key of keys) {
    const num = (p: PlayerSummary): number => {
      if (tab === "profile") return key === "height" ? (p.heightCm ?? 0) : key === "weight" ? (p.weightKg ?? 0) : p.birthDate ? ageForSeason(p.birthDate, season) : 0;
      return careerOf(p)?.[key as keyof PlayerCareerCounts] ?? 0;
    };
    const has = (p: PlayerSummary): boolean => (tab === "profile" ? profileItemHasValue(p, key) : num(p) > 0);
    const text = (p: PlayerSummary): string => String(num(p));
    const rows = pool.filter(has);
    const higher = rankDirectionOf(key) !== "lower";
    const sorted = rows.map((p) => ({ p, v: num(p), t: text(p) })).sort((a, b) => (higher ? b.v - a.v : a.v - b.v));
    const ranks = rankPositions(sorted.map((x) => x.t));
    const at = sorted.findIndex((x) => x.p.playerId === target.playerId);
    const base = { category: tab, key, label: key, value: at < 0 ? "-" : text(target), total: rows.length, direction: higher ? "higher" : "lower" } as const;
    if (at < 0) lines.push({ ...base, rank: null, note: "この項目の対象外（値なし）", ties: 0 });
    else lines.push({ ...base, rank: ranks[at]!, note: "", ties: sorted.filter((x) => x.t === sorted[at]!.t).length });
  }
  return lines;
}

/** Profile・Career の順位の元（そのシーズンの選手と、試合に一度も名前が無い登録選手）を読む */
export async function loadRegisteredPool(season: string, league: League): Promise<PlayerSummary[]> {
  const [players, registered] = await Promise.all([fetchPlayers(season, league), fetchRegisteredPlayers(season, league)]);
  return [...players, ...registered];
}
