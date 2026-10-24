// Time to Shot の導出データ（data/{season}/team-tts.json.gz）の形式（DESIGN.md Time to Shot の章）。
// 試合×チーム×区間（Q1〜Q4・延長）ごとに、分類ごとの「秒数の合計」と「本数」、除外したFGの本数を、列ごとに並べたもの。
// 行の位置は team-game-index.json と同じ（試合番号×2＋(ホーム 0／アウェイ 1)）。相手（opp）は同じ試合の反対側の行（行 xor 1）。
// 前半・後半は q1+q2・q3+q4 を読むときに足す。平均は「秒数の合計 ÷ 本数」を、足したあとで割る（平均の平均にしない）。
// 値が無い行（PBP が無い試合・延長の無い試合の延長）は -1。2016-17〜2019-20 は作らない（チームリバウンドの番号が違う等で、計測の基準に届かない）。
// 保存キーの対象になるので（BUILD_CODE_ENTRIES）、ここは形式の定義だけにして、あとから変えない。

export const TTS_INDEX_VERSION = 1;

/** この季以降だけ作る（それ以前は画面で「-」） */
export const TTS_FIRST_SEASON = "2020-21";

/** 持つ区間（PERIOD_ATOMS と同じ並び・同じ意味。ot は第1延長以降の合計） */
export const TTS_ATOMS = ["q1", "q2", "q3", "q4", "ot"] as const;
export type TtsAtom = (typeof TTS_ATOMS)[number];

/** 持つ分類（OREB後は別。その他は初回全体にだけ含め、画面の列には出さない） */
export const TTS_INDEX_CATEGORIES = ["score", "deadTo", "dreb", "steal", "quarter", "other", "oreb"] as const;
export type TtsIndexCategory = (typeof TTS_INDEX_CATEGORIES)[number];

/**
 * counts のキー。「区間.分類.n」（本数）・「区間.分類.s」（秒数の合計）・「区間.x」（計測できずに除外した FG の本数）
 */
export function ttsKey(atom: TtsAtom, category: TtsIndexCategory, kind: "n" | "s"): string {
  return `${atom}.${category}.${kind}`;
}
export function ttsExcludedKey(atom: TtsAtom): string {
  return `${atom}.x`;
}

export interface TtsIndexFile {
  version: typeof TTS_INDEX_VERSION;
  generatedAt: string;
  season: string;
  /** 結び付け先の team-game-index.json の行数（合わないときは使わない） */
  indexRows: number;
  rows: {
    counts: Record<string, number[]>;
  };
}
