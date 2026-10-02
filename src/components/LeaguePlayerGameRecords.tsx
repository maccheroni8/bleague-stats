import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "./GlossaryNote";
import { PLAYER_GAME_RECORD_STATS } from "../../shared/playerGameRecords";
import { composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchLeaguePlayerGameRecords } from "../lib/data";
import { gameTypeAxis, type FilterAxis } from "../lib/filterAxes";
import { usePageState } from "../lib/pageStateCache";
import { useJsonData } from "../lib/useJsonData";
import { useUrlState } from "../lib/urlState";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerRecordCard } from "./PlayerSeasonRecords";

/**
 * 選手一覧「記録」タブの範囲「歴代」・カテゴリ「B.PREMIER（旧B1）レコード」: 全シーズンの選手の1試合の記録（DESIGN.md 188章）。
 * 値は夜間の集計が書き出した上位（data/league-player-game-records.json）で、画面は全選手の試合ログを読まない。
 * カードの形はシーズン側（PlayerSeasonRecords）と同じ。各行にその試合のシーズンを添える
 */
export function LeaguePlayerGameRecords({ categoryAxis }: { categoryAxis: FilterAxis }) {
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [openKeys, setOpenKeys] = usePageState<Set<string>>("players:records:league:open", () => new Set());
  const [showAllKeys, setShowAllKeys] = usePageState<Set<string>>("players:records:league:showAll", () => new Set());
  const toggle = (setter: typeof setOpenKeys, key: string) =>
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const { data: file, loading } = useJsonData(() => fetchLeaguePlayerGameRecords(), []);
  const table = file?.byGameType[gameType] ?? {};
  const records = PLAYER_GAME_RECORD_STATS.flatMap((def) => {
    const entries = table[def.key];
    return entries && entries.length > 0 ? [{ def, entries }] : [];
  });
  const names = records.flatMap((r) => r.entries.map((e) => e.playerName));

  return (
    <div>
      <FilterBar simple stateKey="players:records:league" axes={[categoryAxis, gameTypeAxis(gameType, setGameType, null)]} />
      <ConditionTitle title="歴代記録 B.PREMIER（旧B1）レコード：1試合の記録" conditions={composeLabels(gameTypeLabels(gameType, null))} />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : records.length === 0 ? (
        <p className="empty-message">データがありません</p>
      ) : (
        <PlayerNamePool names={names}>
          <div className="career-highs-grid">
            {records.map(({ def, entries }) => (
              <PlayerRecordCard
                key={def.key}
                def={def}
                entries={entries}
                season=""
                showSeason
                open={openKeys.has(def.key)}
                onToggle={() => toggle(setOpenKeys, def.key)}
                showAll={showAllKeys.has(def.key)}
                onToggleShowAll={() => toggle(setShowAllKeys, def.key)}
              />
            ))}
          </div>
          <GlossaryNote
            anchor={GLOSSARY_ANCHORS.records}
            label="記録"
            scope="全シーズンの全選手の出場した試合の中での1試合の記録です（毎日1回、前日までの試合結果を取り込んだあとに作り直します）。"
          />
        </PlayerNamePool>
      )}
    </div>
  );
}
