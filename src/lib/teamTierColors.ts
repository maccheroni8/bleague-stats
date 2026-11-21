// 全チームスタッツ（各タブ・シチュエーション別）の、良い数値の上位3チーム（緑）・悪い数値の下位3チーム（赤）の色（設計書448章）。
// 順位の決め方・向き・色なしの項目はチーム詳細（407・408章）と同じ（compareRank.ts の teamRanksOf + rankDirection.ts）。
// 1位・最下位がいちばん濃い（tier-top-1〜3・tier-bot-1〜3）。画面・通信に依存しない純粋な関数だけ（保存キーの対象外）
import type { Column } from "../components/SortableTable";
import { teamRanksOf } from "./compareRank";
import type { AllTeamsRow, TeamPerspective } from "./teamStatsColumns";

/** 視点によらず自チームの勝敗そのものを表す列（勝率）。opp でも反転しない */
const OWN_RESULT_KEYS = new Set(["winPct", "w", "l"]);
/** 色を付けない列（チーム名・試合数・勝敗の表記・延長のあった試合数） */
const NO_TIER_KEYS = new Set(["team", "g", "record", "otGames"]);

/** 列のマスに付けるクラス（上位3位は tier-top-1〜3、下位3位は tier-bot-1〜3）。teamId → クラス */
export function tierCellClasses<R extends AllTeamsRow>(rows: readonly R[], col: Column<R>, perspective: TeamPerspective): Map<string, string> {
  const out = new Map<string, string>();
  if (NO_TIER_KEYS.has(col.key)) return out;
  const own = OWN_RESULT_KEYS.has(col.key);
  // 負けの数は少ないほど良い（向きを決める表には「l」が無いので、少ないほど良い項目の TOV の向きを借りる）
  const target = (col.key === "l" ? { ...col, key: "tov" } : col) as unknown as Column<AllTeamsRow>;
  const ranks = teamRanksOf(rows, target, own ? "own" : perspective);
  if (!ranks) return out;
  for (const [teamId, r] of ranks) {
    if (r.tier === "top") out.set(teamId, `tier-top-${r.rank}`);
    else if (r.tier === "bottom") out.set(teamId, `tier-bot-${r.bottomRank}`);
  }
  return out;
}

/** 各列に、順位の色のクラスを足した列を返す（並べ替えても色はその値に付いたまま。クラスは行の teamId で引く） */
export function withTierColors<R extends AllTeamsRow>(columns: readonly Column<R>[], rows: readonly R[], perspective: TeamPerspective): Column<R>[] {
  return columns.map((col) => {
    const classes = tierCellClasses(rows, col, perspective);
    if (classes.size === 0) return col;
    return { ...col, cellClass: (r: R) => classes.get(r.team.teamId) };
  });
}
