// 1試合行の索引（data/{season}/player-game-index.json.gz・team-game-index.json.gz。形式は shared/gameIndex.ts、DESIGN.md 219章）の行を読む。
// ランキングの1試合記録の条件・昇順・連続記録などが使う。
// 集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。ファイルの読み込みは gameIndexLoad.ts（ここは通信を含まない純粋な部分。検証スクリプトからも使う）。
//
// 行を1件ずつオブジェクトにすると多い（全シーズンで選手 約13万行）ので、読み込んだ列はそのまま持ち、必要な行だけ playerGameAt・teamGameAt で
// オブジェクトにする。出場時間は分（秒÷60）に戻す。算出できない列（view.unavailable）は、行では 0 のままなので、条件や昇順では対象から外すこと。
// ルーキーは索引に無い。ルーキーのシーズンと選手の対応（rookie-eligibility.json）と突き合わせる（rookieOfIndex）。

import {
  GAME_FLAG_PLAYOFF,
  GAME_FLAG_SHORT,
  GAME_INDEX_VERSION,
  ROW_FLAG_HOME,
  ROW_FLAG_STARTER,
  type IndexTeam,
  type PlayerGameIndexFile,
  type TeamGameIndexFile,
} from "../../shared/gameIndex";
import { ageOnDate, type AgeOnDate } from "../../shared/gameAge";
import type { Division, GameType, RookieEligibilityFile } from "../../shared/types";

/** 索引ファイルの版が合うか（版が新しい・壊れたファイルは使わない） */
export function isSupportedGameIndex(file: { version?: unknown; rows?: unknown; games?: unknown } | null | undefined): boolean {
  return !!file && file.version === GAME_INDEX_VERSION && !!file.rows && !!file.games;
}

/** 選手の1試合（索引の1行）。PlayerGameLog と同じ項目名（索引にある項目だけ）に、シーズン・選手・チームの情報を添えたもの */
export interface IndexedPlayerGame {
  season: string;
  scheduleKey: string;
  date: string;
  gameType: GameType;
  /** 前後半5分の特別な試合（2016-17・2017-18のCS）か */
  shortGame: boolean;
  playerId: string;
  playerName: string;
  /** 当時のポジション（無ければ ""）と、補い方（"" 当時の値／"near" 近いシーズンの値／"current" 現在の値） */
  position: string;
  positionFallback: "" | "near" | "current";
  birthDate: string;
  classKey: "jp" | "intl" | "";
  teamId: string;
  teamName: string;
  teamDivision: Division | "";
  opponentTeamId: string;
  opponentTeamName: string;
  opponentDivision: Division | "";
  isHome: boolean;
  isStarter: boolean;
  win: boolean;
  teamScore: number;
  opponentScore: number;
  /** 所属チームから見た最終点差（勝てば正） */
  finalMargin: number;
  overtimes: number;
  /** 試合中の最大リード・最大ビハインド（プレーバイプレーが無い試合は undefined） */
  maxLead?: number;
  maxDeficit?: number;
  min: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  blockedAgainst: number;
  foulsDrawn: number;
  plusMinus: number;
  pt2in: number;
  ptfb: number;
  pt2nd: number;
  ptsOffTov: number;
  dunks: number;
  basketCounts: number;
  pf: number;
  technicalFouls: number;
  unsportsmanlikeFouls: number;
}

export interface PlayerGameIndexView {
  season: string;
  file: PlayerGameIndexFile;
  /** 行の数 */
  size: number;
  unavailable: ReadonlySet<string>;
}

export function viewPlayerGameIndex(file: PlayerGameIndexFile): PlayerGameIndexView {
  return { season: file.season, file, size: file.rows.player.length, unavailable: new Set(file.unavailable) };
}

function teamOf(teams: IndexTeam[], i: number): IndexTeam {
  const t = teams[i];
  if (!t) throw new Error(`チーム辞書に番号 ${i} がありません`);
  return t;
}

/** i行目の選手の1試合 */
export function playerGameAt(view: PlayerGameIndexView, i: number): IndexedPlayerGame {
  const { file } = view;
  const { rows, games, teams, players } = file;
  const g = rows.game[i]!;
  const p = players[rows.player[i]!]!;
  const flags = rows.flags[i]!;
  const isHome = (flags & ROW_FLAG_HOME) !== 0;
  const own = teamOf(teams, isHome ? games.home[g]! : games.away[g]!);
  const opp = teamOf(teams, isHome ? games.away[g]! : games.home[g]!);
  const teamScore = isHome ? games.homeScore[g]! : games.awayScore[g]!;
  const opponentScore = isHome ? games.awayScore[g]! : games.homeScore[g]!;
  const lead = isHome ? games.homeMaxLead[g]! : games.awayMaxLead[g]!;
  const deficit = isHome ? games.awayMaxLead[g]! : games.homeMaxLead[g]!;
  const s = rows.stats;
  return {
    season: file.season,
    scheduleKey: games.key[g]!,
    date: games.date[g]!,
    gameType: (games.flags[g]! & GAME_FLAG_PLAYOFF) !== 0 ? "playoff" : "regular",
    shortGame: (games.flags[g]! & GAME_FLAG_SHORT) !== 0,
    playerId: p[0],
    playerName: p[1],
    position: p[2],
    positionFallback: p[3],
    birthDate: p[4],
    classKey: p[5],
    teamId: own[0],
    teamName: own[1],
    teamDivision: own[2],
    opponentTeamId: opp[0],
    opponentTeamName: opp[1],
    opponentDivision: opp[2],
    isHome,
    isStarter: (flags & ROW_FLAG_STARTER) !== 0,
    win: teamScore > opponentScore,
    teamScore,
    opponentScore,
    finalMargin: teamScore - opponentScore,
    overtimes: games.overtimes[g]!,
    ...(lead >= 0 && deficit >= 0 ? { maxLead: lead, maxDeficit: deficit } : {}),
    min: s.minSec[i]! / 60,
    pts: s.pts[i]!,
    fgm: s.fgm[i]!,
    fga: s.fga[i]!,
    tpm: s.tpm[i]!,
    tpa: s.tpa[i]!,
    ftm: s.ftm[i]!,
    fta: s.fta[i]!,
    oreb: s.oreb[i]!,
    dreb: s.dreb[i]!,
    reb: s.reb[i]!,
    ast: s.ast[i]!,
    tov: s.tov[i]!,
    stl: s.stl[i]!,
    blk: s.blk[i]!,
    blockedAgainst: s.blockedAgainst[i]!,
    foulsDrawn: s.foulsDrawn[i]!,
    plusMinus: s.plusMinus[i]!,
    pt2in: s.pt2in[i]!,
    ptfb: s.ptfb[i]!,
    pt2nd: s.pt2nd[i]!,
    ptsOffTov: s.ptsOffTov[i]!,
    dunks: s.dunks[i]!,
    basketCounts: s.basketCounts[i]!,
    pf: s.pf[i]!,
    technicalFouls: s.technicalFouls[i]!,
    unsportsmanlikeFouls: s.unsportsmanlikeFouls[i]!,
  };
}

/** 試合当日の年齢（生年月日が無ければ null） */
export function playerAgeAt(view: PlayerGameIndexFile | PlayerGameIndexView, i: number): AgeOnDate | null {
  const file = "file" in view ? view.file : view;
  const p = file.players[file.rows.player[i]!]!;
  return ageOnDate(p[4], file.games.date[file.rows.game[i]!]!);
}

/** そのシーズンにルーキーの選手か（rookie-eligibility.json との突き合わせ。2016-17は判定できないので false） */
export function rookieOfIndex(rookies: RookieEligibilityFile | null | undefined, season: string, playerId: string): boolean {
  return !!rookies?.seasons[season]?.includes(playerId);
}

/** チームの1試合（索引の1行）。TeamGameLog と同じ項目名（索引にある項目だけ）。被記録の opponentXxx は、同じ試合の相手の行から作る */
export interface IndexedTeamGame {
  season: string;
  scheduleKey: string;
  date: string;
  gameType: GameType;
  shortGame: boolean;
  teamId: string;
  teamName: string;
  teamDivision: Division | "";
  opponentTeamId: string;
  opponentTeamName: string;
  opponentDivision: Division | "";
  isHome: boolean;
  win: boolean;
  teamScore: number;
  opponentScore: number;
  finalMargin: number;
  overtimes: number;
  maxLead?: number;
  maxDeficit?: number;
  /** 1Q〜4Qの自チーム・相手の得点。前後半5分の特別な試合は undefined。補えなかった区間は null */
  periodPoints?: (number | null)[];
  opponentPeriodPoints?: (number | null)[];
  periodPointsFromPbp?: number[];
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  pf: number;
  fb: number;
  pt2in: number;
  pft: number;
  pt2nd: number;
  foulsDrawn: number;
  dunks: number;
  benchPoints: number;
  starterPoints: number;
  /** 未計測は undefined */
  attendance?: number;
  japanesePoints: number;
  foreignPoints: number;
  naturalizedOrAsianPoints: number;
  opponentFgm: number;
  opponentFga: number;
  opponentTpm: number;
  opponentTpa: number;
  opponentFtm: number;
  opponentFta: number;
  opponentOreb: number;
  opponentDreb: number;
  opponentAst: number;
  opponentTov: number;
  opponentStl: number;
  opponentBlk: number;
  opponentPf: number;
  opponentFb: number;
  opponentPt2in: number;
  opponentPft: number;
  opponentPt2nd: number;
  opponentFoulsDrawn: number;
  opponentDunks: number;
}

export interface TeamGameIndexView {
  season: string;
  file: TeamGameIndexFile;
  /** 行の数（試合の数×2） */
  size: number;
  unavailable: ReadonlySet<string>;
  periodsFromPbp: ReadonlyMap<number, number[]>;
}

export function viewTeamGameIndex(file: TeamGameIndexFile): TeamGameIndexView {
  return {
    season: file.season,
    file,
    size: file.games.key.length * 2,
    unavailable: new Set(file.unavailable),
    periodsFromPbp: new Map(file.rows.periodsFromPbp),
  };
}

/** i行目のチームの1試合（行の位置は 試合の番号×2＋(ホーム 0／アウェイ 1)） */
export function teamGameAt(view: TeamGameIndexView, i: number): IndexedTeamGame {
  const { file } = view;
  const { games, teams } = file;
  const s = file.rows.stats;
  const g = i >> 1;
  const isHome = (i & 1) === 0;
  const j = i ^ 1; // 同じ試合の相手の行
  const own = teamOf(teams, isHome ? games.home[g]! : games.away[g]!);
  const opp = teamOf(teams, isHome ? games.away[g]! : games.home[g]!);
  const teamScore = isHome ? games.homeScore[g]! : games.awayScore[g]!;
  const opponentScore = isHome ? games.awayScore[g]! : games.homeScore[g]!;
  const lead = isHome ? games.homeMaxLead[g]! : games.awayMaxLead[g]!;
  const deficit = isHome ? games.awayMaxLead[g]! : games.homeMaxLead[g]!;
  const quarters = (a: "p1" | "o1"): (number | null)[] | undefined => {
    const cols = a === "p1" ? ([s.p1, s.p2, s.p3, s.p4] as const) : ([s.o1, s.o2, s.o3, s.o4] as const);
    if (cols.every((c) => c[i]! < 0)) return undefined; // 前後半5分の特別な試合
    return cols.map((c) => (c[i]! < 0 ? null : c[i]!));
  };
  const periodPoints = quarters("p1");
  const opponentPeriodPoints = quarters("o1");
  const fromPbp = view.periodsFromPbp.get(i);
  const attendance = s.attendance[i]!;
  return {
    season: file.season,
    scheduleKey: games.key[g]!,
    date: games.date[g]!,
    gameType: (games.flags[g]! & GAME_FLAG_PLAYOFF) !== 0 ? "playoff" : "regular",
    shortGame: (games.flags[g]! & GAME_FLAG_SHORT) !== 0,
    teamId: own[0],
    teamName: own[1],
    teamDivision: own[2],
    opponentTeamId: opp[0],
    opponentTeamName: opp[1],
    opponentDivision: opp[2],
    isHome,
    win: teamScore > opponentScore,
    teamScore,
    opponentScore,
    finalMargin: teamScore - opponentScore,
    overtimes: games.overtimes[g]!,
    ...(lead >= 0 && deficit >= 0 ? { maxLead: lead, maxDeficit: deficit } : {}),
    ...(periodPoints ? { periodPoints } : {}),
    ...(opponentPeriodPoints ? { opponentPeriodPoints } : {}),
    ...(fromPbp ? { periodPointsFromPbp: fromPbp } : {}),
    fgm: s.fgm[i]!,
    fga: s.fga[i]!,
    tpm: s.tpm[i]!,
    tpa: s.tpa[i]!,
    ftm: s.ftm[i]!,
    fta: s.fta[i]!,
    oreb: s.oreb[i]!,
    dreb: s.dreb[i]!,
    reb: s.reb[i]!,
    ast: s.ast[i]!,
    tov: s.tov[i]!,
    stl: s.stl[i]!,
    blk: s.blk[i]!,
    pf: s.pf[i]!,
    fb: s.fb[i]!,
    pt2in: s.pt2in[i]!,
    pft: s.pft[i]!,
    pt2nd: s.pt2nd[i]!,
    foulsDrawn: s.foulsDrawn[i]!,
    dunks: s.dunks[i]!,
    benchPoints: s.benchPoints[i]!,
    starterPoints: s.starterPoints[i]!,
    ...(attendance >= 0 ? { attendance } : {}),
    japanesePoints: s.japanesePoints[i]!,
    foreignPoints: s.foreignPoints[i]!,
    naturalizedOrAsianPoints: s.naturalizedOrAsianPoints[i]!,
    opponentFgm: s.fgm[j]!,
    opponentFga: s.fga[j]!,
    opponentTpm: s.tpm[j]!,
    opponentTpa: s.tpa[j]!,
    opponentFtm: s.ftm[j]!,
    opponentFta: s.fta[j]!,
    opponentOreb: s.oreb[j]!,
    opponentDreb: s.dreb[j]!,
    opponentAst: s.ast[j]!,
    opponentTov: s.tov[j]!,
    opponentStl: s.stl[j]!,
    opponentBlk: s.blk[j]!,
    opponentPf: s.pf[j]!,
    opponentFb: s.fb[j]!,
    opponentPt2in: s.pt2in[j]!,
    opponentPft: s.pft[j]!,
    opponentPt2nd: s.pt2nd[j]!,
    opponentFoulsDrawn: s.foulsDrawn[j]!,
    opponentDunks: s.dunks[j]!,
  };
}
