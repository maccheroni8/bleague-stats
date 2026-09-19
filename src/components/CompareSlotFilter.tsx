import { FilterBar } from "./FilterBar";
import {
  gameTypeAxis,
  situationalAxes,
  type FilterAxis,
  type FilterAxisOption,
} from "../lib/filterAxes";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
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
  gameType?: { value: SeasonGameTypeFilter; onChange: (gameType: SeasonGameTypeFilter) => void };
  boundary?: SeasonHalfBoundary | null;
  opponentWinRateSupported?: boolean;
  ownTeamDivisionSupported?: boolean;
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
  boundary,
  opponentWinRateSupported,
  ownTeamDivisionSupported,
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
    if (gameType) axes.push(gameTypeAxis(gameType.value, gameType.onChange));
    axes.push(
      // 会場はスロットでは詳細フィルタ側に置く（スロットの幅では主要軸を絞るため）
      ...situationalAxes(filter, onFilter, { boundary, opponentWinRateSupported, ownTeamDivisionSupported }).map(
        (a): FilterAxis => (a.id === "s.homeAway" ? { ...a, tier: "advanced" } : a),
      ),
    );
  }

  const clearAll = () => {
    onFilter({ range: { kind: "all" } });
    gameType?.onChange("regular");
  };

  return (
    <>
      <FilterBar axes={axes} stateKey={stateKey} onClearAll={clearAll} compact />
      {!enabled && <p className="compare-slot-note">{disabledNote}</p>}
    </>
  );
}
