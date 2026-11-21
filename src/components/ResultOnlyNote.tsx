import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";
import { resultOnlyRecordNote, resultOnlyStatsNote } from "../lib/resultOnlyNoteText";

/**
 * 結果だけの試合（ボックススコアが公式に無い試合・不戦勝。DESIGN.md 228章）の注記。
 * 勝敗・得失点には数えるが、スタッツの試合数（G）・試合ログ・ランキング・記録には入っていないことを、該当の試合を挙げて伝える。
 * 勝敗の試合数とスタッツの試合数が食い違って見える画面（順位表・チーム詳細）に添える。対象が無ければ何も出さない
 */
export function ResultOnlyNote({
  games,
  teamId,
  variant = "record",
  className = "result-only-note",
}: {
  games: ResultOnlyGameEntry[] | undefined;
  /** record: 勝敗に含む（順位表・チーム詳細）／ stats: スタッツのある試合だけで数える表（全チームスタッツ。順位表と勝敗が1試合違うことがある） */
  variant?: "record" | "stats";
  /** 指定すると、そのチームの試合だけを挙げる */
  teamId?: string;
  className?: string;
}) {
  const shown = (games ?? []).filter(
    (g) => g.gameType === "regular" && (!teamId || g.homeTeamId === teamId || g.awayTeamId === teamId),
  );
  if (shown.length === 0) return null;
  return <p className={className}>{variant === "stats" ? resultOnlyStatsNote(shown) : resultOnlyRecordNote(shown)}</p>;
}
