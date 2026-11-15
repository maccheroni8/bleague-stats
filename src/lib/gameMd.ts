// 試合詳細の md（AI向けの書き出し）。画面・通信とは独立した純粋な組み立て。
// 値は試合詳細の画面・保存画像（397章）と同じ関数（ボックススコアの列・在コートの復元・得点の流れ・ショットのゾーン）を呼ぶだけ。
// 保存キーの対象のファイルは変えない（このファイルを shared/ から import しないこと）。
import type { BoxscoreRow, YahooGamePbp } from "../../shared/types";
import { scoringSequence, type ScoringEvent } from "../../shared/gameFlow";
import { judgeClutch } from "../../shared/clutchTime";
import { computeOnCourtRatings, onCourtPeriodCount } from "../../shared/onCourt";
import { buildOfficialPaintSplit } from "../../shared/paintSplit";
import { normalizePlayerName } from "../../shared/playerName";
import { BOXSCORE_TABS, boxSummaryColumns, buildBoxscoreTeamData, gameDetailColumnsFor, type BoxscoreColumn, type BoxscoreTabKey, type ColumnCtx } from "../components/BoxscoreTable";
import { buildGameImageModel, gapScore, type GameImageInput, type GameImageModel, type LineupCard } from "./gameImages/model";
import { formatMinutesFromSeconds, sumCountsList, playTimeToSeconds, type BoxscoreCounts } from "./boxscoreAggregate";
import { OR_PCT_UNAVAILABLE_NOTE } from "./gameOrPct";
import { ON_COURT_SHARE_UNAVAILABLE_NOTE } from "./gameOnCourtShare";
import { classificationGroup, splitClassificationSeason } from "./classificationFilter";
import { foulColumnsSplit } from "./ruleChange";
import { statDescription } from "./statDescriptions";
import { reconstructedPeriodPlusMinus } from "./playerSeasonBoxscore";
import { buildShotEvents, buildZoneStats } from "./shotChart";
import { buildShotTypeBreakdownByPlayer, buildShotTypeBreakdownByTeam, shotTypeLabel, sortShotTypeKeys } from "./shotTypeBreakdown";
import { orderPlayersByPlayTime } from "./boxscoreOrder";
import { gameFlowFor } from "./gameFlowForGame";
import type { League } from "./league";

export interface GameMdInput extends GameImageInput {
  league: League;
  /** スポーツナビの記録（B.PREMIER の対応シーズンだけ。無ければ null） */
  yahooPbp: YahooGamePbp | null;
  /** 書き出した日（YYYY-MM-DD） */
  exportedAt: string;
}

export interface GameMdOutput {
  markdown: string;
  filename: string;
  characters: number;
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
export const mdTable = (head: string[], rows: string[][]) => [head, head.map(() => "---"), ...rows].map((r) => `|${r.map(esc).join("|")}|`).join("\n");

const NO_DATA = "-";
const pct2 = (made: number, att: number) => (att > 0 ? `${((made / att) * 100).toFixed(2)}%` : NO_DATA);
const ratio = (made: number, att: number) => (att > 0 ? `${made}/${att}（${pct2(made, att)}）` : `${made}/${att}（-）`);
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;

// ---- 時刻（試合開始からの経過秒 → 「2Q 残り7:32」） ----
const periodStart = (p: number) => (p <= 4 ? (p - 1) * 600 : 2400 + (p - 5) * 300);
const periodLen = (p: number) => (p <= 4 ? 600 : 300);
function periodName(p: number, total: number): string {
  if (p <= 4) return `${p}Q`;
  return total - 4 > 1 ? `OT${p - 4}` : "OT";
}
/** 出来事の時刻（区間の終わり・得点など）。ピリオドの境目はそのピリオドの終わり（残り0:00） */
function atEnd(sec: number, total: number): string {
  let p = 1;
  while (p < total && sec > periodStart(p) + periodLen(p)) p += 1;
  return `${periodName(p, total)} 残り${clock(Math.max(0, periodStart(p) + periodLen(p) - sec))}`;
}
/** 区間の始まり。ピリオドの境目は次のピリオドの始まり（残り10:00） */
function atStart(sec: number, total: number): string {
  let p = 1;
  while (p < total && sec >= periodStart(p) + periodLen(p)) p += 1;
  return `${periodName(p, total)} 残り${clock(Math.max(0, periodStart(p) + periodLen(p) - sec))}`;
}

class UsedLabels {
  readonly set = new Set<string>();
  add(l: string): string {
    this.set.add(l);
    return l;
  }
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, "");
}

export function buildGameMd(input: GameMdInput): GameMdOutput {
  const { game } = input;
  const model = buildGameImageModel(input);
  const used = new UsedLabels();
  const periods = model.quarters.home.length;
  const total = onCourtPeriodCount(game.season, periods, game.raw.PlayByPlays);
  const seq = game.raw.PlayByPlays.length > 0 ? scoringSequence(game.raw.PlayByPlays).events : [];
  const manual = String((game.meta as { source?: string } | undefined)?.source ?? "").startsWith("manual:");
  const out: string[] = [];
  const homeName = game.homeTeam.name;
  const awayName = game.awayTeam.name;
  const title = `${homeName} vs ${awayName}`;
  const filename = `${model.scheduleKey}_${safeName(model.home.shortName)}-${safeName(model.away.shortName)}_${game.season}${input.league === "one" ? "_B.ONE" : ""}_試合情報_${game.date}.md`;

  out.push(`# ${title}（${game.date}・${game.season}シーズン）試合情報`, "");
  out.push(`> サイトの試合詳細ページ（キースタッツ・ゲームリーダー・出場交代と点差の推移・ショットチャート・オンザコート・ラインナップ・ボックススコア）と同じ計算の数字を、省かずに書き出したものです。数字の書き方はサイトと同じ（割合は小数第2位、分母が0の割合は「-」、時間は分:秒）。ホーム＝${homeName}、アウェイ＝${awayName}。`, "");
  if (manual) out.push("> この試合は公式サイトにボックススコアが無いため、他の公開記録の試合合計から作っています。Q別の選手スタッツ・出場交代・プレー記録・ペイント内などプレーバイプレーから数える項目・チームリバウンド・+/- は含まれません。", "");

  out.push(...sectionBasic(input, model));
  out.push(...sectionKeyStats(input, model, used));
  out.push(...sectionLeaders(input));
  out.push(...sectionFlow(input, model, seq, total));
  out.push(...sectionShots(input, model, used));
  out.push(...sectionUsage(input, model, used));
  out.push(...sectionBoxscore(input, model, used));
  out.push(...sectionDefinitions(used));
  const markdown = out.join("\n");
  return { markdown, filename, characters: Array.from(markdown).length };
}

// ---- 1. 試合の基本 ----
function sectionBasic(input: GameMdInput, m: GameImageModel): string[] {
  const { game } = input;
  const q = m.quarters;
  const n = q.home.length;
  const labels = m.periodLabels;
  const half = (a: number[], from: number, to: number) => a.slice(from, to).reduce((s, v) => s + v, 0);
  const head = ["チーム", ...labels, ...(n >= 4 ? ["前半", "後半"] : []), "合計"];
  const row = (name: string, a: number[], score: number) => [name, ...a.map(String), ...(n >= 4 ? [String(half(a, 0, 2)), String(half(a, 2, 4))] : []), String(score)];
  const result = m.home.won ? `${m.home.name}の勝ち` : m.away.won ? `${m.away.name}の勝ち` : "引き分け";
  const ot = n > 4 ? `あり（${n - 4}回）` : "なし";
  return [
    "## 1. 試合の基本",
    "",
    mdTable(["項目", "内容"], [
      ["対戦", `${m.home.name}（ホーム）vs ${m.away.name}（アウェイ）`],
      ["最終スコア", `${m.home.score}-${m.away.score}（${result}）`],
      ["試合ID（ScheduleKey）", m.scheduleKey],
      ["日時", m.dateLabel],
      ["会場", m.venue || NO_DATA],
      ["来場者数", m.attendance != null ? `${m.attendance.toLocaleString("ja-JP")}人` : NO_DATA],
      ["リーグ", m.leagueLabel],
      ["シーズン", `${m.season}シーズン`],
      ["試合区分", m.gameTypeLabel],
      ["延長", ot],
      ["登録区分の基準", splitClassificationSeason(game.season) ? "試合の日の登録区分（日本人は見做し日本人を含む）" : "現在の登録情報に基づく参考値"],
      ["書き出した日", input.exportedAt],
    ]),
    "",
    "### クォーター別スコア",
    "",
    mdTable(head, [row(m.home.name, q.home, m.home.score), row(m.away.name, q.away, m.away.score)]),
    "",
    ...(n > 4 ? ["- 延長を含む試合です。前半＝1Q・2Q、後半＝3Q・4Q（延長は含めない）。合計は延長を含む最終スコア。", ""] : []),
  ];
}

// ---- 2. キースタッツ ----
function sectionKeyStats(input: GameMdInput, m: GameImageModel, used: UsedLabels): string[] {
  const { game } = input;
  const out: string[] = ["## 2. キースタッツ", ""];
  const homeTotal = game.raw.HomeBoxscores.find((r) => r.Category === 3 && r.PeriodCategory === 18);
  const awayTotal = game.raw.AwayBoxscores.find((r) => r.Category === 3 && r.PeriodCategory === 18);
  if (!homeTotal || !awayTotal) return [...out, "- チーム合計の記録がないため出せません。", ""];
  const fmt = (v: number, d = 2) => v.toFixed(d);
  const rows: string[][] = [];
  const gapOf = new Map(m.keyStats.map((k) => [k.key, k] as const));
  const push = (label: string, h: string, a: string, diff: string, key?: string, dir: "high" | "low" | null = "high") => {
    used.add(label);
    const k = key ? gapOf.get(key) : undefined;
    const hn = Number(h.replace(/[%,]/g, "").split("（")[0]);
    const an = Number(a.replace(/[%,]/g, "").split("（")[0]);
    const cmp = k ? (k.better === "home" ? 1 : k.better === "away" ? -1 : 0) : dir && Number.isFinite(hn) && Number.isFinite(an) ? Math.sign(hn - an) * (dir === "high" ? 1 : -1) : null;
    const better = cmp === null ? "" : cmp > 0 ? m.home.shortName : cmp < 0 ? m.away.shortName : "同じ";
    rows.push([k?.highlight ? `**${label}**` : label, h, a, diff, better, k ? fmt(k.gap) : NO_DATA, k?.highlight ? "★" : ""]);
  };
  // 割合（成功/試投つき）と数
  const pctRow = (key: string, label: string, hm: number, ha: number, am: number, aa: number) =>
    push(label, ratio(hm, ha), ratio(am, aa), ha > 0 && aa > 0 ? `${(((hm / ha) - (am / aa)) * 100).toFixed(2)}pt` : NO_DATA, key);
  const numRow = (key: string | undefined, label: string, h: number, a: number, dir: "high" | "low" | null = "high") => push(label, String(h), String(a), signed(h - a), key, dir);
  const H = homeTotal;
  const A = awayTotal;
  pctRow("fg", "FG%", H.PT2M + H.PT3M, H.PT2A + H.PT3A, A.PT2M + A.PT3M, A.PT2A + A.PT3A);
  pctRow("2p", "2P%", H.PT2M, H.PT2A, A.PT2M, A.PT2A);
  pctRow("3p", "3P%", H.PT3M, H.PT3A, A.PT3M, A.PT3A);
  pctRow("ft", "FT%", H.FTM, H.FTA, A.FTM, A.FTA);
  numRow(undefined, "PTS", H.Point, A.Point);
  numRow("reb", "TR", H.RB_TOT, A.RB_TOT);
  numRow("or", "OR", H.RB_OFF, A.RB_OFF);
  numRow(undefined, "DR", H.RB_DEF, A.RB_DEF);
  numRow("ast", "AST", H.AS, A.AS);
  numRow("tov", "TOV", H.TO, A.TO, "low");
  numRow("stl", "STL", H.ST, A.ST);
  numRow("blk", "BLK", H.BS, A.BS);
  numRow(undefined, "STOCKS", H.ST + H.BS, A.ST + A.BS);
  numRow(undefined, "F", H.FOUL, A.FOUL, "low");
  const summary = game.raw.Summaries.find((s) => s.PeriodCategory === 18);
  if (summary) {
    numRow("pitp", "PITP", summary.HomeTeamPT2IN, summary.AwayTeamPT2IN);
    numRow("fb", "FBPS", summary.HomeTeamPTFB, summary.AwayTeamPTFB);
    numRow("2nd", "2ND PTS", summary.HomeTeamPT2ND, summary.AwayTeamPT2ND);
    numRow("offto", "PTSOFFTO", summary.HomeTeamPTPFT, summary.AwayTeamPTPFT);
  }
  const bench = (list: BoxscoreRow[]) => list.filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.StartingFlg !== 1).reduce((s, r) => s + r.Point, 0);
  numRow("bench", "BENCH PTS", bench(game.raw.HomeBoxscores), bench(game.raw.AwayBoxscores));
  // 試合の流れ
  const flow = gameFlowFor(game);
  if (flow) {
    numRow(undefined, "MAX LEAD", flow.homeLead, flow.awayLead);
    numRow(undefined, "MAX RUN", flow.homeRun, flow.awayRun);
  }
  // テンポと効率・Four Factors（ボックススコアのアドバンスドのチーム合計行と同じ値）
  const adv = teamAdvancedValues(input);
  for (const [label, key] of [["eFG%", "efg"], ["TS%", "ts"], ["TOV%", "tovpct"], ["OR%", "orpct"], ["FTR", "ftr"], ["ORtg", "ortg"], ["DRtg", "drtg"], ["NetRtg", "netrtg"], ["POSS", "poss"], ["PACE", "pace"]] as const) {
    const v = adv[key];
    if (v) push(label, v[0], v[1], v[2], undefined, label === "TOV%" || label === "DRtg" ? "low" : label === "POSS" || label === "PACE" ? null : "high");
  }
  out.push(
    mdTable(["項目", `${m.home.shortName}（ホーム）`, `${m.away.shortName}（アウェイ）`, "差（ホーム−アウェイ）", "優位（良い側）", "差の大きさ", "注目"], rows),
    "",
  );
  const top = m.keyStats.filter((k) => k.highlight).sort((a, b) => b.gap - a.gap);
  out.push(
    "- **注目（★・太字）＝差が大きかった上位5項目**。比べる項目は、FG%・2P%・3P%・FT%・TR・OR・AST・TOV・STL・BLK・PITP・FBPS・2ND PTS・PTSOFFTO・BENCH PTS の15項目（保存画像と同じ）。数の項目と割合の項目を同じものさしで比べるため、「たまたまでは出にくい差か」に直した値が「差の大きさ」（大きいほど差が大きい）。割合＝2つの割合の差の検定の式、数＝差÷√(両チームの合計)、得点の項目＝差÷√(2×両チームの合計)。同じ大きさのときは表の上の項目を先にする。他の項目（PTS・DR・STOCKS・F・MAX LEAD・MAX RUN・Four Factors・レーティング）は比べる対象に入れていないため「差の大きさ」は「-」。",
    top.length ? `- 差が大きかった順：${top.map((k) => `${k.label}（${k.home === k.away ? "同じ" : k.better === "home" ? m.home.shortName : m.away.shortName}が優位。${k.homeSub ? `${k.homeText}（${k.homeSub}）対 ${k.awayText}（${k.awaySub}）` : `${k.homeText}対${k.awayText}`}）`).join("、")}` : "- 差が大きい項目はありません。",
    "- TOV・F・TOV%・DRtg は少ないほうが優位。優位の欄は数字が良い側（同じ値は「同じ」。POSS・PACE は良し悪しがないため空欄）。",
    "- ORtg・DRtg・NetRtg・POSS・PACE は推定式（ボックススコアのアドバンスドのチーム合計行と同じ。実際のポゼッションは使わない）。DRtg は相手の ORtg、NetRtg は ORtg の差なので、ORtg の言い換えです。POSS・PACE は両チームで同じ値（PACE は両チームの平均・40分換算）。TOV% は TOV÷(FGA＋0.44×FTA＋TOV)。",
    "",
  );
  void gapScore;
  return out;
}

/** ボックススコアのアドバンスドのチーム合計行と同じ値（[ホーム, アウェイ, 差]）。取れない項目は含めない */
function teamAdvancedValues(input: GameMdInput): Record<string, [string, string, string] | undefined> {
  const { game } = input;
  const cols = gameDetailColumnsFor("advanced", foulColumnsSplit([game.season]));
  const data = (side: "home" | "away") => teamData(input, side, cols);
  const h = data("home");
  const a = data("away");
  const res: Record<string, [string, string, string] | undefined> = {};
  for (const col of cols) {
    const hv = cellOf(col, h.teamTotal, h.teamTotalCtx);
    const av = cellOf(col, a.teamTotal, a.teamTotalCtx);
    const hn = Number(hv.replace(/[%,]/g, ""));
    const an = Number(av.replace(/[%,]/g, ""));
    const isPct = hv.endsWith("%");
    const d = Number.isFinite(hn) && Number.isFinite(an) ? `${signed(Number((hn - an).toFixed(2)))}${isPct ? "pt" : ""}` : NO_DATA;
    res[col.key] = [hv, av, d];
  }
  return res;
}

function teamData(input: GameMdInput, side: "home" | "away", columns: BoxscoreColumn[]) {
  const { game } = input;
  const isHome = side === "home";
  const ownRows = isHome ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
  const oppRows = isHome ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
  const periods = onCourtPeriodCount(game.season, gamePeriodsOf(input), game.raw.PlayByPlays);
  const model = cachedModel(input);
  const lineupStints = model.onCourt?.lineupStints ?? [];
  const onCourtRatings = input.shotChartSupported && model.onCourt ? computeOnCourtRatings(model.onCourt.intervals) : {};
  const manual = String((game.meta as { source?: string } | undefined)?.source ?? "").startsWith("manual:");
  const d = buildBoxscoreTeamData({
    ownRows,
    oppRows,
    side,
    summaries: game.raw.Summaries,
    playByPlays: game.raw.PlayByPlays,
    yahooTurnovers: input.yahooPbp?.turnovers ?? [],
    periodOption: undefined,
    columns,
    onCourtRatings,
    lineupStints,
    totalPeriods: periods,
    reconstructedPlusMinus: reconstructedPeriodPlusMinus(game),
  });
  const base = { own: d.teamTotal, ownPlayType: d.playType, shotChartSupported: input.shotChartSupported, yahooPbpSupported: input.yahooPbp !== null, noFlow: manual };
  const playerCtx: ColumnCtx = { ...base, isPlayerRow: true, isTeamTotalRow: false };
  const nonPlayerCtx: ColumnCtx = { ...base, isPlayerRow: false, isTeamTotalRow: false };
  const teamTotalCtx: ColumnCtx = { ...base, ratings: d.ratings, oppDreb: d.oppTeamTotal.dreb, isPlayerRow: false, isTeamTotalRow: true };
  return { ...d, playerCtx, nonPlayerCtx, teamTotalCtx, manual };
}

/** 割合の項目で分母が0のとき true（サイトの一部の列は 0.00% と出すが、md では決まりどおり「-」にそろえる） */
function zeroDenominator(key: string, c: BoxscoreCounts): boolean {
  const fga = c.pt2a + c.pt3a;
  switch (key) {
    case "fgpct": case "efg": case "pps": case "ftr": return fga <= 0;
    case "2ppct": return c.pt2a <= 0;
    case "3ppct": return c.pt3a <= 0;
    case "ftpct": return c.fta <= 0;
    case "ts": return fga + 0.44 * c.fta <= 0;
    case "tovpct": case "ppp": return fga + 0.44 * c.fta + c.tov <= 0;
    case "paint2pct": return c.paint2a <= 0;
    case "mid2pct": return c.nonPaint2a <= 0;
    default: return false;
  }
}
const cellOf = (col: BoxscoreColumn, c: BoxscoreCounts, ctx: ColumnCtx) => (zeroDenominator(col.key, c) ? NO_DATA : col.format(c, ctx));

const modelCache = new WeakMap<GameMdInput, GameImageModel>();
function cachedModel(input: GameMdInput): GameImageModel {
  let m = modelCache.get(input);
  if (!m) {
    m = buildGameImageModel(input);
    modelCache.set(input, m);
  }
  return m;
}
function gamePeriodsOf(input: GameMdInput): number {
  return cachedModel(input).quarters.home.length;
}

// ---- 3. ゲームリーダー ----
function sectionLeaders(input: GameMdInput): string[] {
  const { game } = input;
  const out: string[] = ["## 3. ゲームリーダー", ""];
  const defs: { label: string; value: (r: BoxscoreRow) => number }[] = [
    { label: "得点（PTS）", value: (r) => r.Point },
    { label: "リバウンド（TR）", value: (r) => r.RB_TOT },
    { label: "アシスト（AST）", value: (r) => r.AS },
    { label: "スティール（STL）", value: (r) => r.ST },
    { label: "ブロック（BLK）", value: (r) => r.BS },
    { label: "3ポイント成功（3PM）", value: (r) => r.PT3M },
    { label: "EFF", value: (r) => r.EFF },
  ];
  const tie = (a: BoxscoreRow, b: BoxscoreRow) => playTimeToSeconds(b.PlayTime) - playTimeToSeconds(a.PlayTime) || b.EFF - a.EFF || Number(a.PlayerNo) - Number(b.PlayerNo);
  out.push("- 項目ごとに上位3人（同じ数のときは出場時間の長い順 → EFF の高い順 → 背番号の小さい順）。順位は値が同じなら同じ順位。出場しなかった選手は除く。", "");
  for (const [name, rows] of [[game.homeTeam.name, game.raw.HomeBoxscores], [game.awayTeam.name, game.raw.AwayBoxscores]] as const) {
    const players = rows.filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.PlayTime !== "DNP");
    const body: string[][] = [];
    for (const d of defs) {
      const sorted = [...players].sort((a, b) => d.value(b) - d.value(a) || tie(a, b)).slice(0, 3);
      let prev = Number.NaN;
      let rank = 0;
      sorted.forEach((r, i) => {
        const v = d.value(r);
        if (v !== prev) rank = i + 1;
        prev = v;
        body.push([i === 0 ? d.label : "", `${rank}位`, `${normalizePlayerName(r.PlayerNameJ)}（#${r.PlayerNo}）`, r.PlayTime, String(v)]);
      });
    }
    out.push(`### ${name}`, "", mdTable(["項目", "順位", "選手", "MIN", "値"], body), "");
  }
  return out;
}

// ---- 4. 試合の流れ ----
interface RunInfo { home: boolean; points: number; fromSec: number; toSec: number; before: [number, number]; after: [number, number] }
function allRuns(events: ScoringEvent[]): RunInfo[] {
  const runs: RunInfo[] = [];
  let cur: RunInfo | null = null;
  let prev: [number, number] = [0, 0];
  for (const e of events) {
    if (cur && cur.home === e.home) {
      cur.points += e.points;
      cur.toSec = e.elapsedSec;
      cur.after = [e.homeScore, e.awayScore];
    } else {
      cur = { home: e.home, points: e.points, fromSec: e.elapsedSec, toSec: e.elapsedSec, before: prev, after: [e.homeScore, e.awayScore] };
      runs.push(cur);
    }
    prev = [e.homeScore, e.awayScore];
  }
  return runs;
}

function sectionFlow(input: GameMdInput, m: GameImageModel, seq: ScoringEvent[], total: number): string[] {
  const { game } = input;
  const out: string[] = ["## 4. 試合の流れ", ""];
  if (!m.flow || seq.length === 0) return [...out, "- この試合・シーズンはプレーバイプレーの記録がないため、点差の推移と出場交代は出せません。", ""];
  // リードチェンジ・同点
  let leader = 0;
  let changes = 0;
  let ties = 0;
  let homeLead = 0;
  let awayLead = 0;
  for (const e of seq) {
    const diff = e.homeScore - e.awayScore;
    homeLead = Math.max(homeLead, diff);
    awayLead = Math.max(awayLead, -diff);
    const s = Math.sign(diff);
    if (s === 0) ties += 1;
    else {
      if (leader !== 0 && s !== leader) changes += 1;
      leader = s;
    }
  }
  out.push("### 点差の推移の要点", "", mdTable(["項目", "内容"], [
    ["最大リード", `${m.home.shortName} ${m.flow.home.maxLead}点／${m.away.shortName} ${m.flow.away.maxLead}点`],
    ["リードチェンジ", `${changes}回`],
    ["同点", `${ties}回`],
    ["最大のラン（連続得点）", `${m.home.shortName} ${m.flow.home.run ? `${m.flow.home.run.points}-0` : NO_DATA}／${m.away.shortName} ${m.flow.away.run ? `${m.flow.away.run.points}-0` : NO_DATA}`],
  ]), "");
  void homeLead;
  void awayLead;
  out.push("- 最大リード＝そのチームが最も大きくリードした点差。リードチェンジ＝リードしているチームが入れ替わった回数（同点をはさんでも1回）。同点＝得点で同点になった回数（試合開始の0-0は数えない）。ラン＝相手の得点をはさまない連続得点（12-0 は12点連続）。", "");
  // ラン
  const runs = allRuns(seq);
  const runRows = (home: boolean) =>
    runs
      .filter((r) => r.home === home && r.points >= 6)
      .sort((a, b) => b.points - a.points || a.fromSec - b.fromSec)
      .slice(0, 5)
      .map((r) => [`${r.points}-0`, `${atStart(r.fromSec - 0.0001, total)}〜${atEnd(r.toSec, total)}`, `${r.before[0]}-${r.before[1]} → ${r.after[0]}-${r.after[1]}`]);
  out.push("### 大きなラン（6点以上の連続得点。大きい順に最大5つ）", "");
  for (const [home, name] of [[true, m.home.name], [false, m.away.name]] as const) {
    const rows = runRows(home);
    out.push(`#### ${name}`, "", rows.length ? mdTable(["ラン", "時間帯（最初の得点〜最後の得点）", "スコア（ホーム-アウェイ）の変化"], rows) : "- 6点以上のランはありません。", "");
  }
  // クラッチタイム
  out.push("### クラッチタイム", "");
  const j = judgeClutch(game.raw.PlayByPlays, game.homeTeam.id, game.homeScore, game.awayScore);
  if (!j.ok) {
    out.push(`- 判定できません（理由：${({ "no-pbp": "プレーバイプレーの記録がない", "short-game": "4クォーターまで試合が進んでいない", "score-sequence": "得点の並びが読めない", "final-score": "最終スコアと記録が合わない" } as const)[j.reason]}）。`, "");
  } else if (!j.judgement.isClutchGame) {
    out.push("- この試合にクラッチタイム（第4Q・延長の残り5:00以下で5点差以内）はありませんでした。", "");
  } else {
    const jd = j.judgement;
    const scoringCodes = new Set([1, 3, 4, 7, 44]);
    const flagged = new Set<string>();
    jd.playByPlays.forEach((ev, i) => {
      if (jd.flags[i] && scoringCodes.has(ev.ActionCD1) && ev.Score) flagged.add(ev.Score);
    });
    let hp = 0;
    let ap = 0;
    for (const e of seq) {
      if (!flagged.has(`${e.homeScore}-${e.awayScore}`)) continue;
      if (e.home) hp += e.points;
      else ap += e.points;
    }
    const first = jd.windows[0]![0];
    const before = [...seq].filter((e) => e.elapsedSec <= first).at(-1);
    out.push(
      mdTable(["項目", "内容"], [
        ["クラッチタイムの時間", `合計 ${clock(jd.seconds)}`],
        ["時間帯", jd.windows.map(([s, e]) => `${atStart(s, total)}〜${atEnd(e, total)}`).join("、")],
        ["開始時点のスコア（ホーム-アウェイ）", before ? `${before.homeScore}-${before.awayScore}` : "0-0"],
        ["クラッチタイム中の得点", `${m.home.shortName} ${hp}点／${m.away.shortName} ${ap}点（${m.home.shortName}${signed(hp - ap)}）`],
      ]),
      "",
      "- クラッチタイム＝第4Q・延長の残り5:00以下で、プレーの直前の点差が5点以内の時間（プレーごとに判定。時間が途切れて複数の時間帯になることがある）。",
      "",
    );
  }
  // 出場交代
  out.push("### 出場交代（コートにいた時間帯）", "");
  for (const [name, team] of [[m.home.name, m.flow.home], [m.away.name, m.flow.away]] as const) {
    const rows = team.rows.map((r) => {
      const merged: { startSec: number; endSec: number }[] = [];
      for (const iv of r.intervals) {
        const last = merged.at(-1);
        if (last && iv.startSec <= last.endSec) last.endSec = Math.max(last.endSec, iv.endSec);
        else merged.push({ ...iv });
      }
      return [normalizePlayerName(r.name), r.starter ? "先発" : "ベンチ", r.playTime, String(merged.length), merged.map((iv) => `${atStart(iv.startSec, total)}〜${atEnd(iv.endSec, total)}`).join("、")];
    });
    out.push(`#### ${name}`, "", mdTable(["選手", "区分", "MIN", "出場回数", "出場していた時間帯"], rows), "");
    if (team.dnp.length) out.push(`- 出場しなかった選手：${team.dnp.map(normalizePlayerName).join("、")}`, "");
  }
  out.push("- 出場していた時間帯は、プレーバイプレーの交代の記録から復元した在コートの区間（ボックススコアの出場時間と一致するよう、同じ秒の交代は記録順に処理）。出場回数＝コートに入った回数。", "");
  return out;
}

// ---- 5. シュート ----
function sectionShots(input: GameMdInput, m: GameImageModel, used: UsedLabels): string[] {
  const { game } = input;
  const out: string[] = ["## 5. シュート", ""];
  // 内訳（保存画像3枚目と同じ分け方）
  const paint = buildOfficialPaintSplit(game.raw.PlayByPlays).byTeam;
  const breakdownRows: string[][] = [];
  for (const [name, t, id, total] of [[m.home.name, m.shots.home, game.homeTeam.id, game.raw.HomeBoxscores.find((r) => r.Category === 3 && r.PeriodCategory === 18)], [m.away.name, m.shots.away, game.awayTeam.id, game.raw.AwayBoxscores.find((r) => r.Category === 3 && r.PeriodCategory === 18)]] as const) {
    if (!total) continue;
    const split = paint.get(id);
    const fga = total.PT2A + total.PT3A;
    const fgaShare = (n: number) => (fga > 0 ? `${((n / fga) * 100).toFixed(2)}%` : NO_DATA);
    const paintPts = t.ptsSegments.find((s) => s.key === "paint")?.value ?? 0;
    const midPts = t.ptsSegments.find((s) => s.key === "mid")?.value ?? 0;
    const totalPts = total.Point;
    const ptsShare = (n: number) => (totalPts > 0 ? `${((n / totalPts) * 100).toFixed(2)}%` : NO_DATA);
    breakdownRows.push(
      [name, "3P", ratio(total.PT3M, total.PT3A), fgaShare(total.PT3A), String(total.PT3M * 3), ptsShare(total.PT3M * 3)],
      [name, "ペイント内の2P", split ? ratio(split.paint2m, split.paint2a) : NO_DATA, split ? fgaShare(split.paint2a) : NO_DATA, String(paintPts), ptsShare(paintPts)],
      [name, "ペイント外の2P", split ? ratio(split.nonPaint2m, split.nonPaint2a) : NO_DATA, split ? fgaShare(split.nonPaint2a) : NO_DATA, String(midPts), ptsShare(midPts)],
      [name, "FT", ratio(total.FTM, total.FTA), "-", String(total.FTM), ptsShare(total.FTM)],
    );
  }
  out.push("### シュートの内訳", "", mdTable(["チーム", "種類", "成功/試投（成功率）", "FGAに占める割合", "得点", "総得点に占める割合"], breakdownRows), "",
    "- ペイント内／外はボックススコアと同じ公式の区分（インサイドペイント／アウトサイドペイント）。ペイント内の2Pの得点はキースタッツの PITP と同じ値（プレーバイプレーから数えたペイント内の得点）、ペイント外の2Pの得点＝2Pの得点−ペイント内の得点。FGAに占める割合の分母＝FGA、総得点に占める割合の分母＝チームの得点。", "");
  // エリア別
  out.push("### エリア別の成功/試投（ショットチャートのゾーン）", "");
  if (!input.shotChartSupported || !m.shots.hasPositions) {
    out.push("- このシーズンの記録にはシュートの位置（座標）がないため、エリア別は出せません（2022-23シーズン以降）。", "");
  } else {
    const hz = buildZoneStats(game.raw.PlayByPlays.length ? shotsOf(input, game.homeTeam.id) : []);
    const az = buildZoneStats(game.raw.PlayByPlays.length ? shotsOf(input, game.awayTeam.id) : []);
    const rows = hz.map((z, i) => [z.zone.label, ratio(z.makes, z.attempts), ratio(az[i]!.makes, az[i]!.attempts)]);
    const sum = (zs: typeof hz) => zs.reduce((a, z) => ({ made: a.made + z.makes, att: a.att + z.attempts }), { made: 0, att: 0 });
    const hs = sum(hz);
    const as = sum(az);
    rows.push(["エリア合計", ratio(hs.made, hs.att), ratio(as.made, as.att)]);
    const fgAtt = (id: string) => (id === game.homeTeam.id ? m.shots.home.fga : m.shots.away.fga);
    out.push(mdTable(["エリア", `${m.home.shortName}（ホーム）`, `${m.away.shortName}（アウェイ）`], rows), "",
      `- エリアはリングからの距離と角度で分けたショットチャートの12ゾーン（リストリクテッドエリア＝リング周り1.25m以内、ペイント＝ペイントの長方形、ショートコーナー、ミッドレンジ左・中・右、コーナー3、ウィング3、トップ3）。センターラインより後ろからのロングシュート（${m.shots.home.shots.filter((s) => s.longShot).length + m.shots.away.shots.filter((s) => s.longShot).length}本）は、ブザー間際の投げ込みが多く3Pの成功率をゆがめるため、どのエリアにも入れていません。`,
      `- エリア合計とFGの試投（ホーム ${fgAtt(game.homeTeam.id)}・アウェイ ${fgAtt(game.awayTeam.id)}）の差は、ロングシュートとゾーン外のシュート。`, "");
  }
  // シュートタイプ（スポーツナビ）
  const yp = input.yahooPbp;
  out.push("### シュートタイプ別の成功/試投（スポーツナビの記録）", "");
  if (!yp) {
    out.push("- この試合・シーズンにはスポーツナビの記録がないため、シュートタイプ別は出せません（B.PREMIER の2023-24シーズン以降）。", "");
  } else {
    const byTeam = buildShotTypeBreakdownByTeam(yp.shots);
    const keys = sortShotTypeKeys([...new Set(yp.shots.map((s) => s.shotType).filter((t) => t.length > 0))]);
    const hb = byTeam.get(game.homeTeam.id) ?? {};
    const ab = byTeam.get(game.awayTeam.id) ?? {};
    const cell = (c: { made: number; attempted: number } | undefined) => (c && c.attempted > 0 ? ratio(c.made, c.attempted) : NO_DATA);
    const rows = keys.map((k) => [used.add(shotTypeLabel(k)), cell(hb[k]?.twoPoint), cell(hb[k]?.threePoint), cell(ab[k]?.twoPoint), cell(ab[k]?.threePoint)]);
    out.push(mdTable(["シュートタイプ", `${m.home.shortName} 2P`, `${m.home.shortName} 3P`, `${m.away.shortName} 2P`, `${m.away.shortName} 3P`], rows), "", "- 選手ごとのシュートタイプは「7. ボックススコア」の Shooting を参照。", "");
  }
  return out;
}

function shotsOf(input: GameMdInput, teamId: string) {
  // ショットの座標つきイベント（buildGameImageModel と同じ buildShotEvents）
  return buildShotEventsFor(input).filter((s) => s.teamId === teamId);
}
function buildShotEventsFor(input: GameMdInput) {
  return input.shotChartSupported ? buildShotEvents(input.game.raw.PlayByPlays) : [];
}

// ---- 6. オンザコートと起用 ----
function sectionUsage(input: GameMdInput, m: GameImageModel, used: UsedLabels): string[] {
  const out: string[] = ["## 6. オンザコートと起用", ""];
  if (!m.usage) return [...out, "- この試合・シーズンはプレーバイプレーの記録がないため出せません。", ""];
  const oc = (c: number | null) => (c === null ? "集計外" : `OC${c}`);
  const dur = (s: number) => formatMinutesFromSeconds(s);
  out.push(`### オンザコート別（コートにいる外国籍・帰化・アジア特別枠の人数。このリーグ・シーズンの上限は${m.usage.maxOc}人）`, "");
  for (const [name, u] of [[m.home.name, m.usage.home], [m.away.name, m.usage.away]] as const) {
    const totalSec = u.oc.reduce((s, r) => s + r.seconds, 0);
    const rows = u.oc.map((r) => [oc(r.count), dur(r.seconds), totalSec > 0 ? `${((r.seconds / totalSec) * 100).toFixed(2)}%` : NO_DATA, String(r.own), String(r.opp), signed(r.own - r.opp)]);
    rows.push(["合計", dur(totalSec), totalSec > 0 ? "100.00%" : NO_DATA, String(u.oc.reduce((s, r) => s + r.own, 0)), String(u.oc.reduce((s, r) => s + r.opp, 0)), signed(u.oc.reduce((s, r) => s + r.own - r.opp, 0))]);
    out.push(`#### ${name}`, "", mdTable(["オンザコート", "時間", "試合時間に占める割合", "得点", "失点", "得失点差"], rows), "");
  }
  out.push("- OCn＝コートにいる外国籍・帰化・アジア特別枠の選手が n 人。「集計外」＝5人が復元できなかった時間、区分不明の選手を含む組、上限を超える組（公式の記録の取り違え等）。得点・失点はその時間帯のチームの得点・失点。", "");
  out.push("### ラインナップ（5人組）別の出場時間と得失点（出場時間の長い順。最大10組）", "");
  const lineupRows = (cards: LineupCard[]) =>
    cards.slice(0, 10).map((l, i) => [String(i + 1), l.names.map(normalizePlayerName).join("、"), l.oc === null ? "集計外" : `OC${l.oc}`, dur(l.seconds), String(l.own), String(l.opp), signed(l.own - l.opp), String(l.spans.length)]);
  for (const [name, u] of [[m.home.name, m.usage.home], [m.away.name, m.usage.away]] as const) {
    out.push(`#### ${name}（全${u.allLineups.length}組）`, "", mdTable(["順", "5人", "OC", "出場時間", "得点", "失点", "得失点差", "コートに出た回数"], lineupRows(u.allLineups)), "");
  }
  out.push("- ラインナップ＝同時にコートにいた5人の組み合わせ。出場時間・得点・失点は、その5人がそろっていた間の合計。コートに出た回数＝その5人が続けてコートにいた時間帯の数。", "");
  void used;
  return out;
}

// ---- 7. ボックススコア ----
function sectionBoxscore(input: GameMdInput, m: GameImageModel, used: UsedLabels): string[] {
  const { game } = input;
  const out: string[] = ["## 7. ボックススコア", "", "- 両チームの全選手の全項目（出場しなかった選手を含む）。表の並びは、スタメン上固定・出場時間の長い順・出場なしは末尾（サイトと同じ）。FG・2P・3P・FT などの列はサイトの列の定義そのもの（成功・試投・成功率は別の列）。", ""];
  const foulSplit = foulColumnsSplit([game.season]);
  const tabs: { key: BoxscoreTabKey | "shooting"; label: string }[] = [...BOXSCORE_TABS];
  for (const tab of tabs) {
    if (tab.key === "shooting") continue;
    const columns = gameDetailColumnsFor(tab.key, foulSplit);
    out.push(`### ${tab.label}`, "");
    for (const side of ["home", "away"] as const) {
      const name = side === "home" ? m.home.name : m.away.name;
      const d = teamData(input, side, columns);
      const head = ["選手", "区分", ...columns.map((c) => used.add(c.label))];
      const row = (p: (typeof d.players)[number], group: string) =>
        [`${normalizePlayerName(p.nameJ)}（#${p.playerNo}）`, group, ...(p.dnp ? ["DNP", ...columns.slice(1).map(() => NO_DATA)] : columns.map((c) => cellOf(c, p.counts, d.playerCtx)))];
      const ordered = (list: typeof d.players) => [...list].sort((a, b) => Number(a.dnp) - Number(b.dnp));
      const rows: string[][] = [
        ...ordered(d.starters).map((p) => row(p, "先発")),
        ...ordered(d.bench).map((p) => row(p, "ベンチ")),
        ["TEAM / COACHES", "", ...columns.map((c) => cellOf(c, d.coaches, d.nonPlayerCtx))],
        ["チーム合計", "", ...columns.map((c) => cellOf(c, d.teamTotal, d.teamTotalCtx))],
      ];
      out.push(`#### ${name}`, "", mdTable(head, rows), "");
      if (d.teamOrPct && !d.teamOrPct.available) out.push(`- ※${OR_PCT_UNAVAILABLE_NOTE[d.teamOrPct.reason]}`, "");
      if (d.teamOnCourtShare && !d.teamOnCourtShare.available) out.push(`- ※${ON_COURT_SHARE_UNAVAILABLE_NOTE[d.teamOnCourtShare.reason]}`, "");
      // 内訳集計
      const summaryColumns = boxSummaryColumns(columns, d.manual);
      const noPm = (c: BoxscoreCounts): BoxscoreCounts => ({ ...c, plusMinus: 0, hasPlusMinus: false });
      const unclassified = d.players.filter((p) => !p.dnp && input.classificationById.get(p.playerId) === undefined).length;
      const note = (splitClassificationSeason(game.season) ? "試合の日の登録区分（日本人は見做し日本人を含む）" : "現在の登録情報に基づく参考値") + (unclassified > 0 ? `／${unclassified}名分のデータ欠落あり` : "");
      const grp = (label: "日本人" | "外国籍・帰化・アジア") => d.players.filter((p) => classificationGroup(input.classificationById.get(p.playerId)) === label);
      const sumRows: string[][] = [
        ["スタメン合計", ...summaryColumns.map((c) => cellOf(c, noPm(sumCountsList(d.starters.map((p) => p.counts))), d.nonPlayerCtx))],
        ["ベンチ合計", ...summaryColumns.map((c) => cellOf(c, noPm(sumCountsList(d.bench.map((p) => p.counts))), d.nonPlayerCtx))],
        ["チーム合計", ...summaryColumns.map((c) => cellOf(c, noPm(d.teamTotal), d.teamTotalCtx))],
        ["日本人選手合計", ...summaryColumns.map((c) => cellOf(c, noPm(sumCountsList(grp("日本人").map((p) => p.counts))), d.nonPlayerCtx))],
        ["外国籍・帰化・アジア合計", ...summaryColumns.map((c) => cellOf(c, noPm(sumCountsList(grp("外国籍・帰化・アジア").map((p) => p.counts))), d.nonPlayerCtx))],
      ];
      out.push(`##### ${name} 内訳集計`, "", mdTable(["", ...summaryColumns.map((c) => used.add(c.label))], sumRows), "", `- ※${note}。内訳集計の OR% は %OR（チームの OR に占める割合）、USG% は %USG、AST% は %AST（チーム全体に占める割合）に置き換えています。`, "");
    }
    if (tab.key === "misc" && foulSplit) out.push("- 2026-27以降のファウルの列：TF1・TF2（テクニカル）、FLAG（フレグラント）、DISR（ディスラプティブ）。", "");
  }
  // Shooting（シュートタイプ別。スポーツナビの記録）
  out.push("### Shooting（シュートタイプ別。スポーツナビの記録）", "");
  const yp = input.yahooPbp;
  if (!yp) {
    out.push("- この試合・シーズンにはスポーツナビの記録がないため出せません。", "");
  } else {
    const byPlayer = buildShotTypeBreakdownByPlayer(yp.shots);
    const keys = sortShotTypeKeys([...new Set(yp.shots.map((s) => s.shotType).filter((t) => t.length > 0))]);
    if (keys.length === 0) out.push("- この試合のデータがありません。", "");
    for (const [name, rows] of [[m.home.name, game.raw.HomeBoxscores], [m.away.name, game.raw.AwayBoxscores]] as const) {
      const players = orderPlayersByPlayTime(rows.filter((r) => r.Category === 1 && r.PeriodCategory === 18));
      const cell = (b: ReturnType<typeof byPlayer.get>, k: string) => {
        const c = b?.[k];
        if (!c) return NO_DATA;
        const parts = [c.twoPoint.attempted > 0 ? `2P ${c.twoPoint.made}/${c.twoPoint.attempted}` : "", c.threePoint.attempted > 0 ? `3P ${c.threePoint.made}/${c.threePoint.attempted}` : ""].filter(Boolean);
        return parts.length ? parts.join(" ") : NO_DATA;
      };
      const body = players.map((p) => [normalizePlayerName(p.PlayerNameJ), p.StartingFlg === 1 ? "先発" : "ベンチ", ...keys.map((k) => cell(byPlayer.get(p.PlayerID), k))]);
      if (keys.length) out.push(`#### ${name}`, "", mdTable(["選手", "区分", ...keys.map((k) => used.add(shotTypeLabel(k)))], body), "");
    }
    if (keys.length) out.push("- セルは「2P 成功/試投　3P 成功/試投」。そのタイプの試投が無い選手は「-」。チームのシュートタイプ別の合計は「5. シュート」にあります。", "");
  }
  return out;
}

// ---- 定義 ----
function sectionDefinitions(used: UsedLabels): string[] {
  const out = ["## 8. 定義", "", "- この書き出しの中で使った指標の説明（サイトの用語集と同じ文）。", ""];
  for (const l of [...used.set].sort()) {
    const d = statDescription(l);
    if (d) out.push(`- **${l}**：${d}`);
  }
  out.push("");
  return out;
}
