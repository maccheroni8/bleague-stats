// 画面専用。保存済みの索引を読むだけで、導出データは変更しない。
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { playerGameAt, type PlayerGameIndexView } from "./gameIndex";
import { ageForSeason } from "./age";
import { indexRowClassMatches, type ClassificationGroupFilter } from "./classificationFilter";

/**
 * 登録区分の選択肢（URL の cls。全選手スタッツと同じ書き方・並び。DESIGN.md 298章）。外国籍・帰化・アジア特別枠は 2026-27 以降だけ（それより前は理由を出す）、
 * まとめの「外国籍・帰化・アジア」（intl）はいつも選べる
 */
export const FIGURE_CLASSES = [
  { value: "all", label: "全選手", group: "all" },
  { value: "jp", label: "日本人", group: "日本人" },
  { value: "foreign", label: "外国籍", group: "外国籍" },
  { value: "nat", label: "帰化", group: "帰化" },
  { value: "asia", label: "アジア特別枠", group: "アジア特別枠" },
  { value: "intl", label: "外国籍・帰化・アジア", group: "外国籍・帰化・アジア" },
] as const satisfies readonly { value: string; label: string; group: ClassificationGroupFilter }[];
export type FigureClass = typeof FIGURE_CLASSES[number]["value"];

/** 選択肢の値 → 登録区分の絞り込み */
export function figureClassGroup(value: FigureClass): ClassificationGroupFilter {
  return FIGURE_CLASSES.find((c) => c.value === value)!.group;
}
export interface AgeDot { playerId: string; name: string; age: number; averageMinutes: number; registration: string }
export function ageSummary(ages: readonly number[]) {
  if (!ages.length) return { count: 0, mean: null, median: null };
  const sorted = [...ages].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return { count: ages.length, mean: ages.reduce((a, b) => a + b, 0) / ages.length,
    median: sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2 };
}
/**
 * i行目の試合での登録区分（jp／intl）。2026-27 以降の索引は行ごとに、その試合での区分（rows.cls。0 日本人・1〜3 外国籍・帰化・アジア特別枠・-1 不明）を
 * 持つので、それを使う（シーズン途中の区分の変更を当てる。DESIGN.md 295章・296章）。行ごとの区分が無い索引（2025-26 以前・古い版）は、選手ごとの1つの値
 */
export function figureRowClassKey(view: PlayerGameIndexView, i: number, fallback: "jp" | "intl" | ""): "jp" | "intl" | "" {
  const code = view.file.rows.cls?.[i];
  if (code === undefined) return fallback;
  return code === 0 ? "jp" : code > 0 ? "intl" : "";
}

export function figureAgeData(view: PlayerGameIndexView, options: {
  season: string; gameType: SeasonGameTypeFilter; min: number; classification: FigureClass; eligiblePlayerIds?: ReadonlySet<string>;
}) {
  const memberships = new Map<string, { playerId: string; name: string; teamId: string; birth: string; registration: string; minutes: number; games: number }>();
  for (let i = 0; i < view.size; i++) {
    const g = playerGameAt(view, i);
    const classKey = figureRowClassKey(view, i, g.classKey);
    if (options.eligiblePlayerIds && !options.eligiblePlayerIds.has(g.playerId)) continue;
    if (options.gameType !== "both" && g.gameType !== options.gameType) continue;
    // 区分は試合ごと（2026-27 以降は行ごとの区分。その区分で出場した試合だけを数える）
    if (options.classification !== "all" && !indexRowClassMatches(view.file, i, figureClassGroup(options.classification))) continue;
    if (!(g.min > 0)) continue; // DNPは平均の分母に含めない。「なし」も出場者が対象。
    const key = `${g.playerId}@${g.teamId}`;
    const row = memberships.get(key) ?? { playerId: g.playerId, name: g.playerName, teamId: g.teamId, birth: g.birthDate, registration: classKey, minutes: 0, games: 0 };
    row.minutes += g.min;
    row.games++;
    memberships.set(key, row);
  }
  const byTeam = new Map<string, AgeDot[]>();
  const unique = new Map<string, number>();
  let missingBirth = 0;
  for (const row of memberships.values()) {
    const averageMinutes = row.minutes / row.games;
    if (averageMinutes < options.min) continue;
    const age = row.birth ? ageForSeason(row.birth, options.season) : NaN;
    if (!Number.isFinite(age) || age < 0) { missingBirth++; continue; }
    const dots = byTeam.get(row.teamId) ?? [];
    dots.push({ playerId: row.playerId, name: row.name, age, averageMinutes, registration: row.registration });
    byTeam.set(row.teamId, dots);
    unique.set(row.playerId, age);
  }
  return { byTeam, overall: ageSummary([...unique.values()]), missingBirth };
}

// 形を決める場所はここだけ。将来のシーズン別4区分は読む側で結合してここへ渡す。
// 見做し日本人を含め、現行の索引でjpに分類される選手は丸にする。
export type FigureMarkerShape = "circle" | "diamond" | "square" | "triangle" | "unknown";
const REGISTRATION_MARKERS: Readonly<Record<string, FigureMarkerShape>> = {
  jp: "circle", 日本人: "circle", 見做し日本人: "circle", みなし日本人: "circle",
  intl: "diamond", 外国籍: "diamond", 帰化選手: "diamond", 帰化: "diamond", アジア特別枠: "diamond",
};
export function figureMarkerShape(registration: string | undefined): FigureMarkerShape {
  return REGISTRATION_MARKERS[registration ?? ""] ?? "unknown";
}

/** 同年齢の点の中心を、形によらず行の中央から等間隔に置く。 */
export function centeredAgeDots(dots: readonly AgeDot[]) {
  const totals = new Map<number, number>();
  for (const dot of dots) totals.set(dot.age, (totals.get(dot.age) ?? 0) + 1);
  const height = Math.max(38, Math.max(1, ...totals.values()) * 12 + 12);
  const used = new Map<number, number>();
  return { height, dots: dots.map(dot => {
    const level = used.get(dot.age) ?? 0;
    used.set(dot.age, level + 1);
    return { ...dot, centerY: height / 2 + (level - (totals.get(dot.age)! - 1) / 2) * 12 };
  }) };
}

export type FigureReferenceMode = "mean" | "median" | "both";
export function figureAgeReferences(summary: ReturnType<typeof ageSummary>, mode: FigureReferenceMode) {
  const keys: ("mean" | "median")[] = mode === "both" ? ["mean", "median"] : [mode];
  return keys.map(key => ({ key, label: key === "mean" ? "平均" : "中央値", value: summary[key] }));
}

/** 図解だけの初期値。全選手スタッツの初期値60〜100%は変えない。 */
export const FIGURE_GAMES_RATIO_RANGE: [number, number] = [0, 100];
export function isDefaultFigureGamesRatio(range: readonly [number, number]): boolean {
  return range[0] === FIGURE_GAMES_RATIO_RANGE[0] && range[1] === FIGURE_GAMES_RATIO_RANGE[1];
}
