import { TEAM_NAMES } from "../../scripts/lib/divisions";

// TEAM_NAMES（scripts/lib/divisions.ts）は現行B.PREMIER26クラブのみを収録している
// （その出典・用途が26クラブに固定されているため）。過去在籍のみで現在はB.ONEに所属する
// 4クラブ（新潟・FE名古屋・越谷・ライジングゼファー福岡）の名称はここで補う
const EXTRA_TEAM_NAMES: Record<string, string> = {
  "695": "新潟アルビレックスBB",
  "717": "ファイティングイーグルス名古屋",
  "745": "越谷アルファーズ",
  "753": "ライジングゼファー福岡",
};

/** 歴代の記録で使う、クラブの名称（名称の履歴に無いときの代わり）。今の名称 */
export function leagueTeamDisplayName(teamId: string): string {
  return TEAM_NAMES[teamId] ?? EXTRA_TEAM_NAMES[teamId] ?? teamId;
}
