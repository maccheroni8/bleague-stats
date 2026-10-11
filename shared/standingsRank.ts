// 順位表（全体・地区内・ワイルドカード）が共有するタイブレーク判定（DESIGN.md 87章・229章）。
// 集計（scripts/aggregate.ts）と検証（scripts/validate-standings-tiebreak.ts）から使う。
//
// 公式ルール（bleague.jp/regulation/?tab=1）: ①勝率 → ②当該クラブ間の勝率 → ③当該クラブ間の得失点差 →
// ④当該クラブ間の1試合平均得点 → ⑤リーグ戦全体の得失点差 → ⑥リーグ戦全体の1試合平均得点 → ⑦抽選。
// 抽選だけは実装できないので teamId 昇順で代用する。
import { safeDiv } from "./formulas.ts";

export interface HeadToHeadTally {
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

/** チームID→対戦相手ID→直接対決成績。シーズンを日付順に走査しながら累積する */
export type HeadToHeadTable = Map<string, Map<string, HeadToHeadTally>>;

export function recordHeadToHeadResult(
  table: HeadToHeadTable,
  teamId: string,
  opponentId: string,
  win: boolean,
  pointsFor: number,
  pointsAgainst: number,
): void {
  let byOpponent = table.get(teamId);
  if (!byOpponent) {
    byOpponent = new Map();
    table.set(teamId, byOpponent);
  }
  let tally = byOpponent.get(opponentId);
  if (!tally) {
    tally = { wins: 0, losses: 0, pointsFor: 0, pointsAgainst: 0 };
    byOpponent.set(opponentId, tally);
  }
  if (win) tally.wins += 1;
  else tally.losses += 1;
  tally.pointsFor += pointsFor;
  tally.pointsAgainst += pointsAgainst;
}

export interface StandingsCompareEntry {
  teamId: string;
  winPct: number;
  pointDiff: number;
  pointsFor: number;
  wins: number;
  losses: number;
}

/**
 * 順位表（全体・地区内・ワイルドカードとも）が共有するタイブレーク判定。公式ルールは上のとおり。
 * 同率のグループは**渡されたクラブの中だけ**で作る（公式は比べる対象の集合ごとに判定する。
 * 地区順位なら地区のクラブ、ワイルドカードならプールのクラブ）。このため、ワイルドカードの順位は
 * プールのクラブだけを渡して計算し直す（全体順位の部分集合では、プール外のクラブを含む3クラブ以上の
 * 同率で順序が変わりうる。DESIGN.md 229章）。
 */
export function rankStandingsTeams<T extends StandingsCompareEntry>(teams: T[], headToHead: HeadToHeadTable): T[] {
  const byWinPctDesc = [...teams].sort((a, b) => b.winPct - a.winPct);
  const result: T[] = [];
  let i = 0;
  while (i < byWinPctDesc.length) {
    let j = i + 1;
    while (j < byWinPctDesc.length && byWinPctDesc[j]!.winPct === byWinPctDesc[i]!.winPct) {
      j += 1;
    }
    result.push(...resolveTiedGroupByHeadToHead(byWinPctDesc.slice(i, j), headToHead));
    i = j;
  }
  return result;
}

/**
 * 勝率が同率のグループを、公式タイブレーク（2026-27 B.PREMIERリーグ戦フォーマット、
 * bleague.jp/regulation/?tab=1。DESIGN.md参照）で並べ替える:
 * (1)当該クラブ間の直接対決の勝率 → (2)当該クラブ間の得失点差 → (3)当該クラブ間の1試合平均得点 →
 * (4)シーズン全体の得失点差 → (5)シーズン全体の1試合平均得点 → (6)抽選（実装不可のため
 * teamId昇順で代用する）。
 *
 * 3クラブ以上が同率の場合は公式ルールどおり再帰的に決める: ある基準で一部のクラブと他のクラブの
 * 間に優劣がついたら、その優劣関係を確定させ、優劣がつかなかったクラブ同士（部分グループ）で
 * **(1)から**改めて判定し直す（直接対決の成績も、その部分グループ内の対戦だけで数え直す）。
 *
 * 直接対決（(1)〜(3)）は、判定対象のグループ内で**実際に行われた試合だけ**で数える（2026-10-11に
 * 変更。DESIGN.md 229章）。総当たりが揃っていなくても使い、グループ内で1試合も対戦していない
 * クラブの勝率・得失点差・平均得点は0とする（公式の順位表の表示で確認した扱い）。グループ内で
 * 1試合も行われていないときだけ(1)〜(3)を飛ばして(4)以降で判定する。
 * 公式ルールは全日程終了後の最終順位を前提としていて、シーズン中の途中経過も同じ扱いにしている。
 */
function resolveTiedGroupByHeadToHead<T extends StandingsCompareEntry>(
  group: T[],
  headToHead: HeadToHeadTable,
): T[] {
  if (group.length <= 1) return group;

  const idsInGroup = new Set(group.map((t) => t.teamId));
  const hasAnyGameInGroup = group.some((team) => {
    const opponents = headToHead.get(team.teamId);
    if (!opponents) return false;
    for (const [opponentId, tally] of opponents) {
      if (idsInGroup.has(opponentId) && tally.wins + tally.losses > 0) return true;
    }
    return false;
  });

  // (1)〜(3)は、このグループ内の対戦だけを集計する（再帰で部分グループになったら数え直す）
  const h2h = new Map<string, { winPct: number; pointDiff: number; avgPoints: number }>();
  if (hasAnyGameInGroup) {
    for (const team of group) {
      let wins = 0;
      let losses = 0;
      let pointsFor = 0;
      let pointsAgainst = 0;
      for (const [opponentId, tally] of headToHead.get(team.teamId) ?? []) {
        if (!idsInGroup.has(opponentId)) continue;
        wins += tally.wins;
        losses += tally.losses;
        pointsFor += tally.pointsFor;
        pointsAgainst += tally.pointsAgainst;
      }
      h2h.set(team.teamId, {
        winPct: safeDiv(wins, wins + losses),
        pointDiff: pointsFor - pointsAgainst,
        avgPoints: safeDiv(pointsFor, wins + losses),
      });
    }
  }

  const criteria: ((t: T) => number)[] = [
    ...(hasAnyGameInGroup
      ? [
          (t: T) => h2h.get(t.teamId)!.winPct,
          (t: T) => h2h.get(t.teamId)!.pointDiff,
          (t: T) => h2h.get(t.teamId)!.avgPoints,
        ]
      : []),
    (t: T) => t.pointDiff,
    (t: T) => safeDiv(t.pointsFor, t.wins + t.losses),
  ];

  for (const criterion of criteria) {
    const partitions = partitionByValueDesc(group, criterion);
    if (partitions.length > 1) {
      // 優劣がついた。各部分グループ（同値のクラブ同士）は(1)から判定し直す
      return partitions.flatMap((sub) => resolveTiedGroupByHeadToHead(sub, headToHead));
    }
  }

  // (6)抽選は実装不可のため、teamId昇順の決定論的な順序で代用する
  return [...group].sort((a, b) => a.teamId.localeCompare(b.teamId));
}

/** 値の降順に、同値（浮動小数点の誤差は許容）のチーム同士をまとめたグループの配列にする */
function partitionByValueDesc<T>(items: T[], valueOf: (item: T) => number): T[][] {
  const EPSILON = 1e-9;
  const sorted = [...items].sort((a, b) => valueOf(b) - valueOf(a));
  const groups: T[][] = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(valueOf(last[0]!) - valueOf(item)) < EPSILON) last.push(item);
    else groups.push([item]);
  }
  return groups;
}
