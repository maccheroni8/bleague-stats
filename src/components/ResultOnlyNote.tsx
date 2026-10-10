import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";
import { useTeamLabel } from "../lib/teamLabel";

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
  const label = useTeamLabel();
  const shown = (games ?? []).filter(
    (g) => g.gameType === "regular" && (!teamId || g.homeTeamId === teamId || g.awayTeamId === teamId),
  );
  if (shown.length === 0) return null;
  return (
    <p className={className}>
      {variant === "stats"
        ? "この表の試合数・勝敗はスタッツ（ボックススコア）のある試合だけです。順位表の勝敗には、次の試合が含まれます: "
        : "勝敗には、スタッツ（ボックススコア）の無い試合を含みます。試合数・スタッツ・試合ログ・シチュエーション別の成績・ランキングには入りません: "}
      {shown.map((g, i) => (
        <span key={g.scheduleKey}>
          {i > 0 && "、"}
          {g.date.replace(/-/g, "/")} {label(g.homeTeamId, g.homeTeamName)} {g.homeScore}-{g.awayScore}{" "}
          {label(g.awayTeamId, g.awayTeamName)}（{g.reason === "forfeit" ? "不戦勝" : "公式にボックススコアなし"}）
        </span>
      ))}
    </p>
  );
}
