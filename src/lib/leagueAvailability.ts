// B.ONE で見られる画面（DESIGN.md 297章）。段階2で順に出し、まだの画面は B.ONE を選んだときに理由を出して選べないようにする。
// 画面を B.ONE に対応させたら、ここの値を ready にする（`npm run validate:league-wiring` が、ready の画面の読み込み・リンクにリーグが通っているかを調べる）。
import type { League } from "./league";

/** App.tsx のページ（Route）ごとの名前 */
export type LeaguePage =
  | "home"
  | "teams"
  | "teamDetail"
  | "players"
  | "playerDetail"
  | "schedule"
  | "game"
  | "rankings"
  | "compare"
  | "standings"
  | "figures"
  | "glossary";

export type LeagueAvailability = { ready: true } | { ready: false; reason: string };

const READY: LeagueAvailability = { ready: true };

/** 段階2の残りの push で出す画面 */
function preparing(name: string): LeagueAvailability {
  return { ready: false, reason: `B.ONE の${name}は準備中です。` };
}

/** 段階3で出す画面（段階2では出さない） */
function later(name: string): LeagueAvailability {
  return { ready: false, reason: `${name}は、B.ONE ではまだ見られません（今後対応します）。` };
}

/** B.ONE での各ページの状態。B.PREMIER はすべて見られる */
export const ONE_PAGE_AVAILABILITY: Record<LeaguePage, LeagueAvailability> = {
  home: READY,
  schedule: READY,
  game: READY,
  glossary: READY,
  teams: READY,
  teamDetail: READY,
  players: READY,
  playerDetail: READY,
  standings: READY,
  figures: READY,
  rankings: READY,
  compare: later("比較"),
};

export function pageAvailability(page: LeaguePage, league: League): LeagueAvailability {
  return league === "premier" ? READY : ONE_PAGE_AVAILABILITY[page];
}

/** B.ONE の順位表で選べないタブ（タブ名 → 理由）。年間スケジュールの大会日程は B.PREMIER のもの、マジックナンバーは段階3 */
export const ONE_STANDINGS_TAB_REASONS: Partial<Record<string, string>> = {
  annual: "年間スケジュールは、B.ONE ではまだ見られません。",
  magic: "マジックナンバーは、B.ONE ではまだ見られません（今後対応します）。",
};

/** B.ONE のチームのページで選べない項目の理由（段階3で出す） */
export const ONE_PERIOD_REASON = "Q別・前後半は、B.ONE ではまだ選べません（今後対応します）。";
/** B.ONE のチームのページ（一覧）で選べないタブ */
export const ONE_TEAMS_TAB_REASONS: Partial<Record<string, string>> = {
  records: "チームの記録は、B.ONE ではまだ見られません（今後対応します）。",
  champions: "歴代王者は、B.ONE ではまだ見られません（今後対応します）。",
};
/** B.ONE のチーム詳細で選べないタブ（段階3で出す） */
export const ONE_TEAM_DETAIL_TAB_REASONS: Partial<Record<string, string>> = {
  career: "通算成績は、B.ONE ではまだ見られません（今後対応します）。",
  clubRecord: "クラブレコードは、B.ONE ではまだ見られません（今後対応します）。",
  compare: "比較は、B.ONE ではまだ見られません（今後対応します）。",
};
/** B.ONE の個人のページ（一覧）で選べないタブ・項目 */
export const ONE_PLAYERS_TAB_REASONS: Partial<Record<string, string>> = {
  records: "個人の記録は、B.ONE ではまだ見られません（今後対応します）。",
  awards: "歴代アワードは、B.ONE ではまだ見られません（今後対応します）。",
};
export const ONE_ROOKIE_REASON = "ルーキーは、B.PREMIER の規程に準じた判定のため、B.ONE ではまだ選べません。";
/** B.ONE の選手詳細で選べないタブ */
export const ONE_PLAYER_DETAIL_TAB_REASONS: Partial<Record<string, string>> = {
  compare: "比較は、B.ONE ではまだ見られません（今後対応します）。",
};

/** B.ONE のランキングで選べない「種類」（種類 → 理由）。シーズン成績・1試合記録・勝負所・アシストペア・達成記録・On/Off（いずれもシーズン）が見られる */
export const ONE_RANKING_KIND_REASONS: Partial<Record<string, string>> = {
  career: "通算記録は、B.ONE ではまだ見られません（今後対応します）。",
  special: "1シーズン記録は、B.ONE ではまだ見られません（今後対応します）。",
  attendance: "観客動員は、B.ONE ではまだ見られません（今後対応します）。",
};
/** B.ONE の1試合記録で選べない範囲（歴代） */
export const ONE_RANKING_ALLTIME_REASON = "通算・歴代は、B.ONE ではまだ見られません（今後対応します）。今季のシーズンの記録だけ見られます。";
/** B.ONE のランキングで選べないカテゴリ・項目の理由 */
export const ONE_RANKING_SHOOTING_REASON = "Shooting は、B.ONE ではシュートの種類の記録が無いため選べません。";
export const ONE_RANKING_FORCED_TOV_REASON = "Forced TOV は、B.ONE では強制ターンオーバーの分類の記録が無いため選べません。";
export const ONE_RANKING_CAREER_REASON = "Career は、B.ONE ではリーグをまたぐ経歴の集計が無いため選べません。";
export const ONE_RANKING_COMPARE_REASON = "前季との比較は、B.ONE ではまだ選べません（今後対応します）。";
/** 掲載基準の「達成可能」を B.ONE で出さない間の理由（日程が60試合に足りないクラブがあるとき） */
export const ONE_RANKING_ACHIEVABLE_REASON = "「達成可能」は、B.ONE ではクラブの日程が出そろうまで選べません（残り試合数が正しく出せないため）。";
