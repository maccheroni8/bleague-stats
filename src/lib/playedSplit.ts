// 個人詳細 > 出場有無（選んだシーズンの、その選手が所属していたチームの試合を「出場した試合」「出場しなかった試合」に分けて、チームのスタッツを並べて比べる）。
// 値はチーム詳細の対戦相手別・全チームスタッツと同じ列の式に、チームの試合ログ（team-games）の合計を渡して出す。試合の生データは読まない。
// 「出場した試合」＝本人の出場時間が0より大きい試合。「出場しなかった試合」＝そのチームでの所属期間（本人の試合ログに、そのチームの試合として
// 最初に載った日〜最後に載った日。出場時間0の行を含む）の、本人が出場しなかったチームの試合。移籍した選手はチームごとに分ける。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import type { Column } from "../components/SortableTable";
import type { PlayerGameLog, TeamGameLog } from "../../shared/types";
import { filterByGameType, type SeasonGameTypeFilter } from "../../shared/gameType";
import { makeRow, type OpponentSplitRow } from "./opponentSplit";
import type { GameTeamInfo } from "./situational";

export const PLAYED_LABEL = "出場した試合";
export const NOT_PLAYED_LABEL = "出場しなかった試合";
export const DIFF_LABEL = "差（出場−しなかった）";

export interface PlayedSplitBlock {
  teamId: string;
  teamName: string;
  played: OpponentSplitRow;
  notPlayed: OpponentSplitRow;
  diff: OpponentSplitRow;
  /** 所属期間（本人の試合ログが、そのチームの試合として載った最初の日と最後の日） */
  tenure: { first: string; last: string };
}

export interface PlayedSplitInput {
  /** そのシーズンの本人の試合ログ（試合種別で絞る前。出場時間0の行を含む） */
  logs: readonly PlayerGameLog[];
  gameType: SeasonGameTypeFilter;
  /** 試合ごとの自チーム（出場時間0の行も含めて引く） */
  ownTeamOf: (g: { scheduleKey: string; isHome: boolean }) => GameTeamInfo | null | undefined;
  /** チームごとの、そのシーズンの試合ログ */
  teamLogsByTeamId: ReadonlyMap<string, readonly TeamGameLog[]>;
}

/** 本人の試合ログに載ったチーム（所属期間つき）。最初の試合日の古いチームから */
export function tenuresByTeam(
  logs: readonly PlayerGameLog[],
  ownTeamOf: PlayedSplitInput["ownTeamOf"],
): { teamId: string; teamName: string; first: string; last: string }[] {
  const map = new Map<string, { teamId: string; teamName: string; first: string; last: string }>();
  for (const g of logs) {
    const own = ownTeamOf(g);
    if (!own) continue;
    const t = map.get(own.teamId);
    if (!t) map.set(own.teamId, { teamId: own.teamId, teamName: own.teamName, first: g.date, last: g.date });
    else {
      if (g.date < t.first) t.first = g.date;
      if (g.date > t.last) {
        t.last = g.date;
        t.teamName = own.teamName;
      }
    }
  }
  return [...map.values()].sort((a, b) => a.first.localeCompare(b.first) || a.teamId.localeCompare(b.teamId));
}

export function buildPlayedSplit(input: PlayedSplitInput): PlayedSplitBlock[] {
  const { logs, gameType, ownTeamOf, teamLogsByTeamId } = input;
  const blocks: PlayedSplitBlock[] = [];
  for (const tenure of tenuresByTeam(logs, ownTeamOf)) {
    const teamLogs = teamLogsByTeamId.get(tenure.teamId);
    if (!teamLogs) continue;
    const playedKeys = new Set(logs.filter((g) => g.min > 0 && ownTeamOf(g)?.teamId === tenure.teamId).map((g) => g.scheduleKey));
    const inTenure = filterByGameType([...teamLogs], gameType).filter((g) => g.date >= tenure.first && g.date <= tenure.last);
    const sorted = [...inTenure].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
    if (sorted.length === 0) continue;
    const playedLogs = sorted.filter((g) => playedKeys.has(g.scheduleKey));
    const notPlayedLogs = sorted.filter((g) => !playedKeys.has(g.scheduleKey));
    blocks.push({
      teamId: tenure.teamId,
      teamName: tenure.teamName,
      played: makeRow(tenure.teamId, "played", PLAYED_LABEL, null, playedLogs),
      notPlayed: makeRow(tenure.teamId, "notPlayed", NOT_PLAYED_LABEL, null, notPlayedLogs),
      diff: makeRow(tenure.teamId, "diff", DIFF_LABEL, null, []),
      tenure: { first: tenure.first, last: tenure.last },
    });
  }
  return blocks;
}

/** 勝率の表記（.750・1.000）。試合が無いときは「-」 */
export function formatWinPct(wins: number, losses: number): string {
  const n = wins + losses;
  if (n === 0) return "-";
  const p = (wins / n).toFixed(3);
  return p.startsWith("0") ? p.slice(1) : p;
}

/** 勝率の差の表記（+.123・-.050。0は.000）。どちらかの試合が無いときは「-」 */
export function formatWinPctDiff(a: { wins: number; losses: number }, b: { wins: number; losses: number }): string {
  const na = a.wins + a.losses;
  const nb = b.wins + b.losses;
  if (na === 0 || nb === 0) return "-";
  const d = Math.round((a.wins / na - b.wins / nb) * 1000) / 1000;
  const body = Math.abs(d).toFixed(3).replace(/^0/, "");
  return d > 0 ? `+${body}` : d < 0 ? `-${body}` : body;
}

const NUM_RE = /^([+-]?)([\d,]*\.?\d+)(%?)$/;
const TIME_RE = /^([+-]?)(\d+):(\d\d)$/;

function decimalsOf(s: string): number {
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * 画面に出ている2つの値（出場した試合・しなかった試合）から差の表記を作る。符号つき（0は符号なし）、小数の桁・「%」・桁区切り・「分:秒」は元の表記に合わせる。
 * どちらかが「-」、または読めない表記のときは「-」
 */
export function diffText(playedText: string, notPlayedText: string): string {
  const a = playedText.trim();
  const b = notPlayedText.trim();
  const ta = TIME_RE.exec(a);
  const tb = TIME_RE.exec(b);
  if (ta && tb) {
    const secs = (m: RegExpExecArray) => (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
    const d = secs(ta) - secs(tb);
    const abs = Math.abs(d);
    const body = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, "0")}`;
    return d > 0 ? `+${body}` : d < 0 ? `-${body}` : body;
  }
  const ma = NUM_RE.exec(a);
  const mb = NUM_RE.exec(b);
  if (!ma || !mb || ma[3] !== mb[3]) return "-";
  const va = Number(ma[1] + ma[2]!.replace(/,/g, ""));
  const vb = Number(mb[1] + mb[2]!.replace(/,/g, ""));
  const digits = Math.max(decimalsOf(ma[2]!), decimalsOf(mb[2]!));
  const d = Math.round((va - vb) * 10 ** digits) / 10 ** digits;
  const grouped = ma[2]!.includes(",") || mb[2]!.includes(",");
  const body = Math.abs(d).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: grouped });
  return `${d > 0 ? "+" : d < 0 ? "-" : ""}${body}${ma[3]}`;
}

/**
 * チームの表の列（全チームスタッツと同じ列）を、出場有無の表の列にする。試合が無い行は「-」、差の行は画面に出ている2つの値の差。
 * 見出しを押しても行の並びは変わらない（3行を固定で並べる）
 */
export function playedSplitStatColumns(columns: readonly Column<OpponentSplitRow>[], block: PlayedSplitBlock): Column<OpponentSplitRow>[] {
  const text = (c: Column<OpponentSplitRow>, r: OpponentSplitRow): string => (c.format ? c.format(r) : String(c.sortValue(r)));
  return columns.map((c) => ({
    ...c,
    render: undefined,
    sortValue: () => 0,
    format: (r) => {
      if (r.key === "diff") {
        if (block.played.gamesPlayed === 0 || block.notPlayed.gamesPlayed === 0) return "-";
        return diffText(text(c, block.played), text(c, block.notPlayed));
      }
      return r.gamesPlayed === 0 ? "-" : text(c, r);
    },
  }));
}
