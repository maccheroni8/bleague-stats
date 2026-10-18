// チームの1試合記録の「Q別・前後半・延長」（設計書265章）。チームのピリオド別の索引（team-period-index。225・256章）の区間の値を、
// 1試合行の索引の行（teamGameAt）に結び付けて、「その区間の値を持つチームの1試合」にする。集計のコードから読まれない場所（保存キーの対象外）に置く。
// - 行の位置は team-game-index と同じ（試合の番号×2＋〔ホーム 0／アウェイ 1〕）。相手の値は同じ試合の相手の行（i^1）から引く
// - 値の無い区間（前後半5分の特別な試合の1Q〜4Q、延長の無い試合の延長）は null（その試合は対象外）
// - 来場者数・試合中の最大点差・最大のランは区間の値ではないので外す（項目は区間を選ぶと選べない）
import { PERIOD_ATOMS, type TeamPeriodIndexFile } from "../../shared/periodIndex";
import { teamGameAt, type IndexedTeamGame, type TeamGameIndexView } from "./gameIndex";
import { PERIOD_ATOM_INDEXES, type GameRecordPeriod } from "./periodIndex";

/** 行 r の、区間（PERIOD_ATOMS の番号の並び）の列 col の合計。値の無い（-1）区間は 0 として足す */
function sumAt(file: TeamPeriodIndexFile, r: number, atoms: readonly number[], col: string): number {
  let s = 0;
  for (const a of atoms) {
    const v = file.rows.counts[`${PERIOD_ATOMS[a]}.${col}`]?.[r] ?? -1;
    if (v > 0) s += v;
  }
  return s;
}

/** 行 r が、その区間の値を持つか（得点が -1 の区間を含むときは持たない） */
function hasPeriodRow(file: TeamPeriodIndexFile, r: number, atoms: readonly number[]): boolean {
  return atoms.every((a) => (file.rows.counts[`${PERIOD_ATOMS[a]}.pts`]?.[r] ?? -1) >= 0);
}

/**
 * 主索引の i 行目の、指定した区間の値を持つチームの1試合。その区間の値が無いときは null。
 * 勝敗・対戦相手・日付などは試合のまま、得点・シュート・リバウンド・ファウルなどは区間の値に置き換える
 */
export function teamPeriodGameAt(view: TeamGameIndexView, file: TeamPeriodIndexFile, i: number, period: GameRecordPeriod): IndexedTeamGame | null {
  const atoms = PERIOD_ATOM_INDEXES[period];
  if (!hasPeriodRow(file, i, atoms)) return null;
  const j = i ^ 1;
  const own = (col: string) => sumAt(file, i, atoms, col);
  const opp = (col: string) => sumAt(file, j, atoms, col);
  const base = teamGameAt(view, i);
  const row: IndexedTeamGame = {
    ...base,
    teamScore: own("pts"),
    opponentScore: opp("pts"),
    finalMargin: own("pts") - opp("pts"),
    fgm: own("pt2m") + own("pt3m"),
    fga: own("pt2a") + own("pt3a"),
    tpm: own("pt3m"),
    tpa: own("pt3a"),
    ftm: own("ftm"),
    fta: own("fta"),
    oreb: own("oreb"),
    dreb: own("dreb"),
    reb: own("treb"),
    ast: own("ast"),
    tov: own("tov"),
    stl: own("stl"),
    blk: own("blk"),
    pf: own("foul"),
    fb: own("fb"),
    pt2in: own("pt2in"),
    pft: own("pft"),
    pt2nd: own("pt2nd"),
    foulsDrawn: own("foulsDrawn"),
    dunks: own("dunks"),
    benchPoints: own("benchPoints"),
    starterPoints: own("starterPoints"),
    japanesePoints: own("japanesePoints"),
    foreignPoints: own("foreignPoints"),
    naturalizedOrAsianPoints: own("naturalizedPoints") + own("asianQuotaPoints"),
    opponentFgm: opp("pt2m") + opp("pt3m"),
    opponentFga: opp("pt2a") + opp("pt3a"),
    opponentTpm: opp("pt3m"),
    opponentTpa: opp("pt3a"),
    opponentFtm: opp("ftm"),
    opponentFta: opp("fta"),
    opponentOreb: opp("oreb"),
    opponentDreb: opp("dreb"),
    opponentAst: opp("ast"),
    opponentTov: opp("tov"),
    opponentStl: opp("stl"),
    opponentBlk: opp("blk"),
    opponentPf: opp("foul"),
    opponentFb: opp("fb"),
    opponentPt2in: opp("pt2in"),
    opponentPft: opp("pft"),
    opponentPt2nd: opp("pt2nd"),
    opponentFoulsDrawn: opp("foulsDrawn"),
    opponentDunks: opp("dunks"),
  };
  delete row.attendance;
  delete row.maxLead;
  delete row.maxDeficit;
  delete row.maxRun;
  delete row.maxRunFromSec;
  delete row.maxRunToSec;
  delete row.maxRunOwnBefore;
  delete row.maxRunOppBefore;
  return row;
}
