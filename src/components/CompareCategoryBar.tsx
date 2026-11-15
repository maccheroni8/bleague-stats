import { BOXSCORE_TABS, type BoxscoreTabKey } from "./BoxscoreTable";
import { TEAM_PERSPECTIVE_LABELS, type TeamPerspective } from "../lib/teamStatsColumns";

interface Props {
  tabs?: { key: BoxscoreTabKey; label: string }[];
  category: BoxscoreTabKey;
  onCategory: (key: BoxscoreTabKey) => void;
  /** 指定したときだけ、タブの並びの右端に視点（自チーム／opp／+/-）の切り替えを出す（チームの比較） */
  perspective?: TeamPerspective;
  onPerspective?: (v: TeamPerspective) => void;
}

/**
 * 比較の表の上に置くタブ行（比較ページ・チーム詳細・個人詳細の比較タブで共通）。
 * 左にスタッツ項目のタブ、右端に視点の切り替え。狭い画面では視点がタブの下の行へ折り返す（はみ出さない）
 */
export function CompareCategoryBar({ tabs = BOXSCORE_TABS, category, onCategory, perspective, onPerspective }: Props) {
  return (
    <div className="tab-bar-with-toggle compare-category-bar">
      <div className="tab-bar">
        {tabs.map((t) => (
          <button key={t.key} className={`tab-button${category === t.key ? " active" : ""}`} onClick={() => onCategory(t.key)} type="button">
            {t.label}
          </button>
        ))}
      </div>
      {perspective && onPerspective && (
        <div className="mode-toggle" role="group" aria-label="視点">
          {(Object.keys(TEAM_PERSPECTIVE_LABELS) as TeamPerspective[]).map((p) => (
            <button key={p} type="button" className={perspective === p ? "active" : ""} onClick={() => onPerspective(p)}>
              {TEAM_PERSPECTIVE_LABELS[p]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
