// 登録区分（日本人／外国籍／帰化選手／アジア特別枠）を、試合ごとに決める1か所の処理（DESIGN.md 295章）。
// 集計（aggregate.ts）・1試合の索引（gameIndexBuild.ts）・ピリオド別の索引（periodIndexBuild.ts）・オンザコートの人数がこれを通る。
//
// - 全シーズン（SPLIT_CLASSIFICATION_FIRST_SEASON＝2016-17 から）: そのシーズン・リーグの登録区分の記録（data/{season}/registrations.json、B.ONE は one/ 側）が
//   あればその値。シーズン途中の変更（changes）は、その日以降の試合だけに当てる。記録に無い選手は選手マスタの区分。
//   2026-27 以降は record-registrations.ts が記録する（REGISTRATION_RECORDING_FIRST_SEASON）。2016-17〜2025-26（旧B1）は
//   根拠の台帳（docs/registration-history/）から作った区分表（DESIGN.md 388章。scripts/build-registration-history.ts）
//
// 見做し日本人は classification を「日本人」にして deemedJapanese を付ける（国籍は書き換えない）。オンザコートの人数には数えない
import type { PlayerMasterEntry } from "./types.ts";

export type Classification = NonNullable<PlayerMasterEntry["classification"]>;

/** 外国籍・帰化・アジア特別枠を分けて選べる最初のシーズン（登録区分の記録を読む最初のシーズン。388章で旧B1 の台帳を入れて 2016-17 から） */
export const SPLIT_CLASSIFICATION_FIRST_SEASON = "2016-17";

/** record-registrations.ts が選手マスタから記録を足す最初のシーズン（それより前は台帳から作った区分表で、自動では書き足さない） */
export const REGISTRATION_RECORDING_FIRST_SEASON = "2026-27";

export function hasSplitClassification(season: string): boolean {
  return season >= SPLIT_CLASSIFICATION_FIRST_SEASON;
}

export interface RegistrationChange {
  /** この日（JST の YYYY-MM-DD）以降の試合に当てる */
  from: string;
  classification: Classification;
  deemedJapanese?: boolean;
  /** 根拠（クラブ・リーグの発表の URL など） */
  source?: string;
}

export interface SeasonRegistrationEntry {
  /** シーズンの初めの区分（changes が無ければシーズンを通しての区分） */
  classification: Classification;
  deemedJapanese?: boolean;
  /** 記録した日（YYYY-MM-DD）と、記録の元（"players-master" は選手マスタの区分をそのまま写したもの） */
  recordedAt?: string;
  source?: string;
  /** シーズン途中の区分の変更（日付の昇順） */
  changes?: RegistrationChange[];
}

/** data/{season}/registrations.json（B.ONE は data/{season}/one/registrations.json）。元データ（コミットする） */
export interface SeasonRegistrationFile {
  season: string;
  league: "premier" | "one";
  players: Record<string, SeasonRegistrationEntry>;
}

export interface ResolvedRegistration {
  classification: Classification;
  deemedJapanese: boolean;
}

/** 登録区分の記録の1件から、その日の区分を返す */
export function registrationOn(entry: SeasonRegistrationEntry, date: string | undefined): ResolvedRegistration {
  let classification = entry.classification;
  let deemedJapanese = !!entry.deemedJapanese;
  if (date) {
    for (const c of entry.changes ?? []) {
      if (c.from <= date) {
        classification = c.classification;
        deemedJapanese = !!c.deemedJapanese;
      }
    }
  }
  return { classification, deemedJapanese };
}

export type ClassifyAt = (playerId: string, date?: string) => Classification | undefined;

/**
 * そのシーズンの区分の決め方。date を渡すと、シーズン途中の変更を考える（渡さなければシーズンの初めの区分）。
 * 試合ごとの区分（オンザコートの人数・区分別の得点・索引の行）は必ず試合の日を渡す
 */
export function makeClassifier(
  season: string,
  registrations: SeasonRegistrationFile | null | undefined,
  masterById: Map<string, Pick<PlayerMasterEntry, "classification">>,
): ClassifyAt {
  const players = hasSplitClassification(season) ? (registrations?.players ?? {}) : {};
  return (playerId, date) => {
    const entry = players[playerId];
    if (entry) return registrationOn(entry, date).classification;
    return masterById.get(playerId)?.classification;
  };
}

/** 索引の行に持つ詳細の区分の番号（登録区分の記録のあるシーズンの行）。-1 は区分が分からない */
export const CLASSIFICATION_CODES: Classification[] = ["日本人", "外国籍", "帰化選手", "アジア特別枠"];

export function classificationCode(c: Classification | undefined): number {
  return c === undefined ? -1 : CLASSIFICATION_CODES.indexOf(c);
}
