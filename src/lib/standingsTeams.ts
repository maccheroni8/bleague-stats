import type { PlayoffRaceFile, StandingsTeamSnapshot } from "../../shared/types";
import { formatDecimal, formatRecord, formatSigned, formatWinPct } from "./format";

/**
 * 順位表の1チーム。unplayed=true は、開幕直後でまだ試合をしていないため順位表スナップショット
 * （standings-history.json）に載っていないクラブを、playoff-race.json（scripts/lib/divisions.tsの地区割り）
 * から0勝0敗で補ったもの（withUnplayedTeams参照）。順位は付けず「-」で表示する
 */
export type StandingsTeam = StandingsTeamSnapshot & { unplayed?: boolean };

/**
 * 順位表の列（試合数・勝敗・勝率・得失点差・ゲーム差）の表示。順位表（StandingsPage）と勝敗表（WinLossGrid）で同じ値にするため、
 * 整形はここ1か所にまとめる。未試合のクラブは「-」（ゲーム差だけ、首位との勝ち負け差があれば数値）。首位（差0）は「-」
 */
export interface StandingsStatCells {
  games: string;
  record: string;
  winPct: string;
  pointDiff: string;
  gamesBehind: string;
}

export function formatGamesBehind(t: Pick<StandingsTeam, "unplayed" | "divisionGamesBehind">): string {
  if (t.unplayed) return t.divisionGamesBehind === undefined ? "-" : formatDecimal(t.divisionGamesBehind);
  return !t.divisionGamesBehind ? "-" : formatDecimal(t.divisionGamesBehind);
}

export function standingsStatCells(t: StandingsTeam): StandingsStatCells {
  return {
    games: String(t.wins + t.losses),
    record: formatRecord(t.wins, t.losses),
    winPct: t.unplayed ? "-" : formatWinPct(t.winPct),
    pointDiff: t.unplayed ? "-" : formatSigned(t.pointDiff, 0),
    gamesBehind: formatGamesBehind(t),
  };
}

/**
 * まだ試合をしていないクラブを0勝0敗で順位表に加える（2026-27〜のB.PREMIERフォーマットのみ。それ以前の
 * シーズンは最新スナップショットに全クラブが揃っている）。並べ方（DESIGN.md 130章）:
 * - 試合をしたクラブの順位（公式タイブレーク適用済み）はそのまま。未試合のクラブはその後ろに並べ、順位は付けない
 *   （勝率が定義できず、公式の順位付けの対象にならないため）
 * - 未試合のクラブ同士はチーム名の五十音順
 * - ゲーム差は、試合をしたクラブの首位との差（(首位の勝ち−負け)÷2）を示す。首位がいなければ付けない
 */
export function withUnplayedTeams(teams: StandingsTeamSnapshot[], race: PlayoffRaceFile | null): StandingsTeam[] {
  if (!race || race.format !== "premier-2026") return teams;
  const played = new Set(teams.map((t) => t.teamId));
  const missing = race.teams
    .filter((r) => !played.has(r.teamId))
    .sort((a, b) => (a.teamName ?? a.teamId).localeCompare(b.teamName ?? b.teamId, "ja"));
  if (missing.length === 0) return teams;
  const gamesAbove = (t: StandingsTeamSnapshot | undefined) => (t ? t.wins - t.losses : undefined);
  const overallLeader = teams.find((t) => t.rank === 1);
  const unplayed: StandingsTeam[] = missing.map((r, i) => {
    const divisionLeader = teams.find((t) => t.division === r.division && t.divisionRank === 1);
    const leaderAbove = gamesAbove(overallLeader);
    const divisionLeaderAbove = gamesAbove(divisionLeader);
    return {
      teamId: r.teamId,
      teamName: r.teamName ?? r.teamId,
      wins: 0,
      losses: 0,
      winPct: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      // 並び順用の値（表示は「-」）。試合をしたクラブの後ろに来るよう大きな値にする
      rank: 1000 + i,
      gamesBehind: leaderAbove === undefined ? 0 : leaderAbove / 2,
      division: r.division,
      divisionRank: 1000 + i,
      divisionGamesBehind: divisionLeaderAbove === undefined ? undefined : divisionLeaderAbove / 2,
      unplayed: true,
    };
  });
  return [...teams, ...unplayed];
}

