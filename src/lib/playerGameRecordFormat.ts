// 選手の1試合の記録の値の表記（選手一覧の記録タブのカードと、ランキングの1試合記録の一覧で共通。DESIGN.md 159・190章）
import { formatMinutesFromSeconds } from "./boxscoreAggregate";
import { formatPct, formatSigned } from "./format";
import type { PlayerGameRecordDef } from "../../shared/playerGameRecords";
import { PLAYER_ASTED_MIN_POINTS, PLAYER_PCT_MIN_MADE, type PlayerRecordGame } from "../../shared/playerGameRecords";
import { scaledMinForPeriod } from "./periodMinimum";
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

/** 成功率の項目の、最低成功数の基準のキー（eFG%・TS% は FG と同じ）と、その試合の成功数 */
const PCT_MADE: Record<string, { base: keyof typeof PLAYER_PCT_MIN_MADE; label: string; made: (g: PlayerRecordGame) => number }> = {
  fgPct: { base: "fgPct", label: "FGM", made: (g) => g.fgm },
  efgPct: { base: "fgPct", label: "FGM", made: (g) => g.fgm },
  tsPct: { base: "fgPct", label: "FGM", made: (g) => g.fgm },
  "2pPct": { base: "twoPct", label: "2PM", made: (g) => g.fgm - g.tpm },
  tpPct: { base: "tpPct", label: "3PM", made: (g) => g.tpm },
  ftPct: { base: "ftPct", label: "FTM", made: (g) => g.ftm },
};

/**
 * 区間（Q別・前後半）を選んだときの、成功率の項目の最低成功数の判定（区間の長さに合わせて下げた数。periodMinimum.ts）。
 * 成功率でない項目は null（判定しない）
 */
export function playerPctPeriodFilter(key: string, period: string): ((g: PlayerRecordGame) => boolean) | null {
  const m = PCT_MADE[key];
  if (!m) return null;
  const min = scaledMinForPeriod(PLAYER_PCT_MIN_MADE[m.base], period);
  return (g) => m.made(g) >= min;
}

/** 成功率の項目の対象の試合の条件（最低成功数。区間を選んだときは、区間の長さに合わせて下げた数）。成功率でない項目は undefined */
export function playerGameRecordMinMadeNote(key: string, period?: { key: string; label: string }): string | undefined {
  if (key === "astedPct") return `得点が${PLAYER_ASTED_MIN_POINTS}点以上の試合が対象です。同じ率の中は得点の多い試合から並べます。`;
  const m = PCT_MADE[key];
  if (!m) return undefined;
  const t = `${m.label}が${scaledMinForPeriod(PLAYER_PCT_MIN_MADE[m.base], period?.key ?? null)}以上`;
  // Q別・前後半では、試合全体の基準を区間の長さに合わせて下げた数
  if (period) return `${t}の${period.label}の記録だけが対象です（試合全体の基準を区間の長さに合わせて下げた数）。同じ率の中は試投数の多い記録から並べます。`;
  return `${t}の試合が対象です。同じ率の中は試投数の多い試合から並べます。`;
}

export type { PlayerGameRecordEntry };
