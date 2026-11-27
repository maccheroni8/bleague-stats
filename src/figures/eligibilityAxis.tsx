import { AchievableCheckbox } from "../components/AchievableCheckbox";
import { GamesPlayedRatioSlider } from "../components/GamesPlayedRatioSlider";
import type { FilterAxis } from "../lib/filterAxes";
import { eligibilityLabels } from "../lib/conditionLabels";
import { numberParam } from "../lib/urlState";

/** 出場率の上限（%）のURL。書かなければ100（上限なし）。下限だけの古いURLもそのまま開ける（DESIGN.md 476章） */
export const ratioMaxParam = (key: string) => numberParam(key, 100, { min: 0, max: 100 });

/**
 * 図解の「掲載基準」（出場率◯%以上、上限を下げると「0〜84%」）。ランキングの掲載基準と同じ形：ボタンに今の値（「出場率85%以上」）が出て、
 * 押すとスライダー（つまみ2つ）の小窓が開く。achievable を渡すと、ランキングと同じ「85%以上達成可能」のチェックを出す（基準は85%で固定）
 * （supported が false のとき〔B.ONE で日程が足りない間〕はチェックを出さない）。年齢分布・トップスコアラー・散布図・ベン図・シュート成功率で共通
 */
export function ratioEligibilityAxis({ id, value, max, defaultValue, onChange, achievable }: {
  id: string; value: number; max: number; defaultValue: number; onChange: (min: number, max: number) => void;
  achievable?: { checked: boolean; onChange: (checked: boolean) => void; supported: boolean };
}): FilterAxis {
  const checked = !!achievable?.supported && achievable.checked;
  const summary = eligibilityLabels({ gamesRatio: value / 100, gamesRatioMax: max / 100, achievable: checked }).join("");
  return {
    kind: "popover", id, label: "掲載基準", tier: "primary",
    value: `${value}-${max}|${checked ? "ach" : ""}`, defaultValue: `${defaultValue}-100|`,
    onChange: () => { onChange(defaultValue, 100); achievable?.onChange(false); },
    summary, chipValue: summary,
    content: <>
      <GamesPlayedRatioSlider label="出場率" min={value} max={max} onChange={onChange} />
      {achievable?.supported && <AchievableCheckbox checked={achievable.checked} onChange={achievable.onChange} />}
    </>,
  };
}
