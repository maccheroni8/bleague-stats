import type { ShotChartGameFilters } from "../lib/situational";

interface Props {
  filters: ShotChartGameFilters;
  onChange: (filters: ShotChartGameFilters) => void;
  /** 「対勝率別」ボタンの表示可否（対戦相手の勝率算出にシーズン全体の試合日程が必要なため） */
  opponentWinRateSupported?: boolean;
  /** シーズン内移籍対応: このシーズンに複数チームでプレーした場合のみチーム別ボタンを表示する
   * （{teamId, label}の配列。1チームのみの通常ケースでは渡さない、または空配列にする） */
  teamOptions?: { teamId: string; label: string }[];
}

/**
 * ショットチャート専用の複数選択フィルタUI。既存のSituationalFilterPicker（1つだけ選べる
 * 単一選択）とは異なり、各行（会場・地区・勝敗・時期・曜日・対戦相手の強さ・月別）を
 * 独立にON/OFFでき、選択した条件すべてがANDで絞り込まれる。同じ行内の選択肢は
 * 再クリックでOFFに戻せる（排他ではあるが「未選択」状態を持つラジオボタンに近い挙動）
 */
export function ShotChartFilterPicker({ filters, onChange, opponentWinRateSupported, teamOptions }: Props) {
  const toggle = <K extends keyof ShotChartGameFilters>(key: K, value: ShotChartGameFilters[K]) => {
    onChange({ ...filters, [key]: filters[key] === value ? undefined : value });
  };

  return (
    <div className="situational-filter">
      {teamOptions && teamOptions.length > 1 && (
        <div className="mode-toggle">
          {teamOptions.map((t) => (
            <button key={t.teamId} className={filters.ownTeamId === t.teamId ? "active" : ""} onClick={() => toggle("ownTeamId", t.teamId)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="mode-toggle">
        <button className={filters.homeAway === "home" ? "active" : ""} onClick={() => toggle("homeAway", "home")}>
          ホーム
        </button>
        <button className={filters.homeAway === "away" ? "active" : ""} onClick={() => toggle("homeAway", "away")}>
          アウェイ
        </button>
        <button className={filters.division === "east" ? "active" : ""} onClick={() => toggle("division", "east")}>
          対東地区
        </button>
        <button className={filters.division === "west" ? "active" : ""} onClick={() => toggle("division", "west")}>
          対西地区
        </button>
      </div>
      <div className="mode-toggle">
        <button className={filters.result === "win" ? "active" : ""} onClick={() => toggle("result", "win")}>
          勝った試合
        </button>
        <button className={filters.result === "loss" ? "active" : ""} onClick={() => toggle("result", "loss")}>
          負けた試合
        </button>
      </div>
      <div className="mode-toggle">
        <select
          value={filters.month !== undefined ? String(filters.month) : ""}
          onChange={(e) => {
            const value = e.target.value;
            onChange({ ...filters, month: value === "" ? undefined : Number(value) });
          }}
        >
          <option value="">月別</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <button className={filters.newYear === "before" ? "active" : ""} onClick={() => toggle("newYear", "before")}>
          年明け前
        </button>
        <button className={filters.newYear === "after" ? "active" : ""} onClick={() => toggle("newYear", "after")}>
          年明け後
        </button>
        <button
          className={filters.weekday ? "active" : ""}
          onClick={() => onChange({ ...filters, weekday: filters.weekday ? undefined : true })}
        >
          平日開催
        </button>
      </div>
      {opponentWinRateSupported && (
        <div className="mode-toggle">
          <button
            className={filters.opponentWinRate === "under50" ? "active" : ""}
            onClick={() => toggle("opponentWinRate", "under50")}
          >
            対5割未満
          </button>
          <button
            className={filters.opponentWinRate === "atLeast50" ? "active" : ""}
            onClick={() => toggle("opponentWinRate", "atLeast50")}
          >
            対5割以上
          </button>
          <button
            className={filters.opponentWinRate === "atLeast60" ? "active" : ""}
            onClick={() => toggle("opponentWinRate", "atLeast60")}
          >
            対6割以上
          </button>
        </div>
      )}
    </div>
  );
}
