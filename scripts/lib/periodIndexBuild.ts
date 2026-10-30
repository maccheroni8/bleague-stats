// ピリオド別の索引を作る（DESIGN.md 225章。形式は shared/periodIndex.ts）。
// そのシーズンの試合の生データ（games/）と、同じシーズンの1試合行の索引（player-game-index.json・team-game-index.json。先に作っておく）から作る。
// 値は、シーズン成績のQ別・前後半（src/lib/playerSeasonBoxscore.ts の computeGamePeriodTotals・computeGameTeamPeriodTotals）が呼ぶのと同じ関数
// （buildPlayerBoxscores・buildTeamTotalCounts・computeTeamRatings）に、同じ区間の定義（buildPeriodRangeOptions）を渡して出す。
// src/lib は拡張子なしの import を使うため Node で直接読めない。esbuild で1ファイルにまとめてから実行する（npm run aggregate:period-index）。
// 選手の行は、1試合行の索引の行（出場した試合）に結び付ける。前後半5分の特別な試合（1Q〜4Qが無い）の行は持たない。
// チームの追加の列（Misc・Scoring 用の項目と、外国籍の人数別の在コート秒数。256章の段階1）は、チームの試合ログ（scripts/aggregate.ts）と同じ関数で区間ごとに出す。
// 人数別の得点・失点・攻撃回数（256章の段階3の作り直しの回）は、よく使われるラインナップと同じ数え方で区間ごとと試合全体（all）に出す。
import path from "node:path";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./storage.ts";
import { makeClassifier, type SeasonRegistrationFile } from "../../shared/registration.ts";
import { seasonRuleFor } from "../../shared/seasonRules.ts";
import {
  PERIOD_ATOMS,
  PERIOD_INDEX_VERSION,
  PERIOD_POSS_KEYS,
  PERIOD_ROW_FLAG_PLUS_MINUS,
  PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED,
  PLAYER_PERIOD_ONCOURT_COLUMNS,
  PLAYER_PERIOD_ONCOURT_OPP_KEYS,
  PLAYER_PERIOD_ONCOURT_OWN_KEYS,
  PLAYER_PERIOD_STAT_COLUMNS,
  TEAM_PERIOD_COUNT_COLUMNS,
  TEAM_PERIOD_EXTRA_COLUMNS,
  TEAM_PERIOD_FOREIGN_COLUMNS,
  TEAM_PERIOD_FOUL_COLUMNS,
  TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS,
  TEAM_PERIOD_WHOLE_GAME_KEY,
  type TeamPeriodExtraColumn,
  type PeriodAtom,
  type PeriodPossKey,
  type PlayerPeriodIndexFile,
  type PlayerPeriodStatColumn,
  type TeamPeriodIndexFile,
} from "../../shared/periodIndex.ts";
import { GAME_FLAG_SHORT, type PlayerGameIndexFile, type TeamGameIndexFile } from "../../shared/gameIndex.ts";
import { overtimeCount } from "../../shared/gamePeriods.ts";
import type { Category, PlayByPlayEvent, PlayerMasterEntry, SeasonRules, StoredGame } from "../../shared/types.ts";
import { onCourtPeriodCount, periodRangeSeconds, reconstructOnCourt, substitutionModelForSeason, type OnCourtReconstruction } from "../../shared/onCourt.ts";
import {
  fgAssistsByPlayer,
  onCourtKeyIndex,
  periodPlusMinusAvailable,
  playerOnCourtByPeriod,
  plusMinusOf,
  sumOverPeriods,
  teamOnCourtQuality,
} from "../../shared/playerOnCourt.ts";
import { foreignCourtByPeriod, type ForeignPeriodTotals } from "../../shared/foreignOnCourt.ts";
import { buildMiscEventCounts, countTechnicalFouls, teamPointsBreakdown, ZERO_MISC_EVENTS } from "../../shared/teamGameEvents.ts";
import { computePointsOffTurnovers } from "../../shared/pointsOffTurnovers.ts";
import { computeFastbreakPoints, computePointsInPaint, computeSecondChancePoints } from "../../shared/playTypePoints.ts";
import { computeAssistedScoring } from "../../shared/assistedScoring.ts";
import { buildOfficialPaintSplit } from "../../shared/paintSplit.ts";
import { buildPlayerBoxscores, buildTeamTotalCounts, computeTeamRatings, rowsInPeriodRange, type BoxscoreCounts } from "../../src/lib/boxscoreAggregate";
import { buildPeriodRangeOptions, periodInRange, type PeriodRangeOption } from "../../src/lib/periodRange";

/** 選手の統計の列の値（BoxscoreCounts から。PlayerGameLog・PlayerSeasonRawTotals と同じ項目への対応は buildPeriodFilteredRawTotals と同じ） */
function playerStatOf(c: BoxscoreCounts, col: PlayerPeriodStatColumn): number {
  switch (col) {
    case "fgm":
      return c.pt2m + c.pt3m;
    case "fga":
      return c.pt2a + c.pt3a;
    case "tpm":
      return c.pt3m;
    case "tpa":
      return c.pt3a;
    case "reb":
      return c.treb;
    case "blockedAgainst":
      return c.bson;
    case "foulsDrawn":
      return c.foulon;
    case "pf":
      return c.foul;
    case "mid2m":
      return c.nonPaint2m;
    case "mid2a":
      return c.nonPaint2a;
    case "plusMinus":
      return c.hasPlusMinus ? c.plusMinus : 0;
    default:
      return Number((c as unknown as Record<string, unknown>)[col] ?? 0);
  }
}

/** その試合の区間の選択肢（シーズン成績のQ別・前後半と同じ定義。試合の延長の本数で、延長の区間が決まる） */
function periodOptionsOf(game: StoredGame): { atoms: (PeriodRangeOption | null)[]; poss: Record<PeriodPossKey, PeriodRangeOption | null> } {
  const overtimes = overtimeCount(game);
  const options = buildPeriodRangeOptions(4 + overtimes);
  const pick = (value: string): PeriodRangeOption | null => options.find((o) => o.value === value) ?? null;
  const atoms = PERIOD_ATOMS.map((a) => pick(a));
  const poss = Object.fromEntries(PERIOD_POSS_KEYS.map((k) => [k, pick(k)])) as Record<PeriodPossKey, PeriodRangeOption | null>;
  return { atoms, poss };
}

/**
 * チームの追加の列（TEAM_PERIOD_EXTRA_COLUMNS）の、その区間の値（自チーム）。試合ログ（scripts/aggregate.ts の processTeams）と同じ関数に、
 * その区間のプレーバイプレー（ピリオドで絞る）・ボックススコアの行を渡す
 */
function teamExtraValues(
  playByPlays: PlayByPlayEvent[],
  ownRows: StoredGame["raw"]["HomeBoxscores"],
  teamId: string,
  option: PeriodRangeOption,
  classify: (id: string) => string | undefined,
): Record<TeamPeriodExtraColumn, number> {
  const pbp = playByPlays.filter((e) => periodInRange(option, e.Period));
  const misc = buildMiscEventCounts(pbp).byTeam.get(teamId) ?? ZERO_MISC_EVENTS;
  const assisted = computeAssistedScoring(pbp).byTeam.get(teamId);
  const paint = buildOfficialPaintSplit(pbp).byTeam.get(teamId);
  const points = teamPointsBreakdown(ownRows, teamId, classify, rowsInPeriodRange(ownRows.filter((r) => r.Category === 1), option));
  return {
    foulsDrawn: buildTeamTotalCounts(ownRows, option).foulon,
    pt2in: computePointsInPaint(pbp).byTeam.get(teamId) ?? 0,
    fb: computeFastbreakPoints(pbp).byTeam.get(teamId) ?? 0,
    pt2nd: computeSecondChancePoints(pbp).byTeam.get(teamId) ?? 0,
    pft: computePointsOffTurnovers(pbp).byTeam.get(teamId) ?? 0,
    dunks: misc.dunks,
    technicalFouls: countTechnicalFouls(pbp).byTeam.get(teamId) ?? 0,
    basketCounts: misc.basketCounts,
    unsportsmanlikeFouls: misc.unsportsmanlikeFouls,
    disqualifyingFouls: misc.disqualifyingFouls,
    technicalFoulsCat1: misc.technicalFoulsCat1,
    technicalFoulsCat2: misc.technicalFoulsCat2,
    flagrantFouls: misc.flagrantFouls,
    disruptiveFouls: misc.disruptiveFouls,
    assisted2m: assisted?.assisted2m ?? 0,
    assisted3m: assisted?.assisted3m ?? 0,
    assistedFtm: assisted?.assistedFtm ?? 0,
    paint2m: paint?.paint2m ?? 0,
    paint2a: paint?.paint2a ?? 0,
    mid2m: paint?.nonPaint2m ?? 0,
    mid2a: paint?.nonPaint2a ?? 0,
    benchPoints: points.bench,
    starterPoints: points.starter,
    japanesePoints: points.japanese,
    foreignPoints: points.foreign,
    naturalizedPoints: points.naturalized,
    asianQuotaPoints: points.asianQuota,
  };
}

/** 人数別の列（TEAM_PERIOD_FOREIGN_COLUMNS・TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS）の値の並び。攻撃回数の無い試合は攻撃回数の列が -1 */
function foreignColumnValues(t: ForeignPeriodTotals): number[] {
  return [
    ...t.seconds,
    ...t.ownPoints,
    ...t.oppPoints,
    ...(t.ownPoss ?? [-1, -1, -1, -1, -1]),
    ...(t.oppPoss ?? [-1, -1, -1, -1, -1]),
  ];
}
const FOREIGN_INDEX_COLUMNS = [...TEAM_PERIOD_FOREIGN_COLUMNS, ...TEAM_PERIOD_FOREIGN_DETAIL_COLUMNS];

/**
 * その試合の、チームごとの人数別の値（区間〔PERIOD_ATOMS の番号〕ごとと試合全体。並びは FOREIGN_INDEX_COLUMNS）。数えられる5人組が無いチームは含めない。
 * 延長は第1延長以降の合計。攻撃回数は、その試合に数え上げがあれば（2020-21以降）すべての区間で値を持つ
 */
function foreignValuesByAtom(
  game: StoredGame,
  onCourt: OnCourtReconstruction | null,
  classify: (id: string) => string | undefined,
  maxOnCourt: number | undefined,
): Map<string, { atoms: number[][]; whole: number[] }> {
  const result = new Map<string, { atoms: number[][]; whole: number[] }>();
  if (!onCourt) return result;
  const periods = onCourtPeriodCount(game.season, game.quarterScores.home.length, game.raw.PlayByPlays);
  const withPoss = onCourt.lineupStints.some((s) => s.countsByPeriod !== undefined);
  const empty = () => foreignColumnValues({
    seconds: [0, 0, 0, 0, 0],
    ownPoints: [0, 0, 0, 0, 0],
    oppPoints: [0, 0, 0, 0, 0],
    ownPoss: withPoss ? [0, 0, 0, 0, 0] : null,
    oppPoss: withPoss ? [0, 0, 0, 0, 0] : null,
  });
  const add = (into: number[], values: number[]) => values.forEach((v, i) => (into[i] = into[i]! === -1 ? -1 : into[i]! + v));
  for (const [teamId, byPeriod] of foreignCourtByPeriod(onCourt.lineupStints, classify, maxOnCourt, periodRangeSeconds, periods)) {
    const atoms = PERIOD_ATOMS.map(() => empty());
    const whole = empty();
    for (const [period, totals] of byPeriod) {
      const values = foreignColumnValues(totals);
      add(atoms[period <= 4 ? period - 1 : PERIOD_ATOMS.indexOf("ot")]!, values);
      add(whole, values);
    }
    result.set(teamId, { atoms, whole });
  }
  return result;
}

function emptyPlayerColumns(): Record<PlayerPeriodStatColumn, number[]> {
  return Object.fromEntries(PLAYER_PERIOD_STAT_COLUMNS.map((c) => [c, [] as number[]])) as Record<PlayerPeriodStatColumn, number[]>;
}

function isParticipating(values: number[]): boolean {
  return values.some((v) => v !== 0);
}

async function readIndexes(season: string, category: Category): Promise<{ player: PlayerGameIndexFile; team: TeamGameIndexFile } | null> {
  const dir = path.join(DATA_DIR, seasonDirName(season, category));
  const player = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
  const team = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
  if (!player || !team) return null;
  return { player, team };
}

/** そのシーズンのピリオド別の索引（選手・チーム）。1試合行の索引が無いシーズンは null */
export async function buildPeriodIndex(
  season: string,
  category: Category = "premier",
): Promise<{ player: PlayerPeriodIndexFile; team: TeamPeriodIndexFile } | null> {
  const indexes = await readIndexes(season, category);
  if (!indexes) return null;
  const { player: playerIndex, team: teamIndex } = indexes;
  const generatedAt = new Date().toISOString();

  // 選手の索引の行: (選手ID, 試合) → 行の番号
  const rowOf = new Map<string, number>();
  const { rows: pr, players, games } = playerIndex;
  for (let i = 0; i < pr.player.length; i++) rowOf.set(`${players[pr.player[i]!]![0]}|${games.key[pr.game[i]!]}`, i);
  const gameNumber = new Map<string, number>(games.key.map((k, i) => [k, i]));

  // 登録区分（ベンチ／スタメン・区分別の得点、On-Court Foreign）と、同時に出られる外国籍・特別枠の最大人数（試合ログと同じ値）
  const playersMaster = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const masterById = new Map(playersMaster.map((p) => [p.playerId, p]));
  // 登録区分は試合ログと同じ決め方（shared/registration.ts。試合の日付で決める）
  const classifyAt = makeClassifier(
    season,
    await readJson<SeasonRegistrationFile>(path.join(DATA_DIR, seasonDirName(season, category), "registrations.json")),
    masterById,
  );
  const seasonRules = (await readJson<SeasonRules[]>(path.join(DATA_DIR, "season-rules.json"))) ?? [];
  const maxForeignOnCourt = seasonRuleFor(seasonRules, season, category)?.maxForeignOnCourt;

  const allGames = (await readAllGames(season, category)).filter((g) => gameNumber.has(String(g.scheduleKey)));
  if (allGames.length !== games.key.length) throw new Error(`${season}: 索引の試合 ${games.key.length} 件のうち、生データがあるのは ${allGames.length} 件です`);
  allGames.sort((a, b) => gameNumber.get(String(a.scheduleKey))! - gameNumber.get(String(b.scheduleKey))!);

  // 選手: 行ごとの区間の値を集めてから (row, period) の昇順に書く
  const perRow = new Map<number, { period: number; flags: number; values: number[]; ocValues: number[] | null }[]>();
  // 出場中の材料の列は、数え上げのあるシーズン（2020-21以降）の索引だけが持つ
  const withOnCourtColumns = substitutionModelForSeason(season) === "modern";
  // 復元の Q別 +/- は、公式のピリオド別の値が無いシーズン（2016-17〜2021-22）だけ。2022-23以降は公式の値を使い、欠けた行も補わない
  const reconstructsPeriodPlusMinus = Number(season.slice(0, 4)) < 2022;
  // チーム: 試合番号×2＋(ホーム 0／アウェイ 1)
  const teamRows = teamIndex.games.key.length * 2;
  const teamCounts: Record<string, number[]> = {};
  for (const a of PERIOD_ATOMS) {
    for (const c of [...TEAM_PERIOD_COUNT_COLUMNS, ...TEAM_PERIOD_EXTRA_COLUMNS, ...TEAM_PERIOD_FOUL_COLUMNS, ...FOREIGN_INDEX_COLUMNS]) teamCounts[`${a}.${c}`] = new Array<number>(teamRows).fill(-1);
  }
  for (const c of FOREIGN_INDEX_COLUMNS) teamCounts[`${TEAM_PERIOD_WHOLE_GAME_KEY}.${c}`] = new Array<number>(teamRows).fill(-1);
  const teamPoss = Object.fromEntries(PERIOD_POSS_KEYS.map((k) => [k, new Array<number>(teamRows).fill(-1)])) as Record<PeriodPossKey, number[]>;
  const teamGameNumber = new Map<string, number>(teamIndex.games.key.map((k, i) => [k, i]));

  // ピリオド別の選手行（PeriodCategory 1〜4）がある試合。無い試合は区間の値を持たない
  const hasPeriodRows = new Set<string>(
    allGames
      .filter((game) => [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores].some((r) => r.Category === 1 && r.PeriodCategory >= 1 && r.PeriodCategory <= 4))
      .map((game) => String(game.scheduleKey)),
  );
  for (const game of allGames) {
    const key = String(game.scheduleKey);
    const g = gameNumber.get(key)!;
    const classify = (id: string) => classifyAt(id, game.date);
    const short = (games.flags[g]! & GAME_FLAG_SHORT) !== 0;
    // ピリオド別の選手行が無い試合（合計だけの手入力の試合。DESIGN.md 275章）は、区間の値を持たない（0ではなく -1＝無い）
    const noPeriods = !hasPeriodRows.has(key);
    const tg = teamGameNumber.get(key);
    if (tg === undefined) throw new Error(`${season} ${key}: チームの索引に試合がありません`);
    const { atoms, poss } = periodOptionsOf(game);
    // 在コートの復元は試合ログ（scripts/aggregate.ts）と同じ呼び方。1試合に1回だけ
    const totalPeriods = onCourtPeriodCount(game.season, game.quarterScores.home.length, game.raw.PlayByPlays);
    const onCourt =
      game.raw.PlayByPlays.length > 0
        ? reconstructOnCourt(
            game.raw.PlayByPlays,
            game.raw.HomeBoxscores,
            game.raw.AwayBoxscores,
            game.homeTeam.id,
            game.awayTeam.id,
            totalPeriods,
            substitutionModelForSeason(game.season),
          )
        : null;
    const foreignValues = foreignValuesByAtom(game, onCourt, classify, maxForeignOnCourt);
    const fgAssists = withOnCourtColumns && onCourt ? fgAssistsByPlayer(game.raw.PlayByPlays) : null;
    for (const side of [0, 1] as const) {
      const teamId = side === 0 ? game.homeTeam.id : game.awayTeam.id;
      const ownForeign = foreignValues.get(teamId);
      // 試合全体の人数別の値は、前後半5分の特別な試合でも持つ
      if (ownForeign) FOREIGN_INDEX_COLUMNS.forEach((c, i) => (teamCounts[`${TEAM_PERIOD_WHOLE_GAME_KEY}.${c}`]![tg * 2 + side] = ownForeign.whole[i]!));
      const ownRows = side === 0 ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
      const oppRows = side === 0 ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
      // 前後半5分の特別な試合は、1Q〜4Q・前半・後半を持たない（クォーターではない。DESIGN.md 143章）
      const usable = (a: PeriodAtom, opt: PeriodRangeOption | null): opt is PeriodRangeOption => opt !== null && !noPeriods && !(short && a !== "ot");
      // 出場中の材料（2020-21以降）と、復元の Q別 +/-（公式の値が無い試合。チームの区間の合計が試合全体の復元と合うときだけ）。DESIGN.md 304章
      const ownScore = side === 0 ? game.homeScore : game.awayScore;
      const oppScore = side === 0 ? game.awayScore : game.homeScore;
      const byPlayer = onCourt ? playerOnCourtByPeriod(onCourt.lineupStints, teamId, totalPeriods) : null;
      const reconstructedPm = onCourt && byPlayer ? periodPlusMinusAvailable(onCourt, byPlayer, teamId, ownScore, oppScore) : false;
      const quality =
        withOnCourtColumns && onCourt
          ? teamOnCourtQuality(onCourt, teamId, side === 0 ? game.awayTeam.id : game.homeTeam.id, ownRows, oppRows, ownScore, oppScore, totalPeriods)
          : -1;
      const sideEntries: { row: number; playerId: string; entry: { period: number; flags: number; values: number[]; ocValues: number[] | null } }[] = [];
      PERIOD_ATOMS.forEach((atom, ai) => {
        const opt = atoms[ai]!;
        if (!usable(atom, opt)) return;
        let offFouls = 0;
        let charges = 0;
        for (const p of buildPlayerBoxscores(ownRows, opt, game.raw.PlayByPlays, [])) {
          offFouls += p.counts.offensiveFoulsCommitted;
          charges += p.counts.chargesDrawn;
          if (p.dnp) continue;
          const row = rowOf.get(`${p.playerId}|${key}`);
          if (row === undefined) continue; // 出場時間が0の行（索引に無い）
          const values = PLAYER_PERIOD_STAT_COLUMNS.map((c) => playerStatOf(p.counts, c));
          if (!isParticipating(values)) continue;
          const inAtom = (period: number) => (atom === "ot" ? period >= 5 : period === ai + 1);
          const oc = byPlayer ? sumOverPeriods(byPlayer.get(p.playerId), inAtom) : null;
          let flag = p.counts.hasPlusMinus ? PERIOD_ROW_FLAG_PLUS_MINUS : 0;
          if (!p.counts.hasPlusMinus && reconstructsPeriodPlusMinus && reconstructedPm && oc) {
            values[PLAYER_PERIOD_STAT_COLUMNS.indexOf("plusMinus")] = plusMinusOf(oc);
            flag |= PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED;
          }
          const ocValues = withOnCourtColumns
            ? onCourt && oc
              ? [
                  oc[0]!,
                  ...PLAYER_PERIOD_ONCOURT_OWN_KEYS.map((k) => oc[onCourtKeyIndex(k, "own")]!),
                  ...PLAYER_PERIOD_ONCOURT_OPP_KEYS.map((k) => oc[onCourtKeyIndex(k, "opp")]!),
                  [...(fgAssists?.get(p.playerId) ?? [])].filter(([period]) => inAtom(period)).reduce((a, [, n]) => a + n, 0),
                  quality,
                ]
              : new Array<number>(PLAYER_PERIOD_ONCOURT_COLUMNS.length).fill(-1)
            : null;
          sideEntries.push({ row, playerId: p.playerId, entry: { period: ai, flags: flag, values, ocValues } });
        }
        teamCounts[`${atom}.offFouls`]![tg * 2 + side] = offFouls;
        teamCounts[`${atom}.charges`]![tg * 2 + side] = charges;
        // チームの自チームの値（相手の値は相手の行から引く）
        const own = buildTeamTotalCounts(ownRows, opt);
        for (const c of TEAM_PERIOD_COUNT_COLUMNS) teamCounts[`${atom}.${c}`]![tg * 2 + side] = Number((own as unknown as Record<string, unknown>)[c] ?? 0);
        const extra = teamExtraValues(game.raw.PlayByPlays, ownRows, teamId, opt, classify);
        for (const c of TEAM_PERIOD_EXTRA_COLUMNS) teamCounts[`${atom}.${c}`]![tg * 2 + side] = extra[c];
        if (ownForeign) FOREIGN_INDEX_COLUMNS.forEach((c, i) => (teamCounts[`${atom}.${c}`]![tg * 2 + side] = ownForeign.atoms[ai]![i]!));
      });
      // 復元の Q別 +/- は、そのチームの試合で、出場中の区間（時間か得点差がある）のある選手×区間すべてに索引の行があるときだけ残す。
      // 行が無い区間（公式のピリオド別の記録では出場していない区間に、復元では出ていた）があると、区間の合計が試合の +/- と合わなくなるため
      if (byPlayer && sideEntries.some((e) => (e.entry.flags & PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED) !== 0)) {
        const has = new Set(sideEntries.map((e) => `${e.playerId}|${e.entry.period}`));
        let covered = true;
        for (const [pid, bp] of byPlayer) {
          PERIOD_ATOMS.forEach((atom, ai) => {
            const v = sumOverPeriods(bp, (period) => (atom === "ot" ? period >= 5 : period === ai + 1));
            if ((v[0]! > 0 || plusMinusOf(v) !== 0) && !has.has(`${pid}|${ai}`)) covered = false;
          });
        }
        if (!covered) {
          const pmIndex = PLAYER_PERIOD_STAT_COLUMNS.indexOf("plusMinus");
          for (const e of sideEntries) {
            if ((e.entry.flags & PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED) === 0) continue;
            e.entry.flags &= ~PERIOD_ROW_FLAG_PLUS_MINUS_RECONSTRUCTED;
            e.entry.values[pmIndex] = 0;
          }
        }
      }
      for (const e of sideEntries) {
        let list = perRow.get(e.row);
        if (!list) perRow.set(e.row, (list = []));
        list.push(e.entry);
      }
      for (const k of PERIOD_POSS_KEYS) {
        const opt = poss[k];
        if (!opt || noPeriods || (short && k !== "ot")) continue;
        teamPoss[k][tg * 2 + side] = computeTeamRatings(buildTeamTotalCounts(ownRows, opt), buildTeamTotalCounts(oppRows, opt)).poss;
      }
    }
  }

  // 結び付けの確認: 索引の行はすべて、いずれかの区間に値を持つ（特別な試合でも、出場が数秒だけでもないのに無いのは異常）
  const rowIds = [...perRow.keys()].sort((a, b) => a - b);
  for (let i = 0; i < pr.player.length; i++) {
    if (perRow.has(i)) continue;
    const g = pr.game[i]!;
    if ((games.flags[g]! & GAME_FLAG_SHORT) !== 0) continue;
    // ピリオド別の選手行が無い試合（公式にボックススコアが無く、合計だけを手で入れた 2017-18 の1810。DESIGN.md 275章）は区間の値を持たない
    if (!hasPeriodRows.has(games.key[g]!)) continue;
    // 公式の記録で、試合全体の出場が1秒だけでどの区間にも記録の無い選手（全区間が DNP）。区間の値は無い（validate-period-index が確かめる）
    if (pr.stats.minSec[i]! <= 2) continue;
    throw new Error(`${season} ${games.key[g]} ${players[pr.player[i]!]![0]}: 試合に出た選手の区間の値がありません`);
  }

  const rows: PlayerPeriodIndexFile["rows"] = { row: [], period: [], flags: [], stats: emptyPlayerColumns() };
  for (const row of rowIds) {
    for (const e of perRow.get(row)!.sort((a, b) => a.period - b.period)) {
      rows.row.push(row);
      rows.period.push(e.period);
      rows.flags.push(e.flags);
      PLAYER_PERIOD_STAT_COLUMNS.forEach((c, ci) => rows.stats[c].push(e.values[ci]!));
      if (e.ocValues) PLAYER_PERIOD_ONCOURT_COLUMNS.forEach((c, ci) => (rows.stats[c] ??= []).push(e.ocValues![ci]!));
    }
  }

  return {
    player: { version: PERIOD_INDEX_VERSION, generatedAt, season, indexRows: pr.player.length, rows },
    team: { version: PERIOD_INDEX_VERSION, generatedAt, season, indexRows: teamRows, rows: { counts: teamCounts, poss: teamPoss } },
  };
}
