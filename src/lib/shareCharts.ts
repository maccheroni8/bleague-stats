// 割合の積み上げ棒グラフ（ShareBarChart）に渡す区分と値の組み立て（DESIGN.md 141章）。On-Court Foreign・得点構成・
// 得点構成（登録区分）を、全チーム・チーム詳細と個人詳細のシーズン別推移・選手一覧で同じ区分・同じ色・同じ計算で出すための共通処理。
import type { TeamSummary } from "../../shared/types";
import { CLASSIFICATION_COLORS } from "./classificationFilter";
import { formatMinutesFromSeconds } from "./boxscoreAggregate";
import type { ShareBarCategory } from "../components/ShareBarChart";

// --- On-Court Foreign（在コートの外国籍・帰化・アジア特別枠の人数、0〜4名） ---
export const FOREIGN_CATEGORIES: ShareBarCategory[] = [
  { label: "0", color: "#c4c4c4" },
  { label: "1", color: "#7cc4f7" },
  { label: "2", color: "#1f78c1" },
  { label: "3", color: "#0b3d7a" },
  { label: "4", color: "#7b3fa0" },
];

export interface ForeignShare {
  seconds: number[];
  secondsPerGame: number[];
  totalSeconds: number;
  pct: number[];
  /** 平均人数（Σ 人数×割合） */
  average: number;
}

/** チームの区分ごとの在コート秒数（teams.json の foreignPlayerCourtSeconds）から割合・1試合平均・平均人数を出す */
export function foreignShare(team: TeamSummary): ForeignShare {
  // 旧形式（4要素）のファイルやフィールドの欠落は0秒として扱う
  const raw = team.foreignPlayerCourtSeconds as readonly number[] | undefined;
  const seconds = FOREIGN_CATEGORIES.map((_, i) => raw?.[i] ?? 0);
  const totalSeconds = seconds.reduce((a, b) => a + b, 0);
  const pct = seconds.map((s) => (totalSeconds > 0 ? (100 * s) / totalSeconds : 0));
  // foreignPlayerCourtSeconds はレギュラーシーズンのみの集計で、gamesPlayed もレギュラーシーズンの試合数
  const games = team.gamesPlayed > 0 ? team.gamesPlayed : 0;
  const secondsPerGame = seconds.map((s) => (games > 0 ? Math.round(s / games) : 0));
  const average = pct.reduce((sum, p, count) => sum + (count * p) / 100, 0);
  return { seconds, secondsPerGame, totalSeconds, pct, average };
}

export function foreignDetails(share: ForeignShare): { details: string[]; tooltipDetails: string[]; footer: string } {
  return {
    details: share.secondsPerGame.map((s) => formatMinutesFromSeconds(s)),
    tooltipDetails: share.seconds.map(
      (s, i) => `（平均${formatMinutesFromSeconds(share.secondsPerGame[i]!)}／合計${formatMinutesFromSeconds(s)}）`,
    ),
    footer: `捕捉できた合計出場時間: ${formatMinutesFromSeconds(share.totalSeconds)}`,
  };
}

export function foreignAverageLabel(average: number): { wide: string; narrow: string } {
  return { wide: `平均${average.toFixed(2)}人`, narrow: `${average.toFixed(2)}人` };
}

// --- 得点構成（3P・FT・ミッドレンジ・ペイント内） ---
export const SCORING_CATEGORIES: ShareBarCategory[] = [
  { label: "3P", color: "#1f78c1" },
  { label: "FT", color: "#c4c4c4" },
  { label: "Mid-range", color: "#7cc4f7" },
  { label: "Paint", color: "#0b3d7a" },
];

// --- 得点構成（登録区分） ---
export const CLASSIFICATION_CATEGORIES: ShareBarCategory[] = [
  { label: "日本人", color: CLASSIFICATION_COLORS.japanese },
  { label: "外国籍・帰化・アジア", color: CLASSIFICATION_COLORS.international },
];

export interface PointsShare {
  /** 1試合平均の得点（失点構成では失点） */
  perGame: number;
  pct: number[];
  /** 区分ごとの1試合平均の得点 */
  values: number[];
}

/** チームの得点構成（mode="opponent" は失点構成）。teams.json の割合と1試合平均の得点から */
export function teamScoringShare(team: TeamSummary, mode: "own" | "opponent"): PointsShare {
  const a = team.advanced;
  const perGame = mode === "own" ? team.perGame.pts : team.opponentPerGame.pts;
  const pct =
    mode === "own"
      ? [a.threePointPointsSharePct, a.ftPointsSharePct, a.midRangePointsSharePct, a.paintPointsSharePct]
      : [a.opponentThreePointPointsSharePct, a.opponentFtPointsSharePct, a.opponentMidRangePointsSharePct, a.opponentPaintPointsSharePct];
  return { perGame, pct, values: pct.map((p) => (p / 100) * perGame) };
}

/** チームの得点構成（登録区分）。区分不明の選手の得点はどちらにも入れないため、合計が100%に満たないことがある */
export function teamClassificationShare(team: TeamSummary, mode: "own" | "opponent"): PointsShare {
  const a = team.advanced;
  const perGame = mode === "own" ? team.perGame.pts : team.opponentPerGame.pts;
  const pct =
    mode === "own"
      ? [a.japanesePointsSharePct, a.foreignPointsSharePct + a.naturalizedOrAsianPointsSharePct]
      : [a.opponentJapanesePointsSharePct, a.opponentForeignPointsSharePct + a.opponentNaturalizedOrAsianPointsSharePct];
  return { perGame, pct, values: pct.map((p) => (p / 100) * perGame) };
}

/**
 * 選手の得点構成。チームと同じ区分・同じ計算（3P＝3PM×3、FT＝FTM、ペイント内＝プレーバイプレーのペイント内得点のタグ、
 * ミッドレンジ＝2Pの得点−ペイント内得点）。値はレギュラーシーズンの合計を渡す
 */
export function playerScoringShare(t: { games: number; pts: number; fgm: number; tpm: number; ftm: number; pt2in: number }): PointsShare {
  const three = 3 * t.tpm;
  const ft = t.ftm;
  const paint = t.pt2in;
  const mid = Math.max(0, 2 * (t.fgm - t.tpm) - t.pt2in);
  const parts = [three, ft, mid, paint];
  const total = parts.reduce((a, b) => a + b, 0);
  const pct = parts.map((v) => (total > 0 ? (100 * v) / total : 0));
  const games = t.games > 0 ? t.games : 1;
  return { perGame: t.pts / games, pct, values: parts.map((v) => v / games) };
}

export function pointsDetails(share: PointsShare, unit: "pts" | "opp" = "pts"): { details: string[]; tooltipDetails: string[]; footer: string } {
  return {
    details: share.values.map((v) => v.toFixed(1)),
    tooltipDetails: share.values.map((v) => `（${v.toFixed(1)} pts）`),
    footer: `${unit === "pts" ? "平均得点" : "平均失点"}: ${share.perGame.toFixed(1)}`,
  };
}

export function pointsRightLabel(perGame: number): { wide: string; narrow: string } {
  return { wide: `${perGame.toFixed(1)}点`, narrow: perGame.toFixed(1) };
}

/**
 * レギュラーシーズンの途中か（シーズン別推移の行に「途中経過」と添える判定）。今のシーズンで、playoff-race.json の残り試合
 * （remaining）が残っているとき。teamId を渡せばそのチーム、無ければリーグ全体（どこかのチームに残り試合があれば途中）で見る
 */
export function isRegularSeasonInProgress(
  season: string,
  current: string,
  race: { teams: { teamId: string; remaining: number }[] } | null | undefined,
  teamId?: string,
): boolean {
  if (season !== current || !race || race.teams.length === 0) return false;
  return teamId ? (race.teams.find((t) => t.teamId === teamId)?.remaining ?? 0) > 0 : race.teams.some((t) => t.remaining > 0);
}
