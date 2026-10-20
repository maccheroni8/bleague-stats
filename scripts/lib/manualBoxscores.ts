// 公式にボックススコアが無く、他の公開記録から合計だけを手で入れた試合（DESIGN.md 275章）。
// 生データ（data/{season}/games/{key}.json.gz）の meta.source が "manual:" で始まる。ピリオド別の選手行・PBP・公式の集計行（Summaries）を持たないので、
// それらと突き合わせる検証（validate-period-index・validate-game-index）は対象から外す。集計・索引の作成は、これらが無くても動く。
export const MANUAL_BOXSCORE_KEYS: ReadonlySet<string> = new Set(["1810"]);

export function isManualBoxscoreKey(scheduleKey: string | number): boolean {
  return MANUAL_BOXSCORE_KEYS.has(String(scheduleKey));
}
