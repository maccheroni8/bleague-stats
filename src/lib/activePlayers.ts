import { useCallback, useState } from "react";
import { fetchPlayers, fetchRegisteredPlayers } from "./data";
import { simpleSelectAxis, type FilterAxis } from "./filterAxes";
import { currentSeason } from "./season";
import { enumParam } from "./urlState";
import { useJsonData } from "./useJsonData";

/**
 * 「現役」の絞り込み（ランキング > 個人 > 通算記録・歴代の1試合記録・勝負所の通算・アシストペアの通算と歴代。DESIGN.md 222章）。
 * 現役＝今季（進行中のシーズン）のB.PREMIERの名簿に載っている選手。ランキングの Profile と同じ「そのシーズンに登録していた選手」
 * （players.json の選手＋名簿から足した registered-players.json の選手。173章）を、今季について使う。
 * 通算記録の上位20位は夜間の集計が現役だけの表を書き出す（scripts/aggregate-league-player-rankings.ts が同じ選手を数える）。URLは act=1
 */
export type ActiveToggle = "all" | "active";
export const ACTIVE_PARAM = enumParam<ActiveToggle>("act", ["all", "active"], "all", { active: "1" });
export const ACTIVE_LABEL = "現役";

/** 表の下の注記（現役で絞り込んだとき） */
export function activeNote(season: string = currentSeason()): string {
  return `現役は、今季（${season}シーズン）のB.PREMIERの名簿に載っている選手です。今季のB.ONE・B.NEXTでプレーしている選手は含まれません。`;
}

export function activeAxis(value: ActiveToggle, onChange: (v: ActiveToggle) => void, opts: { disabledReason?: string } = {}): FilterAxis {
  return simpleSelectAxis({
    id: "active",
    label: ACTIVE_LABEL,
    options: [
      { value: "all", label: "しない" },
      { value: "active", label: "する" },
    ],
    value,
    defaultValue: "all",
    onChange: (v) => onChange(v as ActiveToggle),
    disabledReason: opts.disabledReason,
  });
}

export interface ActivePlayers {
  /** 今季の名簿の選手ID。読み込み前・読み込めなかったとき・使わないときは null */
  ids: ReadonlySet<string> | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/** enabled のときだけ、今季の名簿（players.json と registered-players.json）を読む */
export function useActivePlayerIds(enabled: boolean): ActivePlayers {
  const season = currentSeason();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { data, loading, error } = useJsonData(async () => {
    if (!enabled) return null;
    const [players, registered] = await Promise.all([fetchPlayers(season), fetchRegisteredPlayers(season)]);
    return new Set([...players, ...registered].map((p) => p.playerId));
  }, [enabled, season, attempt]);
  return {
    ids: enabled ? data : null,
    loading: enabled && loading,
    error: enabled && error ? `今季（${season}）の名簿を読み込めませんでした（${error}）` : null,
    retry,
  };
}
