// 図解「ファウル」（チーム）の反則ポイントの表の集計（DESIGN.md 416章）。数は導出データ（shared/foulPoints.ts）、点数はシーズンの規程（shared/foulPointRules.ts）。
// レギュラーシーズンの試合だけを数える（規程が「リーグ戦」の年間合計のため）。試合の範囲（直近◯試合・期間）は、ほかの表と同じくチームごとの試合に当てる。
// 台帳の行（出場停止・コーチの退場）は、対象行為がレギュラーシーズンの試合のもの（結び付いた試合が範囲に入るか、その日が範囲に入る）と、
// 試合以外の行為（SNS など）でその日がレギュラーシーズンの範囲（範囲の最初の試合〜最後の試合の日）に入るものを数える。ポストシーズンの行為は数えない。
import { GAME_FLAG_PLAYOFF } from "../../shared/gameIndex";
import type { FoulPointsFile } from "../../shared/foulPoints";
import { FOUL_POINTS_FINE_THRESHOLD, entryShortPoints, foulPointRuleFor, type FoulPointRule } from "../../shared/foulPointRules";
import type { SituationalRange } from "./situational";

export interface FoulPointCount {
  /** 件数（試合数・人数など） */
  count: number;
  points: number;
}

export interface TeamFoulPointRow {
  teamId: string;
  teamName: string;
  games: number;
  total: number;
  /** 31点までの残り（0 以下は到達） */
  remaining: number;
  /** 旧: テクニカル（退場の3点に含めた分を除く）・アンスポーツマンライク（同）・退場 */
  tf: FoulPointCount;
  uf: FoulPointCount;
  ejection: FoulPointCount;
  /** 新: テクニカル カテゴリ1・2・フレグラント・ディスクォリファイング */
  tf1: FoulPointCount;
  tf2: FoulPointCount;
  flagrant: FoulPointCount;
  dq: FoulPointCount;
  /** 出場停止（count は試合数） */
  suspension: FoulPointCount;
  /** エントリー不足（count は9名以下だった試合の数） */
  entry: FoulPointCount;
  /** 区分の書かれていないテクニカル（2026-27 以降で数えられないもの） */
  tfUnknown: number;
}

const zero = (): FoulPointCount => ({ count: 0, points: 0 });

/** 範囲に入るレギュラーシーズンの試合（チームの番号 → 試合の番号） */
function regularGames(file: FoulPointsFile, range: SituationalRange): Map<number, number[]> {
  const byTeam = new Map<number, number[]>();
  for (let g = 0; g < file.games.key.length; g++) {
    if ((file.games.flags[g]! & GAME_FLAG_PLAYOFF) !== 0) continue;
    for (const t of [file.games.home[g]!, file.games.away[g]!]) {
      const list = byTeam.get(t) ?? [];
      list.push(g);
      byTeam.set(t, list);
    }
  }
  const out = new Map<number, number[]>();
  for (const [t, list] of byTeam) {
    const ordered = [...list].sort((a, b) => (file.games.date[a]! < file.games.date[b]! ? -1 : file.games.date[a]! > file.games.date[b]! ? 1 : a - b));
    out.set(
      t,
      range.kind === "recent"
        ? ordered.slice(Math.max(0, ordered.length - range.n))
        : range.kind === "dateRange"
          ? ordered.filter((g) => (!range.start || file.games.date[g]! >= range.start) && (!range.end || file.games.date[g]! <= range.end))
          : ordered,
    );
  }
  return out;
}

export function teamFoulPointRows(file: FoulPointsFile, range: SituationalRange, ruleOverride?: FoulPointRule): TeamFoulPointRow[] {
  const rule = ruleOverride ?? foulPointRuleFor(file.season);
  if (!rule) return [];
  const p = rule.points;
  const games = regularGames(file, range);
  const teamNo = new Map(file.teams.map(([id], i) => [id, i]));
  const rows: TeamFoulPointRow[] = [];
  file.teams.forEach(([teamId, teamName], t) => {
    const list = games.get(t) ?? [];
    if (list.length === 0) return;
    const row: TeamFoulPointRow = {
      teamId, teamName, games: 0, total: 0, remaining: 0,
      tf: zero(), uf: zero(), ejection: zero(), tf1: zero(), tf2: zero(), flagrant: zero(), dq: zero(), suspension: zero(), entry: zero(), tfUnknown: 0,
    };
    const inScope = new Set(list);
    const first = file.games.date[list[0]!]!;
    const last = file.games.date[list[list.length - 1]!]!;
    // 台帳: コーチの退場で、退場の3点に含めるコーチ・ベンチのテクニカルの数（試合ごと）
    const coachAbsorbed = new Map<number, number>();
    let coachEjections = 0;
    for (const pen of file.penalties) {
      if (teamNo.get(pen.teamId) !== t) continue;
      const counted =
        pen.competition === "regular"
          ? pen.game >= 0
            ? inScope.has(pen.game)
            : pen.incidentDate >= first && pen.incidentDate <= last
          : pen.competition === "other" && pen.game < 0 && pen.incidentDate >= first && pen.incidentDate <= last;
      if (!counted) continue;
      row.suspension.count += pen.suspensionGames;
      if (rule.system === "old" && pen.coachEjection) {
        coachEjections++;
        if (pen.game >= 0) coachAbsorbed.set(pen.game, (coachAbsorbed.get(pen.game) ?? 0) + 2);
      }
    }
    let tfAll = 0, ufAll = 0, absorbed = 0, ejections = coachEjections;
    for (const g of list) {
      const r = g * 2 + (file.games.home[g] === t ? 0 : 1);
      const entry = file.team.entry[r]!;
      if (entry >= 0) {
        const pts = entryShortPoints(rule, entry);
        if (pts > 0) {
          row.entry.count++;
          row.entry.points += pts;
        }
      }
      if (file.team.tf[r] === -1) continue;
      row.games++;
      tfAll += file.team.tf[r]!;
      ufAll += file.team.uf[r]!;
      ejections += file.team.ejectPair[r]! + file.team.ejectDq[r]!;
      absorbed += file.team.absorbed[r]! + Math.min(coachAbsorbed.get(g) ?? 0, file.team.tfStaff[r]!);
      row.tf1.count += file.team.tf1[r]!;
      row.tf2.count += file.team.tf2[r]!;
      row.flagrant.count += file.team.flagrant[r]!;
      row.dq.count += file.team.dq[r]!;
      row.tfUnknown += file.team.tf[r]! - file.team.tf1[r]! - file.team.tf2[r]!;
    }
    if (rule.system === "old") {
      // 同じ試合の TF・UF 2回の退場は退場の3点だけ。TF・UF の1点から外す数は、選手ごとの TF＋UF（最大2）とコーチの2回。
      // 外す数は TF から先に引き、TF で足りない分を UF から引く（どちらも1点なので合計の点は同じ）
      const fromTf = Math.min(absorbed, tfAll);
      row.tf.count = tfAll - fromTf;
      row.uf.count = ufAll - Math.min(absorbed - fromTf, ufAll);
      row.tf.points = row.tf.count * (p.tf ?? 0);
      row.uf.points = row.uf.count * (p.uf ?? 0);
      row.ejection.count = ejections;
      row.ejection.points = ejections * (p.ejection ?? 0);
      row.tf1 = zero(); row.tf2 = zero(); row.flagrant = zero(); row.dq = zero(); row.tfUnknown = 0;
    } else {
      row.tf1.points = row.tf1.count * (p.tf1 ?? 0);
      row.tf2.points = row.tf2.count * (p.tf2 ?? 0);
      row.flagrant.points = row.flagrant.count * (p.flagrant ?? 0);
      row.dq.points = row.dq.count * (p.dq ?? 0);
    }
    row.suspension.points = row.suspension.count * p.suspension;
    row.total = row.tf.points + row.uf.points + row.ejection.points + row.tf1.points + row.tf2.points + row.flagrant.points + row.dq.points + row.suspension.points + row.entry.points;
    row.remaining = FOUL_POINTS_FINE_THRESHOLD - row.total;
    rows.push(row);
  });
  return rows;
}
