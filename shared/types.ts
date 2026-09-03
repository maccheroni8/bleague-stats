// data/{season}/*.json の型定義。scripts/（バックエンド集計）・src/（フロントエンド表示）の
// 両方から参照する共通モジュール（旧scripts/lib/types.ts・src/lib/types.tsを統合）。
// 生データ（GeniusAPIレスポンス）系の型はDESIGN.md 2-2章の実機検証（6試合・4,513件の
// PlayByPlaysで確認済み）に基づく。

/**
 * 東西2地区（B.PREMIER）に加え、北/東/中/西/南5地区（B.ONE）の値を含む（DESIGN.md 14-4章）。
 * どの値集合が使われるかはCategoryに依存する（同じ"east"でもB.PREMIERとB.ONEでは別の地区）
 */
export type Division = "east" | "west" | "north" | "central" | "south";

/**
 * B.LEAGUEのカテゴリ区分（DESIGN.md 14章）。"premier"は既存のB.PREMIER（旧B1）で、
 * data/{season}/... に無変更で保存する。"one"はB.ONE（旧B2）で、data/{season}/one/... に
 * 保存する（14-5章の案A）。B.NEXTは調査のみでまだ未実装のため型に含めていない
 */
export type Category = "premier" | "one";

/**
 * 地区マスタのシーズン対応版（`Record<Category, Record<Season, Record<TeamID, Division>>>`）。
 * scripts/lib/divisions.tsの`TEAM_DIVISIONS`/`ONE_TEAM_DIVISIONS`は「2026-27シーズン基準の
 * 単一スナップショット」で過去シーズンのクラブ入れ替え・地区再編（東西2地区⇔東中西3地区の
 * 変動を含む）を反映できないという既知の制約があった（DESIGN.md 11章・14-9章）。
 * `data/division-history.json`（`scripts/scrape-division-history.ts`が
 * `bleague.jp/standings/?year={年}&tab={1|2}`から機械的に取得）がこの制約を解消する
 * シーズン別マスタで、この型はそのファイルの構造を表す
 */
export type DivisionHistoryFile = Record<Category, Record<string, Record<string, Division>>>;

/**
 * レギュラーシーズン戦とプレーオフ（チャンピオンシップ）戦の区別。ConventionNameJから
 * scripts/lib/gameType.tsのclassifyGameType()で判定する（オールスター等はisExhibitionGame()で
 * 事前に除外済みの前提。2026-08-16、選手個人スタッツが60試合超になる集計バグの修正で導入）。
 */
export type GameType = "regular" | "playoff";

// ---- GeniusAPI (v2_genius_contexts) の型定義 ----

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
  /**
   * 2016-17〜2019-20シーズン（game_detailページ埋め込みJSON経由の取得のみ）のActionCD1=89
   * （選手交代スワップ、1イベントでOUT→INのペアを表す）でのみ使用。PlayerID1=退場選手・
   * PlayerID2=入場選手。それ以外のイベント種別・シーズンではnull（DESIGN.md参照）
   */
  PlayerID2: string | null;
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

/**
 * 生データ（data/{season}/games/）がまだ無い試合（開催予定）の日程情報。
 * GeniusAPIは未開催の試合にAccessDeniedを返すため使えず、game_detailページのHTMLから
 * 日付・対戦カード・会場を取得する（scripts/lib/upcomingGame.ts、2026-08-16導入）。
 * 生データが揃い次第（試合開始後）この一覧からは自然に外れ、games-summary.json側に載る
 */
export interface UpcomingGameEntry {
  scheduleKey: string;
  /** JST基準のYYYY-MM-DD */
  date: string;
  homeTeamName: string;
  awayTeamName: string;
  venue?: string;
}

export interface ScheduleFile {
  season: string;
  generatedAt: string;
  scheduleKeys: string[];
  upcomingGames: UpcomingGameEntry[];
}

// ---- data/{season}/games-summary.json の保存スキーマ（日程ページ用。1試合1行、レギュラー+
// プレーオフ。オールスター等除外済み。games/の生データからaggregate.tsが毎回作り直す） ----

export interface GameSummary {
  scheduleKey: string;
  /** JST基準のYYYY-MM-DD */
  date: string;
  homeTeamId: string;
  homeTeamName: string;
  awayTeamId: string;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
  gameEndedFlg: boolean;
  gameType: GameType;
  venue?: string;
  /**
   * 来場者数（生データのGame.Attendanceをそのまま転記）。試合単位で持たせておき、
   * チーム詳細ページの通算成績（Phase TF予定）で合算できるようにする土台。
   * Attendanceがnullの試合（データ欠損）はフィールド自体を省略する
   */
  attendance?: number;
}

// ---- data/{season}/teams.json・players.json の保存スキーマ（aggregate.tsの集計結果） ----

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
  foulsDrawn: number;
  blockedAgainst: number;
  /** 個人+/-（生データのPLUSMINUSをそのまま合算）。Bリーグ公式フィールド。DESIGN.md 2-2章 */
  plusMinus: number;
  /**
   * ダブルダブル/トリプルダブル数（レギュラーシーズンのみ集計。PTS/REB/AST/STL/BLKのうち
   * 2桁到達部門数が2以上でDD、3以上でTD。src/lib/boxscoreAggregate.tsのcomputeStatBadge()と
   * 同じ閾値。トリプルダブルはダブルダブルの条件も満たすためdoubleDoublesに含まれる）
   */
  doubleDoubles: number;
  tripleDoubles: number;
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
  plusMinus: number;
}

export interface ShootingStats {
  fgPct: number;
  tpPct: number;
  ftPct: number;
  /** 2P%。(FGM-3PM)/(FGA-3PA)。他の%系フィールドと同じくtotalsから直接算出できる派生値 */
  pt2Pct: number;
  efgPct: number;
  tsPct: number;
  ftRate: number;
}

export interface TeamAdvancedStats {
  /** Bリーグ公式EFF（貢献度）。1試合あたりの値。DESIGN.md 6章 */
  eff: number;
  /** 推定ポゼッション（シーズン合計）。生データのチーム行のPOSS値を合算した値 */
  poss: number;
  /** ペース。40分換算・5人あたりの推定ポゼッション数 */
  pace: number;
  /** オフェンシブレーティング（100ポゼッションあたり得点） */
  offRtg: number;
  /** ディフェンシブレーティング（100ポゼッションあたり失点） */
  defRtg: number;
  /** ネットレーティング = offRtg - defRtg */
  netRtg: number;
  /** オフェンスリバウンド率。公式に定義がないためNBA流を採用（DESIGN.md 6章） */
  orbPct: number;
  /** 相手チームのオフェンスリバウンド率。orbPctの相手チーム版 */
  opponentOrbPct: number;
  /** ターンオーバー率（Four Factors）。公式に定義がないためNBA流を採用（DESIGN.md 6章） */
  tovPct: number;
  /** 相手チームのターンオーバー率（＝相手に強制したターンオーバー率）。tovPctの相手チーム版 */
  opponentTovPct: number;
  /**
   * ベンチ得点（1試合あたり平均）。GeniusAPIに直接の該当フィールドが無いため、
   * ボックススコア個人行の StartingFlg!==1（先発以外）の選手のPoint合計から導出した
   * 独自集計（DESIGN.md 12章）
   */
  benchPointsPerGame: number;
}

export interface PlayerAdvancedStats {
  /** Bリーグ公式EFF（貢献度）。1試合あたりの値。DESIGN.md 6章 */
  eff: number;
  /** ユーセージ率。公式に定義がないためNBA流を採用（DESIGN.md 6章） */
  usagePct: number;
  /** オンコート純得失点（シーズン合計）。定義上、個人+/-（PLUSMINUS）合計と同値 */
  onCourtNet: number;
  /** オンコート純得失点（1試合あたり平均） */
  onCourtNetPerGame: number;
  /** オフコート純得失点（シーズン合計）= 出場試合のチーム得失点差合計 − オンコート純得失点 */
  offCourtNet: number;
  /** オフコート純得失点（1試合あたり平均） */
  offCourtNetPerGame: number;
  /**
   * PER（Hollinger方式、NBA/Basketball-Reference流）。公式に定義が無いためNBA流を採用。
   * リーグ全体を出場時間で加重平均するとちょうど15になるよう正規化されている
   */
  per: number;
  /**
   * PPP（Points Per Possession）。個人ORtg（Dean Oliver方式、shared/formulas.tsの
   * individualOffRtg。ボックススコア試合詳細ページの個人ORtgと同じ計算式をシーズン合計値に
   * 適用）を100で割った値。同じ計算式をそのまま再利用しているため、qASTの分母近傍0の
   * 不安定性ガード（MIN_MINUTES_FOR_INDIVIDUAL_RATING、シーズン合計出場時間4分未満）も
   * 引き継ぎ、該当選手はundefined（算出不能）になる
   */
  ppp?: number;
}

// ---- data/team-colors.json の保存スキーマ（scripts/extract-team-colors.ts生成） ----

/**
 * primary/secondaryは視認性チェック（src/lib/color.ts）を通過した色、または
 * 両方とも不合格の場合はテーマに追従するモノクロのフォールバック値
 * （`var(--fg)`。src/lib/color.tsのMONO_FALLBACK_COLOR参照）が入る
 * フロントエンド消費用の型。空文字列にはしない ── 呼び出し側は`??`（null合体）・
 * `? :`（truthyチェック）どちらのフォールバックパターンでも安全に働く
 * （DESIGN.md参照。以前は空文字列を返しており、`??`パターンの呼び出し元だけ
 * すり抜けるバグがあった）
 */
export interface TeamColors {
  primary?: string;
  secondary?: string;
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
  advanced: TeamAdvancedStats;
  opponentPerGame: PerGameStats;
  netPerGame: PerGameStats;
  /** 相手チームがこのチームとの試合で記録したシュート成功率（＝被シュート成功率）。DESIGN.md参照 */
  opponentShooting: ShootingStats;
  /**
   * 相手に強制したターンオーバーの種類別カウント（＝相手から奪ったもの。自チームのディフェンスの
   * 成果。Yahoo!スポーツplay-by-play由来。DESIGN.md参照）。
   * Yahoo PBPデータが1試合も取得できていないシーズンではフィールド自体を省略する
   */
  forcedTurnovers?: TeamForcedTurnovers;
  /**
   * 自チームが犯したターンオーバーの種類別カウント（＝相手に強制されたもの。自チームのオフェンス面の
   * 課題。forcedTurnoversと表裏の関係で、同じTeamForcedTurnovers型・同じ集計元（Phase H6）。
   * Yahoo PBPデータが1試合も取得できていないシーズンではフィールド自体を省略する
   */
  turnoversCommitted?: TeamForcedTurnovers;
  /**
   * シュートタイプ別の成功/試投カウント（Yahoo!スポーツplay-by-play由来、レギュラーシーズンのみ・
   * チーム全選手合算。PlayerSummary.shotTypesと同じ形・同じキー方針のチーム集計版。DESIGN.md参照）。
   * Yahoo PBPデータが1試合も取得できていないシーズンではフィールド自体を省略する
   */
  shotTypes?: ShotTypeBreakdown;
}

/**
 * 相手に強制したターンオーバーの種類別シーズン集計（DESIGN.md参照）。「等」で言及された
 * 主要4種別（オフェンスファウル/24秒/バックコート/5秒バイオレーション）を独立フィールドにし、
 * 残りの低頻度デッドボール種別（トラベリング・ダブルドリブル・3秒/8秒バイオレーション・
 * アウトオブバウンズ・オフェンスゴールテンディング・分類不能）は`otherDead`にまとめる。
 * `live`はスティール由来（バッドパス・ボールハンドリングロスト）の参考値
 */
export interface TeamForcedTurnovers {
  /** Yahoo PBPデータが実際に取得できた試合数（分母の目安。全試合数と異なりうる） */
  gamesWithData: number;
  offensiveFoul: number;
  violation24sec: number;
  backcourtViolation: number;
  violation5sec: number;
  otherDead: number;
  live: number;
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
  advanced: PlayerAdvancedStats;
  /**
   * data/players-master.json（scrape-roster.ts）から突合した選手属性。マスタに未登録の選手
   * （新加入直後でまだスクレイプできていない等）は全フィールド未定義になりうる
   */
  position?: string;
  nationality?: string;
  classification?: "日本人" | "外国籍" | "帰化選手" | "アジア特別枠";
  heightCm?: number;
  weightKg?: number;
  birthDate?: string;
  /**
   * シュートタイプ別の成功/試投カウント（Yahoo!スポーツplay-by-play由来、レギュラーシーズンのみ。
   * DESIGN.md参照）。キーはYahoo表記のシュートタイプ原文をそのまま使う（scrape-yahoo-pbp.tsの
   * turnoverSubtypeCountsと同じ方針）。「キャッチアンドシュート」に相当する独立タグはデータ上
   * 存在せず、無印の「ジャンプショット」（全体の約51%）に一括りになっている点に注意。
   * Yahoo PBPデータが1試合も取得できていないシーズンではフィールド自体を省略する
   */
  shotTypes?: ShotTypeBreakdown;
}

export interface ShotTypeCounts {
  made: number;
  attempted: number;
}

/** シュートタイプ1種類分の2P/3P別成功・試投カウント（同じシュートタイプ名でも2P/3Pどちらもありうる。DESIGN.md参照） */
export interface ShotTypeSplitCounts {
  twoPoint: ShotTypeCounts;
  threePoint: ShotTypeCounts;
}

export type ShotTypeBreakdown = Record<string, ShotTypeSplitCounts>;

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
  gameType: GameType;
  /** ファウルドローン（FOULON）。EFF計算・ボックススコアのFD列に対応 */
  foulsDrawn: number;
  /** 被ブロック数（BSON）。EFF計算・ボックススコアのBSR列に対応 */
  blockedAgainst: number;
  /** テクニカルファウル数（ActionCD1=24）。EFF計算の追加減点補正に使う */
  technicalFouls: number;
  /**
   * ペイント内得点（PITP）。PlayByPlaysのPlayTextタグ集計による得点（shared/playTypePoints.ts）。
   * BoxscoreRow.PT2IN（シュート成功本数、スケールが異なる）はそのまま使わない
   */
  pt2in: number;
  /** ファストブレイク得点（FBPS）。pt2inと同じPBPタグ集計方式（shared/playTypePoints.ts） */
  ptfb: number;
  /** セカンドチャンス得点（2ND PTS）。pt2inと同じPBPタグ集計方式（shared/playTypePoints.ts） */
  pt2nd: number;
  /**
   * この試合、自チームが最も長い時間コートに置いていた外国籍選手（外国籍/帰化選手/
   * アジア特別枠の合算）同時出場人数（0〜。理論上は5だが実運用ではほぼ0〜3）。
   * `reconstructOnCourt`のlineupStintsから、チーム全体の出場時間ベースで算出した
   * 試合単位の代表値（特定選手の出場時間には限定しない）。classificationが不明な
   * 選手を含む区間は集計から除外するため、対象試合の在コート区間が一つも分類できな
   * かった場合はundefined（DESIGN.md参照）
   */
  foreignPlayerCount?: number;
  /** 対戦相手チームの同時出場外国籍選手数（foreignPlayerCountと同じ算出方法、相手チーム視点） */
  opponentForeignPlayerCount?: number;
  /** ターンオーバーからの得点（PTSOFFTO）。PlayTextの公式判定タグ集計。shared/pointsOffTurnovers.ts参照。
   * 2016-17シーズンのみタグ自体が存在せず常に0（「算出不能」、DESIGN.md参照） */
  ptsOffTov: number;
  /** ダンク成功数 */
  dunks: number;
  /** バスケットカウント（アンドワン）数 */
  basketCounts: number;
  /** アンスポーツマンファウル数 */
  unsportsmanlikeFouls: number;
  /** ディスクォリファイングファウル数 */
  disqualifyingFouls: number;
  /** アシストされた2P成功数。shared/assistedScoring.ts参照 */
  assisted2m: number;
  /** アシストされた3P成功数 */
  assisted3m: number;
  /** アシストされたFT成功数 */
  assistedFtm: number;
  /** ペイント内2P成功数（ショットチャート座標由来。2022-23シーズン以降のみ、それ以前は常に0） */
  paint2m: number;
  /** ペイント内2P試投数（同上） */
  paint2a: number;
  /** ミッドレンジ（ペイント外）2P成功数（同上） */
  mid2m: number;
  /** ミッドレンジ（ペイント外）2P試投数（同上） */
  mid2a: number;
  /**
   * 在コート区間（shared/onCourt.tsのreconstructOnCourt）の推定ポゼッション合計（自チーム視点）。
   * シーズン合計してから個人PACEの式を1回だけ適用するために保持する（チームPOSSと同じ
   * 「試合単位の正しい値をそのまま合算する」方針。DESIGN.md参照）。coverage==="full"の
   * シーズン（2022-23以降）のみ算出し、それ以外は常に0
   */
  onCourtOwnPoss: number;
  /** 同上、相手チーム視点 */
  onCourtOppPoss: number;
  /** 同上、在コート秒数 */
  onCourtSeconds: number;
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
  gameType: GameType;
  /** チーム総プレイタイム（5人合計・分）。通常40分×5=200だがOT試合は変動する */
  min: number;
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
  /**
   * ポゼッション。生データのチーム行に公式POSS値がある場合（fullティア、2022-23シーズン以降）は
   * それをそのまま使う。無い場合（pbpNoShotChartティア、2022-23シーズンより前）は、
   * 公式のポゼッション推定式（shared/formulas.tsのestimatedPossessions()）を試合単位で適用した値。
   * シチュエーション別集計ではこの値をそのまま合算する（式の再計算はしない。非線形性回避）
   */
  poss: number;
  /** PlayerGameLog.foreignPlayerCountと同じ算出方法・同じ意味（チーム視点）。DESIGN.md参照 */
  foreignPlayerCount?: number;
  /** PlayerGameLog.opponentForeignPlayerCountと同じ（対戦相手チーム視点） */
  opponentForeignPlayerCount?: number;
  /**
   * 相手チームのボックススコア（個人ORtg/DRtgのDean Oliver方式で「opponent」役として必要な
   * フィールドのみ。opponentScoreがptsに相当するためptsは別途持たない）。DESIGN.md参照
   */
  opponentMin: number;
  opponentFgm: number;
  opponentFga: number;
  opponentFtm: number;
  opponentFta: number;
  opponentOreb: number;
  opponentDreb: number;
  opponentTov: number;
  /**
   * チーム詳細ページ「スタッツ」タブのopp/+/-トグル・シチュエーション別成績（チーム版）用に
   * 追加した相手チームのAST/STL/BLK/3PM/3PA（DESIGN.md参照。DRtg算出には不要だが、
   * opp視点のシューティング内訳・カウント統計を試合ログ単位で表示するために必要）
   */
  opponentTpm: number;
  opponentTpa: number;
  opponentAst: number;
  opponentStl: number;
  opponentBlk: number;
  /** クラブレコード「被記録」（Phase H8）用の相手チームのファウル数・被ファウル数 */
  opponentPf: number;
  opponentFoulsDrawn: number;
  /**
   * プレータイプ内訳（PlayByPlaysのPlayTextタグ集計、shared/playTypePoints.ts参照）。
   * チーム詳細ページ「通算成績」タブの単純合計値用。命名はBoxscoreCounts.PlayTypeCountsと
   * 揃えている（pt2in=PITP, fb=FBPS, pt2nd=2ND PTS）
   */
  pt2in: number;
  fb: number;
  pt2nd: number;
  /** Points Off Turnovers（PTSOFFTO、shared/pointsOffTurnovers.ts） */
  pft: number;
  /** 被ファウル数（FOULON） */
  foulsDrawn: number;
  /** ダンク数（PlayByPlaysのPlayTextタグ集計、ActionCD1=4かつ"ダンク"を含むイベントをTeamID単位で集計） */
  dunks: number;
  /** その試合の来場者数（Game.Attendance）。ホーム/アウェイいずれの側の試合ログにも同じ値を持たせ、
   * 「ホーム来場者数」集計時はisHomeでフィルタしてから合算する。未計測の試合は省略 */
  attendance?: number;
  /** クラブレコード「被記録」（Phase H8）用の相手チームのプレータイプ内訳・ダンク数。
   * 同じ試合のpitpByTeam等から対戦相手側のteamIdを引くだけで求まる（新規のPBP走査は不要） */
  opponentPt2in: number;
  opponentFb: number;
  opponentPt2nd: number;
  opponentPft: number;
  opponentDunks: number;
  /**
   * Misc/スコアリングタブ拡張（2026-08-29）用。個人版PlayerGameLogの同名フィールドと同じ
   * PBPタグ集計（shared/assistedScoring.ts・aggregate.tsのbuildMiscEventCounts）を
   * チーム単位で集計したもの。technicalFoulsはHC/ベンチテクニカルも含むチーム帰属分
   * （ActionCD1=20/21/24の合計。countTechnicalFoulsのbyTeam）
   */
  technicalFouls: number;
  basketCounts: number;
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
  assisted2m: number;
  assisted3m: number;
  assistedFtm: number;
  /**
   * ペイント内外2P内訳（ショットチャート座標由来、buildPaintSplitByPlayerのbyTeam）。
   * 2022-23シーズン以降のみ、それ以前は常に0（個人版PlayerGameLog.paint2m等と同じ制約）
   */
  paint2m: number;
  paint2a: number;
  mid2m: number;
  mid2a: number;
  opponentTechnicalFouls: number;
  opponentBasketCounts: number;
  opponentUnsportsmanlikeFouls: number;
  opponentDisqualifyingFouls: number;
  opponentAssisted2m: number;
  opponentAssisted3m: number;
  opponentAssistedFtm: number;
  opponentPaint2m: number;
  opponentPaint2a: number;
  opponentMid2m: number;
  opponentMid2a: number;
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

// ---- data/{season}/head-to-head.json の保存スキーマ（星取り表ページ用） ----

/** 特定の対戦相手1チームとの通算成績（星取り表の1セル分） */
export interface HeadToHeadRecord {
  wins: number;
  losses: number;
  /** 自チーム視点の合計得失点差 */
  pointDiff: number;
}

export interface HeadToHeadSummary {
  wins: number;
  losses: number;
  winPct: number;
}

export interface HeadToHeadTeamRow {
  teamId: string;
  teamName: string;
  /** scripts/lib/divisions.tsのマスタに基づく（未登録チームは未定義） */
  division?: Division;
  /** 対戦相手のteamIdをキーにした通算成績。対戦していない相手はキー自体が存在しない */
  vs: Record<string, HeadToHeadRecord>;
  overall: HeadToHeadSummary;
  /** 相手が東地区のチームだった試合の合算成績（相手の地区が不明な試合は含まない） */
  vsEast: HeadToHeadSummary;
  /** 相手が西地区のチームだった試合の合算成績（相手の地区が不明な試合は含まない） */
  vsWest: HeadToHeadSummary;
}

// ---- data/{season}/lineups/{teamId}.json の保存スキーマ（ラインナップスタッツ。DESIGN.md参照） ----

export interface LineupAggregate {
  /** playerIdをソートして","結合した正規化キー（5人の組み合わせを順不同で同一視する） */
  lineupKey: string;
  playerIds: string[];
  /** シーズン通算の在コート合計秒数 */
  secondsPlayed: number;
  /** シーズン通算の純得失点（この5人が同時に出場していた時間帯のチーム得失点差の合計） */
  netPoints: number;
  /** シーズン通算の自チーム得点（この5人が同時に出場していた時間帯。Phase H5で追加） */
  ownPoints: number;
  /** シーズン通算の相手チーム得点（同上） */
  oppPoints: number;
  /** この組み合わせが出場した試合数（延べではなく試合単位のユニーク数） */
  gamesPlayed: number;
  /**
   * 推定Net Rating（100ポゼッションあたり純得失点）。スティント単位の実ポゼッション数は
   * 記録されていないため、チームのシーズン平均ペース（POSS/MIN）から按分推定した近似値
   * （公式に定義がないためNBA流の考え方をチームレベル平均で代用。DESIGN.md 6章の他のアドバンスド
   * スタッツと同様の位置づけ）
   */
  estimatedNetRtg: number;
  /** 推定Offensive Rating（100ポゼッションあたり自チーム得点）。estimatedNetRtgと同じ推定ポゼッションを使う */
  estimatedOffRtg: number;
  /** 推定Defensive Rating（100ポゼッションあたり相手チーム得点）。同上 */
  estimatedDefRtg: number;
}

export interface TeamLineupsFile {
  teamId: string;
  teamName: string;
  season: string;
  lineups: LineupAggregate[];
}

// ---- data/seasons.json の保存スキーマ（収録済みシーズン一覧・データ対応範囲。DESIGN.md参照） ----

/**
 * シーズンごとのデータ対応範囲（フロントエンドがPBP系機能・ショットチャートの表示可否を
 * 判定するためのフラグ）。2層構成（2026-08-15、ユーザー確定）:
 * - "full": 基本＋アドバンスド＋PBP系（Lead Tracker・出場交代バー・ラインナップ・
 *   オンオフコートスタッツ）＋ショットチャート全部対応（2022-23〜。公式PLUSMINUS/USG/
 *   ショット座標がAPIに存在する）
 * - "pbpNoShotChart": 基本＋アドバンスド＋PBP系はあるがショットチャートのみ非対応
 *   （2016-17〜2021-22。個人+/-はshared/onCourt.tsによる自前復元。2016-17〜2019-20は
 *   legacyモデルでの復元だが、2026-08-13検証で警告0件・MIN一致率100%を確認済みのため
 *   2020-21〜2021-22と同じ扱いとする。将来ショットチャートを実装する際もこのフラグを
 *   そのまま参照する）
 */
export type SeasonCoverage = "full" | "pbpNoShotChart";

export interface SeasonEntry {
  season: string;
  coverage: SeasonCoverage;
  /**
   * Yahoo!スポーツplay-by-play（追加データ源、シュートタイプ・ターンオーバー種別。DESIGN.md
   * 33章・35章参照）の取得済みデータが1件以上あるか。理論上の対応範囲（2023-24シーズン以降、
   * scripts/lib/yahooCoverage.tsのyahooPbpCoverage()）とは別に、実際にdata/{season}/yahoo/へ
   * スクレイピング済みかどうかを見る（未取得のうちはUIから機能を隠すため）
   */
  yahooPbp: boolean;
}

export type SeasonsFile = SeasonEntry[];

// ---- data/season-rules.json の保存スキーマ（シーズン非依存、レギュレーション変遷。DESIGN.md参照） ----

/**
 * 各シーズンの外国籍/帰化選手/アジア特別枠に関するレギュレーション（登録・ベンチ入り・
 * 同時出場の人数制限）。ルールの構造自体が年代で大きく異なる（クォーター別事前申請制→
 * シンプルな人数上限制、等）ため、数値だけを固定スキーマに収めず、説明文（human-readable）
 * を主とし、確認できた数値のみ構造化フィールドに入れる方式にしている。
 */
export interface ForeignPlayerRule {
  /** リーグ登録可能人数の説明（帰化選手・アジア特別枠を含む/別枠かで年代により構造が異なる） */
  registration: string;
  /** 1試合のベンチ入り（試合エントリー）人数の説明 */
  benchEntry?: string;
  /** 同時出場（オンザコート）人数の説明 */
  onCourt: string;
  /** 事前申請制等、上記だけでは表現しきれない補足 */
  notes?: string;
}

export interface SeasonRules {
  season: string;
  /** この期間区分の通称（例: "2016-17〜2017-18: クォーター別事前申請制"） */
  eraLabel: string;
  foreignPlayerRule: ForeignPlayerRule;
  /** アジア特別枠制度が存在するか（2020-21シーズン導入） */
  hasAsiaSpecialQuota: boolean;
  /** オンザコート人数制限が撤廃されているか（B.PREMIER 2026-27シーズン〜） */
  onTheCourtFree: boolean;
  /** 東西地区制が存在するか（B.PREMIER 2026-27シーズン〜。scripts/lib/divisions.ts参照） */
  hasDivisionSystem: boolean;
  /**
   * 情報の裏取り状況。official-pdf=公式PDF本文で直接確認、secondary-source=第三者記事等の
   * 二次情報のみで公式一次情報は未確認、unverified=未確認
   */
  sourceConfidence: "official-pdf" | "secondary-source" | "unverified";
  sourceNotes?: string;
}

// ---- data/team-history.json の保存スキーマ（シーズン非依存、クラブ名称変更履歴。DESIGN.md参照） ----

/**
 * クラブの名称変更履歴（改称回数に上限を設けない配列。改称が無いクラブも要素数1の配列で表現し、
 * 特別扱いしない）。TeamIDはbleague.jpの内部クラブIDで改称をまたいでも不変であることを実証済み
 * （DESIGN.md 2-8章。宇都宮ブレックス（旧栃木）・東京サンロッカーズ（旧SR渋谷）・
 * 神戸ストークス（旧西宮・旧兵庫、3段階改称）で確認）
 */
export interface TeamNameHistoryEntry {
  name: string;
  /** この名称が使われ始めたシーズン（"2016-17"形式）。判明している範囲で入れる。不明なら省略 */
  fromSeason?: string;
  /** この名称が使われていた最後のシーズン。現在も使われている場合は省略（末尾要素は基本省略） */
  toSeason?: string;
}

export interface TeamHistoryEntry {
  teamId: string;
  /** 名称変更履歴を古い順に並べた配列。最後の要素が現行名 */
  names: TeamNameHistoryEntry[];
}

/**
 * 選手の登録名変更履歴（team-history.jsonと同じ考え方）。playerIdは改名（主に帰化選手の
 * 日本語名への変更）をまたいでも不変であることを実証済み（ニカ・ウィリアムス→ウィリアムス
 * ニカ playerId=9345、ルーク・エヴァンス→エヴァンス ルーク playerId=9418、
 * ニック・メイヨ→メイヨ ニック playerId=26890）。
 *
 * team-history.jsonと同様、各シーズンのplayers.json/games/*.json自体は元々その時点の
 * 登録名で記録されているため（GeniusAPI生データのPlayerNameJがシーズンごとに正しい値を
 * 持っている）、シーズン別の名前解決に本データを使う必要は無い。TeamDetailPageの
 * 「名称変更履歴」表示と同じく、PlayerDetailPageに改名の経緯を示す注記を出すための
 * 情報源として使う
 */
export interface PlayerNameHistoryEntry {
  name: string;
  /** この名称が使われ始めたシーズン（"2016-17"形式）。判明している範囲で入れる。不明なら省略 */
  fromSeason?: string;
  /** この名称が使われていた最後のシーズン。現在も使われている場合は省略（末尾要素は基本省略） */
  toSeason?: string;
}

export interface PlayerHistoryEntry {
  playerId: string;
  /** 改名履歴を古い順に並べた配列。最後の要素が現行名 */
  names: PlayerNameHistoryEntry[];
}

// ---- data/club-honors.json の保存スキーマ（teamId→獲得タイトル配列。scripts/scrape-club-honors.ts参照） ----

export type HonorCategory = "overall" | "division" | "international" | "emperors_cup";

export interface ClubHonor {
  competition: string;
  /** "2023-24"形式のシーズン、または国際大会の一部実績は暦年（"2019"等） */
  season: string;
  category: HonorCategory;
  note?: string;
}

export type ClubHonorsFile = Record<string, ClubHonor[]>;

// ---- data/players-master.json の保存スキーマ（シーズン非依存、選手プロフィール共通。
// DESIGN.md 5章・11章参照）----
//
// 2026-08時点でscrape-season-rosters.tsによる一回限りのバックフィルを実施し、対象を
// 「現在契約中の選手のみ」から「2016-17〜2025-26シーズンに一度でも在籍した全選手」に
// 拡張済み。「そのシーズン、どのクラブに所属していたか」というseason依存の情報は
// data/season-rosters.json（SeasonRostersFile）が別途持つため、このファイルには含めない
// （season非依存のプロフィールとseason依存のクラブ所属履歴を分離する設計）。
// 継続的なメンテナンスは2つのスクリプトが分担する:
//   - scrape-roster.ts（週次）: 現役選手のteamId/teamNameの鮮度維持・当該シーズンの新規選手検知
//   - scrape-season-rosters.ts（一回限り、必要に応じて再実行）: 過去シーズンの退団済み選手の
//     発掘・プロフィール補完（バックフィル済みのシーズン範囲を広げたい場合に再実行する）

export interface PlayerMasterEntry {
  playerId: string;
  name: string;
  /**
   * 直近確認できたクラブ。現役選手はscrape-roster.ts実行のたびに更新されるが、
   * 退団済み選手（scrape-season-rosters.ts由来のエントリ）は発見時点の所属クラブのまま
   * 更新されない（＝「最後に確認できた時点」の値。現在の所属を意味しない）
   */
  teamId: string;
  teamName: string;
  /** bleague.jp表記そのまま（例: "SG/SF"）。複数ポジション兼任時はスラッシュ区切り */
  position?: string;
  /** 「リーグ登録国籍」欄の値をそのまま保持（例: "日本", "フィリピン"）。DESIGN.md 11章参照 */
  nationality?: string;
  /**
   * 日本人/外国籍/帰化選手/アジア特別枠。bleague.jp上に明示的なラベルが存在しないため
   * 自動判定は未実装（2026-08時点）。判定基準が決まり次第、別途ロジックを追加する
   */
  classification?: "日本人" | "外国籍" | "帰化選手" | "アジア特別枠";
  heightCm?: number;
  weightKg?: number;
  /** YYYY-MM-DD */
  birthDate?: string;
}

// ---- data/player-awards.json の保存スキーマ（シーズン非依存、Record<playerId, entries>。
// bleague.jpのroster_detail/?PlayerID=ページ「受賞歴」セクション（.rosterDetail-awardHistory）
// から取得。players-master.jsonとは別ファイル（更新頻度・再取得ポリシーが異なるため。
// DESIGN.md 46章参照） ----

export interface PlayerAwardEntry {
  /** 受賞シーズン。bleague.jp表記そのまま（例: "2023-24"） */
  season: string;
  /** 賞の名称。原文の末尾に"(B1)"等が付いている場合はそこを除いた部分（例: "得点王"） */
  name: string;
  /** 賞名末尾の"(B1)"等から抽出したカテゴリ。無い賞（MVP・ベストファイブ等）はundefined */
  category?: string;
}

export type PlayerAwardsFile = Record<string, PlayerAwardEntry[]>;

// ---- data/season-rosters.json の保存スキーマ（ファイル自体はシーズン非依存だが、内容は
// season→クラブ→選手ID一覧のアーカイブ。roster/?e=全選手（在籍中+退団済の全選手）から
// scripts/scrape-season-rosters.tsが構築する。players-master.jsonが「直近確認できた
// クラブ」という単一のスナップショットしか持てないのに対し、こちらは
// 「そのシーズン、その選手がどのクラブに所属していたか」を正確に記録する。
//
// 用途: (1) players-master.jsonの新規選手発掘（未知のplayerIdをここから見つけてroster_detailで
// 補完する）、(2) 将来のシーズン別ロースター表示等の参照用アーカイブ。
// 一方、aggregate.tsの国籍区分（classification）突合には使わない ――
// classificationは選手個人に紐づく性質（どのクラブに居たかとは無関係）で、
// masterById.get(playerId)?.classification というplayerId単位の参照だけで完結し、
// これは常にseason非依存で正しい。season-rostersを経由する必要があるのは「未知の選手を
// 発見する」フェーズだけで、発見後の実際の分類はplayers-master.json単体で足りる。
// DESIGN.md参照 ----

export interface SeasonRosterEntry {
  teamId: string;
  teamName: string;
  playerIds: string[];
}

/** キーは "2016-17" 形式のシーズン文字列 */
export type SeasonRostersFile = Record<string, SeasonRosterEntry[]>;

// ---- data/{season}/yahoo/{scheduleKey}.json の保存スキーマ（Yahoo!スポーツplay-by-playテキスト。
// scripts/scrape-yahoo-pbp.ts参照。bleague.jp本体データとは独立した追加データ源で、対応シーズンは
// scripts/lib/yahooCoverage.tsのyahooPbpCoverage()が判定する（2023-24以降のみ）） ----

/**
 * ターンオーバーのライブボール/デッドボール区別。"live"=スティール由来（バッドパス／
 * ボールハンドリングロスト、相手の速攻に直結しうる）、"dead"=バイオレーション・
 * オフェンスファウル由来（笛で試合が止まる）。"unknown"はsubtypeRawが未知の文言だった場合
 * （scrape-yahoo-pbp.tsのparseWarningsにも記録される。新しい文言を見つけたら分類表を更新する）
 */
export type YahooTurnoverBallType = "live" | "dead" | "unknown";

/** Yahoo!スポーツplay-by-play 1件（1<li>）に共通する時刻情報 */
export interface YahooEventClock {
  /** そのクォーター/延長内での通し番号（1〜4=各Q, 5以降=延長） */
  period: number;
  /** "残り9分11秒"のような原文表記 */
  clockLabel: string;
  /** clockLabelから解析したそのピリオド内の残り秒数 */
  remainingSec: number;
}

export interface YahooShotEvent extends YahooEventClock {
  teamId: string;
  /** Yahoo表記の背番号（"#21"の21部分）。bleague.jp側TeamID+この番号でPlayerIDを解決する */
  playerNo: string;
  /** playerLookup（同じScheduleKeyの自前ボックススコアから作る）で解決できた場合のみ入る */
  playerId: string | null;
  /** Yahoo表記の選手名（姓のみのことが多い。playerId解決の裏取り・デバッグ用） */
  playerNameRaw: string;
  made: boolean;
  /** "2Pシュート"/"3Pシュート"の表記から判定（このシュート自体の得点価値。カッコ内の数字ではない） */
  shotValue: 2 | 3;
  /** "インサイドペイント"/"アウトサイドペイント"等、シュートタイプの前に付くゾーン表記（無ければnull） */
  zoneLabel: string | null;
  /** "プルアップジャンプショット"等のシュートタイプ原文（分類はせず原文のまま保持。DESIGN.md参照） */
  shotType: string;
  /** "ファストブレイク"「セカンドチャンス」「ポインツオフターンオーバー」等、末尾に付く追加タグ */
  tags: string[];
  /**
   * ○(N点)のNをそのまま保持した、そのプレーヤーのその試合での得点累計（実機確認の結果、FTを含む
   * 総得点の累計と判明。シュート自体の得点ではない）。FT得点も混ざるためFG得点のクロスチェックには
   * 使えない（scrape-yahoo-pbp.tsは代わりにmadeショットのshotValue合算で検証している）。ミスした
   * 場合はnull
   */
  cumulativePointsAfter: number | null;
  raw: string;
}

export interface YahooTurnoverEvent extends YahooEventClock {
  teamId: string;
  /** "チームターンオーバー"（24秒バイオレーション等、個人に紐付かない）の場合true */
  isTeamTurnover: boolean;
  playerNo: string | null;
  playerId: string | null;
  playerNameRaw: string | null;
  /**
   * ターンオーバー原因の原文（"バッドパス"等）。オフェンスファウル由来はターンオーバー行自体には
   * 文言が付かず、直前の別イベント行にしか出ないため、その場合はパーサがそこから補って入れる
   * （元々文言が無かったことはこのフィールドだけでは分からないので判別が必要ならrawを見る）
   */
  subtypeRaw: string | null;
  ballType: YahooTurnoverBallType;
  raw: string;
}

export interface YahooGamePbp {
  scheduleKey: string;
  season: string;
  fetchedAt: string;
  /** <li>の総数（プレイヤーイン/アウト・リバウンド・ファウル等、shots/turnovers以外も含む） */
  eventCount: number;
  /** playerId解決に失敗した人数（ScheduleKeyの自前ボックススコアに該当する(TeamID,PlayerNo)が
   * 無かった件数。0でなければ自前データの欠落かYahoo側の表記ゆれを疑う） */
  unresolvedPlayerCount: number;
  /** 想定外のフォーマット（未知のターンオーバーsubtype・ピリオドラベル等）を検出した際の記録 */
  parseWarnings: string[];
  shots: YahooShotEvent[];
  turnovers: YahooTurnoverEvent[];
}

// ---- data/league-team-rankings.json（Phase H7、2026-08-29） ----
//
// data/{season}/team-games/配下の全シーズン・全クラブ（過去に降格・改称したクラブも含む。
// teamIdはクラブ改称をまたいで不変なので、同一teamIdの全シーズン分を素直に合算・比較すれば
// よい。2-8章参照）を横断して、通算成績（shared/teamRecords.tsのCAREER_TOTAL_DEFS）・
// クラブレコード（同TEAM_RECORD_STATS）・シーズン単位の特殊記録（最多勝利数・最多連勝）
// それぞれについて全クラブ中の順位を算出したもの。対象はB.PREMIERのみ（既存の「通算成績」
// 「クラブレコード」タブと同じスコープ）。npm run aggregateの日次サイクルには含めず、
// scripts/aggregate-league-rankings.tsを手動実行するバッチ処理で随時再生成する運用とする
// （ユーザー指定）。

/** レギュラーシーズンのみ/プレーオフのみ/合算。src/lib/gameType.tsのSeasonGameTypeFilterと同じ3値
 * （shared/types.tsは他のshared/*.tsに依存しない方針のため、型エイリアスは重複定義している） */
export type LeagueRankingGameType = "regular" | "playoff" | "both";

export interface LeagueTeamRankEntry {
  value: number;
  /** リーグ全クラブ中の順位（1位が最高値）。同値の場合はteamId昇順で決定的にタイブレークする
   * （複数クラブが同順位を共有する「1224方式」ではなく、既存のrankAmongTeams()/rankAmong()と
   * 同じ「並び順で連番を振る」方式に揃えている） */
  rank: number;
  /** その項目・そのgameTypeでランキング対象になったクラブの総数（該当試合が1件も無いクラブ・
   * その項目のfilter条件を満たす試合が1件も無いクラブは対象外）。formatTeamRank()と同じ
   * 「◯位/◯チーム」表示にそのまま使える */
  totalTeams: number;
}

/** [statKey][teamId] のルックアップ */
export type LeagueTeamRankingStatTable = Record<string, Record<string, LeagueTeamRankEntry>>;

export interface LeagueTeamRankingsFile {
  generatedAt: string;
  /** CAREER_TOTAL_DEFSの各key（ホーム/アウェイ問わず全試合が対象＝「トータル」） */
  career: Record<LeagueRankingGameType, LeagueTeamRankingStatTable>;
  /** TEAM_RECORD_STATSの各key（1試合単位の最高値、トータル） */
  clubRecord: Record<LeagueRankingGameType, LeagueTeamRankingStatTable>;
  /** シーズン単位の特殊記録（1シーズンの最多勝利数・最多連勝の最高値、トータル） */
  seasonSpecial: Record<LeagueRankingGameType, Record<"wins" | "streak", Record<string, LeagueTeamRankEntry>>>;
  /**
   * ホーム/アウェイ限定版（2026-08-29、「歴代記録」タブのホーム/アウェイ/トータル切り替え用に追加）。
   * 対象試合をisHomeで絞り込んだ上で、career/clubRecord/seasonSpecialと全く同じロジックで
   * 算出したもの（形はcareer/clubRecord/seasonSpecialと同一）。「トータル」表示は上記の
   * 既存フィールドをそのまま使う（このホーム/アウェイ限定版とは別に重複保存しない）
   */
  careerHome: Record<LeagueRankingGameType, LeagueTeamRankingStatTable>;
  careerAway: Record<LeagueRankingGameType, LeagueTeamRankingStatTable>;
  clubRecordHome: Record<LeagueRankingGameType, LeagueTeamRankingStatTable>;
  clubRecordAway: Record<LeagueRankingGameType, LeagueTeamRankingStatTable>;
  seasonSpecialHome: Record<LeagueRankingGameType, Record<"wins" | "streak", Record<string, LeagueTeamRankEntry>>>;
  seasonSpecialAway: Record<LeagueRankingGameType, Record<"wins" | "streak", Record<string, LeagueTeamRankEntry>>>;
}
