// 個人詳細ページ「オンコート/オフコート比較」（Batch 4）用の集計。
//
// reconstructOnCourt()が返す在コート区間（OnCourtInterval）と、「よく使われるラインナップ」
// （78章）で使っているのと同じポゼッション推定ロジック（buildPossessionStartEvents、
// shared/onCourt.ts）を再利用し、選手がオンコート/オフコートだった時間帯それぞれについて、
// 自チーム・相手チームの得点・ポゼッション・シュート成功数（FG/3P/FT）を集計する。
//
// FG/FT成功・失敗の判定はActionCD1のみで行い、ショットチャート座標（X/Y、2022-23シーズン
// 以降のみ存在）には依存しない。そのため「よく使われるラインナップ」と同じく、PBP対応の
// 全シーズン（pbpSupported）で動作する（coverage制約なし）。

import type { PlayByPlayEvent, StoredGame } from "../../shared/types";
import { buildPossessionStartEvents, buildScoreEvents, totalGameSeconds } from "../../shared/onCourt";
import { elapsedSeconds } from "./leadTracker";

const FG_MADE_CODES = new Set([1, 3, 4]);
const FG_MISSED_CODES = new Set([2, 5, 6]);
const THREE_POINT_CODES = new Set([1, 2]);
const FT_MADE_CODE = 7;
const FT_MISSED_CODE = 8;

export interface ShootingCounts {
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
}

function zeroShooting(): ShootingCounts {
  return { fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0 };
}

function addShooting(target: ShootingCounts, ev: PlayByPlayEvent): void {
  if (FG_MADE_CODES.has(ev.ActionCD1) || FG_MISSED_CODES.has(ev.ActionCD1)) {
    target.fga += 1;
    if (FG_MADE_CODES.has(ev.ActionCD1)) target.fgm += 1;
    if (THREE_POINT_CODES.has(ev.ActionCD1)) {
      target.tpa += 1;
      if (ev.ActionCD1 === 1) target.tpm += 1;
    }
  } else if (ev.ActionCD1 === FT_MADE_CODE || ev.ActionCD1 === FT_MISSED_CODE) {
    target.fta += 1;
    if (ev.ActionCD1 === FT_MADE_CODE) target.ftm += 1;
  }
}

export interface OnOffBucket {
  seconds: number;
  ownPts: number;
  oppPts: number;
  ownPoss: number;
  oppPoss: number;
  ownShooting: ShootingCounts;
  oppShooting: ShootingCounts;
}

function zeroBucket(): OnOffBucket {
  return { seconds: 0, ownPts: 0, oppPts: 0, ownPoss: 0, oppPoss: 0, ownShooting: zeroShooting(), oppShooting: zeroShooting() };
}

export interface OnOffSplit {
  on: OnOffBucket;
  off: OnOffBucket;
}

/**
 * 1試合分、指定選手のオンコート/オフコート区間それぞれについて、自チーム・相手チームの
 * 得点・ポゼッション・シュート成功数を集計する。`playerIntervals`は
 * `reconstructOnCourt().intervals`のうち、この選手・このteamIdの区間だけを渡す
 */
export function computeGameOnOffSplit(
  game: StoredGame,
  teamId: string,
  playerIntervals: { startSec: number; endSec: number }[],
): OnOffSplit {
  const opponentTeamId = teamId === game.homeTeam.id ? game.awayTeam.id : game.homeTeam.id;
  const gameEnd = totalGameSeconds(game.quarterScores.home.length);
  const isOnCourt = (elapsedSec: number) => playerIntervals.some((iv) => elapsedSec >= iv.startSec && elapsedSec < iv.endSec);

  const on = zeroBucket();
  const off = zeroBucket();
  on.seconds = playerIntervals.reduce((sum, iv) => sum + (iv.endSec - iv.startSec), 0);
  off.seconds = Math.max(0, gameEnd - on.seconds);

  for (const ev of buildScoreEvents(game.raw.PlayByPlays)) {
    const bucket = isOnCourt(ev.elapsedSec) ? on : off;
    if (ev.teamId === teamId) bucket.ownPts += ev.points;
    else if (ev.teamId === opponentTeamId) bucket.oppPts += ev.points;
  }

  for (const ps of buildPossessionStartEvents(game.raw.PlayByPlays, game.homeTeam.id, game.awayTeam.id)) {
    const bucket = isOnCourt(ps.elapsedSec) ? on : off;
    if (ps.teamId === teamId) bucket.ownPoss += 1;
    else bucket.oppPoss += 1;
  }

  for (const ev of game.raw.PlayByPlays) {
    if (!ev.TeamID) continue;
    const isShotEvent =
      FG_MADE_CODES.has(ev.ActionCD1) ||
      FG_MISSED_CODES.has(ev.ActionCD1) ||
      ev.ActionCD1 === FT_MADE_CODE ||
      ev.ActionCD1 === FT_MISSED_CODE;
    if (!isShotEvent) continue;
    const bucket = isOnCourt(elapsedSeconds(ev.Period, ev.RestTime)) ? on : off;
    if (ev.TeamID === teamId) addShooting(bucket.ownShooting, ev);
    else if (ev.TeamID === opponentTeamId) addShooting(bucket.oppShooting, ev);
  }

  return { on, off };
}

function mergeShootingInto(target: ShootingCounts, src: ShootingCounts): void {
  target.fgm += src.fgm;
  target.fga += src.fga;
  target.tpm += src.tpm;
  target.tpa += src.tpa;
  target.ftm += src.ftm;
  target.fta += src.fta;
}

function mergeBucketInto(target: OnOffBucket, src: OnOffBucket): void {
  target.seconds += src.seconds;
  target.ownPts += src.ownPts;
  target.oppPts += src.oppPts;
  target.ownPoss += src.ownPoss;
  target.oppPoss += src.oppPoss;
  mergeShootingInto(target.ownShooting, src.ownShooting);
  mergeShootingInto(target.oppShooting, src.oppShooting);
}

export function mergeOnOffSplits(splits: OnOffSplit[]): OnOffSplit {
  const on = zeroBucket();
  const off = zeroBucket();
  for (const s of splits) {
    mergeBucketInto(on, s.on);
    mergeBucketInto(off, s.off);
  }
  return { on, off };
}
