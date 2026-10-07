import { Link } from "react-router-dom";
import type { PlayerGameRecordDef } from "../../shared/playerGameRecords";
import type { PlayerGameRecordEntry } from "../../shared/types";
import { formatPlayerGameRecordValue, playerGameRecordFraction } from "../lib/playerGameRecordFormat";
import { PlayerGameRecordLine } from "./PlayerGameRecordRanking";
import { RecordValue } from "./RecordValue";
import { ResponsivePlayerName } from "./ResponsivePlayerName";

/**
 * 選手一覧「記録」タブのカード（DESIGN.md 190章）: 項目ごとの1位。カード全体が、ランキングページの同じ項目へのリンク。
 * 同じ記録（1位タイ）が複数あるときは、1位の最初の試合と「ほか◯試合」を出す
 */
export function PlayerRecordLeaderCard({
  def,
  entries,
  season,
  to,
}: {
  def: PlayerGameRecordDef;
  entries: PlayerGameRecordEntry[];
  /** 歴代のときは各行の season を使う。シーズンのときのシーズン */
  season: string;
  /** ランキングページの同じ項目 */
  to: string;
}) {
  const first = entries[0]!;
  const ties = entries.filter((e) => e.rank === 1).length;
  return (
    <Link to={to} className="career-high-card career-high-card-link" aria-label={`${def.label}のランキングを見る`}>
      <div className="career-high-label">{def.label} ›</div>
      <div className="career-high-value">
        <RecordValue text={formatPlayerGameRecordValue(def, first.value)} fraction={playerGameRecordFraction(first)} />
      </div>
      {/* 記録した選手は太字にして、対戦相手と区別する */}
      <div>
        <span className="record-team">
          <ResponsivePlayerName name={first.playerName} playerId={first.playerId} season={first.season ?? season} />
        </span>
      </div>
      <div>
        <PlayerGameRecordLine e={first} season={first.season ?? season} />
      </div>
      {ties > 1 && <div className="career-high-others-toggle">ほか{ties - 1}試合</div>}
    </Link>
  );
}
