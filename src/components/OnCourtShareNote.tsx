// 選手の出場中の割合（Scoring の %PTS〜%FTA・Misc の AST%）の注記（在コート基準の再集計。DESIGN.md 304章）。
// 記録が欠けて分子・分母の両方から外した試合の数を出す（372章から全シーズン。前は 2016-17〜2019-20 を出していなかった）。

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
  const excluded = rows.reduce((a, r) => a + Math.max(0, r.gamesPlayed - r.ocGames), 0);
  return (
    <>
      {rows.length > 0 && (
        <p className="rule-change-footnote">
          ※ {target}は、その選手が出場していた間の自チームの数を分母にしています
          {excluded > 0 ? `。プレーバイプレーが無い試合・前後半5分の特別な試合・出場選手の復元が記録と合わない試合（この表では${excluded}試合）は、分子・分母の両方から外しています` : ""}。
        </p>
      )}
    </>
  );
}
