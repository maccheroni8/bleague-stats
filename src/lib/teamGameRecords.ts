// チームの1試合記録（ランキングページ > チーム > 1試合記録。DESIGN.md 191章）の項目と、一覧の行の作り方。
// 範囲「歴代」は夜間の集計の上位20位（data/league-team-rankings.json）、範囲「シーズン」は選んだシーズンの全クラブの試合ログから作る。
// どちらも同じ形の行（TeamGameRecordRow）にそろえる。
import { TEAM_AGAINST_RECORD_STATS, TEAM_PCT_MIN_ATTEMPTS, TEAM_RECORD_STATS, teamRecordDetail, type TeamRecordDetail, type TeamRecordValueDef } from "../../shared/teamRecords";
import { periodAndRestAt } from "../../shared/gameFlow";
import {
  PERIOD_KEYS,
  PERIOD_LABELS,
  PERIOD_RECORD_KINDS,
  periodRecordStatKey,
  rankPeriodGames,
  type PeriodRecordKind,
} from "../../shared/teamPeriodRecords";
import type { LeagueRecordEntry, LeagueTeamRankingsFile, TeamGameLog, TeamHistoryEntry } from "../../shared/types";
import type { SeasonGameTypeFilter } from "./playerSeasonBoxscore";
import { formatPct } from "./format";
import { teamNameInSeason } from "./teamLabel";
export { leagueTeamDisplayName } from "./leagueTeamNames";
import { attemptsFirst, computeTopRecordEntries } from "./topRecords";

/** 記録の種類: 記録（チームにとって良い方）／ワースト（悪い方）／被記録（対戦相手がそのチーム相手に記録した値） */
export type TeamRecordMode = "record" | "worst" | "against";
export const TEAM_RECORD_MODE_LABELS: Record<TeamRecordMode, string> = { record: "記録", worst: "ワースト", against: "被記録" };

/** 一覧に出す件数（同じ順位は続けて出す） */
export const TEAM_RECORD_TOP_N = 20;

export interface TeamRecordItem {
  key: string;
  label: string;
  group?: string;
}

const PERIOD_GROUP = "クォーター別・前後半別";

/** ワーストの向き。少ない方が良い項目（失点・ターンオーバー・ファウル）のワーストは多い方、それ以外は少ない方 */
function lowerFirst(def: TeamRecordValueDef, mode: TeamRecordMode): boolean {
  if (mode === "against") return false;
  const lowerIsBetter = def.lowerIsBetter ?? false;
  return mode === "record" ? lowerIsBetter : !lowerIsBetter;
}

/** その項目が、値の小さい方が上位か（失点・ターンオーバー・ファウルの記録、ワーストの逆向き、クォーター別の最少失点など） */
export function teamRecordLowerFirst(mode: TeamRecordMode, key: string): boolean {
  const period = parsePeriodItemKey(key);
  if (period) return PERIOD_RECORD_KINDS.find((k) => k.key === period.kind)!.lowerFirst;
  const def = teamRankingDefs(mode).find((d) => d.key === key);
  return def ? lowerFirst(def, mode) : false;
}

/** 種類ごとの1試合の項目の定義（ワーストは、成功率・試投数・来場者数・逆転を除く。被記録は来場者数を除く28項目） */
export function teamRecordDefs(mode: TeamRecordMode): TeamRecordValueDef[] {
  if (mode === "against") return TEAM_AGAINST_RECORD_STATS;
  return mode === "record" ? TEAM_RECORD_STATS : TEAM_RECORD_STATS.filter((d) => d.worstEligible !== false);
}

/** 種類ごとの項目の一覧（クォーター別・前後半別は、記録・ワーストだけ） */
export function teamRecordItems(mode: TeamRecordMode): TeamRecordItem[] {
  const items: TeamRecordItem[] = teamRecordDefs(mode).map((d) => ({ key: d.key, label: d.label }));
  if (mode === "against") return items;
  for (const period of PERIOD_KEYS) {
    for (const kind of PERIOD_RECORD_KINDS.filter((k) => k.mode === mode)) {
      items.push({ key: periodRecordStatKey(period, kind.key), label: `${PERIOD_LABELS[period]} ${kind.label}`, group: PERIOD_GROUP });
    }
  }
  return items;
}

// ---- ランキング（1試合記録）の項目（設計書265章）----
// 区間（Q別・前後半・延長）は項目ではなく条件（URL の q）にしたので、「1Q 最多得点」のような項目は出さず、共通の項目に「得失点差」を足す。
// 得失点差は、記録＝最大の点差勝ち（多い順）、ワースト＝最大の点差負け（少ない順）。被記録には出さない。索引でしか出せない（上位20位のファイルが無い）

export const TEAM_MARGIN_DEF: TeamRecordValueDef = { key: "margin", label: "得失点差", value: (g) => g.teamScore - g.opponentScore };

/** ランキングの項目の定義（得失点差は失点の次） */
export function teamRankingDefs(mode: TeamRecordMode): TeamRecordValueDef[] {
  const base = teamRecordDefs(mode);
  if (mode === "against") return base;
  const at = base.findIndex((d) => d.key === "oppPts");
  return [...base.slice(0, at + 1), TEAM_MARGIN_DEF, ...base.slice(at + 1)];
}

export function teamRankingItems(mode: TeamRecordMode): TeamRecordItem[] {
  return teamRankingDefs(mode).map((d) => ({ key: d.key, label: d.label }));
}

/** 区間を選んでいる間は選べない項目（試合全体の値で、区間では意味が無い） */
export const TEAM_NO_PERIOD_KEYS: readonly string[] = ["attendance", "comebackWin", "blownLeadLoss", "maxRun"];
export const TEAM_NO_PERIOD_REASON: Record<string, string> = {
  attendance: "ホーム来場者数は試合全体の値のため、Q別・前後半・延長では選べません。",
  comebackWin: "最大点差からの逆転は試合全体の記録のため、Q別・前後半・延長では選べません。",
  blownLeadLoss: "最大点差からの逆転は試合全体の記録のため、Q別・前後半・延長では選べません。",
  maxRun: "最大のランは試合全体の記録のため、Q別・前後半・延長では選べません。",
};

/** 古い URL の項目「q1:mostPts」を、区間と項目に読み替える表（種類・項目） */
export const LEGACY_PERIOD_ITEMS: Record<PeriodRecordKind, { mode: TeamRecordMode; stat: string }> = {
  mostPts: { mode: "record", stat: "pts" },
  fewestOppPts: { mode: "record", stat: "oppPts" },
  bestDiff: { mode: "record", stat: "margin" },
  fewestPts: { mode: "worst", stat: "pts" },
  mostOppPts: { mode: "worst", stat: "oppPts" },
  worstDiff: { mode: "worst", stat: "margin" },
};

/**
 * 成功率の項目の最低試投数（区間を選んだときは、区間の長さに合わせて下げる）。基準の数と数え方（試投数／成功数）は決定待ちで、今は試投数のまま。
 * 区間の長さ: 1Q〜4Q は4分の1、前半・後半は2分の1、延長は8分の1（最低1）
 */
const PERIOD_SHARE: Record<string, number> = { q1: 1 / 4, q2: 1 / 4, q3: 1 / 4, q4: 1 / 4, h1: 1 / 2, h2: 1 / 2, ot: 1 / 8 };
export function teamPctMinAttempts(key: string, period: string | null): number | null {
  const base = (TEAM_PCT_MIN_ATTEMPTS as Record<string, number>)[key];
  if (base === undefined) return null;
  return period ? Math.max(1, Math.round(base * (PERIOD_SHARE[period] ?? 1))) : base;
}

/** 項目キーが「q1:mostPts」の形か（クォーター別・前後半別の項目） */
export function parsePeriodItemKey(key: string): { period: (typeof PERIOD_KEYS)[number]; kind: PeriodRecordKind } | null {
  const [period, kind] = key.split(":");
  const p = PERIOD_KEYS.find((k) => k === period);
  const k = PERIOD_RECORD_KINDS.find((d) => d.key === kind);
  return p && k ? { period: p, kind: k.key } : null;
}

const PCT_KEYS = new Set(["fgPct", "twoPct", "tpPct", "ftPct"]);

export function formatTeamRecordValue(key: string, v: number): string {
  if (key === "margin") return v > 0 ? `+${v}` : String(v);
  const period = parsePeriodItemKey(key);
  if (period) return (period.kind === "bestDiff" || period.kind === "worstDiff") && v > 0 ? `+${v}` : String(v);
  return PCT_KEYS.has(key) ? formatPct(v) : v.toLocaleString();
}

export interface TeamGameRecordRow {
  rank: number;
  value: number;
  teamId: string;
  /** その試合のときのチーム名 */
  teamName: string;
  season: string;
  scheduleKey: string;
  date: string;
  opponentTeamId: string;
  opponentTeamName: string;
  isHome: boolean;
  /** 成功率の項目: 成功数と試投数 */
  made?: number;
  attempted?: number;
  /** クォーター別・前後半別: 区間の得点・失点、プレーバイプレーから補った値を含むか */
  ownPoints?: number;
  oppPoints?: number;
  fromPbp?: boolean;
  /** 逆転勝利・逆転負け・最大のラン: 最終スコア（と最大のランの場所）。DESIGN.md 221章 */
  detail?: TeamRecordDetail;
}

function periodLabel(period: number): string {
  return period <= 4 ? `第${period}Q` : period === 5 ? "OT" : `OT${period - 4}`;
}

function clock(restSec: number): string {
  return `${Math.floor(restSec / 60)}:${String(restSec % 60).padStart(2, "0")}`;
}

/**
 * 行に添える文字（「最終 85-79」。最大のランは「最終 85-79　第3Q 5:12〜2:30（40-52 → 61-52）」）。
 * 点数は自チームから見て「自チーム-相手」。value は最大のランの点数（ラン後のスコアを出すのに使う）
 */
export function formatTeamRecordDetail(d: TeamRecordDetail, value: number): string {
  const final = `最終 ${d.finalOwn}-${d.finalOpp}`;
  if (d.runFromSec === undefined || d.runToSec === undefined || d.runOwnBefore === undefined || d.runOppBefore === undefined) return final;
  const from = periodAndRestAt(d.runFromSec);
  const to = periodAndRestAt(d.runToSec);
  const when = from.period === to.period ? `${periodLabel(from.period)} ${clock(from.restSec)}〜${clock(to.restSec)}` : `${periodLabel(from.period)} ${clock(from.restSec)}〜${periodLabel(to.period)} ${clock(to.restSec)}`;
  return `${final}　${when}（${d.runOwnBefore}-${d.runOppBefore} → ${d.runOwnBefore + value}-${d.runOppBefore}）`;
}

/** 歴代の集計ファイルから、その種類・試合区分・項目の行を作る。チーム名・相手の名称は、その試合のシーズンの名称 */
export function allTimeTeamRecordRows(
  rankings: LeagueTeamRankingsFile | null | undefined,
  history: readonly TeamHistoryEntry[] | null | undefined,
  mode: TeamRecordMode,
  gameType: SeasonGameTypeFilter,
  key: string,
  teamName: (teamId: string) => string,
): TeamGameRecordRow[] {
  if (!rankings) return [];
  const isPeriod = parsePeriodItemKey(key) !== null;
  const table = isPeriod
    ? rankings.periodRecordTop20
    : mode === "record"
      ? rankings.clubRecordTop20
      : mode === "worst"
        ? rankings.clubRecordWorstTop20
        : rankings.clubRecordAgainstTop20;
  const entries: LeagueRecordEntry[] = table?.[gameType]?.[key] ?? [];
  return entries.flatMap((e) =>
    e.scheduleKey && e.date && e.opponentTeamId
      ? [
          {
            rank: e.rank,
            value: e.value,
            teamId: e.teamId,
            teamName: teamNameInSeason(history, e.teamId, e.season, teamName(e.teamId)),
            season: e.season,
            scheduleKey: e.scheduleKey,
            date: e.date,
            opponentTeamId: e.opponentTeamId,
            opponentTeamName: teamNameInSeason(history, e.opponentTeamId, e.season, teamName(e.opponentTeamId)),
            isHome: e.isHome ?? false,
            ...(e.made !== undefined ? { made: e.made, attempted: e.attempted } : {}),
            ...(e.ownPoints !== undefined ? { ownPoints: e.ownPoints, oppPoints: e.oppPoints } : {}),
            ...(e.fromPbp ? { fromPbp: true } : {}),
            ...(e.finalOwn !== undefined && e.finalOpp !== undefined
              ? {
                  detail: {
                    finalOwn: e.finalOwn,
                    finalOpp: e.finalOpp,
                    ...(e.runFromSec !== undefined ? { runFromSec: e.runFromSec, runToSec: e.runToSec, runOwnBefore: e.runOwnBefore, runOppBefore: e.runOppBefore } : {}),
                  },
                }
              : {}),
          },
        ]
      : [],
  );
}

/** シーズンの全クラブの試合ログ（記録したチームとシーズンを足したもの。1試合につき両チームの2件） */
export type TeamRecordGame = TeamGameLog & { season: string; teamId: string; teamName: string };

function rowOfGame(g: TeamRecordGame, rank: number, value: number, key?: string): TeamGameRecordRow {
  const detail = key ? teamRecordDetail(key, g) : undefined;
  return {
    ...(detail ? { detail } : {}),
    rank,
    value,
    teamId: g.teamId,
    teamName: g.teamName,
    season: g.season,
    scheduleKey: g.scheduleKey,
    date: g.date,
    opponentTeamId: g.opponentTeamId,
    opponentTeamName: g.opponentTeamName,
    isHome: g.isHome,
  };
}

/** シーズンの試合から、その種類・項目の上位（同じ順位は続けて入れる）の行を作る */
export function seasonTeamRecordRows(games: TeamRecordGame[], mode: TeamRecordMode, key: string): TeamGameRecordRow[] {
  const period = parsePeriodItemKey(key);
  if (period) {
    return rankPeriodGames(games, period.period, period.kind)
      .filter((r) => r.rank <= TEAM_RECORD_TOP_N)
      .map((r) => ({
        ...rowOfGame(r.game, r.rank, r.value),
        ownPoints: r.score.pts,
        oppPoints: r.score.oppPts,
        ...(r.score.fromPbp ? { fromPbp: true } : {}),
      }));
  }
  const def = teamRecordDefs(mode).find((d) => d.key === key);
  if (!def) return [];
  const pool = def.filter ? games.filter(def.filter) : games;
  return computeTopRecordEntries(pool, def.value, lowerFirst(def, mode), TEAM_RECORD_TOP_N, attemptsFirst(def.fraction)).map((e) => {
    const frac = def.fraction?.(e.game);
    return { ...rowOfGame(e.game, e.rank, e.value, key), ...(frac ? { made: frac[0], attempted: frac[1] } : {}) };
  });
}
