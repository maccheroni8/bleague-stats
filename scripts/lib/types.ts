// v2_genius_contexts APIの型定義。
// フィールドはDESIGN.md 2-2章の実機検証（6試合・4,513件のPlayByPlaysで確認済み）に基づく。

import type { Division } from "./divisions.ts";

export interface GameRaw {
  Code: number;
  ScheduleKey: number;
  MaxPeriod: number;
  BoxscoreExistsFlg: boolean;
  PlayByPlayExistsFlg: boolean;
  GameCurrentPeriod: number;
  ConventionKey: string;
  ConventionNameJ: string;
  ConventionNameE: string;
  Year: number;
  Setu: string;
  StadiumCD: string;
  StadiumNameJ: string;
  StadiumNameE: string;
  CommissionerID: number | null;
  CommissionerNameJ: string | null;
  RefereeID: number | null;
  RefereeNameJ: string | null;
  SubRefereeID1: number | null;
  SubRefereeNameJ1: string | null;
  SubRefereeID2: number | null;
  SubRefereeNameJ2: string | null;
  Attendance: number | null;
  GameEndedFlg: boolean;
  RecordFixedFlg: boolean;
  ConventionClass: number;
  /** ASP.NET JSON Date形式: "/Date(1779789900000+0900)/" */
  GameDateTime: string;
  HomeTeamID: string;
  HomeTeamNameJ: string;
  HomeTeamNameE: string;
  HomeTeamShortNameJ: string;
  HomeTeamShortNameE: string;
  HomeTeamScore: number;
  AwayTeamID: string;
  AwayTeamNameJ: string;
  AwayTeamNameE: string;
  AwayTeamShortNameJ: string;
  AwayTeamShortNameE: string;
  AwayTeamScore: number;
}

/**
 * 通常試合は HomeTeamScore01〜04 のみ。OT試合は HomeTeamScore05 以降が動的に追加される
 * （MaxPeriodは4のまま変わらないため、延長判定にはフィールドの存在数を使う。DESIGN.md 2-2章）。
 */
export type GameWithDynamicScores = GameRaw & Record<string, unknown>;

export interface PlayByPlayEvent {
  Period: number;
  Code: number;
  ScheduleKey: number;
  TeamID: string | null;
  TeamNameJ: string | null;
  PlayerID1: string | null;
  PlayerNo1: string;
  PlayerNameJ1: string;
  No: number;
  RecordDateTime: string;
  RecordEditDateTime: string | null;
  RestTime: string;
  Score: string;
  PeriodEndRowFlg: boolean;
  GameEndRowFlg: boolean;
  /** イベント種別コード。対応表はDESIGN.md 2-2章参照 */
  ActionCD1: number;
  ActionCD2: number | null;
  ActionCD3: number | null;
  Success: number;
  Side: string;
  PlayText: string;
  /** 1=ホーム, 2=アウェイ。選手交代・シュート等の一部イベントのみ存在 */
  HomeAway?: number;
  /** シュートイベントのみ存在するショット座標 */
  X?: number;
  Y?: number;
  AreaCD?: number;
}

export interface BoxscoreRow {
  Code: number;
  ScheduleKey: number;
  /** 1=個人選手行, 2=チーム発生イベント行(チームREB/TO), 3=チーム合計行。DESIGN.md 2-2章 */
  Category: 1 | 2 | 3;
  TeamID: string | null;
  TeamNameJ: string;
  TeamNameE: string;
  PlayerID: string;
  PlayerNo: string;
  PlayerNameJ: string;
  PlayerNameE: string;
  StartingFlg: 1 | null | "";
  /** "MM:SS" または "DNP"。出場判定はこちらを使う（PlayingFlgではない） */
  PlayTime: string;
  /** true/false/''が入るが、出場していてもfalseになるケースを確認済み。意味不明・出場判定に使わないこと */
  PlayingFlg: boolean | "";
  /** 1〜4=各Q, 5以降=OT各P, 15=前半, 16=後半, 17=延長合計, 18=試合全体。DESIGN.md 2-2章 */
  PeriodCategory: number;
  Point: number;
  PT3M: number;
  PT3A: number;
  PT2M: number;
  PT2A: number;
  FTM: number;
  FTA: number;
  FOUL: number;
  FOULON: number;
  RB_OFF: number;
  RB_DEF: number;
  RB_TOT: number;
  TO: number;
  AS: number;
  ST: number;
  BS: number;
  BSON: number;
  PTFB: number;
  PT2IN: number;
  PT2ND: number;
  EFF: number;
  PLUSMINUS?: number;
  AST_TO: number;
  EFG: number;
  TS: number;
  USG: number;
  /** Category=2/3のチーム行のみ存在 */
  OFFRTG?: number;
  DEFRTG?: number;
  NETRTG?: number;
  POSS?: number;
}

export interface SummaryRow {
  Code: number;
  ScheduleKey: number;
  PeriodCategory: number;
  HomeTeamID: string;
  HomeTeamNameJ: string;
  HomeTeamNameE: string;
  HomeTeamPTR: number;
  HomeTeamPTM: number;
  HomeTeamPTA: number;
  HomeTeamPT2R: number;
  HomeTeamPT2M: number;
  HomeTeamPT2A: number;
  HomeTeamPT3R: number;
  HomeTeamPT3M: number;
  HomeTeamPT3A: number;
  HomeTeamFTR: number;
  HomeTeamFTM: number;
  HomeTeamFTA: number;
  HomeTeamRB_OFF: number;
  HomeTeamRB_DEF: number;
  HomeTeamRB_TOT: number;
  HomeTeamAS: number;
  HomeTeamTO: number;
  HomeTeamST: number;
  HomeTeamBS: number;
  HomeTeamFOUL: number;
  HomeTeamPT2IN: number;
  HomeTeamPTPFT: number;
  HomeTeamPT2ND: number;
  HomeTeamPTFB: number;
  HomeTeamMaxDifference: number;
  HomeTeamBSON: number;
  HomeTeamFOULON: number;
  HomeTeamLeadLast: number;
  HomeTeamLeadLastHome: string;
  HomeTeamLeadLastAway: string;
  LeadCount: number;
  TieCount: number;
  AwayTeamID: string;
  AwayTeamNameJ: string;
  AwayTeamNameE: string;
  AwayTeamPTR: number;
  AwayTeamPTM: number;
  AwayTeamPTA: number;
  AwayTeamPT2R: number;
  AwayTeamPT2M: number;
  AwayTeamPT2A: number;
  AwayTeamPT3R: number;
  AwayTeamPT3M: number;
  AwayTeamPT3A: number;
  AwayTeamFTR: number;
  AwayTeamFTM: number;
  AwayTeamFTA: number;
  AwayTeamRB_OFF: number;
  AwayTeamRB_DEF: number;
  AwayTeamRB_TOT: number;
  AwayTeamAS: number;
  AwayTeamTO: number;
  AwayTeamST: number;
  AwayTeamBS: number;
  AwayTeamFOUL: number;
  AwayTeamPT2IN: number;
  AwayTeamPTPFT: number;
  AwayTeamPT2ND: number;
  AwayTeamPTFB: number;
  AwayTeamMaxDifference: number;
  AwayTeamBSON: number;
  AwayTeamFOULON: number;
  AwayTeamLeadLast: number;
  AwayTeamLeadLastHome: string;
  AwayTeamLeadLastAway: string;
}

export interface GeniusContext {
  Game: GameWithDynamicScores;
  PlayByPlays: PlayByPlayEvent[];
  HomeBoxscores: BoxscoreRow[];
  AwayBoxscores: BoxscoreRow[];
  Summaries: SummaryRow[];
}

// ---- data/{season}/games/{scheduleKey}.json の保存スキーマ（DESIGN.md 5章・8章） ----

export interface StoredGameMeta {
  firstScrapedAt: string;
  lastCheckedAt: string;
  lastChangedAt: string;
  /** watching = 試合終了後14日以内の再チェック対象, final = 再チェック終了 */
  status: "watching" | "final";
  /** これまでに実データが変化した回数（0なら未修正）。DESIGN.md 8章 */
  revisionCount: number;
  latestRevisionId: number;
}

export interface StoredGame {
  scheduleKey: string;
  season: string;
  /** JST基準のYYYY-MM-DD */
  date: string;
  meta: StoredGameMeta;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  homeScore: number;
  awayScore: number;
  /** Q別・OT別得点。通常4要素、OT試合は5要素以降 */
  quarterScores: { home: number[]; away: number[] };
  gameEndedFlg: boolean;
  recordFixedFlg: boolean;
  /** APIレスポンスをほぼそのまま保持（生データを正とする。DESIGN.md 5章） */
  raw: GeniusContext;
}

// ---- data/{season}/schedule.json の保存スキーマ ----

export interface ScheduleFile {
  season: string;
  generatedAt: string;
  scheduleKeys: string[];
}

// ---- data/{season}/player-games/{playerId}.json の保存スキーマ（個人詳細ページの試合ログ用） ----

export interface PlayerGameLog {
  scheduleKey: string;
  /** JST基準のYYYY-MM-DD */
  date: string;
  opponentTeamId: string;
  opponentTeamName: string;
  isHome: boolean;
  win: boolean;
  isStarter: boolean;
  min: number;
  pts: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  plusMinus: number;
}

// ---- data/{season}/team-games/{teamId}.json の保存スキーマ（チーム詳細ページの試合結果一覧用） ----

export interface TeamGameLog {
  scheduleKey: string;
  /** JST基準のYYYY-MM-DD */
  date: string;
  opponentTeamId: string;
  opponentTeamName: string;
  isHome: boolean;
  teamScore: number;
  opponentScore: number;
  win: boolean;
}

// ---- data/{season}/standings-history.json の保存スキーマ（順位表ページ用） ----

export interface StandingsTeamSnapshot {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  /**
   * 勝率降順・同率は得失点差降順のシンプルな方法（DESIGN.md参照）。
   * 公式のタイブレークルール（直接対決等）が判明次第見直す
   */
  rank: number;
  /** 首位とのゲーム差 */
  gamesBehind: number;
  /**
   * 東地区/西地区。scripts/lib/divisions.tsのマスタに基づく（DESIGN.md参照）。
   * マスタは2026-27シーズンのB.PREMIER構成を基準にしているため、過去シーズンの
   * チーム（地区再編前・移籍前）はマスタに無く未定義になりうる
   */
  division?: Division;
  /** 地区内の順位（タイブレーク方法はrankと同じ。地区内で適用）。divisionが不明な場合は未定義 */
  divisionRank?: number;
  /** 地区首位とのゲーム差。divisionが不明な場合は未定義 */
  divisionGamesBehind?: number;
}

export interface StandingsSnapshot {
  /** JST基準のYYYY-MM-DD。その日に試合があった日のみ記録 */
  date: string;
  teams: StandingsTeamSnapshot[];
}
