import type { Division } from "../../shared/types";
import { FilterBar } from "./FilterBar";
import {
  classificationAxis,
  gameTypeAxis,
  periodAxis,
  situationalAxes,
  type FilterAxis,
  type FilterAxisOption,
} from "../lib/filterAxes";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import type { PeriodRangeValue } from "../lib/periodRange";
import { SEASON_PERIOD_OPTIONS } from "../lib/seasonPeriod";
import type { SeasonHalfBoundary, SituationalFilter } from "../lib/situational";

/** スロットの先頭に並べる「どの対象か」の選択（シーズン・チーム・選手）。値は既定値を持たず、チップにも出さない */
export interface CompareSlotSelect {
  id: string;
  label: string;
  value: string;
  options: FilterAxisOption[];
  onChange: (value: string) => void;
}

interface CompareSlotFilterProps {
  /** 「詳細フィルタ」の開閉状態のキー。スロットごとに一意にする */
  stateKey: string;
  selects: CompareSlotSelect[];
  /** false（シーズン・対象が未選択）の間は、絞り込みの軸を出さず disabledNote だけを示す */
  enabled: boolean;
  disabledNote: string;
  filter: SituationalFilter;
  onFilter: (filter: SituationalFilter) => void;
  /** 試合種別をスロットごとに持つ場合のみ渡す（ComparePage。詳細ページの比較タブはバー上部の共通の試合種別を使う） */
  gameType?: {
    value: SeasonGameTypeFilter;
    onChange: (gameType: SeasonGameTypeFilter) => void;
    /** スロットのシーズン（ポストシーズンの表示名「CS」/「プレーオフ」の切り替えに使う） */
    season: string | null;
  };
  /** Q別・前後半・延長・クラッチ（比較ページのスロットだけ） */
  period?: { value: PeriodRangeValue; onChange: (v: PeriodRangeValue) => void };
  /** 登録区分（比較ページのチームのスロットだけ。選手は区分が決まっているので渡さない） */
  classification?: { value: string; onChange: (v: string) => void; season: string | null };
  /** 「すべて解除」を1回の更新で行う（スロットの条件をまとめて戻す。順に更新すると、あとの更新が前の更新を古い値で上書きする） */
  onClear?: () => void;
  boundary?: SeasonHalfBoundary | null;
  opponentWinRateSupported?: boolean;
  /** 「対戦相手の勝率」の最新勝率の選択肢を出すか（設計書450章） */
  opponentLatestWinRateSupported?: boolean;
  ownTeamDivisionSupported?: boolean;
  /** 「対戦地区」の「対◯地区」の選択肢（スロットのシーズン・リーグにある地区。opponentDivisionChoices） */
  opponentDivisions?: Division[];
  /** 指定時、シチュエーションの絞り込みを出さず、この注記を出す（リーグ平均はシーズン全体の値のため。DESIGN.md 149章） */
  situationalDisabledNote?: string;
}

/**
 * 比較スロット1つ分のフィルタ（DESIGN.md 105章 B3）。ComparePage・個人詳細の比較タブ・チーム詳細の比較タブの
 * 3か所で重複していた「シーズン select ＋ SituationalFilterPicker ＋ 試合種別」を統合した部品。
 * 主要軸はシーズン・（対象）・（試合種別）・対象期間、会場と勝敗〜対戦相手勝率は詳細フィルタに畳み、
 * 変更した軸はスロット単位のチップで示す
 */
export function CompareSlotFilter({
  stateKey,
  selects,
  enabled,
  disabledNote,
  filter,
  onFilter,
  gameType,
  period,
  classification,
  onClear,
  boundary,
  opponentWinRateSupported,
  opponentLatestWinRateSupported,
  ownTeamDivisionSupported,
  opponentDivisions,
  situationalDisabledNote,
}: CompareSlotFilterProps) {
  const selectAxes: FilterAxis[] = selects.map((s) => ({
    kind: "select",
    id: `slot.${s.id}`,
    label: s.label,
    tier: "primary",
    options: s.options,
    value: s.value,
    defaultValue: s.value,
    onChange: s.onChange,
    chip: false,
  }));

  const axes: FilterAxis[] = [...selectAxes];
  if (enabled) {
    if (gameType) axes.push(gameTypeAxis(gameType.value, gameType.onChange, gameType.season));
    if (period && !situationalDisabledNote) axes.push(periodAxis(period.value, period.onChange, SEASON_PERIOD_OPTIONS));
    if (classification && !situationalDisabledNote) {
      axes.push(classificationAxis(classification.value as "all", classification.onChange as (v: "all") => void, { season: classification.season, teamCombined: true }));
    }
    if (!situationalDisabledNote) axes.push(
      // 会場はスロットでは詳細フィルタ側に置く（スロットの幅では主要軸を絞るため）
      ...situationalAxes(filter, onFilter, { boundary, opponentWinRateSupported, opponentLatestWinRateSupported, ownTeamDivisionSupported, opponentDivisions }).map(
        (a): FilterAxis => (a.id === "s.homeAway" ? { ...a, tier: "advanced" } : a),
      ),
    );
  }

  const clearAll = () => {
    if (onClear) return onClear();
    onFilter({ range: { kind: "all" } });
    gameType?.onChange("regular");
    period?.onChange("all");
    classification?.onChange("all");
  };

  return (
    <>
      <FilterBar axes={axes} stateKey={stateKey} onClearAll={clearAll} compact />
      {!enabled && <p className="compare-slot-note">{disabledNote}</p>}
      {enabled && situationalDisabledNote && <p className="compare-slot-note">{situationalDisabledNote}</p>}
    </>
  );
}
