// 選手の1試合の記録の値の表記（選手一覧の記録タブのカードと、ランキングの1試合記録の一覧で共通。DESIGN.md 159・190章）
import { formatMinutesFromSeconds } from "./boxscoreAggregate";
import { formatPct, formatSigned } from "./format";
import type { PlayerGameRecordDef } from "../../shared/playerGameRecords";
import { PLAYER_PCT_MIN_ATTEMPTS } from "../../shared/playerGameRecords";
import type { PlayerGameRecordEntry } from "../../shared/types";

export function formatPlayerGameRecordValue(def: PlayerGameRecordDef, v: number): string {
  switch (def.kind) {
    case "minutes":
      return formatMinutesFromSeconds(Math.round(v * 60));
    case "pct":
      return formatPct(v);
    case "ratio":
      return v.toFixed(1);
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

/** 成功率の項目の対象の試合の条件（最低試投数）。成功率でない項目は undefined */
export function playerGameRecordMinAttemptsNote(key: string): string | undefined {
  const m = PLAYER_PCT_MIN_ATTEMPTS;
  const text: Record<string, string> = {
    fgPct: `FGAが${m.fgPct}以上`,
    efgPct: `FGAが${m.fgPct}以上`,
    tsPct: `FGAが${m.fgPct}以上`,
    "2pPct": `2PAが${m.twoPct}以上`,
    tpPct: `3PAが${m.tpPct}以上`,
    ftPct: `FTAが${m.ftPct}以上`,
  };
  const t = text[key];
  return t ? `${t}の試合が対象です。同じ率の中は試投数の多い試合から並べます。` : undefined;
}

export type { PlayerGameRecordEntry };
