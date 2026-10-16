/** シーズン別画像基盤。既存データ・画像取得・集計から独立した、JSONで保存可能な型。 */
export type MediaKind = "player" | "team";
export type Permission = "granted" | "denied" | "unknown";
export type Confirmation = "confirmed" | "unverified";

export interface MediaRights {
  status: "confirmed" | "unknown" | "denied" | "revoked";
  web: Permission;
  export: Permission;
  redistribute: Permission;
  /** 許諾の根拠（公開台帳には秘密の文書・個人情報を収録しない）。 */
  evidence?: string;
  checkedAt?: string;
}

export type MediaSubject =
  | { kind: "player"; playerId: string; teamId: string }
  | { kind: "team"; teamId: string; playerId?: never };

/** 画像実体は一度だけ保存し、複数の確認済み対応から参照できる。 */
export interface MediaAsset {
  assetId: string;
  subject: MediaSubject;
  /** 配信ルート相対パス。外部URL・絶対パス・親ディレクトリ参照は不可。 */
  path: string;
  sha256: string;
  source: { reference: string; checkedAt: string };
  rights: MediaRights;
}

/** 両端を含む暦日。片方省略はその側に制限なし。実際の使用期間のみ記録する。 */
export interface MediaPeriod {
  from?: string;
  to?: string;
}

export interface MediaBinding {
  bindingId: string;
  assetId: string;
  subject: MediaSubject;
  /** 画像が使われていた実際のシーズン。fallback先に合わせて書き換えない。 */
  season: string;
  period?: MediaPeriod;
  verification: {
    chronology: Confirmation;
    affiliation: Confirmation;
    evidence?: string;
    checkedAt?: string;
  };
}

export interface MediaCatalog {
  schemaVersion: 1;
  assets: readonly MediaAsset[];
  bindings: readonly MediaBinding[];
}

/** 画像台帳から独立した、確認済み最終所属の入力。現在の選手マスタから推測しない。 */
export interface FinalAffiliation {
  playerId: string;
  season: string;
  teamId: string;
  status: Confirmation;
  evidence?: string;
  checkedAt?: string;
}

export interface MediaRequest {
  kind: MediaKind;
  context: "season" | "team" | "game" | "career";
  playerId?: string;
  teamId?: string;
  season?: string;
  gameDate?: string;
  /** fallback・通算のシーズン上限。時計を参照せず呼び出し側が明示する。 */
  currentSeason?: string;
  /** fallbackの所属。過去のteamIdとは別。選手写真のfallback時のみ必須。 */
  currentTeamId?: string;
  allowFallback?: boolean;
}

export interface MediaAnnotation {
  type: "fallback" | "representative";
  targetSeason: string | null;
  actualSeason: string;
  targetTeamId: string | null;
  actualTeamId: string;
  targetDate: string | null;
  actualPeriod: MediaPeriod | null;
}

export type MediaResolution =
  | {
      status: "exact" | "fallback" | "representative";
      assetId: string;
      path: string;
      targetSeason: string | null;
      actualSeason: string;
      targetTeamId: string | null;
      actualTeamId: string;
      targetDate: string | null;
      actualPeriod: MediaPeriod | null;
      /** シーズン全体の最終所属写真も代表選択。exactとの区別はこの値で保持。 */
      isRepresentative: boolean;
      annotation: MediaAnnotation | null;
      canExport: boolean;
      canRedistribute: boolean;
    }
  | {
      status: "missing";
      reason: "invalid-input" | "invalid-catalog" | "unconfirmed-affiliation" | "ambiguous" | "no-eligible-image";
      targetSeason: string | null;
      targetTeamId: string | null;
      canExport: false;
      canRedistribute: false;
    };
