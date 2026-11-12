// 1試合分のクラッチの材料（設計書375章）。Q別の索引を作るとき（scripts/lib/periodIndexBuild.ts）と、試合の生データを画面で読む表（日程結果など）で同じものを使う。
// 判定は shared/clutchTime.ts。ここでは、クラッチのプレーを CLUTCH_PERIOD の区間にも数えた在コートの復元と、チームごとのクラッチのボックススコアの行を作る。
import {
  CLUTCH_PERIOD,
  CLUTCH_QUALITY_ONCOURT,
  clutchBoxscoreRows,
  clutchOverlapSeconds,
  clutchPlayByPlays,
  clutchQuality,
  judgeClutch,
  pointsOfPlay,
  type ClutchJudgement,
} from "./clutchTime.ts";
import { onCourtPeriodCount, reconstructOnCourt, STINT_COUNT_KEYS, substitutionModelForSeason, type LineupStint, type OnCourtReconstruction } from "./onCourt.ts";
import { emptyOnCourtValues, ON_COURT_OPP_OFFSET, ON_COURT_OWN_OFFSET, plusMinusOf } from "./playerOnCourt.ts";
import type { BoxscoreRow, PlayByPlayEvent, StoredGame } from "./types.ts";

export interface ClutchSide {
  teamId: string;
  /** 試合の生データの行に、クラッチの行（PeriodCategory = CLUTCH_PERIOD）を足したもの */
  rows: BoxscoreRow[];
  /** 選手ごとのクラッチ中の出場中の材料（shared/playerOnCourt.ts の playerOnCourtByPeriod と同じ並び） */
  byPlayer: Map<string, number[]>;
  /** 出場区間の確かめ（選手の秒の合計＝クラッチの秒×5、+/- の合計＝（得点−失点）×5）が通ったか。通らなければ +/- と出場中の値は使わない */
  onCourtOk: boolean;
  /** 品質のビット（shared/clutchTime.ts の CLUTCH_QUALITY_*） */
  quality: number;
}

export interface ClutchGame {
  judgement: ClutchJudgement;
  /** クラッチのプレーだけの、仮のピリオド（CLUTCH_PERIOD）のプレーバイプレー */
  pbp: PlayByPlayEvent[];
  /** クラッチのプレーを CLUTCH_PERIOD の区間にも数えた在コートの復元 */
  onCourt: OnCourtReconstruction;
  /** [ホーム, アウェイ] */
  sides: [ClutchSide, ClutchSide];
}

/** クラッチのプレーバイプレーの、チームの得点 */
export function clutchTeamPoints(pbp: readonly PlayByPlayEvent[], teamId: string): number {
  return pbp.filter((e) => e.TeamID === teamId).reduce((n, e) => n + pointsOfPlay(e.ActionCD1), 0);
}

/**
 * クラッチ中の、選手ごとの出場中の材料（秒はクラッチの時間帯との重なり、数え上げは CLUTCH_PERIOD の区間）。区間は5人組の出場区間（lineupStints）
 */
export function clutchOnCourtByPlayer(stints: readonly LineupStint[], teamId: string, windows: readonly [number, number][]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const s of stints) {
    if (s.teamId !== teamId) continue;
    const seconds = clutchOverlapSeconds(windows, s.startSec, s.endSec);
    const pair = s.countsByPeriod?.[CLUTCH_PERIOD];
    const scored = s.pointsByPeriod[CLUTCH_PERIOD];
    if (seconds <= 0 && !pair && !scored) continue;
    for (const id of s.playerIds) {
      let v = out.get(id);
      if (!v) out.set(id, (v = emptyOnCourtValues()));
      v[0]! += seconds;
      STINT_COUNT_KEYS.forEach((k, i) => {
        v![ON_COURT_OWN_OFFSET + i]! += k === "pts" ? (scored?.own ?? 0) : (pair?.own[k] ?? 0);
        v![ON_COURT_OPP_OFFSET + i]! += k === "pts" ? (scored?.opp ?? 0) : (pair?.opp[k] ?? 0);
      });
    }
  }
  return out;
}

/** クラッチを判定できる試合か（プレーバイプレーがある・前後半5分の特別な試合でない・ピリオド別の行がある） */
export function clutchJudgeable(game: StoredGame): boolean {
  if (game.raw.PlayByPlays.length === 0) return false;
  const rows = [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores];
  return rows.some((r) => r.Category === 1 && r.PeriodCategory >= 1 && r.PeriodCategory <= 4);
}

/**
 * 試合のクラッチの材料。判定できない試合・クラッチにならなかった試合は null。
 * game.raw.PlayByPlays は時系列（読み込みの出口で chronologicalPlayByPlays 済み）でも、そうでなくてもよい（judgeClutch の中で並べる）
 */
export function buildClutchGame(game: StoredGame): ClutchGame | null {
  if (!clutchJudgeable(game)) return null;
  const judged = judgeClutch(game.raw.PlayByPlays, game.homeTeam.id, game.homeScore, game.awayScore);
  if (!judged.ok || !judged.judgement.isClutchGame) return null;
  const j = judged.judgement;
  const totalPeriods = onCourtPeriodCount(game.season, game.quarterScores.home.length, game.raw.PlayByPlays);
  const model = substitutionModelForSeason(game.season);
  const clutchEvents = new Set(j.playByPlays.filter((_, i) => j.flags[i]));
  const onCourt = reconstructOnCourt(j.playByPlays, game.raw.HomeBoxscores, game.raw.AwayBoxscores, game.homeTeam.id, game.awayTeam.id, totalPeriods, model, {
    clutchEvents,
  });
  const pbp = clutchPlayByPlays(j);
  const legacy = model === "legacy";
  const side = (home: boolean): ClutchSide => {
    const teamId = home ? game.homeTeam.id : game.awayTeam.id;
    const rows = home ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
    const onCourtSec = new Map<string, number>();
    for (const iv of onCourt.intervals) {
      if (iv.teamId !== teamId) continue;
      onCourtSec.set(iv.playerId, (onCourtSec.get(iv.playerId) ?? 0) + clutchOverlapSeconds(j.windows, iv.startSec, iv.endSec));
    }
    const byPlayer = clutchOnCourtByPlayer(onCourt.lineupStints, teamId, j.windows);
    // 出場区間の確かめ: 選手の秒の合計＝クラッチの秒×5（出場区間・5人組の区間の両方）、+/- の合計＝（得点−失点）×5。
    // 合わなければ出場中の値と +/- は使わない（出場時間は出場区間の値のまま。品質のビットで分かる）
    const secSum = [...onCourtSec.values()].reduce((n, v) => n + v, 0);
    const stintSec = [...byPlayer.values()].reduce((n, v) => n + v[0]!, 0);
    const pmSum = [...byPlayer.values()].reduce((n, v) => n + plusMinusOf(v), 0);
    const own = clutchTeamPoints(pbp, teamId);
    const opp = clutchTeamPoints(pbp, home ? game.awayTeam.id : game.homeTeam.id);
    // 公式の記録で出場なし（DNP）の選手に、復元で出場中の値が付いた試合（同じ秒の交代の記録の食い違い。2025-26 の505467など）も、確かめが通らないものとして扱う
    const dnp = new Set(rows.filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.PlayTime === "DNP").map((r) => r.PlayerID));
    const dnpOnCourt = [...byPlayer].some(([id, v]) => dnp.has(id) && v.some((x) => x !== 0));
    const onCourtOk = !dnpOnCourt && secSum === 5 * j.seconds && stintSec === 5 * j.seconds && pmSum === 5 * (own - opp);
    const plusMinus = onCourtOk ? new Map([...byPlayer].map(([id, v]) => [id, plusMinusOf(v)])) : null;
    const synthetic = clutchBoxscoreRows(rows, teamId, pbp, onCourtSec, plusMinus, legacy);
    const quality = clutchQuality(rows, teamId, j.playByPlays, legacy) | (onCourtOk ? 0 : CLUTCH_QUALITY_ONCOURT);
    return { teamId, rows: [...rows, ...synthetic], byPlayer, onCourtOk, quality };
  };
  return { judgement: j, pbp, onCourt, sides: [side(true), side(false)] };
}

const viewCache = new WeakMap<StoredGame, StoredGame | null>();

/**
 * 試合の生データに、クラッチの行（PeriodCategory = CLUTCH_PERIOD）とクラッチのプレー（Period = CLUTCH_PERIOD）を足した写し。
 * 区間の選択肢（periods: [CLUTCH_PERIOD]）で絞る表（日程結果など）に渡すと、Q別と同じ関数でクラッチの値が出る。
 * **試合全体の値を数える処理には渡さない**（プレーが二重になる）。クラッチにならなかった試合・判定できない試合は null
 */
export function gameWithClutchView(game: StoredGame): StoredGame | null {
  if (viewCache.has(game)) return viewCache.get(game)!;
  const c = buildClutchGame(game);
  const view = c
    ? { ...game, raw: { ...game.raw, HomeBoxscores: c.sides[0].rows, AwayBoxscores: c.sides[1].rows, PlayByPlays: [...game.raw.PlayByPlays, ...c.pbp] } }
    : null;
  viewCache.set(game, view);
  return view;
}
