// シーズン別の選手写真の台帳（設計書の「シーズン別の選手写真」の章）。
//
// 置き場所は `public/media/player-photos/`（`data/` の外。保存キーの対象ではないので、写真や台帳を足しても全シーズンの作り直しは起きない）:
//   {season}.json                 画面が読む台帳（選手ID → 写真のあるチームIDの並び）。小さく保つ
//   {season}/{teamId}-{playerId}.webp  写真（240×240 の WebP）
//   {season}/sources.json         取得の記録（出典のURL・取得日・指紋・取れなかった組）。画面は読まない
//
// 写真は公式の名簿の画像サーバー（2021-22〜）と、Wayback Machine に残った公式の写真（〜2020-21）から
// `scripts/fetch-season-photos.ts` が自動で取る。チームとシーズンは出典のURLのフォルダ（`roster/{チームID}/{シーズン}/`）で決まる。
// 進行中のシーズンは置かない（今の写真〔`data/player-photos/{選手ID}.webp`〕がそのシーズンの写真）。

export const SEASON_PHOTO_SCHEMA = 1;

/** 画面が読む台帳（`{season}.json`） */
export interface SeasonPhotoIndex {
  v: typeof SEASON_PHOTO_SCHEMA;
  season: string;
  /** 選手ID → 写真のあるチームID（所属した順。途中で移籍した選手は複数） */
  photos: Record<string, string[]>;
}

/** official＝公式の名簿の画像サーバー／wayback＝Wayback に残る公式の名簿の写真／club＝当時のクラブ公式サイトの選手一覧ページ（Wayback）から本人を決めた写真（374-5章） */
export type SeasonPhotoOrigin = "official" | "wayback" | "club";

export interface SeasonPhotoSource {
  teamId: string;
  playerId: string;
  origin: SeasonPhotoOrigin;
  /** 元の画像のURL（Wayback は保存された元のURL） */
  url: string;
  /** Wayback の保存日時（YYYYMMDDhhmmss） */
  snapshot?: string;
  fetchedAt: string;
  /** club のとき: 本人を決めた一覧ページ（「ドメイン 保存日時 ページ上の名前」） */
  clubPage?: string;
  /** 保存した WebP の sha256 */
  sha256: string;
}

/** 取得の記録（`{season}/sources.json`） */
export interface SeasonPhotoSources {
  v: typeof SEASON_PHOTO_SCHEMA;
  season: string;
  photos: SeasonPhotoSource[];
  /** 取れなかった組（"チームID|選手ID" → 最後に確かめた日）。もう一度の実行で飛ばす */
  missing: Record<string, string>;
}

export function seasonPhotoFileName(teamId: string, playerId: string): string {
  return `${teamId}-${playerId}.webp`;
}

/** 台帳の中身が正しい形か（検証と画面の両方で使う） */
export function isSeasonPhotoIndex(value: unknown, season?: string): value is SeasonPhotoIndex {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SeasonPhotoIndex>;
  if (v.v !== SEASON_PHOTO_SCHEMA || typeof v.season !== "string" || !/^\d{4}-\d{2}$/.test(v.season)) return false;
  if (season !== undefined && v.season !== season) return false;
  if (!v.photos || typeof v.photos !== "object") return false;
  return Object.entries(v.photos).every(
    ([playerId, teams]) =>
      /^[\w-]+$/.test(playerId) && Array.isArray(teams) && teams.length > 0 && teams.every((t) => typeof t === "string" && /^\d+$/.test(t)),
  );
}

/**
 * その選手・シーズン（・チーム）の写真のチームIDを選ぶ。無ければ null。
 * チームの指定があり、そのチームの写真があればそれ。無ければ（指定なしを含む）そのシーズンの最後の所属の写真
 * （別のチームでも同じシーズンの写真のほうが、今の写真より当時に近い）
 */
export function pickSeasonPhotoTeam(index: SeasonPhotoIndex | null | undefined, playerId: string, teamId?: string | null): string | null {
  const teams = index?.photos[playerId];
  if (!teams || teams.length === 0) return null;
  if (teamId && teams.includes(teamId)) return teamId;
  return teams[teams.length - 1]!;
}
