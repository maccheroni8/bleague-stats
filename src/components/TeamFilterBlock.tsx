import { TeamLogo } from "./TeamLogo";
import { teamShortName } from "../../shared/teamNames";

/** 日程ページ（SchedulePage）由来のチーム複数選択フィルタ。他ページでも同じパターンで再利用する */
export function TeamFilterBlock({
  options,
  selected,
  expanded,
  onToggleExpanded,
  onToggle,
  onSelectAll,
  onSelectNone,
  heading = "チームで絞り込み",
}: {
  options: { teamId: string; teamName: string }[];
  selected: Set<string> | null;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggle: (teamId: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  heading?: string;
}) {
  if (options.length === 0) return null;
  const selectedCount = selected === null ? options.length : selected.size;
  const hasActiveFilter = selected !== null && selected.size < options.length;
  return (
    <div className="filter-block schedule-team-filter">
      <h3 className="collapsible-heading" onClick={onToggleExpanded}>
        {expanded ? "▼ " : "▶ "}
        {heading}
        {hasActiveFilter && `（${selectedCount}/${options.length}チーム選択中）`}
      </h3>
      {expanded && (
        <>
          <div className="schedule-team-filter-actions">
            <button type="button" onClick={onSelectAll}>
              すべて選択
            </button>
            <button type="button" onClick={onSelectNone}>
              すべて解除
            </button>
          </div>
          <div className="schedule-team-filter-grid">
            {options.map((t) => {
              const checked = selected === null || selected.has(t.teamId);
              return (
                <label key={t.teamId} className="schedule-team-filter-item">
                  <input type="checkbox" checked={checked} onChange={() => onToggle(t.teamId)} />
                  <TeamLogo teamId={t.teamId} size={18} />
                  {teamShortName(t.teamId, t.teamName)}
                </label>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
