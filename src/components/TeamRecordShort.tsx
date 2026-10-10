import { formatRecordShort, RESULT_ONLY_MARK, resultOnlyMarkTitle } from "../lib/recordFormat";

/**
 * 勝敗の短い表記（「45-15」）。スタッツの無い試合（結果だけの試合）を勝敗に含むチーム・シーズンだけ、
 * 後ろに「※」を付けて、勝敗とスタッツの試合数が食い違うことをツールチップで説明する（DESIGN.md 228章）
 */
export function TeamRecordShort({
  wins,
  losses,
  resultOnlyGames,
}: {
  wins: number;
  losses: number;
  resultOnlyGames?: number;
}) {
  return (
    <>
      {formatRecordShort(wins, losses)}
      {resultOnlyGames ? (
        <span className="result-only-mark" title={resultOnlyMarkTitle(resultOnlyGames)}>
          {RESULT_ONLY_MARK}
        </span>
      ) : null}
    </>
  );
}
