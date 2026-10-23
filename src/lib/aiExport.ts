// AI向けMarkdown（短い版）。画面・通信とは独立し、既存の集計と列定義から作る。
import type { PlayerGameLog, PlayerSummary, TeamGameLog, TeamHistoryEntry, TeamSummary, GameSummary } from '../../shared/types';
import type { ScheduleFileExtended } from '../../shared/resultOnlyGames';
import { buildOpponentSplitRows } from './opponentSplit';
import { buildTraditionalColumns, buildAdvancedColumns, buildMiscColumns, sumTeamGameLogs, type AllTeamsRow } from './teamStatsColumns';
import { paintOf, paintRankable, paintValue } from './teamPaint2';
import { buildSeasonBoxscoreCtx, sumPlayerGameLogs, seasonBoxColumnsFor, EMPTY_TEAM_TOTALS } from './playerSeasonBoxscore';
import { EXTRA_ELIGIBILITY_RULES, MIN_GAMES_PLAYED_RATIO_FOR_RANKING } from './playerRankingEligibility';
import { statJa } from './statNames';
import { teamNameInSeason } from './teamLabel';
import { resultOnlyLogsForTeam } from './resultOnlyGames';
import { isRegularSeasonComplete } from '../../shared/regularSeasonComplete';
import { normalizePlayerName } from '../../shared/playerName';

export interface AiExportSeason {
  season: string;
  teams: TeamSummary[];
  logs: ReadonlyMap<string, TeamGameLog[]>;
  schedule: ScheduleFileExtended;
  summaries: GameSummary[];
}
export interface AiExportInput {
  current: AiExportSeason;
  previous: AiExportSeason | null;
  teamId: string;
  history: TeamHistoryEntry[];
  players: { player: PlayerSummary; logs: PlayerGameLog[] }[];
  opponentId?: string;
}
export type AiRow = AllTeamsRow & { logs: TeamGameLog[] };
type LogKey = keyof TeamGameLog;
export interface AiMetric {
  label: string;
  side: 'own' | 'opp';
  percent: boolean;
  direction: '多い順' | '少ない順' | '速い順';
  value: (row: AiRow) => number | null; // %は表示と同じ0〜100。他は1試合平均。
  /** 順位を付けてよい行か。2P内訳の記録が揃わない試合があるチームは参考値にする（ランキングと同じ扱い）。 */
  rankable?: (row: AiRow) => boolean;
  text: (row: AiRow) => string;
}
const BASE = [
  ['pts', ['teamScore']], ['fgm', ['fgm']], ['fga', ['fga']], ['fgpct', ['fgm', 'fga']],
  ['paint2m', ['paint2m']], ['paint2a', ['paint2a']], ['paint2pct', ['paint2m', 'paint2a']],
  ['mid2m', ['mid2m']], ['mid2a', ['mid2a']], ['mid2pct', ['mid2m', 'mid2a']],
  ['3pm', ['tpm']], ['3pa', ['tpa']], ['3ppct', ['tpm', 'tpa']],
  ['ftm', ['ftm']], ['fta', ['fta']], ['ftpct', ['ftm', 'fta']],
  ['or', ['oreb']], ['dr', ['dreb']], ['tr', ['reb']], ['ast', ['ast']],
  ['tov', ['tov']], ['stl', ['stl']], ['blk', ['blk']], ['benchPts', ['benchPoints']],
  ['efg', ['fgm', 'tpm', 'fga']], ['tovpct', ['tov', 'fga', 'fta']],
  ['ftr', ['fta', 'fga']], ['orbpct', ['oreb', 'opponentDreb']],
] as const;
const RATES: Record<string, (r: AiRow, opp: boolean) => number> = {
  fgpct: (r, o) => o ? r.totals.oppFga : r.totals.fga,
  paint2pct: (r, o) => o ? r.totals.oppPaint2a : r.totals.paint2a,
  mid2pct: (r, o) => o ? r.totals.oppMid2a : r.totals.mid2a,
  '3ppct': (r, o) => o ? r.totals.oppTpa : r.totals.tpa,
  ftpct: (r, o) => o ? r.totals.oppFta : r.totals.fta,
  efg: (r, o) => o ? r.totals.oppFga : r.totals.fga,
  ftr: (r, o) => o ? r.totals.oppFga : r.totals.fga,
  tovpct: (r, o) => o ? r.totals.oppFga + .44 * r.totals.oppFta + r.totals.oppTov : r.totals.fga + .44 * r.totals.fta + r.totals.tov,
  orbpct: (r, o) => o ? r.totals.oppOreb + r.totals.dreb : r.totals.oreb + r.totals.oppDreb,
  ortg: r => r.totals.poss, drtg: r => r.totals.poss, netrtg: r => r.totals.poss, pace: r => r.totals.min,
};
function opposite(key: string): LogKey {
  if (key === 'teamScore') return 'opponentScore';
  if (key.startsWith('opponent')) return (key[8]!.toLowerCase() + key.slice(9)) as LogKey;
  return `opponent${key[0]!.toUpperCase()}${key.slice(1)}` as LogKey;
}
export function aiTeamRow(team: AiRow['team'], allLogs: readonly TeamGameLog[]): AiRow {
  const logs = allLogs.filter(g => g.gameType === 'regular');
  const wins = logs.filter(g => g.win).length;
  return { team, logs, gamesPlayed: logs.length, wins, losses: logs.length - wins, totals: sumTeamGameLogs(logs) };
}
export function aiMetrics(): AiMetric[] {
  return (['own', 'opp'] as const).flatMap(side => {
    const opp = side === 'opp';
    const columns = [...buildTraditionalColumns('perGame', side), ...buildAdvancedColumns('perGame', side), ...buildMiscColumns('perGame', side, true, false)];
    const specs: [string, readonly string[]][] = BASE.map(([key, deps]) => [key, deps]);
    if (!opp) specs.push(['ortg', ['teamScore', 'poss']], ['drtg', ['opponentScore', 'poss']], ['netrtg', ['teamScore', 'opponentScore', 'poss']], ['pace', ['min', 'poss']]);
    return specs.map(([key, dependencies]) => {
      const paint = /^(paint2|mid2)/.test(key);
      const col = columns.find(c => c.key === key);
      const baseLabel = col!.label;
      const percent = baseLabel.includes('%') || key === 'ftr';
      const scale = percent && !['tovpct', 'orbpct'].includes(key) ? 100 : 1;
      let deps = dependencies.map(k => opp ? opposite(k) : k as LogKey);
      if (key === 'tr' && opp) deps = ['opponentOreb', 'opponentDreb'];
      const rawValue = (r: AiRow): number => {
        // 2P内訳は、チームスタッツの表と同じ計算（記録が揃う試合だけで平均・合計÷合計）にする。
        if (paint) return (paintValue(paintOf(r.totals), key, 'perGame', side) ?? NaN) * scale;
        return Number(col!.sortValue(r)) * scale;
      };
      const value = (r: AiRow): number | null => {
        if (!r.gamesPlayed || r.logs.some(g => deps.some(k => typeof g[k] !== 'number' || !Number.isFinite(g[k])))) return null;
        if (RATES[key] && RATES[key]!(r, opp) <= 0) return null;
        const v = rawValue(r);
        return Number.isFinite(v) ? v : null;
      };
      return { label: opp ? `opp ${baseLabel}` : baseLabel, side, percent,
        direction: key === 'pace' ? '速い順' : col!.higherIsBetter !== false ? '多い順' : '少ない順',
        value, rankable: paint ? (r: AiRow) => paintRankable(paintOf(r.totals), key, side) : undefined, text: r => { const v = value(r); return v === null ? '未収録' : `${v.toFixed(1)}${percent ? '%' : ''}`; } };
    });
  });
}
export function aiRank(metric: AiMetric, row: AiRow, rows: AiRow[]): string {
  const v = metric.value(row);
  if (v === null) return '未収録';
  if (metric.rankable && !metric.rankable(row)) return '参考（記録が揃わない試合あり）';
  const values = rows.filter(r => !metric.rankable || metric.rankable(r)).map(r => metric.value(r)).filter((n): n is number => n !== null).map(n => Number(n.toFixed(1)));
  const shown = Number(v.toFixed(1));
  const rank = 1 + values.filter(n => metric.direction === '少ない順' ? n < shown : n > shown).length;
  return `${rank}位／${values.length}チーム`;
}
export function aiDifference(a: number | null, b: number | null, percent: boolean): string {
  if (a === null || b === null) return '—';
  const n = Number((a - b).toFixed(1));
  return `${n > 0 ? '+' : ''}${n === 0 ? '0.0' : n.toFixed(1)}${percent ? 'ポイント' : ''}`;
}
export const LEADER_LABELS = ['PTS', 'AST', 'TR', 'STL', 'BLK', 'FG%', '3P%', '2P%', 'FT%', 'eFG%', 'MIN', 'EFF'];
export function aiLeaders(input: AiExportInput, team: AiRow) {
  const keys = new Map(team.logs.map(g => [g.scheduleKey, g.isHome]));
  const columns = [...seasonBoxColumnsFor('traditional', false), ...seasonBoxColumnsFor('advanced', false)];
  const players = input.players.map(({ player, logs }) => {
    const mine = logs.filter(g => g.gameType === 'regular' && keys.get(g.scheduleKey) === g.isHome);
    const raw = sumPlayerGameLogs(mine);
    return { player, raw, ctx: buildSeasonBoxscoreCtx(raw, EMPTY_TEAM_TOTALS, 'perGame', Number(input.current.season.slice(0, 4))) };
  }).filter(p => p.raw.gamesPlayed > 0);
  const eligibility: Record<string, string> = { 'FG%': 'fgPct', '3P%': 'tpPct', '2P%': 'twoPct', 'FT%': 'ftPct', 'eFG%': 'fgPct' };
  return LEADER_LABELS.map(label => {
    const col = columns.find(c => c.label === label)!;
    const rule = EXTRA_ELIGIBILITY_RULES[eligibility[label] ?? ''];
    const eligible = players.filter(p => {
      if (!rule) return true;
      // チーム限定の合計・出場数を掲載基準へ渡す。移籍前後を合算しない。
      const summary = { ...p.player, gamesPlayed: p.raw.gamesPlayed, totals: { ...p.player.totals, ...p.raw } };
      return p.raw.gamesPlayed / team.gamesPlayed >= MIN_GAMES_PLAYED_RATIO_FOR_RANKING && rule.perGameValue(summary) >= rule.defaultValue;
    });
    const ranked = eligible.map(p => ({ playerId: p.player.playerId, name: normalizePlayerName(p.player.name), games: p.raw.gamesPlayed, value: col.value(p.ctx, 'perGame'), text: col.format(p.ctx, 'perGame') }))
      .filter(p => Number.isFinite(p.value)).sort((a, b) => b.value - a.value || a.playerId.localeCompare(b.playerId));
    const rows = ranked.map((p) => ({ ...p, rank: ranked.findIndex(x => x.text === p.text) + 1 }));
    // 指定の上位3人。順位の判定は表示値（1・2・2・4）、並びは既存と同じ生の値の順。
    return { label, rows: rows.slice(0, 3) };
  });
}
const escapeCell = (s: string) => s.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const line = (cells: string[]) => `|${cells.map(escapeCell).join('|')}|`;
function table(head: string[], rows: string[][]): string { return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n'); }
export function buildAiExport(input: AiExportInput): { markdown: string; filename: string; characters: number } {
  const { current, teamId, previous, history } = input;
  if (!current.teams.length || current.teams.some(t => !current.logs.has(t.teamId))) throw new Error('リーグ全体のデータが揃っていません。');
  const team = current.teams.find(t => t.teamId === teamId);
  if (!team) throw new Error('対象チームのデータがありません。');
  const rows = current.teams.map(t => aiTeamRow(t, current.logs.get(t.teamId)!));
  const own = rows.find(r => r.team.teamId === teamId)!;
  if (!own.gamesPlayed) throw new Error('スタッツのあるレギュラーシーズンの試合がありません。');
  const league = aiTeamRow({ teamId: 'league', teamName: 'リーグ平均' }, rows.flatMap(r => r.logs));
  const name = teamNameInSeason(history, teamId, current.season, team.teamName);
  const prevTeam = previous?.teams.find(t => t.teamId === teamId);
  if (prevTeam && !previous!.logs.has(teamId)) throw new Error('前季のデータが揃っていません。');
  const prev = prevTeam ? aiTeamRow(prevTeam, previous!.logs.get(teamId)!) : null;
  const prevName = prevTeam ? teamNameInSeason(history, teamId, previous!.season, prevTeam.teamName) : '';
  const ended = current.summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg);
  const baseDate = ended.map(g => g.date).sort().at(-1);
  if (!baseDate) throw new Error('データの基準日を確認できません。');
  const extra = resultOnlyLogsForTeam(current.schedule.resultOnlyGames ?? [], teamId, new Set(own.logs.map(g => g.scheduleKey))).filter(g => g.gameType === 'regular');
  const wins = own.wins + extra.filter(g => g.win).length;
  const complete = isRegularSeasonComplete({ schedule: current.schedule, summaries: current.summaries });
  const metrics = aiMetrics();
  const definitions = new Set<string>();
  const named = (abbr: string, scope: 'team' | 'player' = 'team') => { if (definitions.has(abbr)) return abbr; definitions.add(abbr); return `${abbr}（${statJa(abbr, scope)}）`; };
  const out = [`# ${name} ${current.season}シーズン`, '', '## 対象と集計条件', '',
    '対象：レギュラーシーズン・試合全体。画面の視点・区間・条件は引き継いでいません。',
    `リーグ：${current.season >= '2026-27' ? 'B.PREMIER' : 'B1'}。${complete ? '終了シーズン' : '途中経過'}。消化${own.gamesPlayed + extra.length}試合、${wins}勝${own.gamesPlayed + extra.length - wins}敗。スタッツの対象は${own.gamesPlayed}試合。`,
    `データ基準日：${baseDate}（収録済みのリーグの最新終了試合日）。自チームの最終収録試合：${own.logs.map(g => g.date).sort().at(-1)}。`,
    prev ? `前季：${previous!.season} ${prevName}、スタッツ${prev.gamesPlayed}試合（前季全体）。` : '前季：比較対象データなし。',
    `参照：https://maccheroni8.github.io/bleague-stats/#/teams/${teamId}?season=${current.season}`, '', '## シーズン成績・リーグ内順位・前季比較', '',
    'カウント系は1試合平均。割合は合計の分子÷合計の分母。リーグ平均は全チームの合計÷延べチーム試合数（割合は合計同士の比）。',
    '平均差＝自チーム−リーグ平均、前季差＝今季−前季。差は丸める前の値から計算します。順位は表示値で同率判定（1・2・2・4）。並び順は大小を示し、優劣の断定ではありません。', ''];
  out.push(table(['項目', '値', '順位', '順', 'リーグ平均', '平均差', '前季', '前季差'], metrics.map(m => [named(m.label), m.text(own), aiRank(m, own, rows), m.direction, m.text(league), aiDifference(m.value(own), m.value(league), m.percent), prev ? m.text(prev) : '—', aiDifference(m.value(own), prev ? m.value(prev) : null, m.percent)])));
  out.push('', '## チーム内リーダー', '', 'このチームでの出場のみ、1試合平均。各項目上位3人（同率は同じ順位）。Gは出場試合数、MINは平均出場時間（分:秒）。',
    `割合はチームのスタッツ対象試合の${MIN_GAMES_PLAYED_RATIO_FOR_RANKING * 100}%以上に出場し、1試合平均の成功数がFG%・eFG%は${EXTRA_ELIGIBILITY_RULES.fgPct!.defaultValue}本、3P%は${EXTRA_ELIGIBILITY_RULES.tpPct!.defaultValue}本、2P%は${EXTRA_ELIGIBILITY_RULES.twoPct!.defaultValue}本、FT%は${EXTRA_ELIGIBILITY_RULES.ftPct!.defaultValue}本以上。`, '',
    table(['項目', '順位', '選手', 'G', '値'], aiLeaders(input, own).flatMap(({ label, rows: leaders }) => leaders.length ? leaders.map((p, i) => [i === 0 ? named(label, 'player') : label, String(p.rank), p.name, String(p.games), p.text]) : [[named(label, 'player'), '—', '該当なし', '—', '—']])));
  if (input.opponentId) {
    const opponent = rows.find(r => r.team.teamId === input.opponentId && r.team.teamId !== teamId);
    if (!opponent) throw new Error('比較相手のデータがありません。');
    const oppName = teamNameInSeason(history, opponent.team.teamId, current.season, opponent.team.teamName);
    out.push('', `## ${oppName}との比較`, '', `### シーズン全体（自チーム${own.gamesPlayed}試合／比較相手${opponent.gamesPlayed}試合）`, '',
      'oppの項目は、それぞれのチームが対戦した相手側の成績です。', '',
      table(['項目', name, oppName, '差（自チーム−比較相手）'], metrics.map(m => [m.label, m.text(own), m.text(opponent), aiDifference(m.value(own), m.value(opponent), m.percent)])), '', '### 直接対決', '');
    const match = buildOpponentSplitRows(teamId, own.logs).rows.find(r => r.opponentTeamId === input.opponentId);
    const extraMatch = extra.filter(g => g.opponentTeamId === input.opponentId);
    if (match) {
      const pts = buildTraditionalColumns('perGame', 'own').find(c => c.key === 'pts')!;
      const oppPts = buildTraditionalColumns('perGame', 'opp').find(c => c.key === 'pts')!;
      const diff = buildTraditionalColumns('perGame', 'own').find(c => c.key === 'plusminus')!;
      out.push(table(['G', '勝敗', 'PTS', 'opp PTS', named('+/-')], [[String(match.gamesPlayed), `${match.wins}勝${match.losses}敗`, pts.format!(match), oppPts.format!(match), diff.format!(match)]]));
    } else out.push(extraMatch.length ? 'スタッツのある直接対決なし。' : '未対戦。');
    if (extraMatch.length) {
      const w = (match?.wins ?? 0) + extraMatch.filter(g => g.win).length;
      const n = (match?.gamesPlayed ?? 0) + extraMatch.length;
      out.push(`結果だけの試合${extraMatch.length}試合を含む勝敗：${n}試合、${w}勝${n - w}敗（上のスタッツには含めません）。`);
    }
  }
  out.push('', '## 定義・注意事項', '',
    '- 途中経過と前季全体の比較では、試合数・対戦相手の構成が異なります。公式の後日訂正で値が変わることがあります。',
    '- 結果だけの試合はシーズンの勝敗に含め、スタッツ・平均・順位・選手リーダーから除外。直接対決の本文は対戦相手別タブと同じ対象で、該当時だけ結果を含む勝敗を別記。中止は勝敗にもスタッツにも含めません。',
    '- 未収録は元の項目がない・分母が0・対象試合がない場合。0とは区別します。欠損のある項目は順位の母数から外し、リーグの一部に欠損があればその項目のリーグ平均は未収録とします。',
    '- FG%＝100×FGM/FGA、3P%＝100×3PM/3PA、2P%＝100×2PM/2PA、FT%＝100×FTM/FTA。PAINT2%・MID2%も各成功数/試投数×100。ペイント内外は公式PBPの区分（座標による距離の推定ではありません）。',
    '- eFG%＝100×(FGM＋0.5×3PM)/FGA。TOV%＝100×TOV/(FGA＋0.44×FTA＋TOV)（Four Factorsの標準式）。FTR＝100×FTA/FGA、OR%＝100×OR/(OR＋opp DR)（NBA流、FTRは百分率表示）。oppは自他を入れ替えます。',
    '- POSS（ポゼッション）はBリーグ公式推定式：各チームのE＝FGA＋0.4×FTA−1.07×OR/(OR＋opp DR)×(FGA−FGM)＋TOV、POSS＝(自チームE＋相手E)/2。試合ごとに求めたPOSSを合算します。',
    '- ORtg＝100×PTS/POSS、DRtg＝100×opp PTS/POSS、NetRtg＝ORtg−DRtg、PACE＝40×POSS/(チーム合計出場分/5)。POSS・ORtg・DRtg・NetRtg・PACEは推定値で、PBPから数えた実ポゼッションではありません。PACEは延長込みの時間から40分換算。区間別POSSは今回の対象外です。',
    '- EFFはサイトのシーズン別の公式式を使用。2020-21以降：PTS＋TR＋AST＋STL＋BLK＋FD−(FGA−FGM)−(FTA−FTM)−TOV−BSR−F−TF。2019-20以前：PTS＋TR＋AST＋STL＋BLK−(FGA−FGM)−(FTA−FTM)−TOV。いずれも合計を出場試合数で割ります。',
    '- 出典：B.LEAGUE公式 https://www.bleague.jp/glossary/ およびサイトの収録データ。', '');
  const markdown = out.join('\n');
  const filename = `${name}_${current.season}_${baseDate}_AIデータ.md`.replace(/[\\/:*?"<>|]/g, '_');
  return { markdown, filename, characters: Array.from(markdown).length };
}
