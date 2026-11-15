// 試合詳細の「画像を保存（6枚）」の中身（数字）を1試合分まとめて作る。描く側（src/components/gameImages/）はこの結果だけを読む。
// 数字はすべて、試合詳細ページと同じ関数（ボックススコア・在コートの復元・得点の流れ・ショットチャート）から出す。
// 画面だけの部品。保存キーの対象のファイルから import しないこと。
import type { BoxscoreRow, PlayerSummary, StoredGame, SummaryRow } from "../../../shared/types";
import { safeDiv } from "../../../shared/formulas";
import { maxRuns, scoringSequence } from "../../../shared/gameFlow";
import { foreignCountInLineup, foreignOnCourtIntervals } from "../../../shared/foreignOnCourt";
import { onCourtPeriodCount, reconstructOnCourt, substitutionModelForSeason, type LineupStint } from "../../../shared/onCourt";
import { buildOfficialPaintSplit } from "../../../shared/paintSplit";
import { computePointsInPaint } from "../../../shared/playTypePoints";
import { assistPointsByAssister } from "../../../shared/assistedScoring";
import { pointsCreated } from "../../../shared/playerGameRecords";
import { teamShortName } from "../../../shared/teamNames";
import {
  buildAssistPairs,
  buildPlayerBoxscores,
  buildTeamTotalCounts,
  formatMinutesFromSeconds,
  playTimeToSeconds,
  sumCountsList,
  type BoxscoreCounts,
} from "../boxscoreAggregate";
import { orderPlayersByPlayTime, playTimeOrderIndex } from "../boxscoreOrder";
import { classificationGroup } from "../classificationFilter";
import { MONO_FALLBACK_COLOR } from "../color";
import { buildGameLineups, rangeTotals, summarizeByForeignCount } from "../gameLineups";
import { gamePeriodScores } from "../gamePeriods";
import { buildPeriodBoundaries, buildScoreTimeline, totalGameSeconds, type PeriodBoundary } from "../leadTracker";
import { reconstructedPeriodPlusMinus } from "../playerSeasonBoxscore";
import { buildSurnameMap } from "../playerSurname";
import { buildShotEvents } from "../shotChart";

export interface GameImageInput {
  game: StoredGame;
  leagueLabel: string;
  classificationById: Map<string, PlayerSummary["classification"]>;
  homeColor: string | undefined;
  awayColor: string | undefined;
  pbpSupported: boolean;
  shotChartSupported: boolean;
  /** 同時に出られる外国籍・帰化・アジア特別枠の上限（シーズン・リーグの規則） */
  maxForeignOnCourt: number | undefined;
}

export interface TeamSide {
  id: string;
  name: string;
  shortName: string;
  /** 塗りに使う色（#rrggbb） */
  color: string;
  score: number;
  won: boolean;
}

export type KeyStatKind = "pct" | "count" | "points";

export interface KeyStatRow {
  key: string;
  label: string;
  home: number;
  away: number;
  homeText: string;
  awayText: string;
  /** 成功/試投（「30/65」）。割合の項目だけ */
  homeSub?: string;
  awaySub?: string;
  lowerIsBetter: boolean;
  /** 差の大きさ（数と割合をそろえたものさし。下の gapScore） */
  gap: number;
  /** 差が大きい上位5項目に入ったか */
  highlight: boolean;
  /** 良かった側（同じ値は null） */
  better: "home" | "away" | null;
}

export interface LeaderRow {
  name: string;
  surname: string;
  min: string;
  value: number;
}

export interface LeaderBlock {
  label: string;
  rows: LeaderRow[];
}

export interface SubRow {
  name: string;
  surname: string;
  starter: boolean;
  playTime: string;
  intervals: { startSec: number; endSec: number }[];
}

export interface RunMark {
  points: number;
  fromSec: number;
  toSec: number;
}

export interface FlowTeam {
  rows: SubRow[];
  dnp: string[];
  oc4: { startSec: number; endSec: number }[];
  run: RunMark | null;
  maxLead: number;
}

export interface ShotMark {
  x: number;
  y: number;
  made: boolean;
  longShot: boolean;
}

export interface Segment {
  key: "3p" | "paint" | "mid" | "ft";
  label: string;
  value: number;
}

export interface ShotTeam {
  shots: ShotMark[];
  fgm: number;
  fga: number;
  fgaSegments: Segment[];
  ptsSegments: Segment[];
}

export interface OcRow {
  /** 人数。null は「集計外」（5人が決まらなかった時間など） */
  count: number | null;
  seconds: number;
  own: number;
  opp: number;
}

export interface LineupCard {
  names: string[];
  surnames: string[];
  seconds: number;
  own: number;
  opp: number;
  oc: number | null;
  spans: { startSec: number; endSec: number }[];
}

export interface UsageTeam {
  oc: OcRow[];
  lineups: LineupCard[];
}

export interface BoxLine {
  label: string;
  no?: string;
  starter?: boolean;
  min: string;
  pts: number;
  reb: number;
  oreb: number;
  ast: number;
  stocks: number;
  tov: number;
  pf: number;
  p2: [number, number];
  p3: [number, number];
  ft: [number, number];
  plusMinus: number | null;
  pc: number | null;
}

export interface BoxTeam {
  players: BoxLine[];
  total: BoxLine;
  subtotals: BoxLine[];
  dnp: string[];
}

export interface GameImageModel {
  scheduleKey: string;
  season: string;
  leagueLabel: string;
  gameTypeLabel: string;
  dateLabel: string;
  venue: string;
  attendance: number | null;
  home: TeamSide;
  away: TeamSide;
  periodLabels: string[];
  quarters: { home: number[]; away: number[] };
  boundaries: PeriodBoundary[];
  totalSeconds: number;
  keyStats: KeyStatRow[];
  leaders: { home: LeaderBlock[]; away: LeaderBlock[] };
  /** 2枚目。プレーバイプレーの無いシーズン・試合は null */
  flow: { home: FlowTeam; away: FlowTeam; timeline: { sec: number; diff: number }[] } | null;
  /** 3枚目 */
  shots: { home: ShotTeam; away: ShotTeam; hasPositions: boolean };
  /** 4枚目。プレーバイプレーの無いシーズン・試合は null */
  usage: { home: UsageTeam; away: UsageTeam; maxOc: number } | null;
  box: { home: BoxTeam; away: BoxTeam };
}

export const GAME_IMAGE_COUNT = 6;

/** 各画像のタイトル（何が載っているか）。5・6枚目はチーム名を添える */
export function gameImageTitle(index: number, homeName: string, awayName: string): string {
  switch (index) {
    case 0:
      return "スコア・キースタッツ・ゲームリーダー";
    case 1:
      return "出場交代と点差の推移";
    case 2:
      return "ショットチャートとシュートの内訳";
    case 3:
      return "オンザコートの起用とよく使ったラインナップ";
    case 4:
      return `ボックススコア　${homeName}`;
    default:
      return `ボックススコア　${awayName}`;
  }
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

/** 「2026/09/22（火）14:00」。開始時刻（公式の GameDateTime）が読めなければ日付だけ */
function dateLabelOf(game: StoredGame): string {
  const m = /\/Date\((\d+)/.exec(String((game.raw.Game as { GameDateTime?: string }).GameDateTime ?? ""));
  if (m) {
    // 日本時間で読む（見る端末の時間帯に左右されないよう、9時間ずらして UTC の値を読む）
    const d = new Date(Number(m[1]) + 9 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}（${WEEKDAYS[d.getUTCDay()]}）${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }
  const [y, mo, da] = game.date.split("-").map(Number);
  const d = new Date(Date.UTC(y!, mo! - 1, da!));
  return `${game.date.replace(/-/g, "/")}（${WEEKDAYS[d.getUTCDay()]}）`;
}

/** 試合区分（集計の判定 scripts/lib/gameType.ts と同じ決め方） */
function gameTypeLabelOf(conventionNameJ: string): string {
  const isChampionship = /チャンピオンシップ|CHAMPIONSHIP/i.test(conventionNameJ);
  const isBrand = conventionNameJ.includes("B.LEAGUE") || conventionNameJ.includes("Bリーグ");
  return (isChampionship && isBrand) || /PLAYOFFS/i.test(conventionNameJ) ? "ポストシーズン" : "レギュラーシーズン";
}

function resolveColor(color: string | undefined, fallback: string): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (color === MONO_FALLBACK_COLOR) return "#1a1a1a";
  return fallback;
}

function playerRows(rows: BoxscoreRow[]): BoxscoreRow[] {
  return rows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
}

function teamTotalRow(rows: BoxscoreRow[]): BoxscoreRow | undefined {
  return rows.find((r) => r.Category === 3 && r.PeriodCategory === 18);
}

/**
 * 差の大きさ。数の項目と割合の項目を同じものさしで比べるため、「たまたまでは出にくい差か」に直す。
 * - 割合（FG% など）: 成功率の差 ÷ その試投数なら出うるばらつき（2つの割合の差の検定と同じ式）
 * - 数（REB など）: 差 ÷ √(両チームの合計)
 * - 得点の項目（ペイントの得点など）: 1回で2点前後入るので、差 ÷ √(2×両チームの合計)
 */
export function gapScore(kind: KeyStatKind, home: number, away: number, homeAtt = 0, awayAtt = 0): number {
  if (kind === "pct") {
    if (homeAtt <= 0 || awayAtt <= 0) return 0;
    const pooled = Math.min(0.999, Math.max(0.001, (home * homeAtt + away * awayAtt) / (homeAtt + awayAtt)));
    return Math.abs(home - away) / Math.sqrt(pooled * (1 - pooled) * (1 / homeAtt + 1 / awayAtt));
  }
  const sum = home + away;
  if (sum <= 0) return 0;
  return Math.abs(home - away) / Math.sqrt((kind === "points" ? 2 : 1) * sum);
}

const pctText = (v: number) => `${(v * 100).toFixed(2)}%`;

function buildKeyStats(home: BoxscoreRow, away: BoxscoreRow, homePlayers: BoxscoreRow[], awayPlayers: BoxscoreRow[], summary: SummaryRow | undefined): KeyStatRow[] {
  const rows: Omit<KeyStatRow, "highlight" | "better">[] = [];
  const pct = (key: string, label: string, hm: number, ha: number, am: number, aa: number, value?: [number, number]) => {
    const h = value ? value[0] : safeDiv(hm, ha);
    const a = value ? value[1] : safeDiv(am, aa);
    rows.push({
      key,
      label,
      home: h,
      away: a,
      homeText: pctText(h),
      awayText: pctText(a),
      ...(value ? {} : { homeSub: `${hm}/${ha}`, awaySub: `${am}/${aa}` }),
      lowerIsBetter: false,
      gap: gapScore("pct", h, a, ha, aa),
    });
  };
  const num = (key: string, label: string, h: number, a: number, kind: "count" | "points", lowerIsBetter = false) => {
    rows.push({ key, label, home: h, away: a, homeText: String(h), awayText: String(a), lowerIsBetter, gap: gapScore(kind, h, a) });
  };
  const hFgm = home.PT2M + home.PT3M;
  const hFga = home.PT2A + home.PT3A;
  const aFgm = away.PT2M + away.PT3M;
  const aFga = away.PT2A + away.PT3A;
  pct("fg", "FG%", hFgm, hFga, aFgm, aFga);
  pct("2p", "2P%", home.PT2M, home.PT2A, away.PT2M, away.PT2A);
  pct("3p", "3P%", home.PT3M, home.PT3A, away.PT3M, away.PT3A);
  pct("ft", "FT%", home.FTM, home.FTA, away.FTM, away.FTA);
  num("reb", "REB", home.RB_TOT, away.RB_TOT, "count");
  num("or", "OR", home.RB_OFF, away.RB_OFF, "count");
  num("ast", "AST", home.AS, away.AS, "count");
  num("tov", "TOV", home.TO, away.TO, "count", true);
  num("stl", "STL", home.ST, away.ST, "count");
  num("blk", "BLK", home.BS, away.BS, "count");
  if (summary) {
    num("pitp", "ペイントの得点", summary.HomeTeamPT2IN, summary.AwayTeamPT2IN, "points");
    num("fb", "速攻の得点", summary.HomeTeamPTFB, summary.AwayTeamPTFB, "points");
    num("2nd", "セカンドチャンスの得点", summary.HomeTeamPT2ND, summary.AwayTeamPT2ND, "points");
    num("offto", "TOからの得点", summary.HomeTeamPTPFT, summary.AwayTeamPTPFT, "points");
  }
  const bench = (list: BoxscoreRow[]) => list.filter((r) => r.StartingFlg !== 1).reduce((s, r) => s + r.Point, 0);
  num("bench", "ベンチ得点", bench(homePlayers), bench(awayPlayers), "points");

  // 差が大きい上位5項目（差が0の項目は入れない。同じ大きさなら上の並びの順）
  const top = new Set(
    rows
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.gap > 0)
      .sort((a, b) => b.r.gap - a.r.gap || a.i - b.i)
      .slice(0, 5)
      .map((x) => x.r.key),
  );
  return rows.map((r) => ({
    ...r,
    highlight: top.has(r.key),
    better: r.home === r.away ? null : r.home > r.away !== r.lowerIsBetter ? "home" : "away",
  }));
}

/** 同じ数で並んだときの順（試合詳細のゲームリーダーと同じ: 出場時間の長い順 → EFF の高い順 → 背番号の小さい順） */
function compareTieBreak(a: BoxscoreRow, b: BoxscoreRow): number {
  const t = playTimeToSeconds(b.PlayTime) - playTimeToSeconds(a.PlayTime);
  if (t !== 0) return t;
  if (b.EFF !== a.EFF) return b.EFF - a.EFF;
  return Number(a.PlayerNo) - Number(b.PlayerNo);
}

function buildLeaders(rows: BoxscoreRow[], surnames: Map<string, string>): LeaderBlock[] {
  const played = rows.filter((r) => r.PlayTime !== "DNP");
  const defs: { label: string; value: (r: BoxscoreRow) => number }[] = [
    { label: "得点", value: (r) => r.Point },
    { label: "リバウンド", value: (r) => r.RB_TOT },
    { label: "アシスト", value: (r) => r.AS },
  ];
  return defs.map((d) => ({
    label: d.label,
    rows: [...played]
      .sort((a, b) => d.value(b) - d.value(a) || compareTieBreak(a, b))
      .slice(0, 3)
      .map((r) => ({ name: r.PlayerNameJ, surname: surnames.get(r.PlayerID) ?? r.PlayerNameJ, min: r.PlayTime, value: d.value(r) })),
  }));
}

const SEGMENT_LABELS = { "3p": "3P", paint: "ペイント内", mid: "ペイント外", ft: "FT" } as const;

function countsToLine(label: string, c: BoxscoreCounts, extra: Partial<BoxLine> = {}): BoxLine {
  return {
    label,
    min: formatMinutesFromSeconds(c.minSec),
    pts: c.pts,
    reb: c.treb,
    oreb: c.oreb,
    ast: c.ast,
    stocks: c.stl + c.blk,
    tov: c.tov,
    pf: c.foul,
    p2: [c.pt2m, c.pt2a],
    p3: [c.pt3m, c.pt3a],
    ft: [c.ftm, c.fta],
    plusMinus: null,
    pc: null,
    ...extra,
  };
}

function buildBoxTeam(game: StoredGame, isHome: boolean, classificationById: Map<string, PlayerSummary["classification"]>): BoxTeam {
  const ownRows = isHome ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
  const teamId = isHome ? game.homeTeam.id : game.awayTeam.id;
  const pbp = game.raw.PlayByPlays;
  const orderIndex = playTimeOrderIndex(ownRows);
  const assistPoints = pbp.length > 0 ? assistPointsByAssister(buildAssistPairs(pbp, undefined)) : null;
  const recon = reconstructedPeriodPlusMinus(game).get(teamId);
  const players = buildPlayerBoxscores(ownRows, undefined, pbp, []).sort((a, b) => (orderIndex.get(a.playerId) ?? 0) - (orderIndex.get(b.playerId) ?? 0));
  const played = players.filter((p) => !p.dnp);
  const lines = played.map((p) => {
    let plusMinus: number | null = p.counts.hasPlusMinus ? p.counts.plusMinus : null;
    if (plusMinus === null) {
      const byPeriod = recon?.get(p.playerId);
      if (byPeriod) plusMinus = [...byPeriod.values()].reduce((a, v) => a + v, 0);
    }
    const pc = assistPoints ? (pointsCreated({ pts: p.counts.pts, assistPoints: assistPoints.get(p.playerId) ?? 0 }) ?? null) : null;
    return countsToLine(p.nameJ, p.counts, { no: p.playerNo, starter: p.startingFlg === 1, plusMinus, pc });
  });
  const sum = (list: typeof players) => sumCountsList(list.map((p) => p.counts));
  const group = (name: "日本人" | "外国籍・帰化・アジア") => players.filter((p) => classificationGroup(classificationById.get(p.playerId)) === name);
  return {
    players: lines,
    total: countsToLine("チーム合計", buildTeamTotalCounts(ownRows, undefined)),
    subtotals: [
      countsToLine("先発", sum(players.filter((p) => p.startingFlg === 1))),
      countsToLine("ベンチ", sum(players.filter((p) => p.startingFlg !== 1))),
      countsToLine("日本人", sum(group("日本人"))),
      countsToLine("外国籍・帰化・アジア", sum(group("外国籍・帰化・アジア"))),
    ],
    dnp: players.filter((p) => p.dnp).map((p) => p.nameJ),
  };
}

export function buildGameImageModel(input: GameImageInput): GameImageModel {
  const { game, classificationById } = input;
  const homePlayers = playerRows(game.raw.HomeBoxscores);
  const awayPlayers = playerRows(game.raw.AwayBoxscores);
  const homeTotal = teamTotalRow(game.raw.HomeBoxscores);
  const awayTotal = teamTotalRow(game.raw.AwayBoxscores);
  const summary = game.raw.Summaries.find((s) => s.PeriodCategory === 18);
  const quarters = gamePeriodScores(game);
  const periods = quarters.home.length;
  const boundaries = buildPeriodBoundaries(periods);
  const totalSeconds = totalGameSeconds(periods);
  const surnames = buildSurnameMap([homePlayers, awayPlayers].map((rows) => rows.map((r) => ({ id: r.PlayerID, name: r.PlayerNameJ }))));
  const nameOf = new Map([...homePlayers, ...awayPlayers].map((r) => [r.PlayerID, r.PlayerNameJ] as const));
  const orderOf = new Map([...homePlayers, ...awayPlayers].map((r, i) => [r.PlayerID, i] as const));

  const side = (isHome: boolean): TeamSide => {
    const t = isHome ? game.homeTeam : game.awayTeam;
    const score = isHome ? game.homeScore : game.awayScore;
    const other = isHome ? game.awayScore : game.homeScore;
    return {
      id: t.id,
      name: t.name,
      shortName: teamShortName(t.id, t.name),
      color: resolveColor(isHome ? input.homeColor : input.awayColor, isHome ? "#003050" : "#8a9099"),
      score,
      won: score > other,
    };
  };

  // 2枚目・4枚目: 在コートの復元（試合詳細と同じ呼び方）
  let flow: GameImageModel["flow"] = null;
  let usage: GameImageModel["usage"] = null;
  if (input.pbpSupported && game.raw.PlayByPlays.length > 0) {
    const onCourt = reconstructOnCourt(
      game.raw.PlayByPlays,
      game.raw.HomeBoxscores,
      game.raw.AwayBoxscores,
      game.homeTeam.id,
      game.awayTeam.id,
      onCourtPeriodCount(game.season, periods, game.raw.PlayByPlays),
      substitutionModelForSeason(game.season),
    );
    const intervalsByPlayer = new Map<string, { startSec: number; endSec: number }[]>();
    for (const iv of onCourt.intervals) {
      const list = intervalsByPlayer.get(iv.playerId) ?? [];
      list.push({ startSec: iv.startSec, endSec: iv.endSec });
      intervalsByPlayer.set(iv.playerId, list);
    }
    const classify = (playerId: string) => classificationById.get(playerId);
    const sequence = scoringSequence(game.raw.PlayByPlays).events;
    const [homeRun, awayRun] = maxRuns(sequence);
    const timeline = buildScoreTimeline(game.raw.PlayByPlays, { home: game.homeScore, away: game.awayScore }, periods).map((p) => ({ sec: p.elapsedSec, diff: p.diff }));
    const flowTeam = (isHome: boolean): FlowTeam => {
      const rows = orderPlayersByPlayTime(isHome ? homePlayers : awayPlayers);
      const teamId = isHome ? game.homeTeam.id : game.awayTeam.id;
      const run = isHome ? homeRun : awayRun;
      const leads = timeline.map((p) => (isHome ? p.diff : -p.diff));
      const isDnp = (r: BoxscoreRow) => r.PlayTime === "DNP" || (intervalsByPlayer.get(r.PlayerID) ?? []).length === 0;
      return {
        rows: rows
          .filter((r) => !isDnp(r))
          .map((r) => ({
            name: r.PlayerNameJ,
            surname: surnames.get(r.PlayerID) ?? r.PlayerNameJ,
            starter: r.StartingFlg === 1,
            playTime: r.PlayTime,
            intervals: [...(intervalsByPlayer.get(r.PlayerID) ?? [])].sort((a, b) => a.startSec - b.startSec),
          })),
        dnp: rows.filter(isDnp).map((r) => r.PlayerNameJ),
        oc4: foreignOnCourtIntervals(onCourt.lineupStints, teamId, classify, 4).map((iv) => ({ startSec: iv.startSec, endSec: iv.endSec })),
        run: run && run.points > 0 ? { points: run.points, fromSec: run.fromSec, toSec: run.toSec } : null,
        maxLead: Math.max(0, ...leads),
      };
    };
    flow = { home: flowTeam(true), away: flowTeam(false), timeline };

    const maxOc = input.maxForeignOnCourt ?? 4;
    const usageTeam = (isHome: boolean): UsageTeam => {
      const teamId = isHome ? game.homeTeam.id : game.awayTeam.id;
      const lineups = buildGameLineups(onCourt.lineupStints, teamId, undefined, boundaries);
      const totals = rangeTotals(undefined, boundaries, isHome ? quarters.home : quarters.away, isHome ? quarters.away : quarters.home);
      const oc = summarizeByForeignCount(lineups, (row) => foreignCountInLineup(row.playerIds, classify), maxOc, totals);
      const spansOf = (key: string) =>
        mergeSpans(onCourt.lineupStints.filter((s: LineupStint) => s.teamId === teamId && s.lineupKey === key && s.endSec > s.startSec));
      return {
        // 人数の少ない順（OC0 → OC4）、集計外は最後
        oc: [...oc]
          .sort((a, b) => (a.count ?? 99) - (b.count ?? 99))
          .map((s) => ({ count: s.count, seconds: s.seconds, own: s.ownPoints, opp: s.oppPoints })),
        lineups: lineups.slice(0, 3).map((l) => {
          const ids = [...l.playerIds].sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));
          return {
            names: ids.map((id) => nameOf.get(id) ?? id),
            surnames: ids.map((id) => surnames.get(id) ?? nameOf.get(id) ?? id),
            seconds: l.seconds,
            own: l.ownPoints,
            opp: l.oppPoints,
            oc: foreignCountInLineup(l.playerIds, classify),
            spans: spansOf(l.lineupKey),
          };
        }),
      };
    };
    usage = { home: usageTeam(true), away: usageTeam(false), maxOc };
  }

  // 3枚目
  const allShots = input.shotChartSupported ? buildShotEvents(game.raw.PlayByPlays) : [];
  const paintPoints = computePointsInPaint(game.raw.PlayByPlays).byTeam;
  const paintSplit = buildOfficialPaintSplit(game.raw.PlayByPlays).byTeam;
  const shotTeam = (teamId: string, total: BoxscoreRow | undefined): ShotTeam => {
    const split = paintSplit.get(teamId);
    const paint = paintPoints.get(teamId) ?? 0;
    const seg = (key: Segment["key"], value: number): Segment => ({ key, label: SEGMENT_LABELS[key], value });
    return {
      shots: allShots.filter((s) => s.teamId === teamId).map((s) => ({ x: s.x, y: s.y, made: s.made, longShot: s.longShot === true })),
      fgm: total ? total.PT2M + total.PT3M : 0,
      fga: total ? total.PT2A + total.PT3A : 0,
      fgaSegments: total ? [seg("3p", total.PT3A), seg("paint", split?.paint2a ?? 0), seg("mid", split?.nonPaint2a ?? 0)] : [],
      ptsSegments: total ? [seg("3p", total.PT3M * 3), seg("paint", paint), seg("mid", Math.max(0, total.PT2M * 2 - paint)), seg("ft", total.FTM)] : [],
    };
  };

  return {
    scheduleKey: game.scheduleKey,
    season: game.season,
    leagueLabel: input.leagueLabel,
    gameTypeLabel: gameTypeLabelOf(game.raw.Game.ConventionNameJ ?? ""),
    dateLabel: dateLabelOf(game),
    venue: game.raw.Game.StadiumNameJ ?? "",
    attendance: game.raw.Game.Attendance ?? null,
    home: side(true),
    away: side(false),
    periodLabels: boundaries.map((b) => b.label),
    quarters,
    boundaries,
    totalSeconds,
    keyStats: homeTotal && awayTotal ? buildKeyStats(homeTotal, awayTotal, homePlayers, awayPlayers, summary) : [],
    leaders: { home: buildLeaders(homePlayers, surnames), away: buildLeaders(awayPlayers, surnames) },
    flow,
    shots: { home: shotTeam(game.homeTeam.id, homeTotal), away: shotTeam(game.awayTeam.id, awayTotal), hasPositions: allShots.length > 0 },
    usage,
    box: { home: buildBoxTeam(game, true, classificationById), away: buildBoxTeam(game, false, classificationById) },
  };
}

/** つながった区間（終わりと次の始まりが同じ）を1つにまとめる */
function mergeSpans(stints: { startSec: number; endSec: number }[]): { startSec: number; endSec: number }[] {
  const out: { startSec: number; endSec: number }[] = [];
  for (const s of [...stints].sort((a, b) => a.startSec - b.startSec)) {
    const last = out[out.length - 1];
    if (last && s.startSec <= last.endSec) last.endSec = Math.max(last.endSec, s.endSec);
    else out.push({ startSec: s.startSec, endSec: s.endSec });
  }
  return out;
}

/** 保存するファイルの名前（「506381_A東京-琉球_1.png」） */
export function gameImageFilename(model: GameImageModel, index: number, ext: string): string {
  const safe = (s: string) => s.replace(/[\\/:*?"<>|\s]/g, "");
  return `${model.scheduleKey}_${safe(model.home.shortName)}-${safe(model.away.shortName)}_${index + 1}.${ext}`;
}
