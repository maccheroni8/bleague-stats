// 画面専用（図解「ベン図」の選手版）。選べる項目は、ランキング（個人・シーズン成績）で選べる Traditional・Advanced・Misc・Scoring の1試合平均。
// 値・向き（higherIsBetter）・表示値は、全選手スタッツ／ランキングと同じ列定義をそのまま使う。円に入るのは、基準の値以上（以下）の選手だけ。
import { buildSeasonBoxscoreCtx, SEASON_SCORING_COLUMNS, SEASON_TRADITIONAL_COLUMNS, seasonBoxColumnsFor, type SeasonBoxscoreColumn, type SeasonBoxscoreCtx } from "./playerSeasonBoxscore";
import { SEASON_ADVANCED_COLUMNS_WITH_FTR } from "./ftrColumn";
import { withPppColumn } from "./pppColumn";
import { foulColumnsSplit } from "./ruleChange";
import { BOX_CATEGORY_TABS, type BoxCategoryKey } from "./categoryLabels";
import { computeVenn, displayNumber, thresholdVennRows, type VennCircleSpec } from "./figureVenn";
import { formatVennThreshold } from "./figureVennItems";
import type { PlayerFigurePoint } from "./figurePlayerPoints";
import type { StatConditionItemDef } from "./statConditions";
import type { PlayerCareerCounts, PlayerSummary } from "../../shared/types";
import { mapConditionDefs, playerCareerConditionDefs, playerProfileConditionDefs } from "./playerConditionItems";
import { shotTypeEntityColumns, SHOT_TYPE_DISPLAY_ORDER } from "./shotTypeBreakdown";
import { CATEGORY_LABELS } from "./categoryLabels";

export const PLAYER_VENN_CATEGORIES = BOX_CATEGORY_TABS;

/** ランキング（個人・シーズン成績）と同じ列の組み立て。PPP は ORtg の列から作る（ランキングの withPppColumn と同じ。
 * playerSeasonRanking.ts を import すると、B.ONE の読み込みの通し忘れの検査の対象になるため、ここでは読み込みを持たない列定義だけを使う） */
const advancedWithPpp = () => withPppColumn(SEASON_ADVANCED_COLUMNS_WITH_FTR);
export function playerVennColumns(category: BoxCategoryKey, season: string): SeasonBoxscoreColumn[] {
  switch (category) {
    case "traditional": return SEASON_TRADITIONAL_COLUMNS;
    case "advanced": return advancedWithPpp();
    case "misc": return seasonBoxColumnsFor("misc", foulColumnsSplit([season]));
    case "scoring": return SEASON_SCORING_COLUMNS;
  }
}

export interface PlayerVennItem { id: string; category: BoxCategoryKey; categoryLabel: string; key: string; label: string }
export const playerVennItemId = (category: BoxCategoryKey, key: string) => `${category}.${key}`;
const listCache = new Map<string, PlayerVennItem[]>();
export function playerVennItems(season: string): PlayerVennItem[] {
  const cacheKey = foulColumnsSplit([season]) ? "new" : "old";
  let items = listCache.get(cacheKey);
  if (!items) {
    items = PLAYER_VENN_CATEGORIES.flatMap(tab => playerVennColumns(tab.key, season).filter(c => c.key !== "name" && c.key !== "team")
      .map(c => ({ id: playerVennItemId(tab.key, c.key), category: tab.key, categoryLabel: tab.label, key: c.key, label: c.label })));
    listCache.set(cacheKey, items);
  }
  return items;
}
export function playerVennColumn(item: PlayerVennItem, season: string): SeasonBoxscoreColumn | undefined {
  return playerVennColumns(item.category, season).find(c => c.key === item.key);
}

/** 初期の3つ（左上・右上・下の円）。基準の値は初期値の表（PLAYER_VENN_DEFAULT_THRESHOLDS） */
export const DEFAULT_PLAYER_VENN_ITEMS: readonly [string, string, string] = [playerVennItemId("traditional", "pts"), playerVennItemId("traditional", "ast"), playerVennItemId("traditional", "3ppct")];
export const PLAYER_VENN_DEFAULT_THRESHOLDS: Readonly<Record<string, number>> = {
  [playerVennItemId("traditional", "pts")]: 15,
  [playerVennItemId("traditional", "ast")]: 5,
  [playerVennItemId("traditional", "3ppct")]: 40,
};

/**
 * 選んだ3つを有効な形に直す。存在しない項目・出せない項目・ほかの円と同じ項目は、初期の項目（それも使われていれば、まだ使われていない最初の項目）にする。
 */
export function resolvePlayerVennSelection(input: readonly (string | undefined)[], available: ReadonlySet<string>, order: readonly string[]): [string, string, string] {
  const used = new Set<string>(), out: string[] = [];
  for (let i = 0; i < 3; i++) {
    let id = input[i];
    if (!id || !available.has(id) || used.has(id)) id = [DEFAULT_PLAYER_VENN_ITEMS[i]!, ...DEFAULT_PLAYER_VENN_ITEMS, ...order].find(x => available.has(x) && !used.has(x))!;
    used.add(id);
    out.push(id);
  }
  return out as [string, string, string];
}

/** 成功率の項目は、分母の試投が1本もない選手は値を出さない（列の定義は 0 を返すが、「0.00%」は試投のない選手の値ではない） */
function hasAttempts(ctx: SeasonBoxscoreCtx, key: string): boolean {
  const r = ctx.raw;
  switch (key) {
    case "fgpct": case "efg": case "ftr": return r.fga > 0;
    case "2ppct": return r.fga - r.tpa > 0;
    case "3ppct": return r.tpa > 0;
    case "ftpct": return r.fta > 0;
    case "ts": return r.fga + r.fta > 0;
    default: return true;
  }
}

export interface PlayerVennValue { value: number; text: string }
/** 選手1人の1つの項目（1試合平均）の値と表示値。出せないとき（「-」・数として読めない）は null */
export function playerVennValue(ctx: SeasonBoxscoreCtx, column: SeasonBoxscoreColumn): PlayerVennValue | null {
  if (!hasAttempts(ctx, column.key)) return null;
  const text = column.format(ctx, "perGame");
  if (text === "-" || !Number.isFinite(displayNumber(text))) return null;
  const value = column.value(ctx, "perGame");
  return Number.isFinite(value) ? { value, text } : null;
}
export const playerVennCtx = (p: PlayerFigurePoint, season: string) => buildSeasonBoxscoreCtx(p.raw, p.team, "perGame", Number(season.slice(0, 4)));

/** 項目ごとに、1人でも値が出せる選手がいるか（無い項目は選べない） */
export function availablePlayerVennItems(points: readonly PlayerFigurePoint[], season: string): Set<string> {
  const items = playerVennItems(season), ok = new Set<string>();
  const ctxs = points.map(p => playerVennCtx(p, season));
  for (const item of items) {
    const column = playerVennColumn(item, season)!;
    if (ctxs.some(c => playerVennValue(c, column))) ok.add(item.id);
  }
  return ok;
}

export const playerVennHigher = (column: SeasonBoxscoreColumn) => column.higherIsBetter ?? true;

/** 基準の値の初期値: 表にある項目はその値、無い項目は表示中の選手の単純平均（画面に出す桁に丸める） */
export function defaultPlayerVennThreshold(itemId: string, values: readonly PlayerVennValue[]): number | null {
  const fixed = PLAYER_VENN_DEFAULT_THRESHOLDS[itemId];
  if (fixed !== undefined) return fixed;
  const nums = values.map(v => displayNumber(v.text)).filter(Number.isFinite);
  if (!nums.length) return null;
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  return displayNumber(formatVennThreshold(mean, values[0]!.text));
}

export function computePlayerVenn(points: readonly PlayerFigurePoint[], itemIds: readonly string[], season: string, thresholds: readonly (number | null)[]) {
  const byId = new Map(playerVennItems(season).map(i => [i.id, i]));
  const ctxs = new Map(points.map(p => [p.id, playerVennCtx(p, season)]));
  const columns = itemIds.map(id => playerVennColumn(byId.get(id)!, season)!);
  const cache = columns.map(c => new Map(points.map(p => [p.id, playerVennValue(ctxs.get(p.id)!, c)] as const)));
  const specs = columns.map((c, i): VennCircleSpec<PlayerFigurePoint> => ({
    value: p => cache[i]!.get(p.id)?.value ?? Number.NaN,
    text: p => cache[i]!.get(p.id)?.text ?? "-",
    higherIsBetter: playerVennHigher(c),
  })) as [VennCircleSpec<PlayerFigurePoint>, VennCircleSpec<PlayerFigurePoint>, VennCircleSpec<PlayerFigurePoint>];
  const model = computeVenn(points, p => p.id, specs, (ranked, i) => {
    const t = thresholds[i];
    return t === null || t === undefined || !Number.isFinite(t) ? [] : thresholdVennRows(ranked, t, specs[i]!.higherIsBetter);
  });
  return { model, valueOf: (id: string, i: number) => cache[i]!.get(id) ?? null, columns };
}

/**
 * 詳細フィルター（スタッツの条件）に選べる項目。ランキング（個人・シーズン成績）と同じ列（出場試合数 G・出場時間 MIN など）を、
 * ベン図の円と同じ1試合平均の値で判定する（表示の値で判定。出せない値は「-」）。同じ key の項目は最初の1つだけ
 */
export function playerVennConditionDefs(season: string, league: "premier" | "one" = "premier", careerOf: (p: PlayerSummary) => PlayerCareerCounts | undefined = () => undefined): StatConditionItemDef<PlayerFigurePoint>[] {
  const defs: StatConditionItemDef<PlayerFigurePoint>[] = [], seen = new Set<string>();
  for (const tab of PLAYER_VENN_CATEGORIES) {
    for (const column of playerVennColumns(tab.key, season)) {
      if (column.key === "name" || column.key === "team" || seen.has(column.key)) continue;
      seen.add(column.key);
      defs.push({
        key: column.key, label: column.label, group: tab.label,
        display: p => { const ctx = playerVennCtx(p, season); return hasAttempts(ctx, column.key) ? column.format(ctx, "perGame") : "-"; },
        displayOther: p => { const ctx = playerVennCtx(p, season); return hasAttempts(ctx, column.key) ? column.format(ctx, "total") : "-"; },
      });
    }
  }
  // ランキング（個人・シーズン成績）と同じ、シューティング・プロフィール・キャリアの項目（値はシーズン通算。B.ONE にはシュートの種類・リーグをまたぐ経歴の記録が無いので、シューティング・キャリアは選べない）
  const pick = (p: PlayerFigurePoint) => p.summary;
  if (league !== "one") {
    for (const c of shotTypeEntityColumns(SHOT_TYPE_DISPLAY_ORDER, (p: PlayerSummary) => p.shotTypes, "perGame", (p) => p.gamesPlayed)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      defs.push({ key: c.key, label: c.label, group: CATEGORY_LABELS.shooting, display: p => { const s = pick(p); return c.format ? c.format(s) : String(c.sortValue(s)); }, seasonTotal: true });
    }
  }
  defs.push(...mapConditionDefs(playerProfileConditionDefs(season), pick));
  if (league !== "one") defs.push(...mapConditionDefs(playerCareerConditionDefs(careerOf), pick));
  return defs;
}
