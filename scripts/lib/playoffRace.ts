// マジックナンバー・プレーオフ進出/敗退・年間優勝の判定（data/{season}/playoff-race.json。DESIGN.md参照）。
//
// 2026-27〜のB.PREMIERフォーマット（bleague.jp/regulation/?tab=1）:
// - 東西2地区。各地区の上位3クラブ＋「各地区の上位3クラブを除いた20クラブ」の上位2クラブ
//   （ワイルドカード）の計8クラブがプレーオフに進出（公式ページ注記の「上位2クラブを除いた」は
//   26-6=20と合わないため誤記と判断）
// - 地区2位以上は準々決勝のホームコートアドバンテージを得る
// - 決勝は3勝先取
//
// 判定は安全側に倒す（ユーザー指定の方式①）: 各チームの「残り全勝時の最大勝率」と「残り全敗時の
// 最低勝率」だけを比較し、ライバル同士の直接対決（どちらかは必ず負ける）や同率時のタイブレークは
// 考慮しない。同率は常に不利側に数える（相手が同率に並べる可能性があれば「上に来うる」とみなす）。
// そのため確定・敗退の表示が数学的に可能になる時点より遅れることはあっても、誤って確定・敗退を
// 表示することは無い。

import type {
  ClinchEvent,
  ClinchType,
  Division,
  PlayoffRaceFile,
  PlayoffRaceTeam,
  StandingsSnapshot,
} from "../../shared/types.ts";
import type { PostseasonFormat } from "../../shared/postseasonFormat.ts";

export interface RaceTeamInput {
  teamId: string;
  teamName?: string;
  division: Division;
  wins: number;
  losses: number;
  remaining: number;
  /**
   * 公式タイブレーク適用済みの地区順位・全体順位（standings-historyの最新スナップショット）。
   * 全チームの残り試合が0になった（レギュラーシーズン終了）ときだけ使い、同率のクラブも
   * タイブレークの結果どおりに確定させる
   */
  divisionRank?: number;
  overallRank?: number;
}

/** 2026-27〜のB.PREMIERの出場形式（各地区上位3＋ワイルドカード2） */
const PREMIER_FORMAT = { divisionTop: 3, wildcardSlots: 2 };
/** 準々決勝のホームコート（出場順位1〜4位＝各地区の1・2位。プレーオフ試合実施要項 第2条・第3条） */
const HOME_COURT_DIVISION_TOP = 2;

function maxWinPct(t: RaceTeamInput): number {
  const games = t.wins + t.losses + t.remaining;
  return games === 0 ? 1 : (t.wins + t.remaining) / games;
}

function minWinPct(t: RaceTeamInput): number {
  const games = t.wins + t.losses + t.remaining;
  return games === 0 ? 0 : t.wins / games;
}

/** otherが最終的にselfと同率以上になりうるか（同率は不利側＝上に来うるとみなす） */
function canFinishAtOrAbove(other: RaceTeamInput, self: RaceTeamInput): boolean {
  return maxWinPct(other) >= minWinPct(self);
}

/** otherが最終的に必ずselfより上（同率も不可）になるか */
function surelyFinishesAbove(other: RaceTeamInput, self: RaceTeamInput): boolean {
  return minWinPct(other) > maxWinPct(self);
}

/**
 * 「ライバルの最大勝ち数のうちn番目に大きい値」を超えるのに必要な、自分の勝ち＋相手の負けの数。
 * 0以下は確定済み（0に丸める）。全チームの試合数が同じ（B.PREMIERは60試合）前提の勝ち数ベースの値
 */
function magicNumber(self: RaceTeamInput, rivals: RaceTeamInput[], nth: number): number {
  const rivalMaxWins = rivals.map((r) => r.wins + r.remaining).sort((a, b) => b - a);
  const target = rivalMaxWins[nth - 1];
  if (target === undefined) return 0;
  return Math.max(0, target - self.wins + 1);
}

/** 他地区ごとに「地区の自動出場枠を超えた分」を合計する（3地区制でも地区ごとに枠を引く） */
function overflowAcrossDivisions(teams: RaceTeamInput[], pick: (t: RaceTeamInput) => boolean, divisionTop: number): number {
  const byDivision = new Map<Division, number>();
  for (const t of teams) if (pick(t)) byDivision.set(t.division, (byDivision.get(t.division) ?? 0) + 1);
  let sum = 0;
  for (const count of byDivision.values()) sum += Math.max(0, count - divisionTop);
  return sum;
}

export function computePremierRace(
  season: string,
  asOf: string | null,
  inputs: RaceTeamInput[],
  format: Pick<PostseasonFormat, "divisionTop" | "wildcardSlots"> = PREMIER_FORMAT,
): PlayoffRaceFile {
  const DIVISION_TOP = format.divisionTop;
  const WILDCARD_SLOTS = format.wildcardSlots;
  const seasonComplete =
    inputs.length > 0 && inputs.every((t) => t.remaining === 0 && t.divisionRank !== undefined && t.overallRank !== undefined);
  if (seasonComplete) return { season, format: "premier-2026", asOf, teams: finalRace(inputs, format) };

  const teams: PlayoffRaceTeam[] = inputs.map((self) => {
    const ownRivals = inputs.filter((t) => t.teamId !== self.teamId && t.division === self.division);
    const otherDivision = inputs.filter((t) => t.division !== self.division);

    const ownThreats = ownRivals.filter((r) => canFinishAtOrAbove(r, self)).length;
    const ownSurelyAbove = ownRivals.filter((r) => surelyFinishesAbove(r, self)).length;

    const eliminatedDivisionFirst = ownSurelyAbove >= 1;
    const eliminatedDivisionTop3 = ownSurelyAbove >= DIVISION_TOP;

    // プレーオフ進出確定: 地区3位以内が確定、または「自分より上に来うるワイルドカード候補」が
    // 1クラブ以下。上に来うる自地区のライバルが全員自分より上になった最悪の場合、そのうち地区上位3を
    // 超えた分と、他地区で上に来うるクラブのうち地区上位3を超えた分がワイルドカード候補として
    // 自分の上に来る
    const wildcardThreatsWorstCase =
      Math.max(0, ownThreats - DIVISION_TOP) +
      overflowAcrossDivisions(otherDivision, (r) => canFinishAtOrAbove(r, self), DIVISION_TOP);
    const clinchedPlayoffs = ownThreats <= DIVISION_TOP - 1 || wildcardThreatsWorstCase <= WILDCARD_SLOTS - 1;

    // 敗退確定: 自地区で必ず上に来るクラブが3以上（地区3位以内が消滅）かつ、必ず上に来るクラブの
    // うち各地区の上位3枠に収まりきらない分（＝必ず自分の上に来るワイルドカード候補）が2以上
    const surelyAboveWildcards =
      Math.max(0, ownSurelyAbove - DIVISION_TOP) +
      overflowAcrossDivisions(otherDivision, (r) => surelyFinishesAbove(r, self), DIVISION_TOP);
    const eliminatedPlayoffs = eliminatedDivisionTop3 && surelyAboveWildcards >= WILDCARD_SLOTS;

    return {
      teamId: self.teamId,
      teamName: self.teamName,
      division: self.division,
      wins: self.wins,
      losses: self.losses,
      remaining: self.remaining,
      magicDivisionFirst: eliminatedDivisionFirst ? null : magicNumber(self, ownRivals, 1),
      magicDivisionTop3: eliminatedDivisionTop3 ? null : magicNumber(self, ownRivals, DIVISION_TOP),
      eliminatedDivisionFirst,
      eliminatedDivisionTop3,
      // 地区優勝確定: 自地区で自分と同率以上になりうるクラブが無い（magicDivisionFirst が0になるのと同じ意味）
      clinchedDivisionFirst: ownThreats === 0,
      clinchedDivisionTop2: ownThreats <= HOME_COURT_DIVISION_TOP - 1,
      clinchedPlayoffs,
      eliminatedPlayoffs,
    };
  });
  return { season, format: "premier-2026", asOf, teams };
}

/**
 * レギュラーシーズン終了後は、公式タイブレーク適用済みの最終順位で確定させる（残り試合が無いので
 * 勝率の比較だけでは同率のクラブの優劣がつかず、安全側の判定のままでは確定しないため）
 */
function finalRace(
  inputs: RaceTeamInput[],
  format: Pick<PostseasonFormat, "divisionTop" | "wildcardSlots"> = PREMIER_FORMAT,
): PlayoffRaceTeam[] {
  const DIVISION_TOP = format.divisionTop;
  const WILDCARD_SLOTS = format.wildcardSlots;
  const divisionTop3 = new Set(inputs.filter((t) => t.divisionRank! <= DIVISION_TOP).map((t) => t.teamId));
  const wildcards = new Set(
    inputs
      .filter((t) => !divisionTop3.has(t.teamId))
      .sort((a, b) => a.overallRank! - b.overallRank!)
      .slice(0, WILDCARD_SLOTS)
      .map((t) => t.teamId),
  );
  return inputs.map((t) => {
    const inPlayoffs = divisionTop3.has(t.teamId) || wildcards.has(t.teamId);
    return {
      teamId: t.teamId,
      teamName: t.teamName,
      division: t.division,
      wins: t.wins,
      losses: t.losses,
      remaining: 0,
      magicDivisionFirst: t.divisionRank === 1 ? 0 : null,
      magicDivisionTop3: t.divisionRank! <= DIVISION_TOP ? 0 : null,
      eliminatedDivisionFirst: t.divisionRank !== 1,
      eliminatedDivisionTop3: t.divisionRank! > DIVISION_TOP,
      clinchedDivisionFirst: t.divisionRank === 1,
      clinchedDivisionTop2: t.divisionRank! <= HOME_COURT_DIVISION_TOP,
      clinchedPlayoffs: inPlayoffs,
      eliminatedPlayoffs: !inPlayoffs,
    };
  });
}

/**
 * 2026-27〜のプレーオフ決勝（3勝先取）の勝者。プレーオフの試合のうち最も新しい試合の2クラブを
 * 決勝のカードとみなし（8クラブのトーナメントで同じ2クラブが対戦するのは1回だけ）、その2クラブ間の
 * プレーオフでの勝数が3に達したクラブを優勝とする。まだ決着していなければundefined
 */
export function premierChampion(
  playoffGames: { date: string; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number }[],
): string | undefined {
  if (playoffGames.length === 0) return undefined;
  const latest = [...playoffGames].sort((a, b) => a.date.localeCompare(b.date)).at(-1)!;
  const pair = new Set([latest.homeTeamId, latest.awayTeamId]);
  const wins = new Map<string, number>();
  for (const g of playoffGames) {
    if (!pair.has(g.homeTeamId) || !pair.has(g.awayTeamId)) continue;
    const winner = g.homeScore > g.awayScore ? g.homeTeamId : g.awayTeamId;
    wins.set(winner, (wins.get(winner) ?? 0) + 1);
  }
  for (const [teamId, count] of wins) if (count >= 3) return teamId;
  return undefined;
}

/**
 * 日ごとの順位表（standings-history.json の各スナップショット）に判定を当て、「確定に切り替わった日」を求める
 * （勝敗表タブの赤枠。DESIGN.md 132章）。
 * - 残り試合は「そのクラブのシーズン総試合数 − その日までの消化数」。総試合数は、終了済みのシーズンなら実際に消化した数、
 *   進行中のシーズンなら規定の試合数（呼び出し側が totalGames で渡す）
 * - 判定は computePremierRace と同じ安全側（残り全勝・全敗の比較）。一度確定したら以後も確定のまま扱い、最初の日だけを記録する
 * - 確定した日にそのクラブの試合があればその試合（onGameDay=true。勝ち負けを問わない）、無ければ直前の試合に付ける
 * - レギュラーシーズンが終わっても勝率の比較だけでは確定しない同率のクラブは、公式の最終順位（タイブレーク適用済み）で
 *   最終日に確定させる（byTiebreak=true）
 */
export function computeClinchEvents(params: {
  snapshots: StandingsSnapshot[];
  teams: { teamId: string; division: Division; totalGames: number }[];
  /** クラブごとのレギュラーシーズンの試合（日付順）。確定日を試合に対応付けるのに使う */
  gamesByTeam: Map<string, { date: string; scheduleKey: string }[]>;
  /** 判定する確定の種類と、プレーオフ進出の判定に使う出場形式 */
  types: ClinchType[];
  format: Pick<PostseasonFormat, "divisionTop" | "wildcardSlots">;
  seasonComplete: boolean;
}): ClinchEvent[] {
  const { snapshots, teams, gamesByTeam, types, format, seasonComplete } = params;
  const firstDate = new Map<string, string>(); // `${teamId}:${type}` -> 確定日
  const flag = (t: PlayoffRaceTeam, type: ClinchType): boolean =>
    type === "division" ? !!t.clinchedDivisionFirst : type === "homeCourt" ? !!t.clinchedDivisionTop2 : !!t.clinchedPlayoffs;

  for (const snapshot of snapshots) {
    const byId = new Map(snapshot.teams.map((t) => [t.teamId, t]));
    const inputs: RaceTeamInput[] = teams.map((team) => {
      const s = byId.get(team.teamId);
      const wins = s?.wins ?? 0;
      const losses = s?.losses ?? 0;
      // 途中の日は順位を渡さない（finalRace に入らないよう、最終日以外は勝率の比較だけで判定する）
      return { teamId: team.teamId, division: team.division, wins, losses, remaining: Math.max(0, team.totalGames - wins - losses) };
    });
    const race = computePremierRace("", snapshot.date, inputs, format);
    for (const t of race.teams) {
      for (const type of types) {
        const key = `${t.teamId}:${type}`;
        if (!firstDate.has(key) && flag(t, type)) firstDate.set(key, snapshot.date);
      }
    }
  }

  // 最終日: 公式の最終順位で確定させる（同率で勝率の比較だけでは決まらないクラブ）
  const tiebreakKeys = new Set<string>();
  const last = snapshots.at(-1);
  if (seasonComplete && last) {
    const byId = new Map(last.teams.map((t) => [t.teamId, t]));
    const inputs: RaceTeamInput[] = teams.map((team) => {
      const s = byId.get(team.teamId);
      return {
        teamId: team.teamId,
        division: team.division,
        wins: s?.wins ?? 0,
        losses: s?.losses ?? 0,
        remaining: 0,
        divisionRank: s?.divisionRank,
        overallRank: s?.rank,
      };
    });
    if (inputs.every((t) => t.divisionRank !== undefined && t.overallRank !== undefined)) {
      for (const t of finalRace(inputs, format)) {
        for (const type of types) {
          const key = `${t.teamId}:${type}`;
          if (!firstDate.has(key) && flag(t, type)) {
            firstDate.set(key, last.date);
            tiebreakKeys.add(key);
          }
        }
      }
    }
  }

  const events: ClinchEvent[] = [];
  for (const [key, date] of firstDate) {
    const [teamId, type] = key.split(":") as [string, ClinchType];
    const games = gamesByTeam.get(teamId) ?? [];
    const sameDay = games.find((g) => g.date === date);
    const previous = [...games].reverse().find((g) => g.date < date);
    const game = sameDay ?? previous ?? null;
    events.push({
      teamId,
      type,
      date,
      scheduleKey: game?.scheduleKey ?? null,
      onGameDay: !!sameDay,
      ...(tiebreakKeys.has(key) ? { byTiebreak: true } : {}),
    });
  }
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.teamId.localeCompare(b.teamId));
}
