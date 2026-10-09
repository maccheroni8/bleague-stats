import { Link } from "react-router-dom";
import { formatTeamRecordDetail, formatTeamRecordValue, type TeamGameRecordRow } from "../lib/teamGameRecords";
import { useNarrow } from "../lib/teamLabel";
import { RecordValue } from "./RecordValue";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/**
 * チーム一覧「記録」タブのカード（DESIGN.md 191章）: 項目ごとの1位。カード全体が、ランキングページの同じ項目へのリンク。
 * 同じ記録（1位タイ）が複数あるときは、1位の最初の試合と「ほか◯試合」を出す
 */
export function TeamRecordLeaderCard({
  itemKey,
  label,
  rows,
  to,
}: {
  itemKey: string;
  label: string;
  /** その項目の上位（1位が先頭） */
  rows: TeamGameRecordRow[];
  /** ランキングページの同じ項目 */
  to: string;
}) {
  const narrow = useNarrow();
  const first = rows[0];
  if (!first) return null;
  const ties = rows.filter((r) => r.rank === 1).length;
  const date = narrow ? first.date.replace(/-/g, "/").slice(2) : first.date;
  return (
    <Link to={to} className="career-high-card career-high-card-link" aria-label={`${label}のランキングを見る`}>
      <div className="career-high-label">{label} ›</div>
      <div className="career-high-value">
        <RecordValue
          text={formatTeamRecordValue(itemKey, first.value)}
          fraction={first.made !== undefined && first.attempted !== undefined ? [first.made, first.attempted] : undefined}
        />
        {first.fromPbp && <span title="公式のクォーター別スコアが欠けている試合のため、プレーバイプレーの得点から出した値です。">※</span>}
      </div>
      {/* 記録したチームは太字にして、対戦相手と区別する */}
      <div>
        <span className="record-team">
          <ResponsiveTeamName teamId={first.teamId} name={first.teamName} always />
        </span>
      </div>
      <div>
        <span className="record-date-nowrap">
          {date}（{first.season}）
        </span>{" "}
        {first.isHome ? "vs" : "@"} <ResponsiveTeamName teamId={first.opponentTeamId} name={first.opponentTeamName} always />
      </div>
      {first.detail && <div>{formatTeamRecordDetail(first.detail, first.value)}</div>}
      {ties > 1 && <div className="career-high-others-toggle">ほか{ties - 1}試合</div>}
    </Link>
  );
}
