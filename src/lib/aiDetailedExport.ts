// AI向けMarkdown（詳しい版）。画面・通信とは独立した純粋な組み立て。値は今の画面と同じ計算（既存の列の式・集計）を呼ぶだけ。
// 読み込みは aiDetailedExportLoad.ts、タームの試合の選び方は aiExportScope.ts。保存キーの対象外。
import type { GameSummary, PlayerGameLog, PlayerSummary, TeamGameLog, TeamHistoryEntry, TeamSummary, YahooGamePbp } from '../../shared/types';
import type { League } from './league';
import type { ScheduleFileExtended } from '../../shared/resultOnlyGames';
import { isRegularSeasonComplete } from '../../shared/regularSeasonComplete';
import { normalizePlayerName } from '../../shared/playerName';
import { gameOvertimes } from './gameFacts';
import { sumTeamGameLogs, EMPTY_TOTALS, type AllTeamsRow, type TeamPerspective } from './teamStatsColumns';
import { seasonPeriodFormatters } from './teamSeasonPeriod';
import { buildTeamSplitRowsFromPeriodSource } from './seasonPeriod';
import { sumTeamGameLogsFor } from './playerSeasonBoxscore';
import { seasonBoxColumnsWithFtr } from './ftrColumn';
import { teamScoringShareFromTotals, teamClassificationShareFromTotals, fgaShare } from './shareCharts';
import { buildBackToBackStatus } from './situational';
import { sumForeignCourt, sumForeignDetail, type ForeignPeriodValue } from './teamForeignCourt';
import { seasonOnCourtSummaryFromDetail } from './teamLineupOnCourt';
import { formatMinutesFromSeconds } from './boxscoreAggregate';
import { sortShotTypeKeys } from './shotTypeBreakdown';
import { sumTtsTotals, ttsRowValues, TTS_TABLE_ITEMS, formatTtsSeconds, formatTtsPct, type TtsSource } from './teamTts';
import { sumTeamPeriodTotals, type TeamPeriodSource } from './teamPeriodTotals';
import type { SeasonPeriodSource } from './seasonPeriod';
import { ONE_PERIOD_REASON } from './leagueAvailability';
import { buildShotTypeBreakdown } from './shotTypeBreakdown';
import { buildStreakTeamRow } from './streaksTab';
import { leagueDirections, leagueRanks, pooledRow } from './aiDetailedLeague';
import {
  HALF_PERIODS, shotPairInPeriods, tovPairInPeriods, YAHOO_PERSPECTIVES, addShotPair, addTovPair, emptyShotPair, emptyTovPair, forcedMetrics, playerShootingColumns, playerShots, shootingMetrics, shotKeysOf, sumShotPair, sumTovPair, tovPairFromTeam,
  type Metric, type ShotPair, type TovPair,
} from './aiDetailedYahoo';
import { ageBaseDate, ageForSeason, formatBaseDateLabel, AGE_BASE_NOTE } from './age';
import { positionText, heightText, weightText, seasonHasProfileFallback } from './profileMark';
import { registrationLabel } from './registrationLabel';
import { splitClassificationSeason } from './classificationFilter';
import type { SeasonRegistrationFile } from '../../shared/registration';
import { buildOpponentSeasonWinRates } from './opponentSeasonWinRate';
import { teamNameInSeason } from './teamLabel';
import { previousSeason } from './seasonCompare';
import { buildSituationalRecordGroups, teamSeasonColumnLabels } from '../pages/TeamDetailPage';
import {
  buildTermsWithOpponent, teamConfirmedGames, MIN_OPP_GAMES, OPPONENT_KIND_LABELS, TERM_KIND_LABELS, TIME_SLICE_CHOICES,
  type OpponentKind, type Term, type TermKind, type TimeSlice,
} from './aiExportScope';

export type DetailedKind = 'team' | 'player';
export interface DetailedSeason {
  season: string;
  teams: TeamSummary[];
  team: TeamSummary;
  /** このチームのレギュラーシーズンの試合ログ（日付→ScheduleKey の順） */
  regular: TeamGameLog[];
  summaries: GameSummary[];
  schedule: ScheduleFileExtended;
  division: unknown;
}
export interface DetailedInput {
  /** 見ているリーグ（省略は B.PREMIER） */
  league?: League;
  kind: DetailedKind;
  season: string;
  teamId: string;
  term: TermKind;
  opp: OpponentKind;
  /** TIME_SLICE_CHOICES の key */
  timeSlice: string;
  /** 前季比較（チーム情報だけ） */
  compare: boolean;
  history: TeamHistoryEntry[];
  cur: DetailedSeason;
  prev: DetailedSeason | null;
  /** zeroMinKeys：このチームでの試合のうち、出場時間が0分の行の scheduleKey（スポーツナビにシュートの記録があるときだけ Shooting に足す） */
  players: { player: PlayerSummary; logs: PlayerGameLog[]; zeroMinKeys?: string[] }[];
  /** 2026-27以降の、そのシーズン・リーグの登録区分の記録（選手情報の登録区分。読めなかったときは null） */
  registrations?: SeasonRegistrationFile | null;
  /** リーグ全チームのレギュラーシーズンの試合ログ（リーグ順位・リーグ平均。チーム情報だけ。自チームも含む） */
  leagueLogs?: ReadonlyMap<string, TeamGameLog[]>;
  /** 区間の索引（オンザコート別。チーム情報だけ） */
  periodSource?: TeamPeriodSource | null;
  /** Time to Shot の索引（2020-21以降。チーム情報だけ） */
  ttsSource?: TtsSource | null;
  /** コートに同時に出られる外国籍・帰化・アジア特別枠の最大人数（規程） */
  maxForeignOnCourt?: number;
  /**
   * スポーツナビの記録（試合ごと。scheduleKey → 記録）。読み込むのは、Forced TOV（チーム情報。1シーズン・全チームのときは teams.json の値を使うので読まない）と
   * 選手の Shooting に必要な試合のうち、記録がある試合だけ
   */
  pbps?: ReadonlyMap<string, YahooGamePbp>;
  /** pbps の範囲：league＝全チームの対象の試合、own＝自チームの対象の試合だけ（前半・後半の Shooting・Forced TOV のため）。省略は league */
  pbpsScope?: 'league' | 'own';
  /** 選手の区間（前半・後半）の索引（選手情報で前半・後半を選んだときだけ） */
  seasonPeriod?: SeasonPeriodSource | null;
  /** 「書き出した日」に書く文字列 */
  exportedAt: string;
}
export interface DetailedPart { label: string; filename: string; markdown: string; characters: number }
/** 2ファイルに分けたときは parts に2つ（試合全体／前半後半）。markdown・filename・characters は先頭（試合全体）のもの */
export interface DetailedOutput { markdown: string; filename: string; characters: number; empty: boolean; parts?: DetailedPart[] }
/** これを超える（文字数）ときは、時間帯で2つのファイルに分ける */
export const SPLIT_LIMIT_CHARACTERS = 100_000;

type FTerm = Term & { tooFew: number; excluded: number };

// ---- 書式 ----
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const table = (head: string[], rows: string[][]) => [head, head.map(() => '---'), ...rows].map(r => `|${r.map(esc).join('|')}|`).join('\n');
const winPct = (w: number, n: number) => (n === 0 ? '-' : (w / n).toFixed(3).replace(/^0/, ''));
const record = (w: number, l: number) => `${w}勝${l}敗（${winPct(w, w + l)}）`;
const SLICE_LABEL: Record<TimeSlice, string> = { game: '試合全体', h1: '前半（1Q・2Q）', h2: '後半（3Q・4Q）' };
/** 試合ログの合計（時間帯 → その時間帯の合計）。試合全体＝試合ログ、前半・後半＝チームのピリオド別の索引（チームスタッツタブの区間別と同じ関数）。クラッチタイムは、ここに枝を足す */
function sliceRow(teamId: string, logs: TeamGameLog[], slice: TimeSlice, source?: TeamPeriodSource | null): AllTeamsRow {
  if (slice !== 'game') {
    if (!source) throw new Error('チームの区間の索引が読み込まれていません。');
    const { games, totals } = sumTeamPeriodTotals(source, logs, slice);
    const w = games.filter(g => g.win).length;
    return { team: { teamId, teamName: '' }, gamesPlayed: games.length, wins: w, losses: games.length - w, totals };
  }
  const wins = logs.filter(g => g.win).length;
  return { team: { teamId, teamName: '' }, gamesPlayed: logs.length, wins, losses: logs.length - wins, totals: logs.length ? sumTeamGameLogs(logs) : { ...EMPTY_TOTALS } };
}

const OPP_RULE = `その試合に入る時点（その試合は含まない）の相手のレギュラーシーズン勝率が .600 以上。相手の消化試合が${MIN_OPP_GAMES}試合未満の試合は判定せず外す。相手の勝敗はスタッツのある試合で数える（結果だけの試合は相手の勝敗に数えない）。チームスタッツの絞り込み「対6割以上」と同じ`;
// 自チームだけ（相手・差に意味がない、または言い換えになる列）
const OWN_ONLY = new Set(['G', 'MIN', 'POSS', 'PACE', 'ORtg', 'DRtg', 'NetRtg', '+/-', 'EFF', 'BSR', '内訳対象']);
// 構成の章に移す列（得点・失点構成とまとめる）
const MOVED_TO_COMPOSITION = new Set(['%3PA', '%2PA', '%PAINT2A', '%MID2A', '日本人 PTS', '外国籍・帰化・アジア PTS', '%日本人 PTS', '%外国籍・帰化・アジア PTS']);
const PERSPECTIVES: [TeamPerspective, string][] = [['own', ''], ['opp', 'opp '], ['diff', '差 ']];
/** シチュエーション別勝敗で、数え方が名前から分かりにくい項目の名前（画面の名前に意味を足す） */
const SITUATION_GROUP_LABEL: Record<string, string> = {
  foreignPlayerCount: 'コート上の外国籍・帰化・アジアの人数（最も長かった人数）',
  inGameMargin: '試合中の点差（試合中に一度でもそうなった。同じ試合が複数の行に入る）',
  opponentStrength: '対戦相手の強さ（相手の今の勝率で分ける。基準日時点・最新）',
};
const SITUATION_ROW_LABEL: Record<string, string> = {
  poss1: '1POS差以内（3点差以内）',
  poss2: '2POS差以内（6点差以内）',
};
/** 数え方が名前から分かりにくい項目（「数字の書き方」に載せる） */
const GLOSSARY_COMMON = [
  'G：チームの表は試合数。選手の表は、その選手が出た試合数（平均の分母にも使う）。opp は相手チームの値、差は自チーム−相手。',
  'BSR＝被ブロック数（自分のシュートが相手にブロックされた回数）。FD＝被ファウル、F＝ファウル。STOCKS＝STL＋BLK。',
  'EFF：Bリーグ公式の貢献度（(PTS＋AST＋BLK＋STL＋FD＋TR)−(TOV＋BSR＋F)−(FGA−FGM)−(FTA−FTM)）。',
  'POSS・PACE・ORtg・DRtg・NetRtg：ポゼッション（攻撃回数）が元。試合ごとに、公式の攻撃回数がある試合はそれを使い、ない試合は推定式で求める。実際には、2022-23以降はほぼ全試合に公式の値があり（2022-23は718試合中717試合）、2021-22以前は全試合が推定式。',
  'AST2M・AST3M・ASTFTM：アシストされた成功数。%PTS ASTED：得点のうちアシストされた得点の割合。',
  'PITP・FBPS・2ND PTS・PTSOFFTO：ペイント内・速攻・セカンドチャンス・ターンオーバー後の得点（プレーバイプレーのタグ由来）。',
  'BENCH PTS・STARTER PTS：控え選手・先発（公式の先発5人）の得点。',
];
const GLOSSARY_TEAM = [
  '内訳対象（21/21）：2P内訳（ペイント／ミッド）の記録がある試合数／全試合数。内訳の平均・成功率は、記録がある試合だけで計算する。',
  '得点：外国籍・帰化・アジア など：得点した選手の登録区分（2025-26以前は日本人／外国籍・帰化・アジアの2区分、2026-27以降は3区分の合算）。コート上の人数とは別。',
  '連戦 GAME1／GAME2：直前の自チームの試合から中1日以内なら GAME2、その連戦の最初が GAME1。相手が同じかは問わない。',
  '100点ゲーム：どちらか一方でも100点以上の試合。地区（対東地区など）：その試合のシーズンの相手の所属地区。土日祝開催：祝日は土日側に入る。',
  '対戦相手の絞り込みの「勝率6割以上」は、その試合に入る時点の相手の勝率。シチュエーション別勝敗の「対戦相手の強さ」は、相手の今の勝率（別の基準）。',
];
const GLOSSARY_PLAYER = [
  '%PTS・%FGM などの%系と ORtg・DRtg・NetRtg・USG% の分母は、その選手が出た試合のチーム合計。',
];
/** 良し悪しの向きが無い項目（出場時間・攻撃回数・テンポ）は順位を付けない（リーグ平均は付ける） */
const NO_RANK = new Set(['G', 'MIN', 'POSS', 'PACE']);
const PLAYER_DROP = new Set(['G', 'GS', 'MIN', 'PTS']);

/** 相手のその試合に入る時点の勝敗の文字（対象の試合の一覧用） */
function oppPreRecord(summaries: readonly GameSummary[], g: { log: TeamGameLog; date: string; scheduleKey: string }): string {
  let w = 0, l = 0;
  for (const s of summaries) {
    if (s.gameType !== 'regular' || !s.gameEndedFlg || (s.homeTeamId !== g.log.opponentTeamId && s.awayTeamId !== g.log.opponentTeamId)) continue;
    if (!(s.date < g.date || (s.date === g.date && s.scheduleKey < g.scheduleKey))) continue;
    if ((s.homeTeamId === g.log.opponentTeamId) === (s.homeScore > s.awayScore)) w++; else l++;
  }
  return record(w, l);
}

/** タームを決めてから、対戦相手で絞る（直近5試合だけは絞ってから5試合を選ぶ）。選べないときは理由つきで止める */
export function detailedTerms(d: DetailedSeason, kind: TermKind, opp: OpponentKind, teamId: string, history: TeamHistoryEntry[], league: League = 'premier'): FTerm[] {
  const complete = isRegularSeasonComplete({ schedule: d.schedule, summaries: d.summaries });
  const names = [d.team.teamName, teamNameInSeason(history, teamId, d.season, d.team.teamName)];
  const r = buildTermsWithOpponent(kind, opp, { season: d.season, league, teamId, teamNames: names, regularLogs: d.regular, summaries: d.summaries, schedule: d.schedule, complete });
  if ('unavailable' in r) throw new Error(`このタームは選べません: ${r.unavailable}`);
  return r.terms;
}

interface Col { key: string; label: string; rows: Map<TimeSlice, AllTeamsRow>; logs: TeamGameLog[]; term: Term }

export function detailedFilename(i: DetailedInput, name: string, baseDate: string): string {
  const parts = [name, i.season, ...((i.league ?? 'premier') === 'one' ? ['B.ONE'] : []), i.kind === 'team' ? 'チーム情報' : '選手情報', TERM_KIND_LABELS[i.term], baseDate];
  if (i.opp !== 'all') parts.splice(parts.length - 1, 0, '対6割以上');
  return `${parts.join('_')}.md`.replace(/[\\/:*?"<>|\s]+/g, '');
}

/** 書き出しに書くリーグ名（B.ONE の2025-26以前は旧B2、B.PREMIER の2025-26以前は B1） */
function leagueName(i: { league?: League; season: string }): string {
  return (i.league ?? 'premier') === 'one' ? (i.season >= '2026-27' ? 'B.ONE' : 'B2（B.ONE の前身）') : i.season >= '2026-27' ? 'B.PREMIER' : 'B1';
}
function sourceNote(i: { league?: League }): string {
  return (i.league ?? 'premier') === 'one'
    ? 'Bリーグ公式の記録（B.ONE のボックススコア・日程・順位）。Shooting・Forced TOV の元になるスポーツナビの記録は B.ONE には無い'
    : 'Bリーグ公式の記録（ボックススコア・日程・順位）。Shooting・Forced TOV はスポーツナビのプレーバイプレー（2023-24以降。記録がある試合だけ）';
}
/** 2ファイルに分けたときの、このファイルの時間帯の名前ともう1つのファイル名 */
interface SplitInfo { self: string; otherFile: string; filename: string }
function aboutTable(i: DetailedInput, ctx: { name: string; ended: string; complete: boolean; terms: FTerm[]; slices: TimeSlice[]; extra: string[][]; split?: SplitInfo }): string {
  return table(['項目', '内容'], [
    ['データの基準日', `${ctx.ended}（収録済みのリーグの最新の終了試合日）`],
    ['リーグ', `${leagueName(i)}（レギュラーシーズンだけ。ポストシーズンは入れない）`],
    ['データの取得先', sourceNote(i)],
    ['チーム', `${ctx.name}${ctx.complete ? '' : '（シーズン途中）'}`],
    ['ターム', `${TERM_KIND_LABELS[i.term]}${ctx.terms.length > 1 && i.kind === 'team' ? '（比べやすいよう、最後の列にシーズン全体を参考に付ける）' : ''}`],
    ['時間帯', ctx.slices.length === 1 && ctx.slices[0] === 'game' ? '試合全体（延長を含む）' : ctx.slices.map(s => (s === 'game' ? '試合全体（延長を含む）' : SLICE_LABEL[s])).join('・') + (ctx.slices.some(s => s !== 'game') ? '。前半・後半は延長を含まない。1Q〜4Q・延長の区間は出さない' : '')],
    ...(ctx.split ? [['ファイルの分け方', `10万字を超えるため、時間帯で2つのファイルに分けた。このファイルは「${ctx.split.self}」。もう1つ：${ctx.split.otherFile}（先頭の「この書き出しについて」「対象試合」は同じ）`]] : []),
    ['対戦相手', i.opp === 'all' ? '全チーム' : `${OPPONENT_KIND_LABELS[i.opp]}（${OPP_RULE}）。${i.term === 'recent5' ? '直近5試合は、相手で絞ってから最後の5試合を選ぶ（ほかのタームは期間を決めてから絞る）' : 'タームを先に決めてから絞る（直近5試合だけは、相手で絞ってから最後の5試合を選ぶ）'}`],
    ...ctx.extra,
    ['書き出した日', i.exportedAt],
  ]);
}

function gameTable(i: DetailedInput, terms: FTerm[]): string {
  const withOpp = i.opp !== 'all';
  return table(['ターム', '期間・決め方', `試合（勝敗・勝率）${withOpp ? '※絞り込みのあと' : ''}`, 'スタッツの対象', '結果だけの試合', withOpp ? '相手の条件で外した試合（うち相手が5試合未満で判定できない）' : '今後の予定'], terms.map(t => {
    const w = t.games.filter(g => g.win).length;
    const ro = t.games.filter(g => g.resultOnly);
    const games = t.games.length ? `${t.games.length}試合 ${record(w, t.games.length - w)}` : '0試合（対象の試合なし）';
    return [t.label, withOpp ? t.rule : `${t.games[0]?.date ?? '-'}〜${t.games.at(-1)?.date ?? '-'}。${t.rule}`, games, `${t.statLogs.length}試合`, ro.length ? ro.map(g => `${g.date}（${g.win ? '勝' : '敗'}）`).join('、') : 'なし', withOpp ? `${t.excluded}試合（うち${t.tooFew}試合）` : t.upcoming ? `${t.upcoming}試合` : '-'];
  }));
}

/** 絞り込んだときの、対象の試合の一覧。直近5試合はその5試合、ほかはシーズン全体の該当試合（複数のタームのときはどのタームかを添える） */
function gameListTable(i: DetailedInput, terms: FTerm[], seasonTerm: FTerm, teamsOf: DetailedSeason, history: TeamHistoryEntry[]): string {
  const multi = terms.length > 1;
  const list = i.term === 'recent5' ? terms.flatMap(t => t.games) : seasonTerm.games;
  const termOf = (g: { scheduleKey: string }) => terms.find(t => t.games.some(x => x.scheduleKey === g.scheduleKey))?.label ?? '-';
  return table([...(multi ? ['ターム'] : []), '日付', '相手', '会場', '結果', '相手の勝敗（試合前）'], list.map(g => {
    const opp = teamsOf.teams.find(t => t.teamId === g.log.opponentTeamId);
    return [...(multi ? [termOf(g)] : []), g.date, opp ? teamNameInSeason(history, opp.teamId, i.season, opp.teamName) : g.log.opponentTeamId, g.isHome ? 'ホーム' : 'アウェイ', `${g.win ? '勝' : '敗'} ${g.resultOnly ? '（結果だけ）' : `${g.log.teamScore}-${g.log.opponentScore}`}`, oppPreRecord(teamsOf.summaries, g)];
  }));
}

/** 試合ごとの、コート上の外国籍・帰化・アジア特別枠の人数別の時間（分）。シチュエーション別勝敗の「最も長かった人数」の根拠 */
function foreignTimeTable(i: DetailedInput, terms: FTerm[]): string[] {
  const games = terms.flatMap(t => t.games).filter(g => !g.resultOnly);
  const nameOf = (id: string) => { const o = i.cur.teams.find(t => t.teamId === id); return o ? teamNameInSeason(i.history, o.teamId, i.season, o.teamName) : id; };
  const min = (sec: number | undefined) => (sec === undefined ? '-' : (sec / 60).toFixed(1));
  const multi = terms.length > 1;
  const termOf = (g: { scheduleKey: string }) => terms.find(t => t.games.some(x => x.scheduleKey === g.scheduleKey))?.label ?? '-';
  const rows = games.map(g => {
    const sec = g.log.foreignCourtSeconds;
    const longest = g.log.foreignPlayerCount;
    return [...(multi ? [termOf(g)] : []), g.date, nameOf(g.log.opponentTeamId), `${g.win ? '勝' : '敗'} ${g.log.teamScore}-${g.log.opponentScore}`, ...[0, 1, 2, 3, 4].map(n => min(sec?.[n])), longest === undefined ? '-' : `${longest}人`];
  });
  return [
    '#### 試合ごとの、コート上の外国籍・帰化・アジアの人数別の時間（分）', '',
    '- 「0人〜4人」は、その人数がコートに同時にいた時間（分）。いちばん長い人数が、シチュエーション別勝敗の「コート上の外国籍・帰化・アジアの人数（最も長かった人数）」の値（最後の列）。1試合に出た人数・登録した人数ではない。',
    '- 外国籍・帰化・アジア特別枠の合計で、日本人は数えない。登録区分が分からない選手がいる区間は数えないので、合計が試合時間に満たないことがある。2人が最も長くても、前後で人数が違った試合は多い（途中退場・途中出場で人数が変わる）。',
    ...(i.season < '2020-21' ? ['- **2019-20以前のシーズンは、コートにいた選手を試合の記録から推定して復元した値で、精度が下がる。** 特に2016-17・2017-18は時間が粗く（同じ長さの人数が並ぶ試合がある）、その試合の「最も長かった人数」は並んだ人数のどれか1つ。'] : []),
    '', table([...(multi ? ['ターム'] : []), '日付', '相手', '結果', '0人', '1人', '2人', '3人', '4人', '最も長かった人数'], rows), '',
  ];
}

/** 選手のプロフィール表（ポジション・身長・体重・年齢・登録区分）。個人詳細と同じ表記・同じ決め方 */
function profileTable(i: DetailedInput, terms: FTerm[], complete: boolean): string[] {
  const keys = new Set(terms.flatMap(t => t.statLogs.map(g => g.scheduleKey)));
  const list = i.players
    .map(({ player, logs }) => { const mine = logs.filter(g => keys.has(g.scheduleKey)); return { player, min: mine.reduce((a, g) => a + g.min, 0), games: mine.length }; })
    .filter(x => x.games > 0)
    .sort((a, b) => b.min - a.min);
  const rows = list.map(({ player: p }) => [
    normalizePlayerName(p.name),
    positionText(p) ?? '-',
    heightText(p) ?? '-',
    weightText(p) ?? '-',
    p.birthDate ? `${ageForSeason(p.birthDate, i.season)}歳` : '-',
    registrationLabel(i.season, p.classification, i.registrations?.players[p.playerId]),
  ]);
  const base = formatBaseDateLabel(ageBaseDate(i.season));
  return [
    '### 選手のプロフィール', '',
    `- 年齢は **${base.replace(' 現在', '')}時点**（各シーズンの6月30日時点。進行中のシーズンは本日時点。個人詳細・図解の年齢分布と同じ決め方）。生年月日が無い選手は「-」。`,
    `- 身長・体重・ポジションは${complete ? '当時の値（そのシーズンの1月15日に固定した値）' : '現在の値（進行中のシーズンは、1月15日に固定するまで現在の値）'}。値が無い選手は「-」。` + (seasonHasProfileFallback(list.map(x => x.player)) ? '＊が付いた値は、当時の値が見つからず補った値（ポジションは近いシーズンの当時の値、無ければ現在の値。身長・体重は現在の値）。' : ''),
    splitClassificationSeason(i.season)
      ? '- 登録区分は、このシーズンの登録区分の記録（外国籍・帰化・アジア特別枠。見做し日本人は「日本人（見做し日本人）」）。シーズン途中で区分が変わった選手は「外国籍 → 帰化（2027-01-10から）」のように変わった日を添える。'
      : '- 登録区分は、2025-26以前は区分を分けて記録していないため、選手マスタの区分を参考値として「日本人」か「外国籍・帰化・アジア」で出す。',
    ...(splitClassificationSeason(i.season) && !i.registrations ? ['- **このシーズンの登録区分の記録を読み込めなかったため、登録区分は選手マスタの区分で出した（参考値）。**'] : []),
    '', table(['選手', 'ポジション', '身長', '体重', '年齢', '登録区分'], rows), '',
  ];
}

/** 前半・後半を含むときの「数字の書き方」の注記 */
function sliceNotes(slices: TimeSlice[], kind: DetailedKind): string[] {
  if (!slices.some(s => s !== 'game')) return [];
  return [
    '- 前半＝1Q・2Q、後半＝3Q・4Q（延長は含まない）。1Q〜4Q・延長の区間は出さない。チーム詳細の Q別タブ・チームスタッツタブで前半・後半を選んだときと同じ値。',
    ...(kind === 'team'
      ? ['- 前半・後半は、自チーム・opp・差の値だけを出し、**リーグ順位・リーグ平均は付けない**（試合全体の列だけに付く）。前半・後半に出す表は Traditional・Advanced・Misc・Scoring・Shooting・Forced TOV・オンザコート別・Time to Shot。チームのまとめ・シチュエーション別勝敗・得点失点構成・Streaks は試合全体だけ。',
        '- 前半・後半の表の「対象試合（勝敗）」は、区間の値がある試合の数（前後半5分の特別な試合・ボックススコアが手入力の試合は区間の値が無いので数えない）。勝敗は試合の最終結果。']
      : ['- 前半・後半の平均の分母は、その選手がそのターム・時間帯に出た試合数（試合全体と同じく、前半・後半に出ていない試合も入る＝チーム詳細の選手スタッツタブと同じ）。']),
    '- Shooting・Forced TOV の前半・後半は、スポーツナビの記録のピリオド（前半＝1・2、後半＝3・4）で数える。分母は記録がある試合だけ。',
  ];
}
const EMPTY_NOTE = (i: DetailedInput) => ['## この条件に当てはまる試合はありません', '', `- ${TERM_KIND_LABELS[i.term]}${i.opp === 'all' ? '' : `・${OPPONENT_KIND_LABELS[i.opp]}`}の条件に当てはまる試合が1つも無いため、表は出しません。`, ''];

/** 書き出しを作る。10万字を超えるときは、時間帯で2ファイル（試合全体／前半後半）に分ける */
export function buildDetailedExport(i: DetailedInput): DetailedOutput {
  const choice = TIME_SLICE_CHOICES.find(c => c.key === i.timeSlice);
  if (!choice || !choice.available(i.season)) throw new Error('この時間帯はまだ書き出せません。');
  if ((i.league ?? 'premier') === 'one' && choice.slices.length > 1) throw new Error(ONE_PERIOD_REASON);
  const slices = [...choice.slices];
  const whole = buildDetailedWhole(i);
  if (whole.empty || slices.length === 1 || whole.characters <= SPLIT_LIMIT_CHARACTERS) return whole;
  const base = whole.filename.replace(/\.md$/, '');
  const fileA = `${base}_試合全体.md`, fileB = `${base}_前半後半.md`;
  const a = buildPart(i, ['game'], { self: '試合全体', otherFile: fileB, filename: fileA });
  const b = buildPart(i, slices.filter(s => s !== 'game'), { self: '前半・後半', otherFile: fileA, filename: fileB });
  const parts: DetailedPart[] = [{ label: '試合全体', ...pick(a) }, { label: '前半・後半', ...pick(b) }];
  return { markdown: a.markdown, filename: a.filename, characters: a.characters, empty: false, parts };
}
/** 分けずに1ファイルで作った書き出し（検証で、2ファイルに分けたものと比べるために公開する） */
export function buildDetailedWhole(i: DetailedInput): DetailedOutput {
  const choice = TIME_SLICE_CHOICES.find(c => c.key === i.timeSlice);
  if (!choice || !choice.available(i.season)) throw new Error('この時間帯はまだ書き出せません。');
  return buildPart(i, [...choice.slices], undefined);
}
const pick = (o: DetailedOutput) => ({ filename: o.filename, markdown: o.markdown, characters: o.characters });

function buildPart(i: DetailedInput, slices: TimeSlice[], split: SplitInfo | undefined): DetailedOutput {
  const hasGame = slices.includes('game');
  const startYear = Number(i.season.slice(0, 4));
  const foulSplit = i.season >= '2026-27';
  const { cur, teamId } = i;
  const lg: League = i.league ?? 'premier';
  // Shooting・Forced TOV は、スポーツナビの記録がある（teams.json に shotTypes がある）シーズンだけ。B.ONE には記録が無い
  const yahooSupported = lg === 'premier' && cur.teams.some(t => !!t.shotTypes);
  const yahooReason = lg === 'one' ? 'B.ONE にはスポーツナビの記録が無いため出せない' : 'スポーツナビの記録は2023-24以降のシーズンにしか無く、このシーズンには無いため出せない';
  const name = teamNameInSeason(i.history, teamId, i.season, cur.team.teamName);
  const ended = cur.summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg).map(g => g.date).sort().at(-1) ?? '-';
  const complete = isRegularSeasonComplete({ schedule: cur.schedule, summaries: cur.summaries });
  const terms = detailedTerms(cur, i.term, i.opp, teamId, i.history, lg);
  const seasonTerm = terms.length > 1 ? detailedTerms(cur, 'season', i.opp, teamId, i.history, lg)[0]! : terms[0]!;
  const filename = split ? split.filename : detailedFilename(i, name, ended);
  const out: string[] = [];
  const finish = (empty = false): DetailedOutput => { const markdown = out.join('\n'); return { markdown, filename, characters: Array.from(markdown).length, empty }; };
  const allEmpty = terms.every(t => t.games.length === 0);

  if (i.kind === 'player') {
    out.push(`# ${name} ${i.season} 選手情報（詳しい版）`, '', '## この書き出しについて', '');
    out.push(aboutTable(i, { name, ended, complete, terms, slices, split, extra: [['対象の選手', `このチームで出場した${i.players.length}人（移籍した選手は、このチームでの試合だけ）`], ['年齢の基準日', `${formatBaseDateLabel(ageBaseDate(i.season)).replace(' 現在', '')}時点（${AGE_BASE_NOTE}）`]] }), '');
    out.push('### チームの試合', '', gameTable(i, terms), '');
    if (i.opp !== 'all') out.push('#### 対象の試合（相手と、その試合に入る時点の相手の勝敗）', '', gameListTable(i, terms, seasonTerm, cur, i.history), '');
    if (allEmpty) { out.push(...EMPTY_NOTE(i)); return finish(true); }
    out.push(...profileTable(i, terms, complete));
    out.push('### 数字の書き方', '', '- 1試合平均（分母は、その選手がそのターム・時間帯に出場した試合数＝各表の G）。%系（%PTS など）の分母は、その選手が出た試合のチームの合計（今の選手スタッツタブと同じ）。小数は第2位まで、時間は 分:秒。「-」は値が無い。',
      '- ORtg・DRtg・NetRtg・USG% も、分母は「その選手が出た試合のチーム合計」（チーム詳細の選手スタッツタブと同じ）。全選手スタッツの同じ項目は「チームの全試合の合計」で割るので、出ていない試合が多い選手ほど少し違う。',
      '- 列の重複を減らすため、G・GS・MIN・PTS は Traditional の表だけに出し、他の表では省く。', '- 出場の無い選手は、そのタームの表から省く。',
      ...sliceNotes(slices, 'player'), '',
      '#### 用語（数え方が名前から分かりにくい項目）', '', ...[...GLOSSARY_PLAYER, ...GLOSSARY_COMMON].map(t => `- ${t}`), '');
    const own = { teamId, teamName: cur.team.teamName };
    let section = 1;
    for (const t of terms) {
      out.push(`## ${section++}. ${t.label}（${t.games[0]?.date ?? '-'}〜${t.games.at(-1)?.date ?? '-'}、チーム${t.statLogs.length}試合）`, '');
      const keys = new Set(t.statLogs.map(g => g.scheduleKey));
      for (const slice of slices) {
        const zeroBy = new Map(i.players.map(x => [x.player.playerId, x.zeroMinKeys ?? []] as const));
        const rows = i.players.flatMap(({ player, logs }) => {
          const mine = logs.filter(g => keys.has(g.scheduleKey));
          if (!mine.length) return [];
          const ownBy = new Map(mine.map(g => [g.scheduleKey, { ...own, isHome: g.isHome } as never]));
          const teamTotals = sumTeamGameLogsFor(t.statLogs, new Set(mine.map(g => g.scheduleKey)));
          // 前半・後半は選手の区間の索引（チーム詳細の選手スタッツタブで期間を選んだときと同じ関数）。試合全体は今までどおり
          if (slice !== 'game' && !i.seasonPeriod) throw new Error('選手の区間の索引が読み込まれていません。');
          const r = buildTeamSplitRowsFromPeriodSource(player.playerId, mine, ownBy, new Map([[teamId, teamTotals]]), 'perGame', startYear, player.playerId, slice === 'game' ? 'all' : slice, slice === 'game' ? null : i.seasonPeriod)[0];
          return r ? [{ player, ctx: r.ctx, logs: mine, zero: (zeroBy.get(player.playerId) ?? []).filter(k => keys.has(k)) }] : [];
        }).sort((a, b) => b.ctx.raw.min - a.ctx.raw.min);
        if (!rows.length) { out.push('- このタームに出場した選手はいません。', ''); continue; }
        for (const tab of ['traditional', 'advanced', 'misc', 'scoring'] as const) {
          const cs = seasonBoxColumnsWithFtr(tab, foulSplit).filter(c => tab === 'traditional' || !PLAYER_DROP.has(c.label));
          const body = rows.map(x => [normalizePlayerName(x.player.name), ...cs.map(c => c.format(x.ctx, 'perGame'))]);
          const keep = cs.map((_, k) => body.some(r => r[k + 1] !== '-'));
          out.push(`### ${tab[0]!.toUpperCase()}${tab.slice(1)}${slices.length > 1 ? `・${SLICE_LABEL[slice]}` : ''}`, '', table(['選手', ...cs.filter((_, k) => keep[k]).map(c => c.label)], body.map(r => [r[0]!, ...r.slice(1).filter((_, k) => keep[k])])), '');
        }
        if (yahooSupported) {
          if (!i.pbps) throw new Error('スポーツナビの記録が読み込まれていません。');
          const pbps = i.pbps;
          const shots = rows.map(x => {
            const mine = x.logs.filter(g => keys.has(g.scheduleKey));
            return { name: normalizePlayerName(x.player.name), played: mine.length, data: playerShots(x.player.playerId, mine.map(g => g.scheduleKey), pbps, x.zero, slice === 'game' ? undefined : HALF_PERIODS[slice]) };
          });
          const shotKeys = sortShotTypeKeys([...new Set(shots.flatMap(x => Object.keys(x.data.breakdown)))]);
          const cs = playerShootingColumns(shotKeys);
          const body = shots.map(x => [x.name, `${x.data.games}／${x.played}`, ...cs.map(c => (x.data.games > 0 ? (c.format ? c.format(x.data) : '-') : '-'))]);
          const extra = shots.filter(x => x.data.extraGames > 0);
          const keep = cs.map((_, k) => body.some(r => r[k + 2] !== '-'));
          out.push(`### Shooting${slices.length > 1 ? `・${SLICE_LABEL[slice]}` : ''}`, '',
            '- シュートの種類別（スポーツナビの記録）。2P・3P別の1試合平均の成功数（2PM・3PM）・試投数（2PA・3PA）・成功率（2P%・3P%）。「選手スタッツ > Shooting」と同じ列。「ジャンプショット」（無印）には、キャッチアンドシュートも含まれる。',
            '- 「記録のある試合／出場」は、その選手が出た試合のうち、スポーツナビの記録がある試合の数／出場した試合の数。**平均・成功率の分母は、記録がある試合だけ**（記録が無い試合を 0 として入れない）。移籍した選手は、このチームでの試合だけ。',
            ...(extra.length ? [`- ${extra.map(x => `${x.name}（${x.data.extraGames}試合）`).join('、')}は、公式のボックススコアでは出場0分なのに、スポーツナビには本人のシュートの記録がある試合がある。選手スタッツの Shooting と同じく、そのシュートは含め、平均の分母（出場試合）には数えない。`] : []), '',
            table(['選手', '記録のある試合／出場', ...cs.filter((_, k) => keep[k]).map(c => c.label)], body.map(r => [r[0]!, r[1]!, ...r.slice(2).filter((_, k) => keep[k])])), '');
        }
      }
    }
    if (!yahooSupported) out.push('### この版で出せなかった表', '', `- Shooting（${yahooReason}）`, '');
    return finish();
  }

  // ---- チーム情報 ----
  const mkCol = (key: string, label: string, t: Term, forSlices: TimeSlice[] = slices, tid = teamId): Col => ({ key, label, logs: t.statLogs, term: t, rows: new Map(forSlices.map(s => [s, sliceRow(tid, t.statLogs, s, i.periodSource)])) });
  // 列＝タームの区分（区分が2つ以上なら最後に「シーズン全体」を参考に足す）
  const termCols: Col[] = terms.map(t => mkCol(t.key, t.label, t));
  const cols: Col[] = terms.length > 1 ? [...termCols, mkCol('season', 'シーズン全体', seasonTerm)] : termCols;
  let prevCol: Col | null = null;
  let prevName = '';
  if (i.compare && i.prev) {
    prevName = teamNameInSeason(i.history, teamId, i.prev.season, i.prev.team.teamName);
    const pt = detailedTerms(i.prev, 'season', i.opp, teamId, i.history, lg)[0]!;
    prevCol = mkCol('prev', `前季全体（${i.prev.season}${lg === 'one' ? '・旧B2' : ''}${i.opp === 'all' ? '' : `・${OPPONENT_KIND_LABELS[i.opp]}`}）`, pt, ['game']);
  }
  const fm = new Map(PERSPECTIVES.map(([p]) => [p, seasonPeriodFormatters('perGame', p, foulSplit)]));
  const numFm = (p: TeamPerspective, label: string, r: AllTeamsRow): number => Number(String(fm.get(p)!.get(label)!(r, startYear)).replace(/[%+]/g, ''));
  const heading = (slice: TimeSlice) => (slices.length > 1 ? [`### ${SLICE_LABEL[slice]}`, ''] : []);

  // ---- リーグ順位・リーグ平均（選んだ期間・対戦相手の絞り込みを、全チームに同じ決め方で当てはめる） ----
  interface LeagueCol { rows: Map<string, AllTeamsRow>; pooled: AllTeamsRow; n: number; logs: Map<string, TeamGameLog[]> }
  const leagueCols = new Map<string, LeagueCol>();
  if (i.leagueLogs) {
    const perTeam = new Map<string, { terms: FTerm[]; season: FTerm }>();
    for (const t of cur.teams) {
      const logs = i.leagueLogs.get(t.teamId);
      if (!logs) continue;
      const ds: DetailedSeason = { ...cur, team: t, regular: logs };
      const tt = detailedTerms(ds, i.term, i.opp, t.teamId, i.history, lg);
      perTeam.set(t.teamId, { terms: tt, season: tt.length > 1 ? detailedTerms(ds, 'season', i.opp, t.teamId, i.history, lg)[0]! : tt[0]! });
    }
    for (const c of cols) {
      const rows = new Map<string, AllTeamsRow>();
      const logsBy = new Map<string, TeamGameLog[]>();
      const allLogs: TeamGameLog[] = [];
      for (const [tid, pt] of perTeam) {
        const term = c.key === 'season' ? pt.season : pt.terms.find(x => x.key === c.key);
        if (!term || !term.statLogs.length) continue;
        rows.set(tid, sliceRow(tid, term.statLogs, 'game'));
        logsBy.set(tid, term.statLogs);
        allLogs.push(...term.statLogs);
      }
      leagueCols.set(c.key, { rows, pooled: pooledRow([...rows.values()], allLogs), n: rows.size, logs: logsBy });
    }
  }
  const hasLeague = leagueCols.size > 0;
  const dirs = new Map(PERSPECTIVES.map(([p]) => [p, leagueDirections(p, foulSplit, startYear)] as const));
  const rankCache = new Map<string, Map<string, number>>();
  /** 自チームの値に順位を添える（「85.50（3位）」）。対象の試合が無いチーム・向きが決まらない項目（G など）は値だけ */
  const rankedCell = (c: Col, p: TeamPerspective, label: string, slice: TimeSlice): string => {
    const r = c.rows.get(slice)!;
    const f = fm.get(p)!.get(label);
    if (!f || !r.gamesPlayed) return '-';
    const v = f(r, startYear);
    // 前半・後半は自チームの値だけ（リーグ順位・リーグ平均は試合全体の列だけ）
    if (slice !== 'game') return v;
    const lc = leagueCols.get(c.key);
    const dir = dirs.get(p)!.get(label);
    if (!lc || !dir || NO_RANK.has(label)) return v;
    const key = `${c.key}|${p}|${label}`;
    let ranks = rankCache.get(key);
    if (!ranks) { ranks = leagueRanks(lc.rows, dir, rr => f(rr, startYear)); rankCache.set(key, ranks); }
    const rk = ranks.get(teamId);
    return rk === undefined ? v : `${v}（${rk}位）`;
  };
  const leagueAvgCell = (c: Col, p: TeamPerspective, label: string): string => {
    const lc = leagueCols.get(c.key);
    const f = fm.get(p)!.get(label);
    if (!lc || !f || label === 'G' || !lc.pooled.gamesPlayed) return '-';
    return f(lc.pooled, startYear);
  };
  /** 列の見出し（リーグ平均の列を右に添える） */
  const colHeads = (list: Col[], slice: TimeSlice = 'game'): string[] => list.flatMap(c => (slice === 'game' && leagueCols.has(c.key) ? [c.label, `${c.label} リーグ平均`] : [c.label]));
  const colCells = (list: Col[], p: TeamPerspective, label: string, slice: TimeSlice): string[] => list.flatMap(c => (slice === 'game' && leagueCols.has(c.key) ? [rankedCell(c, p, label, slice), leagueAvgCell(c, p, label)] : [rankedCell(c, p, label, slice)]));

  const leagueNote = (): string => {
    if (!hasLeague) return '付けない';
    const counts = cols.map(c => `${c.label} ${leagueCols.get(c.key)?.n ?? 0}チーム`).join('・');
    return `チームのまとめ・Traditional・Advanced・Misc・Scoring・Shooting・Forced TOV の表で、自チームの値に「85.50（3位）」の形でリーグ順位を添え、各列の右に「リーグ平均」の列を付ける。順位は、選んだ期間・対戦相手の絞り込みを全チームに同じ決め方で当てはめて比べる（3ターム＝リーグ共通の中断期間、前半戦・後半戦と直近5試合＝各チームの試合、勝率6割以上＝各チームがその試合に入る時点の相手の勝率）。多いほうが良い項目は多い順、少ないほうが良い項目（失点・TOV・DRtg・ファウルなど。opp の視点では向きが反転）は少ない順で、サイトのランキングと同じ向き。同じ値（表の丸めた値が同じ）は同じ順位で、次の順位はその分飛ばす（1位・2位・2位・4位）。対象の試合が0のチームは順位を付けない。順位の対象チーム数：${counts}。リーグ平均は、リーグの全チームの対象の試合を合計して出した1試合平均・割合（チームごとの平均の平均ではない）。G・MIN・POSS・PACE は良し悪しの向きが無いので順位を付けない（リーグ平均は付ける。G は付けない）。得点失点構成・オンザコート別・Time to Shot・Streaks・シチュエーション別勝敗には付けない。Shooting・Forced TOV は、スポーツナビの記録がある試合だけで比べ、記録の無いチームは順位を付けない（自チーム・差は多いほうが上位、opp＝相手のシュート・相手に強制された分は少ないほうが上位）`;
  };
  out.push(`# ${name} ${i.season} チーム情報（詳しい版）`, '', '## この書き出しについて', '');
  out.push(aboutTable(i, { name, ended, complete, terms, slices, split, extra: [['リーグ順位・リーグ平均', leagueNote()], ['前季との比較', prevCol ? `する（「チームのまとめ」だけ。${i.prev!.season} ${prevName} の前季全体${i.opp === 'all' ? '' : '（前季も同じ相手の条件で絞る）'}と比べる）` : i.compare ? `しない（${lg === 'one' ? 'B.ONE の前季（旧B2）' : '前季'}にこのチームの記録がない${lg === 'one' ? '。前季に別のリーグにいたチームとは比べない' : ''}）` : 'しない']] }), '');
  out.push('### 対象試合', '', gameTable(i, terms.length > 1 ? [...terms, { ...seasonTerm, label: 'シーズン全体（参考）' }] : terms), '');
  if (i.opp !== 'all') out.push('#### 対象の試合（相手と、その試合に入る時点の相手の勝敗）', '', gameListTable(i, terms, seasonTerm, cur, i.history), '');
  if (allEmpty) { out.push(...EMPTY_NOTE(i)); return finish(true); }
  if (hasGame) out.push(...foreignTimeTable(i, terms));
  out.push('### 数字の書き方', '',
    '- 平均は1試合平均（分母はその表のスタッツの対象試合数）。割合（%）は合計の分子÷合計の分母（試合ごとの割合の平均ではない）。小数は第2位まで。',
    '- 勝率は .750 の形、時間は 分:秒。「差」は自チーム−相手（構成比・成功率の差はパーセントポイント）。「opp」は相手チームの値。',
    '- 「-」は値が無い（分母が0・その区間の記録が無い・そのシーズンに無い項目）。0 は実際に0。',
    '- 結果だけの試合（不戦勝・ボックススコアの無い試合）は、勝敗・試合数には数え、スタッツには入れない。',
    ...sliceNotes(slices, 'team'), '',
    '#### 用語（数え方が名前から分かりにくい項目）', '', ...[...GLOSSARY_TEAM, ...GLOSSARY_COMMON].map(t => `- ${t}`), '');

  // 1〜3 は試合全体だけ（前半・後半には出さない）
  if (hasGame) {
  // 1. チームのまとめ
  out.push('## 1. チームのまとめ', '');
  const SUMMARY: [TeamPerspective, string, string][] = [
    ['own', 'PTS', '得点'], ['opp', 'PTS', '失点'], ['own', '+/-', '得失点差'], ['own', 'ORtg', ''], ['own', 'DRtg', ''], ['own', 'NetRtg', ''], ['own', 'PACE', ''],
    ['own', 'eFG%', ''], ['opp', 'eFG%', ''], ['own', 'TOV%', ''], ['opp', 'TOV%', ''], ['own', 'OR%', ''], ['opp', 'OR%', ''], ['own', 'FTR', ''], ['opp', 'FTR', ''],
    ['own', '3P%', ''], ['opp', '3P%', ''], ['own', '%3PA', '3PA の割合（FGAに占める）'], ['own', 'AST', ''], ['own', 'TOV', ''],
  ];
  for (const slice of slices.filter(sl => sl === 'game')) {
    out.push(...heading(slice));
    const main = cols.at(-1)!;
    const head = ['項目', ...colHeads(cols), ...(prevCol ? [prevCol.label, `差（${main.label}−前季全体）`] : [])];
    const rows: string[][] = [];
    const recText = (c: Col) => `${c.term.games.length}（${c.term.games.filter(g => g.win).length}-${c.term.games.filter(g => !g.win).length}）`;
    rows.push(['試合（勝敗）', ...cols.flatMap(c => (leagueCols.has(c.key) ? [recText(c), '-'] : [recText(c)])), ...(prevCol ? [recText(prevCol), '-'] : [])]);
    for (const [p, label, ja] of SUMMARY) {
      const f = fm.get(p)!.get(label);
      if (!f) continue;
      const cells = colCells(cols, p, label, slice);
      const prevCell = prevCol ? (() => { const r = prevCol.rows.get(slice)!; return r.gamesPlayed ? f(r, startYear) : '-'; })() : '-';
      let diff = '-';
      if (prevCol) {
        const a = main.rows.get(slice)!, b = prevCol.rows.get(slice)!;
        if (a.gamesPlayed && b.gamesPlayed) {
          const v = numFm(p, label, a) - numFm(p, label, b);
          diff = `${v > 0 ? '+' : ''}${v.toFixed(2)}${/%/.test(label) || label === 'FTR' ? 'ポイント' : ''}`;
        }
      }
      rows.push([`${p === 'opp' ? 'opp ' : ''}${label}${ja ? `（${ja}）` : ''}`, ...cells, ...(prevCol ? [prevCell, diff] : [])]);
    }
    out.push(table(head, rows), '');
  }

  // 2. シチュエーション別勝敗（試合の最終勝敗。結果だけの試合は入らない＝今の画面と同じ）
  const withOpp = i.opp !== 'all';
  out.push('## 2. シチュエーション別勝敗', '', `スタッツのある試合の最終勝敗（今の画面と同じく、結果だけの試合は入らない）。「対戦相手の強さ」の行は概要の表と同じく相手の今季（基準日時点）の勝率で分ける${withOpp ? '（上の絞り込みは試合前の勝率なので、基準が違う）' : ''}。1Q・前半・3Q終了時点は試合ログのクォーター別得点から判定する。月別は出さない（タームと重なる）。`, '');
  const groups = buildSituationalRecordGroups(cur.regular, teamId, buildBackToBackStatus(cur.summaries), buildOpponentSeasonWinRates(cur.teams), cur.division as never, i.season, lg);
  const checkpoint = (g: TeamGameLog, q: number) => {
    const own = (g.periodPoints ?? []).slice(0, q), opp = (g.opponentPeriodPoints ?? []).slice(0, q);
    if (own.length < q || opp.length < q || own.some(v => v == null) || opp.some(v => v == null)) return undefined;
    const a = own.reduce<number>((s, v) => s + (v ?? 0), 0), b = opp.reduce<number>((s, v) => s + (v ?? 0), 0);
    return a > b ? 'lead' : a < b ? 'behind' : 'tie';
  };
  const CHECKPOINT_Q: Record<string, number> = { q1status: 1, halfStatus: 2, q3status: 3 };
  const hasOt = (g: TeamGameLog) => { const n = gameOvertimes(g); if (n !== undefined) return n > 0; const pp = g.periodPoints ?? []; return pp.length >= 4 ? pp.slice(0, 4).reduce<number>((s, v) => s + (v ?? 0), 0) !== g.teamScore : undefined; };
  const sitRows: string[][] = [];
  for (const gr of groups) {
    if (gr.key === 'month') continue;
    for (const row of gr.rows) {
      const pred = gr.key in CHECKPOINT_Q ? (g: TeamGameLog) => checkpoint(g, CHECKPOINT_Q[gr.key]!) === row.key
        : gr.key === 'overtime' ? (g: TeamGameLog) => hasOt(g) === (row.key === 'ot')
        : (g: TeamGameLog) => row.predicate(g, undefined as never);
      const cells = cols.map(c => { const m = c.logs.filter(pred); const w = m.filter(g => g.win).length; return m.length ? `${w}-${m.length - w}` : '-'; });
      if (cells.every(v => v === '-')) continue;
      sitRows.push([SITUATION_GROUP_LABEL[gr.key] ?? gr.label, SITUATION_ROW_LABEL[row.key] ?? row.label, ...cells]);
    }
  }
  out.push(table(['区分', '条件', ...cols.map(c => `${c.label}（勝-敗）`)], sitRows), '');

  // 3. 得点・失点構成
  out.push('## 3. 得点・失点構成', '', '1試合平均の得点（失点）と、総得点（総失点）に占める割合。FG試投構成はFGAに占める割合。', '');
  for (const slice of slices.filter(sl => sl === 'game')) {
    out.push(...heading(slice));
    const rows: string[][] = [];
    for (const side of ['own', 'opponent'] as const) {
      const sl = side === 'own' ? '得点' : '失点';
      const shares = cols.map(c => { const r = c.rows.get(slice)!; return r.gamesPlayed ? teamScoringShareFromTotals(r.totals as never, r.gamesPlayed, side) : null; });
      ['3P', 'FT', 'Mid-range', 'Paint'].forEach((n, k) => rows.push([`${sl}：${n}`, ...shares.map(s => (s ? `${s.values[k]!.toFixed(2)}（${s.pct[k]!.toFixed(2)}%）` : '-'))]));
      const cl = cols.map(c => { const r = c.rows.get(slice)!; return r.gamesPlayed ? teamClassificationShareFromTotals(r.totals as never, r.gamesPlayed, side) : null; });
      ['日本人', '外国籍・帰化・アジア'].forEach((n, k) => rows.push([`${sl}：${n}`, ...cl.map(s => (s ? `${s.values[k]!.toFixed(2)}（${s.pct[k]!.toFixed(2)}%）` : '-'))]));
      const fg = cols.map(c => { const r = c.rows.get(slice)!; const t = r.totals; const o = side === 'own'; return r.gamesPlayed ? fgaShare({ games: r.gamesPlayed, tpa: o ? t.tpa : t.oppTpa, mid2a: o ? t.mid2a : t.oppMid2a, paint2a: o ? t.paint2a : t.oppPaint2a }) : null; });
      ['3P', 'Mid-range', 'Paint'].forEach((n, k) => rows.push([`${side === 'own' ? '' : 'opp '}FG試投：${n}`, ...fg.map(s => (s ? `${s.values[k]!.toFixed(2)}（${s.pct[k]!.toFixed(2)}%）` : '-'))]));
    }
    out.push(table(['項目（平均・割合）', ...cols.map(c => c.label)], rows), '');
  }

  }
  // 4. チームスタッツ（Traditional・Advanced・Misc・Scoring）
  out.push('## 4. チームスタッツ', '', 'チーム詳細 > チームスタッツ > シーズン別成績と同じ列・同じ式。opp・差は意味のある項目だけ。', '');
  for (const [cat, labels] of Object.entries(teamSeasonColumnLabels())) {
    for (const slice of slices) {
      const rows: string[][] = [];
      if (slice !== 'game') rows.push(['対象試合（勝敗）', ...cols.map(c => { const r = c.rows.get(slice)!; return `${r.gamesPlayed}（${r.wins}-${r.losses}）`; })]);
      for (const [p, prefix] of PERSPECTIVES) {
        for (const label of labels) {
          if (MOVED_TO_COMPOSITION.has(label) || (p !== 'own' && OWN_ONLY.has(label))) continue;
          const cells = colCells(cols, p, label, slice);
          if (cells.every(v => v === '-')) continue;
          rows.push([`${prefix}${label}`, ...cells]);
        }
      }
      out.push(`### ${cat}${slices.length > 1 ? `・${SLICE_LABEL[slice]}` : ''}`, '', table(['項目', ...colHeads(cols, slice)], rows), '');
    }
  }
  // Shooting・Forced TOV（スポーツナビの記録がある試合だけで数える。記録が無い試合は分母にも合計にも入れない）
  const tp = i.periodSource ?? null;
  /** 前半・後半を含むときの見出しの添え字 */
  const sfx = (slice: TimeSlice) => (slices.length > 1 ? `・${SLICE_LABEL[slice]}` : '');
  const missingTables: string[] = [];
  if (!yahooSupported) missingTables.push(`Shooting・Forced TOV（${yahooReason}）`);
  else {
    const record = (c: Col) => { const n = sumShotPair(c.logs).games; return `${n}／${c.logs.length}`; };
    /** 列ごとの、リーグ全チームのデータ（teamId → データ）と、リーグ全体を1チームとみなした合計 */
    const leagueOf = <T,>(c: Col, make: (logs: TeamGameLog[], tid: string) => T, has: (d: T) => boolean, add: (a: T, b: T) => T, zero: () => T) => {
      const lc = leagueCols.get(c.key);
      const rows = new Map<string, T>();
      let pooled = zero();
      for (const [tid, logs] of lc?.logs ?? []) { const d = make(logs, tid); if (!has(d)) continue; rows.set(tid, d); pooled = add(pooled, d); }
      return { rows, pooled: rows.size ? pooled : undefined };
    };
    /** 1つの表（行＝視点×項目、列＝ターム＋リーグ平均）。全部の列が「-」の行は出さない */
    const metricRows = <T,>(metrics: Metric<T>[], datas: { own: T | undefined; league: { rows: Map<string, T>; pooled: T | undefined } | undefined }[], prefixOf: (m: Metric<T>) => string): string[][] => {
      const rows: string[][] = [];
      for (const m of metrics) {
        const cells = datas.flatMap(d => {
          const own = d.own && m.text(d.own) !== '-' ? m.text(d.own) : '-';
          let shown = own;
          if (own !== '-' && d.league) {
            const pool = new Map([...d.league.rows].filter(([, r]) => m.text(r) !== '-'));
            const ranks = leagueRanks(pool, { sort: m.value, higherIsBetter: m.higherIsBetter }, m.text);
            const rk = ranks.get(teamId);
            if (rk !== undefined) shown = `${own}（${rk}位）`;
          }
          return d.league ? [shown, d.league.pooled && m.text(d.league.pooled) !== '-' ? m.text(d.league.pooled) : '-'] : [shown];
        });
        if (cells.every(v => v === '-')) continue;
        rows.push([`${prefixOf(m)}${m.label}`, ...cells]);
      }
      return rows;
    };
    const perspectivePrefix = new Map(YAHOO_PERSPECTIVES.map(([p, pre]) => [p, pre]));
    const noteLeague = hasLeague ? '。自チームの値に「（◯位）」でリーグ順位を添え、各列の右に「リーグ平均」（全チームの記録がある試合の合計から出した1試合平均・成功率）を付ける。順位は他の表と同じ決め方（同じ値は同じ順位。対象の記録が無いチームは順位を付けない）' : '';
    // ---- 試合全体の Shooting・Forced TOV（リーグ順位・リーグ平均つき） ----
    if (hasGame) {
    const shotOwn = cols.map(c => sumShotPair(c.logs));
    const shotLeague = cols.map(c => (hasLeague ? leagueOf(c, logs => sumShotPair(logs), d => d.games > 0, addShotPair, emptyShotPair) : undefined));
    const keys = shotKeysOf([...shotOwn, ...shotLeague.flatMap(l => (l?.pooled ? [l.pooled] : []))]);
    out.push(`### Shooting${slices.length > 1 ? '・試合全体' : ''}`, '', `シュートの種類別（スポーツナビの記録）。2P・3P別の1試合平均の成功数（2PM・3PM）・試投数（2PA・3PA）・成功率（2P%・3P%）。視点は 自チーム／opp（相手のシュート）／差（自チーム−相手。成功率の差はパーセントポイント）。「全チームスタッツ > Shooting」と同じ値・同じ列。**分母は、スポーツナビの記録がある試合だけ**（記録が無い試合を 0 として入れない）。「ジャンプショット」（無印）には、キャッチアンドシュートも含まれる（独立した区分が無い）${noteLeague}。`, '');
    out.push(table(['項目', ...colHeads(cols)], [
      ['記録がある試合／スタッツの対象試合', ...cols.flatMap(c => (leagueCols.has(c.key) ? [record(c), `チーム延べ${shotLeague[cols.indexOf(c)]?.pooled?.games ?? 0}試合`] : [record(c)]))],
      ...metricRows(shootingMetrics(keys), cols.map((c, k) => ({ own: shotOwn[k]!.games > 0 ? shotOwn[k] : undefined, league: shotLeague[k] })), m => perspectivePrefix.get(m.perspective) ?? ''),
    ]), '');
    // ---- Forced TOV ----
    const wholeSeasonAll = i.opp === 'all' && (terms.length === 1 && i.term === 'season');
    const tovOf = (c: Col, logs: TeamGameLog[], tid: string): TovPair => {
      if (i.pbps && (i.pbpsScope ?? 'league') === 'league') return sumTovPair(logs, i.pbps, tid);
      // 1シーズン・全チームのときだけ teams.json の値（全試合の合計）を使う（読み込みを省く）
      const t = cur.teams.find(x => x.teamId === tid);
      const p = wholeSeasonAll && t ? tovPairFromTeam(t) : null;
      if (!p) throw new Error('スポーツナビの記録が読み込まれていません。');
      return p;
    };
    const tovOwn = cols.map(c => tovOf(c, c.logs, teamId));
    const tovLeague = cols.map(c => (hasLeague ? leagueOf(c, (logs, tid) => tovOf(c, logs, tid), d => d.forced.gamesWithData > 0, addTovPair, emptyTovPair) : undefined));
    out.push(`### Forced TOV${slices.length > 1 ? '・試合全体' : ''}`, '', `ターンオーバーの種類別の1試合平均（スポーツナビの記録）。視点は 自チーム＝相手から奪った（自チームが強制した）／opp＝相手に強制された（自チームが記録した）／差＝奪った−強制された。「全チームスタッツ > Forced TOV」と同じ値・同じ分類。**分母は、スポーツナビの記録がある試合だけ**（データあり試合数）。「ライブボール（参考）」はスティール由来で参考値${noteLeague ? noteLeague.replace('成功率', '割合') + '。順位の向きは、自チーム・差は多いほうが上位、opp（相手に強制された）は少ないほうが上位' : ''}。`, '');
    out.push(table(['項目', ...colHeads(cols)], [
      ['データあり試合数', ...cols.flatMap((c, k) => (leagueCols.has(c.key) ? [String(tovOwn[k]!.forced.gamesWithData), `チーム延べ${tovLeague[k]?.pooled?.forced.gamesWithData ?? 0}試合`] : [String(tovOwn[k]!.forced.gamesWithData)]))],
      ...metricRows(forcedMetrics(), cols.map((c, k) => ({ own: tovOwn[k]!.forced.gamesWithData > 0 ? tovOwn[k] : undefined, league: tovLeague[k] })), m => perspectivePrefix.get(m.perspective) ?? ''),
    ]), '');
    if (cols.some((c, k) => shotOwn[k]!.games < c.logs.length)) out.push('- **スポーツナビの記録が無い試合があるため、その試合は Shooting・Forced TOV の平均・成功率に入れていない**（上の「記録がある試合／スタッツの対象試合」を参照）。', '');
    }
    // ---- 前半・後半の Shooting・Forced TOV（自チームのスポーツナビの記録のピリオドで数える。リーグ順位・リーグ平均は付けない） ----
    for (const slice of slices.filter(sl => sl !== 'game')) {
      if (!i.pbps) throw new Error('スポーツナビの記録が読み込まれていません。');
      const pbps = i.pbps;
      const periods = HALF_PERIODS[slice as 'h1' | 'h2'];
      const pairs = cols.map(c => shotPairInPeriods(c.logs, pbps, teamId, periods));
      const tovs = cols.map(c => tovPairInPeriods(c.logs, pbps, teamId, periods));
      const word = SLICE_LABEL[slice];
      out.push(`### Shooting・${word}`, '', `シュートの種類別の1試合平均（スポーツナビの記録の、${word}のシュートだけ）。視点・列は試合全体の Shooting と同じ。**自チーム・opp・差の値だけで、リーグ順位・リーグ平均は付けない。** 分母は、スポーツナビの記録がある試合だけ（記録が無い試合を 0 として入れない）。`, '');
      out.push(table(['項目', ...cols.map(c => c.label)], [
        ['記録がある試合／スタッツの対象試合', ...cols.map((c, k) => `${pairs[k]!.games}／${c.logs.length}`)],
        ...metricRows(shootingMetrics(shotKeysOf(pairs)), pairs.map(pr => ({ own: pr.games > 0 ? pr : undefined, league: undefined })), m => perspectivePrefix.get(m.perspective) ?? ''),
      ]), '');
      out.push(`### Forced TOV・${word}`, '', `ターンオーバーの種類別の1試合平均（スポーツナビの記録の、${word}のターンオーバーだけ）。視点は試合全体の Forced TOV と同じ。**リーグ順位・リーグ平均は付けない。** 分母は、スポーツナビの記録がある試合だけ（データあり試合数）。`, '');
      out.push(table(['項目', ...cols.map(c => c.label)], [
        ['データあり試合数', ...tovs.map(t => String(t.forced.gamesWithData))],
        ...metricRows(forcedMetrics(), tovs.map(t => ({ own: t.forced.gamesWithData > 0 ? t : undefined, league: undefined })), m => perspectivePrefix.get(m.perspective) ?? ''),
      ]), '');
      if (cols.some((c, k) => pairs[k]!.games < c.logs.length)) out.push('- **スポーツナビの記録が無い試合があるため、その試合は平均・成功率に入れていない**（上の「記録がある試合／スタッツの対象試合」を参照）。', '');
    }
  }
  // オンザコート別（On-Court Foreign とまとめる）。試合全体（区間は段階4）
  for (const slice of slices) {
  out.push(`### オンザコート別（コート上の外国籍・帰化・アジア特別枠の人数）${sfx(slice)}`, '', '人数ごとの出場時間（合計）、時間の割合、その時間の得点・失点・ORtg・DRtg・NetRtg（2020-21以降は実際の攻撃回数）。「相手の割合」は相手チームのコート上の人数の時間の割合。「ラインナップ > オンザコート別」と同じ値。外国籍・帰化・アジア特別枠の合計で、日本人は数えない。', '');
  for (const c of cols) {
    const logs = c.logs;
    if (!logs.length) { out.push(`#### ${c.label}`, '', '- 該当する試合なし', ''); continue; }
    const detail = tp && i.maxForeignOnCourt !== undefined ? sumForeignDetail(tp, logs, (slice === 'game' ? 'all' : slice) as ForeignPeriodValue) : null;
    const oppSec = tp ? sumForeignCourt(tp, logs, (slice === 'game' ? 'all' : slice) as ForeignPeriodValue, 'opp') : null;
    if (!detail || i.maxForeignOnCourt === undefined) { out.push(`#### ${c.label}`, '', '- 記録なし', ''); if (!missingTables.includes('オンザコート別')) missingTables.push('オンザコート別'); continue; }
    const oc = seasonOnCourtSummaryFromDetail(detail, i.maxForeignOnCourt);
    const oppTotal = oppSec ? oppSec.seconds.reduce((a, b) => a + b, 0) : 0;
    const f2 = (v: number | null) => (v === null ? '-' : v.toFixed(2));
    const sgn = (v: number) => `${v > 0 ? '+' : ''}${v}`;
    const rows = oc.rows.filter(r => r.seconds > 0 || (r.count !== null && oppSec && oppSec.seconds[r.count]! > 0)).map(r => [r.count === null ? '集計外' : `${r.count}人`, formatMinutesFromSeconds(r.seconds), r.pct === null ? '-' : `${r.pct.toFixed(2)}%`, String(r.ownPoints), String(r.oppPoints), sgn(r.netPoints), f2(r.ortg), f2(r.drtg), r.netRtg === null ? '-' : `${r.netRtg > 0 ? '+' : ''}${r.netRtg.toFixed(2)}`, r.count !== null && oppSec && oppTotal ? `${((oppSec.seconds[r.count]! / oppTotal) * 100).toFixed(2)}%` : '-']);
    rows.push(['合計', formatMinutesFromSeconds(oc.totals.seconds), '', String(oc.totals.ownPoints), String(oc.totals.oppPoints), sgn(oc.totals.ownPoints - oc.totals.oppPoints), f2(oc.total.ortg), f2(oc.total.drtg), oc.total.netRtg === null ? '-' : `${oc.total.netRtg > 0 ? '+' : ''}${oc.total.netRtg.toFixed(2)}`, '']);
    out.push(`#### ${c.label}（${oc.games}試合）`, '', table(['人数', '時間', '割合', '得点', '失点', '得失点', 'ORtg', 'DRtg', 'NetRtg', '相手の割合'], rows), '');
  }
  }
  if (i.season < '2020-21') out.push('- 2019-20以前のシーズンは、攻撃回数と在コートが推定で、ORtg・DRtg は推定の値。', '');

  // Time to Shot（2020-21以降）
  if (i.season >= '2020-21' && i.ttsSource) for (const slice of slices) {
    const tts = i.ttsSource;
    const tv = slice === 'game' ? 'all' as const : slice;
    out.push(`### Time to Shot${sfx(slice)}`, '', '攻撃の始まりから最初のFG試投までの平均秒数（秒）と、その始まり方の割合。差は自チーム−相手（秒）。「チーム詳細 > チームスタッツ > Time to Shot」と同じ値。', '');
    const vals = cols.map(c => { const own = sumTtsTotals(tts, c.logs, tv, 'own'), opp = sumTtsTotals(tts, c.logs, tv, 'opp'); return { own: ttsRowValues(own, opp, 'own'), opp: ttsRowValues(own, opp, 'opp'), diff: ttsRowValues(own, opp, 'diff') }; });
    const rows: string[][] = [];
    for (const x of TTS_TABLE_ITEMS) {
      rows.push([`${x.abbr}（秒）`, ...vals.map(v => formatTtsSeconds(v.own[x.item].avg, 'own'))]);
      rows.push([`opp ${x.abbr}（秒）`, ...vals.map(v => formatTtsSeconds(v.opp[x.item].avg, 'opp'))]);
      rows.push([`差 ${x.abbr}（秒）`, ...vals.map(v => formatTtsSeconds(v.diff[x.item].avg, 'diff'))]);
      if (x.hasPct) { rows.push([`${x.abbr}（割合%）`, ...vals.map(v => formatTtsPct(v.own[x.item].pct, 'own'))]); rows.push([`opp ${x.abbr}（割合%）`, ...vals.map(v => formatTtsPct(v.opp[x.item].pct, 'opp'))]); }
    }
    out.push(table(['項目', ...cols.map(c => c.label)], rows), '');
  }
  if (i.season < '2020-21') missingTables.push('Time to Shot（2020-21より前は無い）');

  // Streaks（試合の最終勝敗。結果だけの試合も数える＝今の Streaks と同じ）。試合全体だけ
  if (hasGame) {
  const allGames = teamConfirmedGames(teamId, cur.regular, cur.schedule);
  const multiTerm = terms.length > 1 || i.term === 'recent5';
  out.push('### Streaks', '',
    '連勝・連敗は、**そのターム（列）の中の試合だけで数える**。タームの境目をまたぐ連勝・連敗は、前後のタームでそれぞれ切れて数えるので、「境目で切れた連続」の列に、どちらの境目で切れたか（前を含めた本来の長さ）を書く。「シーズン全体」の列は切れずに数える（チーム詳細 > チームスタッツ > Streaks と同じ）。結果だけの試合も数える。' + (i.opp === 'all' ? '' : '対戦相手で絞ったときは、絞ったあとの試合を順に並べて数える（間の絞られた試合は飛ばす）ので、境目の判定はしない。'), '');
  const run = (st: { length: number; runs: { first: { date: string }; last: { date: string } }[] } | null | undefined) => (!st ? '0' : st.runs.length > 2 ? `${st.length}（${st.runs.length}回）` : `${st.length}（${st.runs.map(r => `${r.first.date}〜${r.last.date}`).join('、')}）`);
  const boundary = (c: Col): string => {
    if (c.key === 'season' || !multiTerm) return '-';
    if (i.opp !== 'all') return '判定しない（絞り込み）';
    const g = c.term.games;
    if (!g.length) return '-';
    const at = allGames.findIndex(x => x.scheduleKey === g[0]!.scheduleKey);
    const parts: string[] = [];
    const before = allGames[at - 1];
    if (before && before.win === g[0]!.win) {
      let inTerm = 0; while (inTerm < g.length && g[inTerm]!.win === g[0]!.win) inTerm++;
      let total = inTerm; for (let k = at - 1; k >= 0 && allGames[k]!.win === g[0]!.win; k--) total++;
      parts.push(`冒頭の${inTerm}${g[0]!.win ? '連勝' : '連敗'}は前のタームから続く（前を含めて${total}${g[0]!.win ? '連勝' : '連敗'}）`);
    }
    const last = g.at(-1)!;
    const endAt = allGames.findIndex(x => x.scheduleKey === last.scheduleKey);
    const after = allGames[endAt + 1];
    if (after && after.win === last.win) {
      let inTerm = 0; while (inTerm < g.length && g[g.length - 1 - inTerm]!.win === last.win) inTerm++;
      let total = inTerm; for (let k = endAt + 1; k < allGames.length && allGames[k]!.win === last.win; k++) total++;
      parts.push(`最後の${inTerm}${last.win ? '連勝' : '連敗'}は次のタームへ続く（先を含めて${total}${last.win ? '連勝' : '連敗'}）`);
    }
    return parts.length ? parts.join('。') : 'なし';
  };
  const stRows = cols.map(c => {
    const row = buildStreakTeamRow({ teamId, teamName: name }, i.season, c.term.games.map(g => g.log), !complete);
    const curS = row.all.current;
    return [c.label, run(row.all.maxWin as never), run(row.all.maxLoss as never), `${row.home?.maxWin ?? 0}／${row.home?.maxLoss ?? 0}`, `${row.away?.maxWin ?? 0}／${row.away?.maxLoss ?? 0}`, curS && curS.count ? `${curS.count}${curS.type === 'win' ? '連勝' : '連敗'}` : '-', ...(multiTerm ? [boundary(c)] : [])];
  });
  out.push(table(['ターム', '最長連勝（期間）', '最長連敗（期間）', 'ホーム 最長連勝／連敗', 'アウェイ 最長連勝／連敗', 'その列の最後の時点', ...(multiTerm ? ['境目で切れた連続'] : [])], stRows), '');
  }
  if (missingTables.length) out.push('### この版で出せなかった表', '', ...missingTables.map(m => `- ${m}`), '');
  out.push('## 用語', '', '- 略称の意味はサイトの用語集と同じ（例：ORtg＝100ポゼッションあたりの得点、POSS・PACE は B.LEAGUE 公式の推定式）。', '- ペイント内外（Paint・Mid-range）は公式の区分。', '');
  return finish();
}
