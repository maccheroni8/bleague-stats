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
  teams: preparing("チームのページ"),
  teamDetail: preparing("チームのページ"),
  players: preparing("個人のページ"),
  playerDetail: preparing("個人のページ"),
  standings: preparing("順位表"),
  figures: preparing("図解"),
  rankings: later("ランキング"),
  compare: later("比較"),
};

export function pageAvailability(page: LeaguePage, league: League): LeagueAvailability {
  return league === "premier" ? READY : ONE_PAGE_AVAILABILITY[page];
}
