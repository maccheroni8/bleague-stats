import { stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "./GlossaryNote";
import { PLAYER_GAME_RECORD_STATS } from "../../shared/playerGameRecords";
import { composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchPlayerGameRecords, fetchSeasons } from "../lib/data";
import { gameTypeAxis, simpleSelectAxis } from "../lib/filterAxes";
import { useJsonData } from "../lib/useJsonData";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { playerGameRecordRankingUrl } from "./PlayerGameRecordRanking";
import { PlayerRecordLeaderCard } from "./PlayerRecordLeaderCard";

/**
 * 選手一覧「記録」タブの範囲「シーズン」: 選んだシーズン・試合区分の中の、選手の1試合の記録の1位（DESIGN.md 159・190章）。
 * 各項目の1位のカードを並べ、カードを押すとランキングページの同じ項目（範囲「シーズン」）へ移る。
 * 値は日次の集計が書き出した上位（data/{season}/player-game-records.json）で、画面は全選手の試合ログを読まない
 */
export function PlayerSeasonRecords({ defaultSeason }: { defaultSeason: string }) {
  // シーズン・試合種別はURLのクエリに持つ（rseason・gt。DESIGN.md 163章）
  const [season, setSeason] = useUrlState(stringParam("rseason", defaultSeason, (v) => /^\d{4}-\d{2}$/.test(v)), defaultSeason);
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");

  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: file, loading } = useJsonData(() => fetchPlayerGameRecords(season), [season]);
  const table = file?.byGameType[gameType] ?? {};
  const records = PLAYER_GAME_RECORD_STATS.flatMap((def) => {
    const entries = table[def.key];
    return entries && entries.length > 0 ? [{ def, entries }] : [];
  });
  const names = records.flatMap((r) => r.entries.slice(0, 1).map((e) => e.playerName));

  const seasonOptions = [...(seasons ?? [])]
    .map((s) => s.season)
    .sort((a, b) => b.localeCompare(a))
    .map((s) => ({ value: s, label: `${s}シーズン` }));

  return (
    <div>
      <FilterBar
        simple
        stateKey="players:records:season"
        axes={[
          simpleSelectAxis({
            id: "playerRecordsSeason",
            label: "シーズン",
            options: seasonOptions.length > 0 ? seasonOptions : [{ value: season, label: `${season}シーズン` }],
            value: season,
            defaultValue: defaultSeason,
            onChange: setSeason,
          }),
          gameTypeAxis(gameType, setGameType, season),
        ]}
      />
      <ConditionTitle title={`${season}シーズンの記録`} conditions={composeLabels(gameTypeLabels(gameType, season))} />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : records.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <PlayerNamePool names={names}>
          <h3 className="career-highs-subheading">1試合の記録（各項目の1位。押すとランキングへ）</h3>
          <div className="career-highs-grid">
            {records.map(({ def, entries }) => (
              <PlayerRecordLeaderCard
                key={def.key}
                def={def}
                entries={entries}
                season={season}
                to={playerGameRecordRankingUrl({ scope: "season", gameType, statKey: def.key, season })}
              />
            ))}
          </div>
          <GlossaryNote anchor={GLOSSARY_ANCHORS.records} label="記録" scope="そのシーズンの全選手の出場した試合の中での1試合の記録です。" />
        </PlayerNamePool>
      )}
    </div>
  );
}
