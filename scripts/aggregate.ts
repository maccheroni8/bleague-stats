// data/{season}/games/*.json（生データ）から teams.json / players.json を再生成する。
// 生データを正とし、集計は都度作り直す（DESIGN.md 5章）。ティアAの基本＋一部アドバンスドスタッツが対象。
//
// 使い方: npm run aggregate -- --season 2025-26

import path from "node:path";
import { DATA_DIR, readAllGames, writeJson } from "./lib/storage.ts";
import { efgPct, ftRate, parsePlayTime, safeDiv, tsPct } from "./lib/formulas.ts";
import type { BoxscoreRow, StoredGame } from "./lib/types.ts";
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
}

function buildStatBlock(totals: StatTotals) {
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
  };
}

interface PlayerAccumulator {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  totals: StatTotals;
}

interface TeamAccumulator {
  teamId: string;
  teamName: string;
  wins: number;
  losses: number;
  totals: StatTotals;
  opponentTotals: StatTotals;
}

function pickTeamRow(rows: BoxscoreRow[], category: 1 | 3): BoxscoreRow[] {
  return rows.filter((r) => r.Category === category && r.PeriodCategory === 18);
}

async function aggregateSeason(season: string): Promise<void> {
  const games = (await readAllGames(season)).filter((g) => g.gameEndedFlg);
  console.log(`[${season}] 集計対象: ${games.length}試合（終了済みのみ）`);

  const players = new Map<string, PlayerAccumulator>();
  const teams = new Map<string, TeamAccumulator>();

  const ensureTeam = (teamId: string, teamName: string): TeamAccumulator => {
    let team = teams.get(teamId);
    if (!team) {
      team = { teamId, teamName, wins: 0, losses: 0, totals: emptyTotals(), opponentTotals: emptyTotals() };
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
      ...buildStatBlock(p.totals),
    }))
    .sort((a, b) => b.perGame.pts - a.perGame.pts);

  const teamsJson = [...teams.values()]
    .map((t) => {
      const ownStats = buildStatBlock(t.totals);
      const oppStats = buildStatBlock(t.opponentTotals);
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

  await writeJson(path.join(DATA_DIR, season, "players.json"), playersJson);
  await writeJson(path.join(DATA_DIR, season, "teams.json"), teamsJson);
  console.log(`保存完了: players.json(${playersJson.length}名) / teams.json(${teamsJson.length}チーム)`);
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
      };
      players.set(row.PlayerID, acc);
    }
    // 直近の試合のチーム所属で上書き（移籍対応。DESIGN.mdでは選手マスタでの厳密な履歴管理は未対応）
    acc.teamId = row.TeamID ?? acc.teamId;
    acc.teamName = row.TeamNameJ;
    // 出場判定はPlayingFlgではなくPlayTime基準（実データ検証でPlayingFlg=falseでも
    // 得点等が記録されている選手が見つかったため。DESIGN.md 2-2章の記述は誤りだった）
    addBoxscoreRow(acc.totals, row, row.PlayTime !== "DNP");
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

  if (game.homeScore > game.awayScore) {
    home.wins += 1;
    away.losses += 1;
  } else if (game.awayScore > game.homeScore) {
    away.wins += 1;
    home.losses += 1;
  }
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
