// アドバンスドスタッツ計算式（DESIGN.md 6章）。
// Bリーグ公式の「スタッツ用語解説」(bleague.jp/glossary/)に定義がある項目はその式を採用し、
// 公式に定義がない項目のみNBA/Basketball-Reference流の一般的な式で補う。
//
// scripts/（バックエンド集計）・src/（フロントエンドのシチュエーション別再集計）の両方から
// 参照する共通モジュール。数値がズレないよう、この1箇所だけを正とする。

export function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** EFG% = (FGM + 0.5*3PM) / FGA。公式定義と一致（DESIGN.md 6章） */
export function efgPct(fgm: number, threePm: number, fga: number): number {
  return safeDiv(fgm + 0.5 * threePm, fga);
}

/** TS% = PTS / (2*(FGA + 0.44*FTA))。公式定義と一致（DESIGN.md 6章） */
export function tsPct(pts: number, fga: number, fta: number): number {
  return safeDiv(pts, 2 * (fga + 0.44 * fta));
}

/** FTR = FTA / FGA。公式に定義がないためNBA流を採用（DESIGN.md 6章） */
export function ftRate(fta: number, fga: number): number {
  return safeDiv(fta, fga);
}

/** ORB% = 100 * TeamOREB / (TeamOREB + OppDREB)。公式に定義がないためNBA流を採用 */
export function orbPct(teamOreb: number, oppDreb: number): number {
  return safeDiv(100 * teamOreb, teamOreb + oppDreb);
}

/**
 * TOV% = 100 * TOV / (FGA + 0.44*FTA + TOV)。Four Factorsの標準定義（Basketball-Reference等）。
 * 「関与したプレー全体に占めるターンオーバーの割合」で、AST/TOV（分母にASTを含む別の比率）とは
 * 別の指標として併存させる（ボックススコアのTOV RATIO列と混同しないこと）
 */
export function tovPct(tov: number, fga: number, fta: number): number {
  return safeDiv(100 * tov, fga + 0.44 * fta + tov);
}

export interface PossessionTotals {
  fga: number;
  fgm: number;
  fta: number;
  oreb: number;
  dreb: number;
  tov: number;
}

/**
 * Bリーグ公式のポゼッション推定式（DESIGN.md 6章）。自チーム視点の推定と相手チーム視点の推定を
 * 平均する精密な式。以前実装していた簡易式（FGA-OREB+TOV+0.44*FTA）から置き換え。
 *   POSS = 0.5 * [ (FGA + 0.4*FTA - 1.07*(OR/(OR+相手DR))*(FGA-FGM) + TO)
 *                 + (被FGA + 0.4*被FTA - 1.07*(被OR/(被OR+DR))*(被FGA-被FGM) + 被TO) ]
 */
export function estimatedPossessions(team: PossessionTotals, opponent: PossessionTotals): number {
  const teamEstimate =
    team.fga +
    0.4 * team.fta -
    1.07 * safeDiv(team.oreb, team.oreb + opponent.dreb) * (team.fga - team.fgm) +
    team.tov;
  const opponentEstimate =
    opponent.fga +
    0.4 * opponent.fta -
    1.07 * safeDiv(opponent.oreb, opponent.oreb + team.dreb) * (opponent.fga - opponent.fgm) +
    opponent.tov;
  return 0.5 * (teamEstimate + opponentEstimate);
}

/** ORtg/DRtg = 100 * PTS / POSS（公式定義と一致。DRtgは相手PTSを渡して計算する） */
export function offensiveRating(pts: number, poss: number): number {
  return safeDiv(100 * pts, poss);
}

/** PACE = 試合時間(40分) * POSS / (プレイタイム合計/5)。公式定義と一致（DESIGN.md 6章） */
export function pace(teamPoss: number, teamMinutesTotal: number, gameMinutes = 40): number {
  return safeDiv(gameMinutes * teamPoss, teamMinutesTotal / 5);
}

export interface EffTotals {
  pts: number;
  ast: number;
  blk: number;
  stl: number;
  reb: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  foulsDrawn: number;
  blockedAgainst: number;
  /**
   * テクニカルファウル数（選手個人＝ActionCD1=24。チーム集計時はHC/ベンチテクニカル
   * ActionCD1=20/21も含む）。公式EFFはテクニカルファウルを通常のパーソナル/オフェンス
   * ファウルの2倍の重みで減点しているため、`pf`（ボックススコアのFOULフィールド、
   * 全ファウル種別を1件=1として合算した値）とは別に持つ必要がある。詳細はeff()のコメント参照
   */
  technicalFouls: number;
}

/**
 * Bリーグ公式EFF（貢献度）。Game Score（NBA流の代替案）の代わりにこちらを採用する。
 * 年度で式が異なる（DESIGN.md 6章）。戻り値は常に「1試合あたり」の値（totals×gamesPlayedで
 * 割って揃えている。2019-20以前の式はもともと試合数で割る定義のため、この関数内で統一する）。
 *
 * - 2020-21シーズン以降: (PTS+AS+BS+ST+FD+TR) - (TO+BSR+F+TF) - (FGA-FGM) - (FTA-FTM)
 *   ※ (2FGA-2FGM)+(3FGA-3FGM) は代数的に (FGA-FGM)（2P/3P合算値）と同じなので、
 *     内訳を分けて集計しなくても2P/3P合算のfgm/fgaでそのまま計算できる
 *   ※ **TF（テクニカルファウルの追加減点）は2026-08-16にB.ONEの35試合検証で発見した項**。
 *     ボックススコアの`FOUL`（=pf）フィールドはテクニカルファウルも通常のパーソナル/
 *     オフェンスファウルと同じ「1」としてカウントするが、GeniusAPI生データの公式`EFF`値と
 *     突き合わせたところ、テクニカルファウル1回につき公式値は`pf`だけを引いた場合より
 *     さらに1多く減点していた（＝テクニカルファウルは実質「2」として重み付けされている）。
 *     `technicalFouls`（ActionCD1=24で個別に検出した回数）をpfに加算することで再現する。
 *     この不一致はB.PREMIER側の1試合53人検証（低頻度事象のテクニカルファウルがサンプルに
 *     たまたま出現しなかった）では見つからず、B.ONEの35試合・768人規模の検証で初めて発覚した。
 *     B.PREMIER側にも同じ式が使われていたため、本修正はB.PREMIER全シーズンに影響する
 *     （DESIGN.md 14-6章）
 * - 2019-20シーズン以前: ((PTS+TR+AS+ST+BS) - (FGA-FGM) - (FTA-FTM) - TO) / 試合数
 *   ※ この年代の式はもともとF（ファウル）の項が無いため、テクニカルファウルの重み付けは
 *     無関係（technicalFoulsは2020-21以降の分岐でのみ使用する）
 *
 * 2026-27シーズンのみを扱う現時点では前者の分岐しか使わないが、Phase 5の過去シーズン
 * バックフィル時にそのまま使えるよう分岐を用意してある。
 */
export function eff(seasonStartYear: number, totals: EffTotals, gamesPlayed: number): number {
  const missedFg = totals.fga - totals.fgm;
  const missedFt = totals.fta - totals.ftm;

  if (seasonStartYear >= 2020) {
    const total =
      totals.pts +
      totals.ast +
      totals.blk +
      totals.stl +
      totals.foulsDrawn +
      totals.reb -
      (totals.tov + totals.blockedAgainst + totals.pf + totals.technicalFouls) -
      missedFg -
      missedFt;
    return safeDiv(total, gamesPlayed);
  }

  return safeDiv(
    totals.pts + totals.reb + totals.ast + totals.stl + totals.blk - missedFg - missedFt - totals.tov,
    gamesPlayed,
  );
}

/**
 * Usage% = 100 * ((FGA + 0.44*FTA + TOV) * (TeamMIN/5)) / (MIN * (TeamFGA + 0.44*TeamFTA + TeamTOV))。
 * 公式に定義がないためNBA流を採用（DESIGN.md 6章）。GeniusAPI生データの個人USGフィールドと
 * 一致することを確認済み（複数選手・1試合分で検証）
 */
export function usagePct(
  player: { fga: number; fta: number; tov: number; min: number },
  team: { fga: number; fta: number; tov: number; min: number },
): number {
  const numerator = (player.fga + 0.44 * player.fta + player.tov) * (team.min / 5);
  const denominator = player.min * (team.fga + 0.44 * team.fta + team.tov);
  return safeDiv(100 * numerator, denominator);
}

/** MM:SS または "DNP" 形式のPlayTimeを分（小数）に変換する */
export function parsePlayTime(playTime: string): number {
  const match = /^(\d+):(\d{2})$/.exec(playTime);
  if (!match) return 0;
  return Number(match[1]) + Number(match[2]) / 60;
}

// ---- PER（Hollinger方式、NBA/Basketball-Reference流。公式に定義が無いためNBA流を採用） ----
//
// Bリーグ公式にPERに相当する指標が無いため、NBA/Basketball-Reference流のuPER→PERの2段階計算を
// そのまま採用する。公式の照合値が存在しない指標のため、検証は「リーグ全体を出場時間で加重平均
// するとちょうど15になる」という計算方法自体の性質を使う（aggregate.tsのコメント参照）。

export interface PerLeagueTotals {
  ast: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  pts: number;
  oreb: number;
  /** TRB（総リバウンド）。StatTotalsの`reb`に対応 */
  trb: number;
  tov: number;
  pf: number;
}

export interface PerConstants {
  factor: number;
  vop: number;
  drbp: number;
}

/** uPER計算で使うリーグ全体の定数（factor/VOP/DRBP）を、シーズン全チーム合計値から算出する */
export function perConstants(lg: PerLeagueTotals): PerConstants {
  const factor = 2 / 3 - safeDiv(0.5 * safeDiv(lg.ast, lg.fgm), 2 * safeDiv(lg.fgm, lg.ftm));
  const vop = safeDiv(lg.pts, lg.fga - lg.oreb + lg.tov + 0.44 * lg.fta);
  const drbp = safeDiv(lg.trb - lg.oreb, lg.trb);
  return { factor, vop, drbp };
}

export interface PerPlayerTotals {
  min: number;
  tpm: number;
  ast: number;
  fgm: number;
  fga: number;
  ftm: number;
  fta: number;
  tov: number;
  trb: number;
  oreb: number;
  stl: number;
  blk: number;
  pf: number;
}

/**
 * uPER（ペース調整・リーグ平均15への正規化を行う前の、1分あたりの粗い効率値）。
 * teamAstFgRatioはその選手が所属するチームのシーズン合計AST/FG。出場時間0の選手は
 * 1/MPが定義できないため0を返す（呼び出し側でシーズン未出場選手を除外する必要はない）
 */
export function uPer(
  totals: PerPlayerTotals,
  teamAstFgRatio: number,
  lg: PerLeagueTotals,
  constants: PerConstants,
): number {
  if (totals.min <= 0) return 0;
  const { factor, vop, drbp } = constants;
  const raw =
    totals.tpm +
    (2 / 3) * totals.ast +
    (2 - factor * teamAstFgRatio) * totals.fgm +
    totals.ftm * 0.5 * (1 + (1 - teamAstFgRatio) + (2 / 3) * teamAstFgRatio) -
    vop * totals.tov -
    vop * drbp * (totals.fga - totals.fgm) -
    vop * 0.44 * (0.44 + 0.56 * drbp) * (totals.fta - totals.ftm) +
    vop * (1 - drbp) * (totals.trb - totals.oreb) +
    vop * drbp * totals.oreb +
    vop * totals.stl +
    vop * drbp * totals.blk -
    totals.pf * (safeDiv(lg.ftm, lg.pf) - 0.44 * safeDiv(lg.fta, lg.pf) * vop);
  return raw / totals.min;
}

/**
 * uPERにペース調整とリーグ平均15への正規化を適用し、最終的なPERにする。
 * PER = uPER × (lgPace/teamPace) × (15/lgAvgUPER)
 */
export function finalizePer(uPerValue: number, teamPace: number, lgPace: number, lgAvgUPer: number): number {
  return uPerValue * safeDiv(lgPace, teamPace) * safeDiv(15, lgAvgUPer);
}

// ---- 個人ORtg/DRtg（Dean Oliver方式、NBA.com/Basketball-Reference流） ----
//
// 出典: https://www.basketball-reference.com/about/ratings.html
// Bリーグ公式に個人単位のORtg/DRtgの定義が無いため、この一次資料の計算式をそのまま採用する
// （簡易な独自式は使わない方針。ユーザー指示によりオンコート区間ベースの旧実装から置き換えた。
// DESIGN.md参照）。基本ボックススコアのみで計算できるためPlayByPlaysには依存しない
// （PACEのみ別途オンコート区間ベースのまま残す）。

/**
 * qAST（アシスト貢献の重み）の第2項の分母 (Team_FGM/Team_MP)*MP*5 - FGM は、出場時間が
 * 極端に短い選手でたまたま0に極めて近い値になることがあり、safeDiv()（完全な0のみガード）
 * では防げない数値不安定性がある（例: 2025-26シーズン実データで2:35出場・FGM=2の選手が
 * PProd=-1551という非現実的な値になったケースを検証で発見）。Basketball-Referenceの式自体に
 * 内在する既知の弱点で、この項の分母が0近傍になるリスクは出場時間が短いほど高いことを
 * 実データ（2025-26シーズン全試合）で確認した（4分未満で最大|PProd|が55.6〜1551.2と暴れるのに
 * 対し、4分以上では39.3以下に収まる）。ユーザー承認の上、この閾値未満はORtg/DRtg/NetRtgとも
 * 「算出不能」（undefined）として扱う
 */
const MIN_MINUTES_FOR_INDIVIDUAL_RATING = 4;

/** 個人・チーム・相手チームいずれも同じ形の基本ボックススコア入力（分＝MPは小数分） */
export interface OliverBoxStats {
  min: number;
  fgm: number;
  fga: number;
  fg3m: number;
  ftm: number;
  fta: number;
  pts: number;
  ast: number;
  oreb: number;
  dreb: number;
  tov: number;
  stl: number;
  blk: number;
  pf: number;
}

interface OliverTeamContext {
  teamScoringPoss: number;
  teamOrbPct: number;
  teamPlayPct: number;
  teamOrbWeight: number;
}

function oliverTeamContext(team: OliverBoxStats, opponent: OliverBoxStats): OliverTeamContext {
  const teamScoringPoss = team.fgm + (1 - (1 - safeDiv(team.ftm, team.fta)) ** 2) * team.fta * 0.4;
  const teamOrbPct = safeDiv(team.oreb, team.oreb + opponent.dreb);
  const teamPlayPct = safeDiv(teamScoringPoss, team.fga + team.fta * 0.4 + team.tov);
  const teamOrbWeight = safeDiv(
    (1 - teamOrbPct) * teamPlayPct,
    (1 - teamOrbPct) * teamPlayPct + teamOrbPct * (1 - teamPlayPct),
  );
  return { teamScoringPoss, teamOrbPct, teamPlayPct, teamOrbWeight };
}

interface OliverOffenseBreakdown {
  /** PProd（個人の得点貢献推定値）。検証用に単独でも公開する（individualPointsProduced参照） */
  pprod: number;
  /** TotPoss（個人の推定得点機会数）。ORtgの分母 */
  totPoss: number;
}

/**
 * 個人ORtgの内部計算。分母が0になりうる箇所（FGA=0・FTA=0・Team_FGA=Player_FGA等）は
 * すべてsafeDiv()でガードする（0を返す＝その項の寄与を0にする）。出場時間0の場合はundefinedを返す
 */
function oliverOffenseBreakdown(
  player: OliverBoxStats,
  team: OliverBoxStats,
  opponent: OliverBoxStats,
): OliverOffenseBreakdown | undefined {
  if (player.min < MIN_MINUTES_FOR_INDIVIDUAL_RATING) return undefined;
  const { teamScoringPoss, teamOrbPct, teamPlayPct, teamOrbWeight } = oliverTeamContext(team, opponent);

  const rawQAst =
    safeDiv(player.min, team.min / 5) * (1.14 * safeDiv(team.ast - player.ast, team.fgm)) +
    safeDiv(
      safeDiv(team.ast, team.min) * player.min * 5 - player.ast,
      safeDiv(team.fgm, team.min) * player.min * 5 - player.fgm,
    ) *
      (1 - safeDiv(player.min, team.min / 5));
  // qAstの第2項の分母は、出場時間がMIN_MINUTES_FOR_INDIVIDUAL_RATING以上でもたまたま0近傍に
  // なることがあり（実データで4分・5分超の選手でもPProdが数百〜千規模に暴走するケースを検証で
  // 発見）、safeDiv()は完全な0のみガードするため防げない。qAstは本来「アシストされた割合」を
  // 表す値で概ね0〜1.2程度に収まる（2025-26シーズン実データ、出場10分以上の選手13,631人分で
  // p1=0.32・p99=1.17・最大3.13）ため、この範囲を大きく外れる値は分母近傍0による暴走とみなし
  // クランプする（ユーザー承認済み: 出場時間ガードに加えた追加の安全策。DESIGN.md参照）
  const qAst = Math.max(-0.5, Math.min(2, rawQAst));

  const fgPart = player.fgm * (1 - 0.5 * safeDiv(player.pts - player.ftm, 2 * player.fga) * qAst);
  const astPart =
    0.5 * safeDiv(team.pts - team.ftm - (player.pts - player.ftm), 2 * (team.fga - player.fga)) * player.ast;
  const ftPart = (1 - (1 - safeDiv(player.ftm, player.fta)) ** 2) * 0.4 * player.fta;
  const orbPart = player.oreb * teamOrbWeight * teamPlayPct;

  const orbAdjust = safeDiv(team.oreb, teamScoringPoss) * teamOrbWeight * teamPlayPct;
  const scPoss = (fgPart + astPart + ftPart) * (1 - orbAdjust) + orbPart;

  const fgxPoss = (player.fga - player.fgm) * (1 - 1.07 * teamOrbPct);
  const ftxPoss = (1 - safeDiv(player.ftm, player.fta)) ** 2 * 0.4 * player.fta;
  const totPoss = scPoss + fgxPoss + ftxPoss + player.tov;

  const pprodFgPart =
    2 * (player.fgm + 0.5 * player.fg3m) * (1 - 0.5 * safeDiv(player.pts - player.ftm, 2 * player.fga) * qAst);
  const pprodAstPart =
    2 *
    safeDiv(team.fgm - player.fgm + 0.5 * (team.fg3m - player.fg3m), team.fgm - player.fgm) *
    0.5 *
    safeDiv(team.pts - team.ftm - (player.pts - player.ftm), 2 * (team.fga - player.fga)) *
    player.ast;
  const pprodOrbPart = player.oreb * teamOrbWeight * teamPlayPct * safeDiv(team.pts, teamScoringPoss);
  const pprod = (pprodFgPart + pprodAstPart + player.ftm) * (1 - orbAdjust) + pprodOrbPart;

  return { pprod, totPoss };
}

/**
 * 個人ORtg = 100 * PProd / TotPoss（Dean Oliver方式）。TotPoss（推定得点機会数）が0以下、
 * または出場時間0の場合は「算出不能」としてundefinedを返す（0点ではなく非表示にするため。
 * 呼び出し側で「-」表示にする）
 */
export function individualOffRtg(
  player: OliverBoxStats,
  team: OliverBoxStats,
  opponent: OliverBoxStats,
): number | undefined {
  const breakdown = oliverOffenseBreakdown(player, team, opponent);
  if (!breakdown || breakdown.totPoss <= 0) return undefined;
  return 100 * (breakdown.pprod / breakdown.totPoss);
}

/**
 * PProd（個人の得点貢献推定値、Dean Oliver方式）。1試合の全選手分を合算すると、そのチームの
 * 実際の得点（PTS）に近い値になるはずという設計上の性質があり、この式の妥当性を間接検証する
 * ために使う（scripts/validate-oliver-ratings.ts参照）。出場時間0の場合はundefinedを返す
 */
export function individualPointsProduced(
  player: OliverBoxStats,
  team: OliverBoxStats,
  opponent: OliverBoxStats,
): number | undefined {
  return oliverOffenseBreakdown(player, team, opponent)?.pprod;
}

/**
 * 個人DRtg（Dean Oliver方式）。teamPossessionsは既存のPOSS推定値（estimatedPossessions()、
 * 自チーム視点の推定値）をそのまま渡す。出場時間0の場合はundefinedを返す
 */
export function individualDefRtg(
  player: OliverBoxStats,
  team: OliverBoxStats,
  opponent: OliverBoxStats,
  teamPossessions: number,
): number | undefined {
  // DRtg式自体にはORtgのqASTのような分母近傍0の不安定性は無いが、ORtgと同じ基準で
  // 出場時間の短い選手を一律「算出不能」にする（ユーザー承認済み。DESIGN.md参照）
  if (player.min < MIN_MINUTES_FOR_INDIVIDUAL_RATING) return undefined;

  const dorPct = safeDiv(opponent.oreb, opponent.oreb + team.dreb);
  const dfgPct = safeDiv(opponent.fgm, opponent.fga);
  const fmWeight = safeDiv(dfgPct * (1 - dorPct), dfgPct * (1 - dorPct) + (1 - dfgPct) * dorPct);

  const stops1 = player.stl + player.blk * fmWeight * (1 - 1.07 * dorPct) + player.dreb * (1 - fmWeight);
  const stops2 =
    (safeDiv(opponent.fga - opponent.fgm - team.blk, team.min) * fmWeight * (1 - 1.07 * dorPct) +
      safeDiv(opponent.tov - team.stl, team.min)) *
      player.min +
    safeDiv(player.pf, team.pf) * 0.4 * opponent.fta * (1 - safeDiv(opponent.ftm, opponent.fta)) ** 2;
  const stops = stops1 + stops2;

  const teamDefensiveRating = 100 * safeDiv(opponent.pts, teamPossessions);
  const dPtsPerScPoss = safeDiv(
    opponent.pts,
    opponent.fgm + (1 - (1 - safeDiv(opponent.ftm, opponent.fta)) ** 2) * opponent.fta * 0.4,
  );
  const stopPct = safeDiv(stops * opponent.min, teamPossessions * player.min);

  return teamDefensiveRating + 0.2 * (100 * dPtsPerScPoss * (1 - stopPct) - teamDefensiveRating);
}
