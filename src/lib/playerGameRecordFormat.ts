// 選手の1試合の記録の値の表記（選手一覧の記録タブのカードと、ランキングの1試合記録の一覧で共通。DESIGN.md 159・190章）
import { formatMinutesFromSeconds } from "./boxscoreAggregate";
import { formatPct, formatSigned } from "./format";
import type { PlayerGameRecordDef } from "../../shared/playerGameRecords";
import { PLAYER_ASTED_MIN_POINTS, PLAYER_PCT_MIN_MADE, type PlayerRecordGame } from "../../shared/playerGameRecords";
import { scaledMinForPeriod } from "./periodMinimum";
import { passesMinMade, scaledMinMade } from "./minCriterion";
import type { PlayerGameRecordEntry } from "../../shared/types";

export function formatPlayerGameRecordValue(def: PlayerGameRecordDef, v: number): string {
  switch (def.kind) {
    case "minutes":
      return formatMinutesFromSeconds(Math.round(v * 60));
    case "pct":
      return formatPct(v);
    case "ratio":
      return v.toFixed(2);
    case "signed":
      return formatSigned(v, 0);
    default:
      return Number.isInteger(v) ? String(v) : v.toFixed(0);
  }
}

/** 成功率の項目に添える成功数／試投数（ファイルにあるときだけ） */
export function playerGameRecordFraction(e: { made?: number; attempted?: number }): readonly [number, number] | undefined {
  return e.made !== undefined && e.attempted !== undefined ? [e.made, e.attempted] : undefined;
}

/** 成功率の項目の、最低成功数の基準のキー（eFG%・TS% は FG と同じ）と、その試合の成功数・試投数 */
const PCT_MADE: Record<string, { base: keyof typeof PLAYER_PCT_MIN_MADE; label: string; made: (g: PlayerRecordGame) => number; att: (g: PlayerRecordGame) => number }> = {
  fgPct: { base: "fgPct", label: "FGM", made: (g) => g.fgm, att: (g) => g.fga },
  efgPct: { base: "fgPct", label: "FGM", made: (g) => g.fgm, att: (g) => g.fga },
  tsPct: { base: "fgPct", label: "FGM", made: (g) => g.fgm, att: (g) => g.fga + g.fta },
  "2pPct": { base: "twoPct", label: "2PM", made: (g) => g.fgm - g.tpm, att: (g) => g.fga - g.tpa },
  tpPct: { base: "tpPct", label: "3PM", made: (g) => g.tpm, att: (g) => g.tpa },
  ftPct: { base: "ftPct", label: "FTM", made: (g) => g.ftm, att: (g) => g.fta },
};

/** 成功率の項目の、最初の最低成功数と名前（成功率でない項目は null）。詳細フィルタで基準を変える・外すときの元の値 */
export function playerPctMinBase(key: string): { base: number; ruleKey: string; label: string } | null {
  const m = PCT_MADE[key];
  return m ? { base: PLAYER_PCT_MIN_MADE[m.base], ruleKey: m.base, label: m.label } : null;
}

/**
 * 区間（Q別・前後半）を選んだとき、または基準を変えた・外したときの、成功率の項目の最低成功数の判定
 * （区間の長さに合わせて下げた数。periodMinimum.ts）。minMade は基準の指定（0＝基準なし。省略は最初の基準）。成功率でない項目は null（判定しない）
 */
export function playerPctPeriodFilter(key: string, period: string | null, minMade?: number): ((g: PlayerRecordGame) => boolean) | null {
  const m = PCT_MADE[key];
  if (!m) return null;
  const min = scaledMinMade(minMade ?? PLAYER_PCT_MIN_MADE[m.base], period);
  return (g) => passesMinMade(m.made(g), m.att(g), min);
}

/** 成功率の項目の対象の試合の条件（最低成功数。区間を選んだときは、区間の長さに合わせて下げた数）。成功率でない項目は undefined */
export function playerGameRecordMinMadeNote(key: string, period?: { key: string; label: string }, minMade?: number): string | undefined {
  if (key === "astedPct") return `得点が${PLAYER_ASTED_MIN_POINTS}点以上の試合が対象です。同じ率の中は得点の多い試合から並べます。`;
  const m = PCT_MADE[key];
  if (!m) return undefined;
  // 詳細フィルタで基準を外している（0）ときは、試投のあった試合すべてが対象
  if (minMade === 0) return `成功数の基準を外しているため、${m.label.replace("M", "A")}が1以上の${period ? `${period.label}の記録` : "試合"}すべてが対象です。同じ率の中は試投数の多い${period ? "記録" : "試合"}から並べます。`;
  const t = `${m.label}が${scaledMinForPeriod(minMade ?? PLAYER_PCT_MIN_MADE[m.base], period?.key ?? null)}以上`;
  // Q別・前後半では、試合全体の基準を区間の長さに合わせて下げた数
  if (period) return `${t}の${period.label}の記録だけが対象です（試合全体の基準を区間の長さに合わせて下げた数）。同じ率の中は試投数の多い記録から並べます。`;
  return `${t}の試合が対象です。同じ率の中は試投数の多い試合から並べます。`;
}

export type { PlayerGameRecordEntry };
