import { useCallback, useState } from "react";
import { currentPlayerNames } from "../../shared/playerName";
import { fetchPlayersMaster } from "./data";
import { useJsonData } from "./useJsonData";

/**
 * 複数のシーズンをまたぐ表（歴代・通算など）の選手名を、選手マスタの今の登録名にそろえるための、選手ID → 名前の表（DESIGN.md 222-5）。
 * 単一のシーズンの表は、そのシーズンの表記のまま（これは使わない）。enabled のときだけ選手マスタ（約33KB）を読む
 */
export interface CurrentPlayerNames {
  /** 読み込み前・読み込めなかったとき・使わないときは null */
  names: ReadonlyMap<string, string> | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

export function useCurrentPlayerNames(enabled: boolean): CurrentPlayerNames {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const { data, loading, error } = useJsonData(async () => (enabled ? currentPlayerNames(await fetchPlayersMaster()) : null), [enabled, attempt]);
  return {
    names: enabled ? data : null,
    loading: enabled && loading,
    error: enabled && error ? `選手の登録名を読み込めませんでした（${error}）` : null,
    retry,
  };
}
