import type { PlayerMasterEntry } from "../../shared/types.ts";

/** リーグ登録国籍の欠落だけを補う。帰化・アジア枠の判定は既存の overrides に任せる。 */
export interface NationalitySupplement {
  playerId: string;
  season: string;
  teamId: string;
  teamName: string;
  nationality: string;
  officialUrl: string;
  checkedOn: string;
}

export const NATIONALITY_SUPPLEMENTS: readonly NationalitySupplement[] = [
  {
    playerId: "12607",
    season: "2026-27",
    teamId: "1638",
    teamName: "佐賀バルーナーズ",
    nationality: "アメリカ合衆国",
    officialUrl: "https://ballooners.jp/team/players/detail/id=52391?PlayerID=12607",
    checkedOn: "2026-10-23",
  },
];

export interface RosterProfileContext {
  season: string;
  /** 今回取得した在籍中一覧の所属。過去のマスタの teamId だけでは補完しない。 */
  currentTeamId?: string;
}

export function nationalitySupplement(entry: PlayerMasterEntry, context: RosterProfileContext): NationalitySupplement | undefined {
  return NATIONALITY_SUPPLEMENTS.find((s) => s.playerId === entry.playerId && s.season === context.season &&
    s.teamId === context.currentTeamId && s.teamId === entry.teamId);
}

/** 補完と同じ国籍は公式取得済みと区別できないため、補完の対象は属性が揃った後も公式値を再確認する。 */
function matchesSupplement(entry: PlayerMasterEntry, context: RosterProfileContext): boolean {
  const supplement = nationalitySupplement(entry, context);
  return supplement !== undefined && supplement.nationality === entry.nationality;
}

export function needsRosterDetail(entry: PlayerMasterEntry, context: RosterProfileContext): boolean {
  // 生年月日が取得済みでも、国籍の欠落は独立して再取得する。
  // 再確認により、補完の保存後も正常復旧した公式値を優先できる（保存形式は増やさない）。
  // 再確認はシーズン・今回の在籍中所属が一致する間だけ。シーズンが変われば自動的に止まる。
  return !entry.birthDate || !entry.nationality?.trim() || matchesSupplement(entry, context);
}

/** 生年月日・国籍が揃っていて、補完の公式再確認だけが取得理由か。失敗しても保存済みの値は変わらないため、再試行を絞る。 */
export function isSupplementRecheckOnly(entry: PlayerMasterEntry, context: RosterProfileContext): boolean {
  return !!entry.birthDate && !!entry.nationality?.trim() && matchesSupplement(entry, context);
}

export function fillMissingNationality(entry: PlayerMasterEntry, context: RosterProfileContext): NationalitySupplement | undefined {
  if (entry.nationality?.trim()) return undefined;
  const supplement = nationalitySupplement(entry, context);
  if (supplement) entry.nationality = supplement.nationality;
  return supplement;
}
