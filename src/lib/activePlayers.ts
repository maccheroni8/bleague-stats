import { useCallback, useState } from "react";
import { fetchPlayers, fetchRegisteredPlayers } from "./data";
import { simpleSelectAxis, type FilterAxis } from "./filterAxes";
import { currentSeason } from "./season";
import { enumParam } from "./urlState";
import { useJsonData } from "./useJsonData";

/** 現役を数えるリーグ（今季の名簿） */
const ACTIVE_LEAGUES = ["premier", "one"] as const;

/**
 * 「現役」の絞り込み（ランキング > 個人 > 通算記録・歴代の1試合記録・勝負所の通算・アシストペアの通算と歴代。DESIGN.md 222章・298章）。
 * 現役＝今季（進行中のシーズン）の B.PREMIER か B.ONE のどちらかの名簿に載っている選手（どのリーグの画面でも同じ意味）。
 * ランキングの Profile と同じ「そのシーズンに登録していた選手」（players.json の選手＋名簿から足した registered-players.json の選手。173章）を、
 * 今季の両リーグについて使う。通算記録の上位20位は、デプロイのときの集計が現役だけの表を書き出す（scripts/aggregate-league-player-rankings.ts が同じ選手を数える）。URLは act=1
 */
export type ActiveToggle = "all" | "active";
export const ACTIVE_PARAM = enumParam<ActiveToggle>("act", ["all", "active"], "all", { active: "1" });
export const ACTIVE_LABEL = "現役";

/** 表の下の注記（現役で絞り込んだとき） */
export function activeNote(season: string = currentSeason()): string {
  return `現役は、今季（${season}シーズン）のB.PREMIERかB.ONEの名簿に載っている選手です。今季のB.NEXTでプレーしている選手は含まれません。`;
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

/** enabled のときだけ、今季の B.PREMIER と B.ONE の名簿（両リーグの players.json と registered-players.json）を読む */
export function useActivePlayerIds(enabled: boolean): ActivePlayers {
  const season = currentSeason();
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { data, loading, error } = useJsonData(async () => {
    if (!enabled) return null;
    // どのリーグの画面でも同じ選手（現役の意味をリーグで変えない）。B.ONE の名簿が読めなければ失敗にする（B.PREMIER だけの現役にしない）
    const lists = await Promise.all(ACTIVE_LEAGUES.flatMap((rosterLeague) => [fetchPlayers(season, rosterLeague), fetchRegisteredPlayers(season, rosterLeague)]));
    return new Set(lists.flat().map((p) => p.playerId));
  }, [enabled, season, attempt]);
  return {
    ids: enabled ? data : null,
    loading: enabled && loading,
    error: enabled && error ? `今季（${season}）の名簿を読み込めませんでした（${error}）` : null,
    retry,
  };
}
