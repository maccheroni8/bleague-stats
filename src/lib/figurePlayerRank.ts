// 画面専用（図解・選手）。詳細フィルタの「ランキング◯位以上」と、強調の「ランキング上位」で使う順位。
// ランキングのページと同じ数え方: 同じシーズン・リーグ・登録区分・対象期間・会場の選手のうち、ランキングの掲載基準（出場率85%と、
// 3P%・FT%・FG%・2P% の追加の基準の最初の値）を満たした選手の中で、1試合平均の値の順（向きは rankDirection.ts）。
// 同じ表示値の選手は同順位（ベン図の「上位◯」と同じ rankVennRows＝ランキングの RankedList と同じ手順）。
import type { PlayerCareerCounts, PlayerSummary } from "../../shared/types";
import { rankDirectionProps } from "./rankDirection";
import { rankVennRows } from "./figureVenn";
import { passesRatio, type PlayerFigurePoint } from "./figurePlayerPoints";
import { playerVennConditionDefs } from "./figurePlayerVenn";
import { EXTRA_ELIGIBILITY_RULES, MIN_GAMES_PLAYED_RATIO_FOR_RANKING } from "./playerRankingEligibility";
import { buildStatConditionItems, parseDisplayedValue, type StatConditionItem } from "./statConditions";

export interface PlayerRankIndex {
  /** 順位を出せる項目か（項目のキー） */
  has: (key: string) => boolean;
  /** 項目のキーと選手の id から順位（出せない選手は null）。項目ごとに最初に聞かれたときに計算する */
  rankOf: (key: string, playerId: string) => number | null;
  /** 項目の上位 n 位以内（同順位を含む）の選手の id */
  topIds: (key: string, n: number) => Set<string>;
  /** 順位を出す項目（ランキングの掲載基準を満たした選手で作った見本の項目） */
  items: StatConditionItem<PlayerFigurePoint>[];
}

export function buildPlayerRankIndex(rankBase: readonly PlayerFigurePoint[], season: string, league: "premier" | "one", careerOf?: (p: PlayerSummary) => PlayerCareerCounts | undefined): PlayerRankIndex {
  const population = rankBase.filter((p) => passesRatio(p, Math.round(MIN_GAMES_PLAYED_RATIO_FOR_RANKING * 100), 100));
  const items = buildStatConditionItems(playerVennConditionDefs(season, league, careerOf), population, "perGame");
  const byKey = new Map(items.map((i) => [i.key, i]));
  const cache = new Map<string, Map<string, number>>();
  const mapOf = (key: string): Map<string, number> => {
    let m = cache.get(key);
    if (m) return m;
    m = new Map();
    const item = byKey.get(key);
    if (item) {
      const rule = EXTRA_ELIGIBILITY_RULES[key];
      const rows = population.filter((p) => !rule || rule.perGameValue(p.summary) >= rule.defaultValue);
      const entries = rows.flatMap((row) => {
        const text = item.display(row);
        const value = parseDisplayedValue(text, item.kind);
        return value === null ? [] : [{ row, value, text }];
      });
      for (const r of rankVennRows(entries, rankDirectionProps(key).higherIsBetter)) m.set(r.row.id, r.rank);
    }
    cache.set(key, m);
    return m;
  };
  return {
    has: (key) => byKey.has(key),
    rankOf: (key, playerId) => mapOf(key).get(playerId) ?? null,
    topIds: (key, n) => new Set([...mapOf(key)].filter(([, r]) => r <= n).map(([id]) => id)),
    items,
  };
}
