// 画面専用（図解・選手の散布図）。表示している人数と、登録区分ごとの人数。
// 区分は表示中の集計（players.json）の登録区分。シーズンの途中で区分が変わった選手は、区分を選んでいるときは選んだ区分に当てはまるほうで数える。
import type { PlayerSummary } from "../../shared/types";
import type { SeasonRegistrationFile } from "../../shared/registration";
import { changedRegistrations } from "./registrationScopeCore";
import { classPartOf, classTokens, classificationMatches, COMBINED_INTL_GROUP, splitGroupOf, type ClassificationGroup, type PlayerGroupFilter } from "./classificationFilter";

const SPLIT_ORDER = ["日本人", "外国籍", "帰化", "アジア特別枠"] as const;

/**
 * 図の空いているところに出す人数の行。1行目は表示人数、続けて登録区分ごとの人数。
 * 区分を選んでいるときは、選んでいる区分だけ（0人でも出す）。選んでいないときは、1人でもいる区分を日本人・外国籍・帰化・アジア特別枠の順に出す。
 */
export function playerCountLines(ids: readonly string[], players: readonly Pick<PlayerSummary, "playerId" | "classification">[], registrations: SeasonRegistrationFile | null | undefined, filter: string): string[] {
  const byId = new Map(players.map((p) => [p.playerId, p]));
  const changed = changedRegistrations(registrations);
  const classPart = classPartOf(filter as PlayerGroupFilter);
  const tokens = classTokens(classPart);
  const counts: Record<(typeof SPLIT_ORDER)[number], number> = { 日本人: 0, 外国籍: 0, 帰化: 0, アジア特別枠: 0 };
  for (const id of new Set(ids)) {
    const p = byId.get(id);
    if (!p) continue;
    let c = p.classification;
    const entry = changed.get(id);
    if (entry && tokens.length) c = [entry.classification, ...(entry.changes ?? []).map((x) => x.classification)].find((x) => classificationMatches(x, classPart)) ?? c;
    const g = splitGroupOf(c);
    if (g) counts[g]++;
  }
  const line = (label: string, n: number) => `${label} ${n}人`;
  const lines = [`表示 ${new Set(ids).size}人`];
  if (!tokens.length) {
    for (const g of SPLIT_ORDER) if (counts[g] > 0) lines.push(line(g, counts[g]));
    return lines;
  }
  for (const t of tokens as ClassificationGroup[]) {
    lines.push(t === COMBINED_INTL_GROUP ? line(t, counts.外国籍 + counts.帰化 + counts.アジア特別枠) : line(t, counts[t as (typeof SPLIT_ORDER)[number]]));
  }
  return lines;
}

/**
 * 人数の枠を置く位置（図の中の左上の角の座標。px）。点の中心から radius 以内に枠が入る数がいちばん少ない位置を、図の中を細かく走査して選ぶ
 * （同数なら右上の角にいちばん近い位置）。点は図の幅・高さに対する割合（0〜100）。位置は割合にして使うと、保存のときに図が広くなっても枠は点から離れる方向にしか動かない。
 */
export function chooseCountPlacement(points: readonly { left: number; top: number }[], plot: { width: number; height: number }, box: { width: number; height: number }, radius = 16, margin = 6, step = 6): { left: number; top: number; overlaps: number } {
  const px = points.map((p) => ({ x: (p.left / 100) * plot.width, y: (p.top / 100) * plot.height }));
  const maxX = Math.max(margin, plot.width - margin - box.width), maxY = Math.max(margin, plot.height - margin - box.height);
  let best = { left: maxX, top: margin, overlaps: Number.POSITIVE_INFINITY, dist: Number.POSITIVE_INFINITY };
  for (let top = margin; top <= maxY + 1e-9; top += step) {
    for (let left = maxX; left >= margin - 1e-9; left -= step) {
      const l = left - radius, r = left + box.width + radius, t = top - radius, b = top + box.height + radius;
      let overlaps = 0;
      for (const p of px) if (p.x >= l && p.x <= r && p.y >= t && p.y <= b) overlaps++;
      const dist = Math.hypot(maxX - left, top - margin);
      if (overlaps < best.overlaps || (overlaps === best.overlaps && dist < best.dist)) best = { left, top, overlaps, dist };
    }
  }
  return { left: best.left, top: best.top, overlaps: best.overlaps };
}
