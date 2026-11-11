// 画面専用（図解「散布図」の選手版）。縦軸・横軸それぞれで「項目」を選ぶ。
// 項目はランキング（個人・シーズン成績）の項目（Traditional〔DD2・TD3・PTS10 を含む〕・Advanced・Misc・Scoring・Shooting・Profile）。
// 値・書式は全選手スタッツ／ランキングと同じ列の定義をそのまま使う（平均／合計の決まりもランキングと同じ）。
import type { PlayerSummary } from "../../shared/types";
import { CATEGORY_LABELS, type BoxCategoryKey } from "./categoryLabels";
import { buildSeasonBoxscoreCtx, type SeasonBoxscoreCtx, type SeasonDisplayMode } from "./playerSeasonBoxscore";
import { hasAttempts, PLAYER_DOUBLE_ITEMS, playerDoubleText, playerDoubleValue, playerVennColumns } from "./figurePlayerVenn";
import type { PlayerFigurePoint } from "./figurePlayerPoints";
import { onCourtShareSeasonUnsupported } from "./onCourtShareSeason";
import { shotTypeEntityColumns, SHOT_TYPE_DISPLAY_ORDER } from "./shotTypeBreakdown";
import { PLAYER_STAT_DEFS } from "./statDefs";
import { ageForSeason } from "./age";
import { heightText, weightText } from "./profileMark";
import type { FreeAxisKind, FreeColumn } from "./figureTeamFree";
import type { Column } from "../components/SortableTable";

export type PlayerFreeCategory = BoxCategoryKey | "shooting" | "profile";
export const PLAYER_FREE_CATEGORIES: readonly { key: PlayerFreeCategory; label: string }[] = [
  { key: "traditional", label: CATEGORY_LABELS.traditional },
  { key: "advanced", label: CATEGORY_LABELS.advanced },
  { key: "misc", label: CATEGORY_LABELS.misc },
  { key: "scoring", label: CATEGORY_LABELS.scoring },
  { key: "shooting", label: CATEGORY_LABELS.shooting },
  { key: "profile", label: CATEGORY_LABELS.profile },
];
export type PlayerFreeMode = "perGame" | "total";
export type PlayerFreeColumn = FreeColumn<PlayerFigurePoint>;

export interface PlayerFreeItem { id: string; category: PlayerFreeCategory; categoryLabel: string; key: string; label: string }
export const playerFreeItemId = (category: PlayerFreeCategory, key: string) => `${category}.${key}`;
export const DEFAULT_PLAYER_FREE_X = playerFreeItemId("traditional", "ast");
export const DEFAULT_PLAYER_FREE_Y = playerFreeItemId("traditional", "pts");

/** 出場中の値で計算する項目（Scoring の %PTS〜%FTA・Misc の AST%。ランキングの ON_COURT_SHARE_STAT_KEYS と同じ。validate:figure-player-free で一致を確かめる） */
export const PLAYER_FREE_ON_COURT_SHARE_KEYS: ReadonlySet<string> = new Set(["pctpts", "pctfgm", "pctfga", "pct3pm", "pct3pa", "pct2pm", "pct2pa", "pctftm", "pctfta", "astpct"]);
/** 出場中の割合の項目を出せないシーズンの理由（ランキングの ON_COURT_SHARE_LEGACY_REASON と同じ文） */
export const PLAYER_FREE_ON_COURT_REASON = (label: string) =>
  `「${label}」は選手の出場中の記録から計算するため、このシーズンは出していません（出場中の記録の数え上げが無いため）。`;
/** シーズン通算の値で出す項目（期間・試合種別の絞り込みは効かない）: Shooting と PER */
export const isPlayerFreeSeasonTotal = (item: Pick<PlayerFreeItem, "category" | "key">) => item.category === "shooting" || (item.category === "advanced" && item.key === "per");

const ctxCache = new WeakMap<PlayerFigurePoint, Map<string, SeasonBoxscoreCtx>>();
function ctxOf(p: PlayerFigurePoint, mode: PlayerFreeMode, season: string): SeasonBoxscoreCtx {
  let byKey = ctxCache.get(p);
  if (!byKey) { byKey = new Map(); ctxCache.set(p, byKey); }
  const k = `${mode}:${season}`;
  let ctx = byKey.get(k);
  if (!ctx) { ctx = buildSeasonBoxscoreCtx(p.raw, p.team, mode, Number(season.slice(0, 4))); byKey.set(k, ctx); }
  return ctx;
}

const finiteOrNull = (v: unknown, text: string) => {
  const n = Number(v);
  return text.trim() === "-" || !Number.isFinite(n) ? null : n;
};
const PERCENT_FRACTION: FreeAxisKind = { unit: "percent", scale: 100, signed: false, digits: 2 };
const COUNT: FreeAxisKind = { unit: "number", scale: 1, signed: false, digits: 0 };

const columnCache = new Map<string, PlayerFreeColumn[]>();
/** その分類・平均／合計の列の一覧 */
export function playerFreeColumns(category: PlayerFreeCategory, mode: PlayerFreeMode, season: string): PlayerFreeColumn[] {
  const cacheKey = `${category}:${mode}:${season >= "2026-27" ? "new" : "old"}`;
  const cached = columnCache.get(cacheKey);
  if (cached) return cached;
  let out: PlayerFreeColumn[];
  if (category === "shooting") {
    const columns: Column<PlayerSummary>[] = shotTypeEntityColumns(SHOT_TYPE_DISPLAY_ORDER, (p: PlayerSummary) => p.shotTypes, mode, (p) => p.gamesPlayed);
    out = columns.map((c) => {
      const text = (p: PlayerFigurePoint) => (c.format ? c.format(p.summary) : String(c.sortValue(p.summary)));
      return { key: c.key, label: c.label, text, value: (p) => finiteOrNull(c.sortValue(p.summary), text(p)) };
    });
  } else if (category === "profile") {
    const integer: FreeAxisKind = { unit: "number", scale: 1, signed: false, digits: 0 };
    out = [
      { key: "height", label: "身長", value: (p: PlayerFigurePoint) => p.summary.heightCm || null, text: (p: PlayerFigurePoint) => heightText(p.summary) ?? "-", axis: integer },
      { key: "weight", label: "体重", value: (p: PlayerFigurePoint) => p.summary.weightKg || null, text: (p: PlayerFigurePoint) => weightText(p.summary) ?? "-", axis: integer },
    ];
    // 年齢はシーズンで決まる（作るときに season を使う）
    out.push({ key: "age", label: "年齢", value: (p) => (p.summary.birthDate ? ageForSeason(p.summary.birthDate, season) : null), text: (p) => (p.summary.birthDate ? `${ageForSeason(p.summary.birthDate, season)}歳` : "-"), axis: { unit: "number", scale: 1, signed: false, digits: 0 } });
  } else {
    out = playerVennColumns(category, season).filter((c) => c.key !== "name" && c.key !== "team").map((c) => {
      const text = (p: PlayerFigurePoint) => {
        const ctx = ctxOf(p, mode, season);
        return hasAttempts(ctx, c.key) ? c.format(ctx, mode) : "-";
      };
      return { key: c.key, label: c.label, text, value: (p: PlayerFigurePoint) => {
        const t = text(p);
        return t === "-" ? null : finiteOrNull(c.value(ctxOf(p, mode, season), mode), t);
      } };
    });
    if (category === "traditional") {
      for (const d of PLAYER_DOUBLE_ITEMS) {
        out.push({
          key: d.key, label: d.label,
          value: (p) => playerDoubleValue(p, d.key, mode),
          // 平均は達成率に達成した試合と出場試合を添える（ランキングと同じ書式）、合計は回数
          text: (p) => {
            const v = playerDoubleValue(p, d.key, mode);
            if (v === null) return "-";
            const n = d.count(p.doubles);
            return mode === "total" ? `${n}回` : `${playerDoubleText(p, d.key, "perGame")}（${n}/${p.doubles.games}）`;
          },
          axis: mode === "total" ? COUNT : PERCENT_FRACTION,
        });
      }
    }
    if (category === "advanced") {
      const per = PLAYER_STAT_DEFS.find((d) => d.key === "per");
      if (per) out.push({ key: per.key, label: per.label, value: (p) => finiteOrNull(per.value(p.summary), per.format(p.summary)), text: (p) => per.format(p.summary) });
    }
  }
  columnCache.set(cacheKey, out);
  return out;
}

const itemCache = new Map<string, PlayerFreeItem[]>();
export function playerFreeItems(season: string): PlayerFreeItem[] {
  const cacheKey = season >= "2026-27" ? "new" : "old";
  let items = itemCache.get(cacheKey);
  if (!items) {
    items = PLAYER_FREE_CATEGORIES.flatMap((cat) => playerFreeColumns(cat.key, "perGame", season).map((c) => ({ id: playerFreeItemId(cat.key, c.key), category: cat.key, categoryLabel: cat.label, key: c.key, label: c.label })));
    itemCache.set(cacheKey, items);
  }
  return items;
}
export function playerFreeColumn(item: PlayerFreeItem, mode: PlayerFreeMode, season: string): PlayerFreeColumn | undefined {
  return playerFreeColumns(item.category, mode, season).find((c) => c.key === item.key);
}
/** 選べる項目か（URL の値が古い・読めないときは初期の項目にする） */
export function resolvePlayerFreeItem(id: string | undefined, season: string, fallback: string): PlayerFreeItem {
  const items = playerFreeItems(season);
  return items.find((i) => i.id === id) ?? items.find((i) => i.id === fallback)!;
}

/** 項目ごとの選べない理由（B.ONE・データの無いシーズン）。選べる項目は undefined */
export function playerFreeItemBlock(item: PlayerFreeItem, players: readonly PlayerSummary[] | null, league: "premier" | "one", reasons: { shooting: string; onCourt: (label: string) => string; none: string }, season: string): string | undefined {
  if (item.category === "shooting") {
    if (league === "one") return reasons.shooting;
    if (players && !players.some((p) => p.shotTypes)) return reasons.none;
    return undefined;
  }
  if (PLAYER_FREE_ON_COURT_SHARE_KEYS.has(item.key) && onCourtShareSeasonUnsupported(season)) return reasons.onCourt(item.label);
  return undefined;
}
