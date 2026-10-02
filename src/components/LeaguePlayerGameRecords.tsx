import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "./GlossaryNote";
import { PLAYER_GAME_RECORD_STATS } from "../../shared/playerGameRecords";
import { composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchLeaguePlayerGameRecords } from "../lib/data";
import { gameTypeAxis, type FilterAxis } from "../lib/filterAxes";
import { useJsonData } from "../lib/useJsonData";
import { useUrlState } from "../lib/urlState";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { playerGameRecordRankingUrl } from "./PlayerGameRecordRanking";
import { PlayerRecordLeaderCard } from "./PlayerRecordLeaderCard";

/**
 * 選手一覧「記録」タブの範囲「歴代」・カテゴリ「B.PREMIER（旧B1）レコード」: 全シーズンの選手の1試合の記録の1位（DESIGN.md 188・190章）。
 * 各項目の1位のカードを並べ、カードを押すとランキングページの同じ項目（範囲「歴代」）へ移る。
 * 値は夜間の集計が書き出した上位（data/league-player-game-records.json）で、画面は全選手の試合ログを読まない
 */
export function LeaguePlayerGameRecords({ categoryAxis }: { categoryAxis: FilterAxis }) {
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const { data: file, loading } = useJsonData(() => fetchLeaguePlayerGameRecords(), []);
  const table = file?.byGameType[gameType] ?? {};
  const records = PLAYER_GAME_RECORD_STATS.flatMap((def) => {
    const entries = table[def.key];
    return entries && entries.length > 0 ? [{ def, entries }] : [];
  });
  const names = records.flatMap((r) => r.entries.slice(0, 1).map((e) => e.playerName));

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
          <h3 className="career-highs-subheading">1試合の記録（各項目の1位。押すとランキングへ）</h3>
          <div className="career-highs-grid">
            {records.map(({ def, entries }) => (
              <PlayerRecordLeaderCard
                key={def.key}
                def={def}
                entries={entries}
                season=""
                to={playerGameRecordRankingUrl({ scope: "allTime", gameType, statKey: def.key })}
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
