// 選手の出場中の割合（Scoring の %PTS〜%FTA・Misc の AST%）の注記（在コート基準の再集計。DESIGN.md 303章）。
// 2016-17〜2019-20 は出していない理由、2020-21以降は、記録が欠けて分子・分母の両方から外した試合の数を出す。
import { onCourtShareSeasonUnsupported } from "../lib/onCourtShareSeason";

export interface OnCourtShareNoteRow {
  season: string;
  /** 出場した試合の数 */
  gamesPlayed: number;
  /** そのうち、出場中の記録がそろう試合の数 */
  ocGames: number;
}

export function OnCourtShareNote({ tab, rows }: { tab: string; rows: readonly OnCourtShareNoteRow[] }) {
  if (tab !== "scoring" && tab !== "misc") return null;
  const target = tab === "scoring" ? "%PTS〜%FTA" : "選手のAST%";
  const legacy = rows.some((r) => onCourtShareSeasonUnsupported(r.season));
  const modern = rows.filter((r) => !onCourtShareSeasonUnsupported(r.season));
  const excluded = modern.reduce((a, r) => a + Math.max(0, r.gamesPlayed - r.ocGames), 0);
  return (
    <>
      {legacy && (
        <p className="rule-change-footnote">※ 2016-17〜2019-20 は、{target}を出していません（出場中の記録の数え上げが無いため）。</p>
      )}
      {modern.length > 0 && (
        <p className="rule-change-footnote">
          ※ {target}は、その選手が出場していた間の自チームの数を分母にしています
          {excluded > 0 ? `。プレーバイプレーが無い・出場選手の復元が記録と合わない試合（この表では${excluded}試合）は、分子・分母の両方から外しています` : ""}。
        </p>
      )}
    </>
  );
}
