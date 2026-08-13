// data/{season}/games/*.json（生データ）から teams.json / players.json を再生成する。
// 生データを正とし、集計は都度作り直す（DESIGN.md 5章）。ティアAの基本＋一部アドバンスドスタッツが対象。
//
// 使い方: npm run aggregate -- --season 2025-26

import path from "node:path";
import { DATA_DIR, readAllGames, readJson, writeJson } from "./lib/storage.ts";
import { eff, efgPct, ftRate, offensiveRating, orbPct, pace, parsePlayTime, safeDiv, tsPct, usagePct } from "../shared/formulas.ts";
import { reconstructOnCourt } from "../shared/onCourt.ts";
import { teamDivision } from "./lib/divisions.ts";
import type {
  BoxscoreRow,
  Division,
  HeadToHeadRecord,
  HeadToHeadTeamRow,
  LineupAggregate,
  PlayerGameLog,
  PlayerMasterEntry,
  StandingsSnapshot,
  StandingsTeamSnapshot,
  StoredGame,
  TeamGameLog,
  TeamLineupsFile,
} from "../shared/types.ts";
import { isMainModule } from "./lib/isMain.ts";

interface StatTotals {
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
  /** ファウルドローン（相手にファウルを誘発した回数）。EFF計算のFDに対応 */
  foulsDrawn: number;
  /** 被ブロック数。EFF計算のBSRに対応 */
  blockedAgainst: number;
  /**
   * 推定ポゼッション。GeniusAPI生データのチーム行に含まれる公式POSS値をそのまま合算する
   * （自チーム/相手チーム行で同一値であることを確認済み。formulas.tsのestimatedPossessions()で
   * シーズン合計値から再計算すると比率項の非線形性で誤差が出るため、生値の合算を採用する）。
   * 個人行にはPOSSが存在しないため選手集計では常に0のまま
   */
  poss: number;
  /**
   * 個人+/-。生データのPLUSMINUS値をそのまま合算する（Bリーグ公式フィールド。DESIGN.md 2-2章で
   * フィールドの存在自体は確認済みだったが未活用だった。POSS等と同様、算出ロジックの
   * 再実装は不要）。チーム合計行（Category=3）にはPLUSMINUSが存在しないため
   * チーム集計では常に0のまま
   */
  plusMinus: number;
  /**
   * 出場した試合における「その試合のチーム得失点差」の合計（オンコート/オフコート純得失点の
   * 算出用アキュムレータ。個人+/-＝オンコート純得失点そのものなので、この値からplusMinusを
   * 引けばオフコート純得失点になる）。チーム合計行（Category=3）を集計する際は常に0を渡すため
   * チーム集計では使わない
   */
  teamNetSum: number;
}

function emptyTotals(): StatTotals {
  return {
    gamesPlayed: 0,
    gamesStarted: 0,
    min: 0,
    pts: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    foulsDrawn: 0,
    blockedAgainst: 0,
    poss: 0,
    plusMinus: 0,
    teamNetSum: 0,
  };
}

function addBoxscoreRow(totals: StatTotals, row: BoxscoreRow, countGame: boolean, teamNetForGame: number): void {
  if (countGame) {
    totals.gamesPlayed += 1;
    totals.teamNetSum += teamNetForGame;
  }
  if (row.StartingFlg === 1) totals.gamesStarted += 1;
  totals.min += parsePlayTime(row.PlayTime);
  totals.pts += row.Point;
  totals.oreb += row.RB_OFF;
  totals.dreb += row.RB_DEF;
  totals.reb += row.RB_TOT;
  totals.ast += row.AS;
  totals.stl += row.ST;
  totals.blk += row.BS;
  totals.tov += row.TO;
  totals.pf += row.FOUL;
  totals.fgm += row.PT2M + row.PT3M;
  totals.fga += row.PT2A + row.PT3A;
  totals.tpm += row.PT3M;
  totals.tpa += row.PT3A;
  totals.ftm += row.FTM;
  totals.fta += row.FTA;
  totals.foulsDrawn += row.FOULON;
  totals.blockedAgainst += row.BSON;
  totals.poss += row.POSS ?? 0;
  totals.plusMinus += row.PLUSMINUS ?? 0;
}

function buildStatBlock(totals: StatTotals, seasonStartYear: number) {
  const gp = totals.gamesPlayed || 1; // 0除算防止（gamesPlayed=0ならperGameは全て0になる）
  return {
    gamesPlayed: totals.gamesPlayed,
    gamesStarted: totals.gamesStarted,
    totals,
    perGame: {
      min: totals.min / gp,
      pts: totals.pts / gp,
      oreb: totals.oreb / gp,
      dreb: totals.dreb / gp,
      reb: totals.reb / gp,
      ast: totals.ast / gp,
      stl: totals.stl / gp,
      blk: totals.blk / gp,
      tov: totals.tov / gp,
      pf: totals.pf / gp,
      plusMinus: totals.plusMinus / gp,
    },
    shooting: {
      fgPct: safeDiv(totals.fgm, totals.fga),
      tpPct: safeDiv(totals.tpm, totals.tpa),
      ftPct: safeDiv(totals.ftm, totals.fta),
      efgPct: efgPct(totals.fgm, totals.tpm, totals.fga),
      tsPct: tsPct(totals.pts, totals.fga, totals.fta),
      ftRate: ftRate(totals.fta, totals.fga),
    },
    advanced: {
      eff: eff(seasonStartYear, totals, gp),
    },
  };
}

interface PlayerAccumulator {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  totals: StatTotals;
  gameLogs: PlayerGameLog[];
}

interface TeamAccumulator {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  totals: StatTotals;
  opponentTotals: StatTotals;
  gameLogs: TeamGameLog[];
}

interface LineupAccumulator {
  playerIds: string[];
  secondsPlayed: number;
  netPoints: number;
  games: Set<string>;
}

function pickTeamRow(rows: BoxscoreRow[], category: 1 | 3): BoxscoreRow[] {
  return rows.filter((r) => r.Category === category && r.PeriodCategory === 18);
}

async function aggregateSeason(season: string): Promise<void> {
  const games = (await readAllGames(season)).filter((g) => g.gameEndedFlg);
  console.log(`[${season}] 集計対象: ${games.length}試合（終了済みのみ）`);

  // EFFの計算式は年度で異なる（DESIGN.md 6章）。シーズン文字列("2025-26")から開始年を取り出す
  const seasonStartYear = Number(season.split("-")[0]);

  // 選手マスタ（シーズン非依存。scrape-roster.tsが生成）。未生成でも集計自体は動く
  const playersMaster = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const masterById = new Map(playersMaster.map((p) => [p.playerId, p]));

  const players = new Map<string, PlayerAccumulator>();
  const teams = new Map<string, TeamAccumulator>();
  const teamLineups = new Map<string, Map<string, LineupAccumulator>>();

  const ensureTeam = (teamId: string, teamName: string): TeamAccumulator => {
    let team = teams.get(teamId);
    if (!team) {
      team = {
        teamId,
        teamName,
        wins: 0,
        losses: 0,
        totals: emptyTotals(),
        opponentTotals: emptyTotals(),
        gameLogs: [],
      };
      teams.set(teamId, team);
    }
    return team;
  };

  for (const game of games) {
    processPlayers(game, players);
    processTeams(game, teams, ensureTeam);
    processLineups(game, teamLineups);
  }

  const playersJson = [...players.values()]
    .map((p) => {
      const statBlock = buildStatBlock(p.totals, seasonStartYear);
      // Usage%はチームの出場全体（シーズン合計）を基準に算出する。移籍選手は直近所属チームで近似する
      const team = teams.get(p.teamId);
      const usage = team ? usagePct(p.totals, team.totals) : 0;
      // 国籍・身長体重・生年月日・ポジションはplayers-master.jsonから突合（未登録選手は全て未定義のまま）
      const master = masterById.get(p.playerId);
      return {
        playerId: p.playerId,
        name: p.name,
        teamId: p.teamId,
        teamName: p.teamName,
        position: master?.position,
        nationality: master?.nationality,
        classification: master?.classification,
        heightCm: master?.heightCm,
        weightKg: master?.weightKg,
        birthDate: master?.birthDate,
        ...statBlock,
        advanced: {
          eff: statBlock.advanced.eff,
          usagePct: usage,
          // オンコート純得失点＝個人+/-（PLUSMINUS）合計そのもの。オフコートはそこから
          // 「出場試合のチーム得失点差合計(teamNetSum)」を差し引いた残りとして導出する
          onCourtNet: p.totals.plusMinus,
          onCourtNetPerGame: statBlock.perGame.plusMinus,
          offCourtNet: p.totals.teamNetSum - p.totals.plusMinus,
          offCourtNetPerGame: (p.totals.teamNetSum - p.totals.plusMinus) / (p.totals.gamesPlayed || 1),
        },
      };
    })
    .sort((a, b) => b.perGame.pts - a.perGame.pts);

  for (const p of players.values()) {
    const gameLogs = [...p.gameLogs].sort((a, b) => a.date.localeCompare(b.date));
    await writeJson(path.join(DATA_DIR, season, "player-games", `${p.playerId}.json`), gameLogs);
  }

  const teamsJson = [...teams.values()]
    .map((t) => {
      const ownStats = buildStatBlock(t.totals, seasonStartYear);
      const oppStats = buildStatBlock(t.opponentTotals, seasonStartYear);
      // POSSは生データのチーム行から合算済みの値（totals.poss）を使う。自チーム/相手チーム行で
      // 同一の値になることを確認済みなので、opponentTotals.possも同じ値になる
      const poss = t.totals.poss;
      const offRtg = offensiveRating(t.totals.pts, poss);
      const defRtg = offensiveRating(t.opponentTotals.pts, poss);
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        wins: t.wins,
        losses: t.losses,
        ...ownStats,
        advanced: {
          eff: ownStats.advanced.eff,
          poss,
          pace: pace(poss, t.totals.min),
          offRtg,
          defRtg,
          netRtg: offRtg - defRtg,
          orbPct: orbPct(t.totals.oreb, t.opponentTotals.dreb),
        },
        opponentPerGame: oppStats.perGame,
        netPerGame: Object.fromEntries(
          Object.entries(ownStats.perGame).map(([key, value]) => [
            key,
            value - oppStats.perGame[key as keyof typeof oppStats.perGame],
          ]),
        ),
      };
    })
    .sort((a, b) => b.wins - a.wins);

  for (const t of teams.values()) {
    const gameLogs = [...t.gameLogs].sort((a, b) => a.date.localeCompare(b.date));
    await writeJson(path.join(DATA_DIR, season, "team-games", `${t.teamId}.json`), gameLogs);
  }

  const standingsHistory = buildStandingsHistory(games);
  await writeJson(path.join(DATA_DIR, season, "standings-history.json"), standingsHistory);

  const headToHead = buildHeadToHead(teams);
  await writeJson(path.join(DATA_DIR, season, "head-to-head.json"), headToHead);

  for (const [teamId, lineupMap] of teamLineups) {
    const team = teams.get(teamId);
    const teamPoss = team?.totals.poss ?? 0;
    const teamMin = team?.totals.min ?? 0;
    const lineups: LineupAggregate[] = [...lineupMap.entries()]
      .map(([lineupKey, acc]) => {
        // 推定Net Rating: スティント単位の実ポゼッション数は記録されていないため、
        // チームのシーズン平均「POSS / MIN(5人合計分)」からスティント時間分を按分推定する
        const estimatedPoss = teamMin > 0 ? (teamPoss * 5 * (acc.secondsPlayed / 60)) / teamMin : 0;
        return {
          lineupKey,
          playerIds: acc.playerIds,
          secondsPlayed: acc.secondsPlayed,
          netPoints: acc.netPoints,
          gamesPlayed: acc.games.size,
          estimatedNetRtg: safeDiv(100 * acc.netPoints, estimatedPoss),
        };
      })
      .sort((a, b) => b.secondsPlayed - a.secondsPlayed);
    const file: TeamLineupsFile = {
      teamId,
      teamName: team?.teamName ?? "",
      season,
      lineups,
    };
    await writeJson(path.join(DATA_DIR, season, "lineups", `${teamId}.json`), file);
  }

  await writeJson(path.join(DATA_DIR, season, "players.json"), playersJson);
  await writeJson(path.join(DATA_DIR, season, "teams.json"), teamsJson);
  console.log(
    `保存完了: players.json(${playersJson.length}名) / teams.json(${teamsJson.length}チーム) / ` +
      `standings-history.json(${standingsHistory.length}日分) / head-to-head.json(${headToHead.length}チーム) / ` +
      `lineups/(${teamLineups.size}チーム)`,
  );
}

/** 1試合分のラインナップスティント（shared/onCourt.ts）をチームごとに積算する */
function processLineups(game: StoredGame, teamLineups: Map<string, Map<string, LineupAccumulator>>): void {
  const periods = game.quarterScores.home.length;
  const result = reconstructOnCourt(
    game.raw.PlayByPlays,
    game.raw.HomeBoxscores,
    game.raw.AwayBoxscores,
    game.homeTeam.id,
    game.awayTeam.id,
    periods,
  );
  for (const stint of result.lineupStints) {
    let lineupMap = teamLineups.get(stint.teamId);
    if (!lineupMap) {
      lineupMap = new Map();
      teamLineups.set(stint.teamId, lineupMap);
    }
    let acc = lineupMap.get(stint.lineupKey);
    if (!acc) {
      acc = { playerIds: stint.playerIds, secondsPlayed: 0, netPoints: 0, games: new Set() };
      lineupMap.set(stint.lineupKey, acc);
    }
    acc.secondsPlayed += stint.endSec - stint.startSec;
    acc.netPoints += stint.netPoints;
    acc.games.add(game.scheduleKey);
  }
}

function processPlayers(game: StoredGame, players: Map<string, PlayerAccumulator>): void {
  const rows = [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores];
  for (const row of pickTeamRow(rows, 1)) {
    if (!row.PlayerID) continue;
    let acc = players.get(row.PlayerID);
    if (!acc) {
      acc = {
        playerId: row.PlayerID,
        name: row.PlayerNameJ,
        teamId: row.TeamID ?? "",
        teamName: row.TeamNameJ,
        totals: emptyTotals(),
        gameLogs: [],
      };
      players.set(row.PlayerID, acc);
    }
    // 直近の試合のチーム所属で上書き（移籍対応。DESIGN.mdでは選手マスタでの厳密な履歴管理は未対応）
    acc.teamId = row.TeamID ?? acc.teamId;
    acc.teamName = row.TeamNameJ;
    const isHome = row.TeamID === game.homeTeam.id;
    const teamNetForGame = isHome ? game.homeScore - game.awayScore : game.awayScore - game.homeScore;
    // 出場判定はPlayingFlgではなくPlayTime基準（実データ検証でPlayingFlg=falseでも
    // 得点等が記録されている選手が見つかったため。DESIGN.md 2-2章の記述は誤りだった）
    addBoxscoreRow(acc.totals, row, row.PlayTime !== "DNP", teamNetForGame);

    const opponent = isHome ? game.awayTeam : game.homeTeam;
    const win = isHome ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
    acc.gameLogs.push({
      scheduleKey: game.scheduleKey,
      date: game.date,
      opponentTeamId: opponent.id,
      opponentTeamName: opponent.name,
      isHome,
      win,
      isStarter: row.StartingFlg === 1,
      min: parsePlayTime(row.PlayTime),
      pts: row.Point,
      oreb: row.RB_OFF,
      dreb: row.RB_DEF,
      reb: row.RB_TOT,
      ast: row.AS,
      stl: row.ST,
      blk: row.BS,
      tov: row.TO,
      pf: row.FOUL,
      fgm: row.PT2M + row.PT3M,
      fga: row.PT2A + row.PT3A,
      tpm: row.PT3M,
      tpa: row.PT3A,
      ftm: row.FTM,
      fta: row.FTA,
      plusMinus: row.PLUSMINUS ?? 0,
    });
  }
}

/** チーム行（Category=3）から試合ログ用のボックススコア詳細を抽出する */
function teamGameLogStats(row: BoxscoreRow) {
  return {
    min: parsePlayTime(row.PlayTime),
    oreb: row.RB_OFF,
    dreb: row.RB_DEF,
    reb: row.RB_TOT,
    ast: row.AS,
    stl: row.ST,
    blk: row.BS,
    tov: row.TO,
    pf: row.FOUL,
    fgm: row.PT2M + row.PT3M,
    fga: row.PT2A + row.PT3A,
    tpm: row.PT3M,
    tpa: row.PT3A,
    ftm: row.FTM,
    fta: row.FTA,
    poss: row.POSS ?? 0,
  };
}

function processTeams(
  game: StoredGame,
  teams: Map<string, TeamAccumulator>,
  ensureTeam: (teamId: string, teamName: string) => TeamAccumulator,
): void {
  const homeRow = pickTeamRow(game.raw.HomeBoxscores, 3)[0];
  const awayRow = pickTeamRow(game.raw.AwayBoxscores, 3)[0];
  if (!homeRow || !awayRow) return;

  const home = ensureTeam(game.homeTeam.id, game.homeTeam.name);
  const away = ensureTeam(game.awayTeam.id, game.awayTeam.name);

  // opponentTotalsもgamesPlayedを数える（perGame算出の分母は「自チームの試合数」と一致させる必要がある）。
  // teamNetForGame（オンコート/オフコート算出用）は個人集計専用なのでチーム集計では常に0を渡す
  addBoxscoreRow(home.totals, homeRow, true, 0);
  addBoxscoreRow(home.opponentTotals, awayRow, true, 0);
  addBoxscoreRow(away.totals, awayRow, true, 0);
  addBoxscoreRow(away.opponentTotals, homeRow, true, 0);

  const homeWin = game.homeScore > game.awayScore;
  const awayWin = game.awayScore > game.homeScore;
  if (homeWin) {
    home.wins += 1;
    away.losses += 1;
  } else if (awayWin) {
    away.wins += 1;
    home.losses += 1;
  }

  home.gameLogs.push({
    scheduleKey: game.scheduleKey,
    date: game.date,
    opponentTeamId: game.awayTeam.id,
    opponentTeamName: game.awayTeam.name,
    isHome: true,
    teamScore: game.homeScore,
    opponentScore: game.awayScore,
    win: homeWin,
    ...teamGameLogStats(homeRow),
  });
  away.gameLogs.push({
    scheduleKey: game.scheduleKey,
    date: game.date,
    opponentTeamId: game.homeTeam.id,
    opponentTeamName: game.homeTeam.name,
    isHome: false,
    teamScore: game.awayScore,
    opponentScore: game.homeScore,
    win: awayWin,
    ...teamGameLogStats(awayRow),
  });
}

interface StandingsAccumulator {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

/**
 * シーズン全試合を日付順に走査し、日付ごとの各チームの累積成績スナップショットを作る。
 * 同率の順位付けは勝率降順→得失点差降順のシンプルな方法（DESIGN.md参照。公式タイブレーク
 * ルールが判明次第見直す）。
 */
function buildStandingsHistory(games: StoredGame[]): StandingsSnapshot[] {
  const sorted = [...games].sort(
    (a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey),
  );
  const accumulators = new Map<string, StandingsAccumulator>();

  const ensure = (teamId: string, teamName: string): StandingsAccumulator => {
    let acc = accumulators.get(teamId);
    if (!acc) {
      acc = { teamId, teamName, wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
      accumulators.set(teamId, acc);
    }
    acc.teamName = teamName;
    return acc;
  };

  const history: StandingsSnapshot[] = [];
  let i = 0;
  while (i < sorted.length) {
    const date = sorted[i]!.date;

    while (i < sorted.length && sorted[i]!.date === date) {
      const game = sorted[i]!;
      const home = ensure(game.homeTeam.id, game.homeTeam.name);
      const away = ensure(game.awayTeam.id, game.awayTeam.name);
      home.pointsFor += game.homeScore;
      home.pointsAgainst += game.awayScore;
      away.pointsFor += game.awayScore;
      away.pointsAgainst += game.homeScore;
      if (game.homeScore > game.awayScore) {
        home.wins += 1;
        away.losses += 1;
      } else {
        away.wins += 1;
        home.losses += 1;
      }
      i += 1;
    }

    const ranked = [...accumulators.values()]
      .map((t) => ({
        teamId: t.teamId,
        teamName: t.teamName,
        wins: t.wins,
        losses: t.losses,
        winPct: safeDiv(t.wins, t.wins + t.losses),
        pointsFor: t.pointsFor,
        pointsAgainst: t.pointsAgainst,
        pointDiff: t.pointsFor - t.pointsAgainst,
      }))
      .sort((a, b) => b.winPct - a.winPct || b.pointDiff - a.pointDiff);

    const leader = ranked[0];
    const teams = ranked.map((t, idx) => ({
      ...t,
      rank: idx + 1,
      gamesBehind: leader ? (leader.wins - t.wins + (t.losses - leader.losses)) / 2 : 0,
    }));

    history.push({ date, teams: attachDivisionRanks(teams) });
  }

  return history;
}

/**
 * 全体ランキング済みのteamsに、地区（東/西）ごとの順位・地区首位とのゲーム差を付与する。
 * タイブレークは全体順位と同じ勝率降順→得失点差降順を地区内で適用する（DESIGN.md参照）。
 * divisions.tsのマスタに無いチーム（過去シーズンの地区再編前後のチーム等）はdivision系が未定義のまま
 */
function attachDivisionRanks(
  teams: Omit<StandingsTeamSnapshot, "division" | "divisionRank" | "divisionGamesBehind">[],
): StandingsTeamSnapshot[] {
  const withDivision: StandingsTeamSnapshot[] = teams.map((t) => ({ ...t, division: teamDivision(t.teamId) }));

  const byDivision = new Map<Division, StandingsTeamSnapshot[]>();
  for (const t of withDivision) {
    if (!t.division) continue;
    const list = byDivision.get(t.division) ?? [];
    list.push(t);
    byDivision.set(t.division, list);
  }

  for (const list of byDivision.values()) {
    list.sort((a, b) => b.winPct - a.winPct || b.pointDiff - a.pointDiff);
    const divLeader = list[0]!;
    list.forEach((t, idx) => {
      t.divisionRank = idx + 1;
      t.divisionGamesBehind = (divLeader.wins - t.wins + (t.losses - divLeader.losses)) / 2;
    });
  }

  return withDivision;
}

/**
 * チームごとのgameLogs（team-games/{teamId}.json相当）から、対戦相手ごとのペアワイズ成績
 * （W-L・合計得失点差）と、地区別（対東地区/対西地区）のまとめを作る（星取り表ページ用）。
 * 対戦していない相手はvsに含めない（フロントエンドでダッシュ/空欄表示にする）。
 */
function buildHeadToHead(teams: Map<string, TeamAccumulator>): HeadToHeadTeamRow[] {
  const withPct = (wins: number, losses: number) => ({ wins, losses, winPct: safeDiv(wins, wins + losses) });

  const rows = [...teams.values()].map((team) => {
    const vs = new Map<string, HeadToHeadRecord>();
    for (const log of team.gameLogs) {
      let rec = vs.get(log.opponentTeamId);
      if (!rec) {
        rec = { wins: 0, losses: 0, pointDiff: 0 };
        vs.set(log.opponentTeamId, rec);
      }
      if (log.win) rec.wins += 1;
      else rec.losses += 1;
      rec.pointDiff += log.teamScore - log.opponentScore;
    }

    let eastWins = 0;
    let eastLosses = 0;
    let westWins = 0;
    let westLosses = 0;
    for (const [opponentTeamId, rec] of vs) {
      const division = teamDivision(opponentTeamId);
      if (division === "east") {
        eastWins += rec.wins;
        eastLosses += rec.losses;
      } else if (division === "west") {
        westWins += rec.wins;
        westLosses += rec.losses;
      }
    }

    return {
      teamId: team.teamId,
      teamName: team.teamName,
      division: teamDivision(team.teamId),
      vs: Object.fromEntries(vs),
      overall: withPct(team.wins, team.losses),
      vsEast: withPct(eastWins, eastLosses),
      vsWest: withPct(westWins, westLosses),
    };
  });

  return rows.sort((a, b) => b.overall.wins - a.overall.wins);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error("使い方: aggregate.ts --season 2025-26");
    process.exitCode = 1;
    return;
  }
  await aggregateSeason(season);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
