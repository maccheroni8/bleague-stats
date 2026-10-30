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
  // foreignPlayerCourtSeconds はレギュラーシーズンのみの集計で、gamesPlayed もレギュラーシーズンの試合数
  return foreignShareFromSeconds(raw, team.gamesPlayed);
}

/** 区分ごとの在コート秒数（[0人〜4人]）と試合数から、割合・1試合平均・平均人数を出す（絞り込んだ試合・区間の合計にも使う） */
export function foreignShareFromSeconds(raw: readonly number[] | undefined, gamesPlayed: number): ForeignShare {
  const seconds = FOREIGN_CATEGORIES.map((_, i) => raw?.[i] ?? 0);
  const totalSeconds = seconds.reduce((a, b) => a + b, 0);
  const pct = seconds.map((s) => (totalSeconds > 0 ? (100 * s) / totalSeconds : 0));
  const games = gamesPlayed > 0 ? gamesPlayed : 0;
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

/** 試合ログの合計（sumTeamGameLogs）のうち、得点構成に使う項目 */
export interface PointsShareTotals {
  pts: number;
  fgm: number;
  tpm: number;
  ftm: number;
  pt2in: number;
  japanesePoints: number;
  internationalPoints: number;
  oppPts: number;
  oppFgm: number;
  oppTpm: number;
  oppFtm: number;
  oppPt2in: number;
  oppJapanesePoints: number;
  oppInternationalPoints: number;
}

function pointsShareOf(parts: number[], pts: number, games: number): PointsShare {
  const perGame = games > 0 ? pts / games : 0;
  const pct = parts.map((v) => (pts > 0 ? (100 * v) / pts : 0));
  return { perGame, pct, values: pct.map((p) => (p / 100) * perGame) };
}

/**
 * チームの得点構成を、選んだ条件の試合ログの合計から出す（全チームスタッツの Scoring % の絞り込み。DESIGN.md 256章）。
 * teams.json の割合（teamScoringShare）と同じ式（3P＝3PM×3、FT＝FTM、ペイント内＝PITP、ミッドレンジ＝2Pの得点−PITP）。レギュラーシーズン全体では teams.json と同じ値（235章の確認）
 */
export function teamScoringShareFromTotals(t: PointsShareTotals, games: number, mode: "own" | "opponent"): PointsShare {
  return mode === "own"
    ? pointsShareOf([3 * t.tpm, t.ftm, 2 * (t.fgm - t.tpm) - t.pt2in, t.pt2in], t.pts, games)
    : pointsShareOf([3 * t.oppTpm, t.oppFtm, 2 * (t.oppFgm - t.oppTpm) - t.oppPt2in, t.oppPt2in], t.oppPts, games);
}

/** チームの得点構成（登録区分）を、選んだ条件の試合ログの合計から出す（teamClassificationShare と同じ区分） */
export function teamClassificationShareFromTotals(t: PointsShareTotals, games: number, mode: "own" | "opponent"): PointsShare {
  return mode === "own"
    ? pointsShareOf([t.japanesePoints, t.internationalPoints], t.pts, games)
    : pointsShareOf([t.oppJapanesePoints, t.oppInternationalPoints], t.oppPts, games);
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
    details: share.values.map((v) => v.toFixed(2)),
    tooltipDetails: share.values.map((v) => `（${v.toFixed(2)} pts）`),
    footer: `${unit === "pts" ? "平均得点" : "平均失点"}: ${share.perGame.toFixed(2)}`,
  };
}

export function pointsRightLabel(perGame: number): { wide: string; narrow: string } {
  return { wide: `${perGame.toFixed(2)}点`, narrow: perGame.toFixed(2) };
}

// --- FG試投構成（3P・Mid-range・Paint。FGAに占める割合。2026-09-27） ---
/** 色は得点構成の同じ区分と同じ */
export const FGA_CATEGORIES: ShareBarCategory[] = [
  { label: "3P", color: "#1f78c1" },
  { label: "Mid-range", color: "#7cc4f7" },
  { label: "Paint", color: "#0b3d7a" },
];

/**
 * FG試投構成。3PA・ペイント外の2PA・ペイント内の2PA（ペイント内外はプレーバイプレーの公式の区分）の合計を渡す。
 * 値は PointsShare と同じ形（perGame＝1試合平均のFGA、values＝区分ごとの1試合平均の試投数）
 */
export function fgaShare(t: { games: number; tpa: number; mid2a: number; paint2a: number }): PointsShare {
  const parts = [t.tpa, t.mid2a, t.paint2a];
  const total = parts.reduce((a, b) => a + b, 0);
  const pct = parts.map((v) => (total > 0 ? (100 * v) / total : 0));
  const games = t.games > 0 ? t.games : 1;
  return { perGame: total / games, pct, values: parts.map((v) => v / games) };
}

export function fgaDetails(share: PointsShare, unit: "own" | "opp" = "own"): { details: string[]; tooltipDetails: string[]; footer: string } {
  return {
    details: share.values.map((v) => v.toFixed(2)),
    tooltipDetails: share.values.map((v) => `（${v.toFixed(2)}本）`),
    footer: `${unit === "own" ? "平均FGA" : "相手の平均FGA"}: ${share.perGame.toFixed(2)}`,
  };
}

export function fgaRightLabel(perGame: number): { wide: string; narrow: string } {
  return { wide: `${perGame.toFixed(2)}本`, narrow: perGame.toFixed(2) };
}
