// data/{season}/*.json の型定義（scripts/aggregate.tsの出力に対応）。

export interface StatTotals {
  gamesPlayed: number;
  gamesStarted: number;
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
}

export interface PerGameStats {
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
}

export interface ShootingStats {
  fgPct: number;
  tpPct: number;
  ftPct: number;
  efgPct: number;
  tsPct: number;
  ftRate: number;
}

export interface TeamSummary {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  gamesPlayed: number;
  gamesStarted: number;
  totals: StatTotals;
  perGame: PerGameStats;
  shooting: ShootingStats;
  opponentPerGame: PerGameStats;
  netPerGame: PerGameStats;
}

export interface PlayerSummary {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  gamesPlayed: number;
  gamesStarted: number;
  totals: StatTotals;
  perGame: PerGameStats;
  shooting: ShootingStats;
}

// ---- data/{season}/games/{scheduleKey}.json（試合詳細ページ用） ----

export interface BoxscoreRow {
  /** 1=個人選手行, 2=チーム発生イベント行, 3=チーム合計行 */
  Category: 1 | 2 | 3;
  TeamID: string | null;
  TeamNameJ: string;
  PlayerID: string;
  PlayerNo: string;
  PlayerNameJ: string;
  StartingFlg: 1 | null | "";
  /** "MM:SS" または "DNP" */
  PlayTime: string;
  /** 1〜4=各Q, 5以降=OT各P, 15=前半, 16=後半, 17=延長合計, 18=試合全体 */
  PeriodCategory: number;
  Point: number;
  PT3M: number;
  PT3A: number;
  PT2M: number;
  PT2A: number;
  FTM: number;
  FTA: number;
  FOUL: number;
  RB_OFF: number;
  RB_DEF: number;
  RB_TOT: number;
  TO: number;
  AS: number;
  ST: number;
  BS: number;
  PLUSMINUS?: number;
}

export interface GameRaw {
  MaxPeriod: number;
  GameCurrentPeriod: number;
  GameEndedFlg: boolean;
  RecordFixedFlg: boolean;
  Attendance: number | null;
  StadiumNameJ: string;
  RefereeNameJ: string | null;
  ConventionNameJ: string;
  HomeTeamID: string;
  HomeTeamNameJ: string;
  AwayTeamID: string;
  AwayTeamNameJ: string;
  HomeTeamScore: number;
  AwayTeamScore: number;
}

export interface GameContext {
  Game: GameRaw;
  HomeBoxscores: BoxscoreRow[];
  AwayBoxscores: BoxscoreRow[];
}

export interface StoredGame {
  scheduleKey: string;
  season: string;
  date: string;
  meta: { status: "watching" | "final"; revisionCount: number };
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  homeScore: number;
  awayScore: number;
  quarterScores: { home: number[]; away: number[] };
  gameEndedFlg: boolean;
  recordFixedFlg: boolean;
  raw: GameContext;
}

export interface TeamGameLog {
  scheduleKey: string;
  date: string;
  opponentTeamId: string;
  opponentTeamName: string;
  isHome: boolean;
  teamScore: number;
  opponentScore: number;
  win: boolean;
}

export interface PlayerGameLog {
  scheduleKey: string;
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
