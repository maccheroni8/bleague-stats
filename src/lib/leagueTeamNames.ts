import { ONE_TEAM_DIVISIONS, TEAM_DIVISIONS, TEAM_NAMES } from "../../scripts/lib/divisions";
import type { DivisionHistoryFile } from "../../shared/types";

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

// 現在の所属カテゴリ（要件3: 降格済み・退会済みクラブと現行クラブを区別する注記）。
// TEAM_DIVISIONS/ONE_TEAM_DIVISIONSはいずれも2026-27シーズン基準の現行クラブ一覧
export function leagueTeamCurrentCategoryLabel(teamId: string): string {
  if (teamId in TEAM_DIVISIONS) return "B.PREMIER";
  if (teamId in ONE_TEAM_DIVISIONS) return "B.ONE";
  return "対象外";
}

// 現行B.PREMIERクラブでないチーム（B.ONEへ降格済み等）は、現在選択中のシーズンに向けて
// リンクしても対象シーズンにそのクラブが存在せず「チームが見つかりませんでした」になってしまう
// （23章で確立された挙動）。そのため、そのクラブが最後にB.PREMIERに在籍していたシーズンを
// division-history.jsonから求め、明示的な?season=付きでリンクする
export function lastPremierSeasonFor(divisionHistory: DivisionHistoryFile | null | undefined, teamId: string): string | undefined {
  if (!divisionHistory) return undefined;
  const seasons = Object.keys(divisionHistory.premier).filter(
    (s) => divisionHistory.premier[s]?.[teamId] !== undefined,
  );
  return seasons.sort().at(-1);
}

