// ファウルの導出データ（data/{season}/fouls.json.gz・B.ONE は data/{season}/one/fouls.json.gz）の形式（DESIGN.md ファウルの章）。
// 図解の「ファウル」タブ（チーム・選手）が、このファイルだけを読む。試合ごとの数を持つので、画面で試合区分・直近の試合・期間を絞れる。
// 試合の並び・チーム辞書は 1試合行の索引（team-game-index.json）と同じ。チームの行の位置は「試合の番号×2＋(ホーム 0／アウェイ 1)」。
// 値はプレーバイプレー（ActionCD1）から数える（shared/foulCodes.ts）:
//   コーチのテクニカル 20、ベンチのテクニカル 21、選手のテクニカル 24・91・92、アンスポーツマン系 25・93・94（フレグラント 93・ディスラプティブ 94）、
//   ディスクォリファイング 26。番号の意味は 2016-17 から同じ（旧形式の読み替えは要らない）。
//   ファウルの種類が書かれていない記録（ActionCD1=31「フリースローオンファウル1」）はどの数にも入れない。
// プレーバイプレーが無い試合（手入力の1810など）は、チームの行がすべて -1（数えない）。選手の行は、どれかの数が1以上の試合だけ持つ。
// 保存キーの対象になるので（BUILD_CODE_ENTRIES）、ここは形式の定義だけにして、あとから変えない。

export const FOULS_INDEX_VERSION = 1;

/** チームの列: コーチ・ベンチ・選手のテクニカル、アンスポーツマン系の合計、フレグラント、ディスラプティブ、ディスクォリファイング */
export const TEAM_FOUL_COLUMNS = ["tfCoach", "tfBench", "tfPlayer", "uf", "flagrant", "disruptive", "dq"] as const;
export type TeamFoulColumn = (typeof TEAM_FOUL_COLUMNS)[number];

/** 選手の列: テクニカル、アンスポーツマン系の合計、フレグラント、ディスラプティブ、ディスクォリファイング */
export const PLAYER_FOUL_COLUMNS = ["tf", "uf", "flagrant", "disruptive", "dq"] as const;
export type PlayerFoulColumn = (typeof PLAYER_FOUL_COLUMNS)[number];

export interface FoulsIndexFile {
  version: typeof FOULS_INDEX_VERSION;
  generatedAt: string;
  season: string;
  /** チーム辞書: [チームID, そのシーズンのチーム名]（team-game-index.json の teams と同じ並び） */
  teams: [id: string, name: string][];
  /** 試合の表（team-game-index.json の games と同じ並び）。flags は gameIndex.ts の GAME_FLAG_*。home・away はチーム辞書の番号 */
  games: { key: string[]; date: string[]; flags: number[]; home: number[]; away: number[] };
  /** 選手辞書: [選手ID, そのシーズンの名前]。選手の行に出てくる選手だけ */
  players: [id: string, name: string][];
  /** チームの行（試合の番号×2＋side）。プレーバイプレーが無い試合は -1 */
  team: Record<TeamFoulColumn, number[]>;
  /** 選手×試合の行（どれかの数が1以上のときだけ）。player は選手辞書、game は試合の表、team はチーム辞書の番号 */
  player: { player: number[]; game: number[]; team: number[] } & Record<PlayerFoulColumn, number[]>;
}
