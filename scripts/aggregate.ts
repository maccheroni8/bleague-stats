// data/{season}/games/*.json（生データ）から teams.json / players.json を再生成する。
// 生データを正とし、集計は都度作り直す（DESIGN.md 5章）。ティアAの基本＋一部アドバンスドスタッツが対象。
//
// 使い方: npm run aggregate -- --season 2025-26

import path from "node:path";
import { DATA_DIR, readAllGames, writeJson } from "./lib/storage.ts";
import { eff, efgPct, ftRate, parsePlayTime, safeDiv, tsPct } from "./lib/formulas.ts";
import type { BoxscoreRow, PlayerGameLog, StandingsSnapshot, StoredGame, TeamGameLog } from "./lib/types.ts";
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
  };
}

function addBoxscoreRow(totals: StatTotals, row: BoxscoreRow, countGame: boolean): void {
  if (countGame) totals.gamesPlayed += 1;
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

function pickTeamRow(rows: BoxscoreRow[], category: 1 | 3): BoxscoreRow[] {
  return rows.filter((r) => r.Category === category && r.PeriodCategory === 18);
}

async function aggregateSeason(season: string): Promise<void> {
  const games = (await readAllGames(season)).filter((g) => g.gameEndedFlg);
  console.log(`[${season}] 集計対象: ${games.length}試合（終了済みのみ）`);

  // EFFの計算式は年度で異なる（DESIGN.md 6章）。シーズン文字列("2025-26")から開始年を取り出す
  const seasonStartYear = Number(season.split("-")[0]);

  const players = new Map<string, PlayerAccumulator>();
  const teams = new Map<string, TeamAccumulator>();

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
  }

  const playersJson = [...players.values()]
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      teamId: p.teamId,
      teamName: p.teamName,
      ...buildStatBlock(p.totals, seasonStartYear),
    }))
    .sort((a, b) => b.perGame.pts - a.perGame.pts);

  for (const p of players.values()) {
    const gameLogs = [...p.gameLogs].sort((a, b) => a.date.localeCompare(b.date));
    await writeJson(path.join(DATA_DIR, season, "player-games", `${p.playerId}.json`), gameLogs);
  }

  const teamsJson = [...teams.values()]
    .map((t) => {
      const ownStats = buildStatBlock(t.totals, seasonStartYear);
      const oppStats = buildStatBlock(t.opponentTotals, seasonStartYear);
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        wins: t.wins,
        losses: t.losses,
        ...ownStats,
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

  await writeJson(path.join(DATA_DIR, season, "players.json"), playersJson);
  await writeJson(path.join(DATA_DIR, season, "teams.json"), teamsJson);
  console.log(
    `保存完了: players.json(${playersJson.length}名) / teams.json(${teamsJson.length}チーム) / ` +
      `standings-history.json(${standingsHistory.length}日分)`,
  );
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
    // 出場判定はPlayingFlgではなくPlayTime基準（実データ検証でPlayingFlg=falseでも
    // 得点等が記録されている選手が見つかったため。DESIGN.md 2-2章の記述は誤りだった）
    addBoxscoreRow(acc.totals, row, row.PlayTime !== "DNP");

    const isHome = row.TeamID === game.homeTeam.id;
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

  // opponentTotalsもgamesPlayedを数える（perGame算出の分母は「自チームの試合数」と一致させる必要がある）
  addBoxscoreRow(home.totals, homeRow, true);
  addBoxscoreRow(home.opponentTotals, awayRow, true);
  addBoxscoreRow(away.totals, awayRow, true);
  addBoxscoreRow(away.opponentTotals, homeRow, true);

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

    history.push({ date, teams });
  }

  return history;
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
