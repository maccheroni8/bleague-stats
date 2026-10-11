// チームの表（チーム詳細の比較・日程結果・シチュエーション別成績、比較ページのチーム）で使う、ボックススコアのカテゴリタブの列。
// 試合詳細のボックススコア（BoxscoreTable の COLUMNS_BY_TAB）は選手の行とチーム合計の行を同じ列に並べるため、
// Scoring の %系（%PTS〜%FTA）は「個人 ÷ チーム全体」の定義のまま選手の行だけに値を出し、チーム合計の行は「-」にしている。
// チームだけの表ではその「-」が行ごと並んでしまうので、列定義そのものは変えず、チームの表の側でだけ次のように直す（DESIGN.md 136章・65-4章）:
// - %3PM・%3PA・%2PM・%2PA: 全チームスタッツ・ランキング・チーム詳細のシーズン別成績と同じ「FGAに占める割合」（100×該当÷FGA）に差し替える
// - %PTS・%FGM・%FGA・%FTM・%FTA: チームでは常に100%になるため、列ごと外す（%FTAに相当するFTA/FGAはアドバンスドのFTR）
import { boxscoreColumnsFor, type BoxscoreColumn, type BoxscoreTabKey } from "../components/BoxscoreTable";
import { safeDiv } from "../../shared/formulas";
import type { BoxscoreCounts } from "./boxscoreAggregate";
import { formatPct100 } from "./format";

/** チームの表では出さない列（選手の「個人 ÷ チーム全体」で、チームの値にすると常に100%になる） */
export const TEAM_HIDDEN_BOXSCORE_COLUMN_KEYS: ReadonlySet<string> = new Set(["pctpts", "pctfgm", "pctfga", "pctftm", "pctfta"]);

/** チームの表でのFGAに占める割合（0〜100）。選手の行の「チーム内の割合」とは別の意味の項目 */
const FGA_SHARE: Record<string, (c: BoxscoreCounts) => number> = {
  pct3pm: (c) => safeDiv(100 * c.pt3m, c.pt2a + c.pt3a),
  pct3pa: (c) => safeDiv(100 * c.pt3a, c.pt2a + c.pt3a),
  pct2pm: (c) => safeDiv(100 * c.pt2m, c.pt2a + c.pt3a),
  pct2pa: (c) => safeDiv(100 * c.pt2a, c.pt2a + c.pt3a),
};

/** ボックススコアのカテゴリタブの列を、チームの表向けに直したもの。自チーム・opp・+/- のどの視点でも、その側の合計から値を出す */
export function teamBoxscoreColumnsFor(tab: BoxscoreTabKey, foulSplit: boolean): BoxscoreColumn[] {
  return boxscoreColumnsFor(tab, foulSplit)
    .filter((col) => !TEAM_HIDDEN_BOXSCORE_COLUMN_KEYS.has(col.key))
    .map((col) => {
      const share = FGA_SHARE[col.key];
      if (!share) return col;
      return { ...col, format: (c: BoxscoreCounts) => formatPct100(share(c)), value: (c: BoxscoreCounts) => share(c) };
    });
}
