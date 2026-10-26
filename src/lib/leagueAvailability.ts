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
  playerDetail: preparing("個人のページ"),
  standings: READY,
  figures: READY,
  rankings: later("ランキング"),
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
export const ONE_CLASS_REASON = "登録区分別は、B.ONE ではまだ選べません（今後対応します）。";
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
