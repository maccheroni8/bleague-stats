/**
 * 歴代の1試合記録の大きなファイル（league-player-game-records・league-team-rankings）を、表（区分・試合区分・項目）ごとの
 * 小さなファイルに分けて公開するときの、置き場所の決まり（DESIGN.md 355章）。
 *
 * 分けたファイルは、公開用のビルド（vite.config.ts のプラグイン）が、同じビルドの元のファイルから作る（data/ には置かない・保存キーに関係しない）。
 * 画面は分けたファイルを先に読み、無いとき（手元の確認用サーバーなど）・読めないときは元の大きなファイルから同じ表を取り出す。
 * このファイルは画面とビルドの設定の両方から読むので、ブラウザの機能を使わない
 */

/** 分けたファイルの置き場所（data/ からの相対パス） */
export const LEAGUE_RECORD_PARTS_DIR = "parts";

/** 個人の歴代1試合記録の表の区分（all＝byGameType、jp・intl＝byClassification） */
export type PlayerRecordPartGroup = "all" | "jp" | "intl";

/** チームの歴代記録で分ける表（1試合記録のランキングが読む4つ） */
export const TEAM_RECORD_PART_TABLES = ["clubRecordTop20", "clubRecordWorstTop20", "clubRecordAgainstTop20", "periodRecordTop20"] as const;
export type TeamRecordPartTable = (typeof TEAM_RECORD_PART_TABLES)[number];

/** 項目キー（「q1:pts」など）をファイル名に使える文字だけにする（同じキーは同じ名前・違うキーは違う名前） */
export function partKeyName(key: string): string {
  return encodeURIComponent(key).replace(/[!'()*.~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%/g, "~");
}

/** 個人の歴代1試合記録の表のファイル（data/ からの相対パス。末尾の .gz は付けない） */
export function playerRecordPartPath(group: PlayerRecordPartGroup, gameType: string, key: string): string {
  return `${LEAGUE_RECORD_PARTS_DIR}/league-player-game-records/${group}/${gameType}/${partKeyName(key)}.json`;
}

/** チームの歴代記録の表のファイル（data/ からの相対パス。末尾の .gz は付けない） */
export function teamRecordPartPath(table: TeamRecordPartTable, gameType: string, key: string): string {
  return `${LEAGUE_RECORD_PARTS_DIR}/league-team-rankings/${table}/${gameType}/${partKeyName(key)}.json`;
}
