// 選手の Time to Shot の導出データ（data/{season}/player-tts.json.gz）の形式（DESIGN.md 480章）。
// 1行＝選手×所属チーム×試合区分（playoff 0＝レギュラーシーズン／1＝ポストシーズン）。
// fg＝計測できた FG（シュートを打った選手＝PBP の PlayerID1）の本数（n）と秒数の合計（s）。
// ft＝フリースローをもらうまでの時間（シュートファウル＋ボーナスの候補。最初の FT を打った選手）の件数と秒数の合計。
// 作るのは scripts/lib/ttsIndexBuild.ts（チームの team-tts と同じ計算・同じ試合）。保存キーの対象なので、ここは形式の定義だけにする。
export const PLAYER_TTS_VERSION = 1;

export interface PlayerTtsFile {
  version: typeof PLAYER_TTS_VERSION;
  generatedAt: string;
  season: string;
  rows: {
    player: string[];
    team: string[];
    playoff: number[];
    fgN: number[];
    fgS: number[];
    ftN: number[];
    ftS: number[];
  };
}
