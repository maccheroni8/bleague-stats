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

export interface TeamColors {
  primary: string;
  secondary: string;
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
  gameType: GameType;
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
  /** この組み合わせが出場した試合数（延べではなく試合単位のユニーク数） */
  gamesPlayed: number;
  /**
   * 推定Net Rating（100ポゼッションあたり純得失点）。スティント単位の実ポゼッション数は
   * 記録されていないため、チームのシーズン平均ペース（POSS/MIN）から按分推定した近似値
   * （公式に定義がないためNBA流の考え方をチームレベル平均で代用。DESIGN.md 6章の他のアドバンスド
   * スタッツと同様の位置づけ）
   */
  estimatedNetRtg: number;
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

// ---- data/club-honors.json の保存スキーマ（teamId→獲得タイトル配列。scripts/scrape-club-honors.ts参照） ----

export type HonorCategory = "overall" | "division" | "international";

export interface ClubHonor {
  competition: string;
  /** "2023-24"形式のシーズン、または国際大会の一部実績は暦年（"2019"等） */
  season: string;
  category: HonorCategory;
  note?: string;
}

export type ClubHonorsFile = Record<string, ClubHonor[]>;

// ---- data/players-master.json の保存スキーマ（シーズン非依存、全選手共通。DESIGN.md 5章参照） ----

export interface PlayerMasterEntry {
  playerId: string;
  name: string;
  /** 直近確認できたクラブ（移籍があればscrape-roster.ts実行のたびに更新される） */
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
