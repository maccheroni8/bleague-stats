// 全チームスタッツ（Traditional・Advanced・Misc・Scoring）の区間別（1Q〜4Q・前半・後半・延長。DESIGN.md 256章の段階2）。
// チームのピリオド別の索引（data/{season}/team-period-index.json。段階1で Misc・Scoring の列を足した）から、試合ログ（TeamGameLog）の合計
// （teamStatsColumns.ts の sumTeamGameLogs）と同じ形の TeamTotals を作る。どの試合を数えるかは、呼び出し側が絞った試合ログ（試合区分・試合の条件）で決める。
// - 前後半5分の特別な試合（2016-17・2017-18のCS）は、1Q〜4Q・前半・後半の値が無いので数えない
// - 延長は、延長のあった試合だけを数える（平均はその試合数で割る。256章の決定2）
// - 勝敗は試合の勝敗のまま（区間ごとの勝ち負けは出さない。決定3）
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { leagueCacheKey, type League } from "./league";
import { useEffect, useState } from "react";
import { PERIOD_ATOMS, TEAM_PERIOD_EXTRA_COLUMNS, TEAM_PERIOD_FOUL_COLUMNS, type PeriodPossKey, type TeamPeriodIndexFile } from "../../shared/periodIndex";
import type { TeamGameLog } from "../../shared/types";
import { fetchTeamPeriodIndex } from "./data";
import { loadTeamGameIndex } from "./gameIndexLoad";
import { isSupportedPeriodIndex, PERIOD_ATOM_INDEXES, type GameRecordPeriod } from "./periodIndex";
import { withPaint, summarizePaint, type PaintPair, type PaintInput } from "./teamPaint2";
import { EMPTY_TOTALS, type TeamTotals } from "./teamStatsColumns";

export type TeamPeriodValue = GameRecordPeriod;

/** 索引に OFF FOUL・CHARGE の列があるか（275章 段階3より前の索引には無い。無ければ画面は「-」にする） */
export function teamPeriodHasFoulColumns(file: TeamPeriodIndexFile): boolean {
  return TEAM_PERIOD_FOUL_COLUMNS.every((c) => !!file.rows.counts[`q1.${c}`]);
}

export interface TeamPeriodSource {
  season: string;
  file: TeamPeriodIndexFile;
  /** scheduleKey → 試合の番号（チームの行の位置は 番号×2＋〔ホーム 0／アウェイ 1〕） */
  gameNo: Map<string, number>;
}

const cache = new Map<string, Promise<TeamPeriodSource | null>>();

/**
 * 1シーズン分のチームの索引を読む。無い・版や行数が合わない・段階1の列（Misc・Scoring 用）が無い古い索引のときは null（呼び出し側は区間別を出せないことを示す）。
 * 失敗は持たず、次の呼び出しでやり直す
 */
export function loadTeamPeriodSource(season: string, league: League = "premier"): Promise<TeamPeriodSource | null> {
  const key = leagueCacheKey(season, league);
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const [team, file] = await Promise.all([loadTeamGameIndex(season, league), fetchTeamPeriodIndex(season, league)]);
      if (!team || !file || !isSupportedPeriodIndex(file) || file.indexRows !== team.size) return null;
      if (TEAM_PERIOD_EXTRA_COLUMNS.some((c) => !file.rows.counts[`q1.${c}`])) return null;
      const gameNo = new Map<string, number>(team.file.games.key.map((k, i) => [k, i]));
      return { season, file, gameNo };
    })();
    p.then((v) => v ?? cache.delete(key), () => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** 区間を選んでいるときだけ索引を読む。source は読めたもの（読めなかったら null）、loading は読み込み中、retry() で読み直す */
export function useTeamPeriodSource(season: string, enabled: boolean, league: League = "premier"): { source: TeamPeriodSource | null; loading: boolean; retry: () => void } {
  const [state, setState] = useState<{ season: string; nonce: number; source: TeamPeriodSource | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadTeamPeriodSource(season, league).then(
      (source) => alive && setState({ season, nonce, source }),
      () => alive && setState({ season, nonce, source: null }),
    );
    return () => {
      alive = false;
    };
  }, [season, enabled, nonce, league]);
  const ready = state && state.season === season && state.nonce === nonce;
  return { source: ready ? state.source : null, loading: enabled && !ready, retry: () => setNonce((n) => n + 1) };
}

/** チームのランキングで、延長の掲載基準（延長のあった試合の数。256章の決定4） */
export const OVERTIME_MIN_TEAM_GAMES_FOR_RANKING = 3;

/** 行 r の、区間（PERIOD_ATOMS の番号の並び）の列 col の合計。値の無い区間（-1）は飛ばす */
function sumAt(file: TeamPeriodIndexFile, r: number, atoms: readonly number[], col: string): number {
  let s = 0;
  for (const a of atoms) {
    const v = file.rows.counts[`${PERIOD_ATOMS[a]}.${col}`]?.[r] ?? -1;
    if (v > 0) s += v;
  }
  return s;
}

/** 行 r に、区間のどれかの値があるか（延長の無い試合の延長・特別な試合の1Q〜4Qは無い） */
function hasValue(file: TeamPeriodIndexFile, r: number, atoms: readonly number[]): boolean {
  return atoms.some((a) => (file.rows.counts[`${PERIOD_ATOMS[a]}.pts`]?.[r] ?? -1) >= 0);
}

/**
 * 試合ログ（絞り込み済み）のうち、その区間の値がある試合の合計（sumTeamGameLogs と同じ項目）と、数えた試合。
 * 数えた試合は、平均の分母と勝敗に使う（勝敗は試合の勝敗のまま）
 */
export function sumTeamPeriodTotals(
  source: TeamPeriodSource,
  logs: readonly TeamGameLog[],
  value: TeamPeriodValue,
): { games: TeamGameLog[]; totals: TeamTotals } {
  const atoms = PERIOD_ATOM_INDEXES[value];
  const { file } = source;
  const t: TeamTotals = { ...EMPTY_TOTALS };
  const games: TeamGameLog[] = [];
  const paintPairs: PaintPair[] = [];
  const hasFoul = teamPeriodHasFoulColumns(file);
  for (const g of logs) {
    const n = source.gameNo.get(g.scheduleKey);
    if (n === undefined) continue;
    const own = n * 2 + (g.isHome ? 0 : 1);
    const opp = n * 2 + (g.isHome ? 1 : 0);
    if (!hasValue(file, own, atoms) || !hasValue(file, opp, atoms)) continue;
    games.push(g);
    const o = (col: string) => sumAt(file, own, atoms, col);
    const p = (col: string) => sumAt(file, opp, atoms, col);
    // 2P内訳は、選んだ区間のどれかで記録が欠けていれば -1（記録なし）にする
    const paintSide = (row: number): PaintInput => {
      const count = (col: string) =>
        atoms.every((a) => (file.rows.counts[`${PERIOD_ATOMS[a]}.${col}`]?.[row] ?? -1) >= 0) ? sumAt(file, row, atoms, col) : -1;
      return {
        pm: count("paint2m"),
        pa: count("paint2a"),
        mm: count("mid2m"),
        ma: count("mid2a"),
        tm: count("pt2m"),
        ta: count("pt2a"),
      };
    };
    paintPairs.push({ own: paintSide(own), opp: paintSide(opp) });
    const poss = file.rows.poss[value as PeriodPossKey]?.[own] ?? -1;
    t.pts += o("pts");
    t.oppPts += p("pts");
    t.fgm += o("pt2m") + o("pt3m");
    t.fga += o("pt2a") + o("pt3a");
    t.tpm += o("pt3m");
    t.tpa += o("pt3a");
    t.ftm += o("ftm");
    t.fta += o("fta");
    t.oreb += o("oreb");
    t.dreb += o("dreb");
    t.reb += o("treb");
    t.ast += o("ast");
    t.tov += o("tov");
    t.stl += o("stl");
    t.blk += o("blk");
    t.pf += o("foul");
    t.fd += o("foulsDrawn");
    t.min += o("minSec") / 60;
    t.poss += poss > 0 ? poss : 0;
    t.oppFgm += p("pt2m") + p("pt3m");
    t.oppFga += p("pt2a") + p("pt3a");
    t.oppTpm += p("pt3m");
    t.oppTpa += p("pt3a");
    t.oppFtm += p("ftm");
    t.oppFta += p("fta");
    t.oppOreb += p("oreb");
    t.oppDreb += p("dreb");
    t.oppTov += p("tov");
    t.oppAst += p("ast");
    t.oppStl += p("stl");
    t.oppBlk += p("blk");
    t.oppPf += p("foul");
    t.oppFd += p("foulsDrawn");
    if (hasFoul) {
      t.offFoul += o("offFouls");
      t.charge += o("charges");
      t.oppOffFoul += p("offFouls");
      t.oppCharge += p("charges");
    }
    t.pt2in += o("pt2in");
    t.fb += o("fb");
    t.pt2nd += o("pt2nd");
    t.pft += o("pft");
    t.dunks += o("dunks");
    t.oppPt2in += p("pt2in");
    t.oppFb += p("fb");
    t.oppPt2nd += p("pt2nd");
    t.oppPft += p("pft");
    t.oppDunks += p("dunks");
    t.technicalFouls += o("technicalFouls");
    t.basketCounts += o("basketCounts");
    t.unsportsmanlikeFouls += o("unsportsmanlikeFouls");
    t.disqualifyingFouls += o("disqualifyingFouls");
    t.technicalFoulsCat1 += o("technicalFoulsCat1");
    t.technicalFoulsCat2 += o("technicalFoulsCat2");
    t.flagrantFouls += o("flagrantFouls");
    t.disruptiveFouls += o("disruptiveFouls");
    t.assisted2m += o("assisted2m");
    t.assisted3m += o("assisted3m");
    t.assistedFtm += o("assistedFtm");
    t.paint2m += o("paint2m");
    t.paint2a += o("paint2a");
    t.mid2m += o("mid2m");
    t.mid2a += o("mid2a");
    t.oppTechnicalFouls += p("technicalFouls");
    t.oppBasketCounts += p("basketCounts");
    t.oppUnsportsmanlikeFouls += p("unsportsmanlikeFouls");
    t.oppDisqualifyingFouls += p("disqualifyingFouls");
    t.oppTechnicalFoulsCat1 += p("technicalFoulsCat1");
    t.oppTechnicalFoulsCat2 += p("technicalFoulsCat2");
    t.oppFlagrantFouls += p("flagrantFouls");
    t.oppDisruptiveFouls += p("disruptiveFouls");
    t.oppAssisted2m += p("assisted2m");
    t.oppAssisted3m += p("assisted3m");
    t.oppAssistedFtm += p("assistedFtm");
    t.oppPaint2m += p("paint2m");
    t.oppPaint2a += p("paint2a");
    t.oppMid2m += p("mid2m");
    t.oppMid2a += p("mid2a");
    t.japanesePoints += o("japanesePoints");
    t.internationalPoints += o("foreignPoints") + o("naturalizedPoints") + o("asianQuotaPoints");
    t.oppJapanesePoints += p("japanesePoints");
    t.oppInternationalPoints += p("foreignPoints") + p("naturalizedPoints") + p("asianQuotaPoints");
    t.benchPoints += o("benchPoints");
    t.starterPoints += o("starterPoints");
    t.oppBenchPoints += p("benchPoints");
    t.oppStarterPoints += p("starterPoints");
  }
  return { games, totals: withPaint(t, summarizePaint(paintPairs)) };
}
