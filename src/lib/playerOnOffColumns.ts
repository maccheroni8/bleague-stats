// 選手の On/Off の項目（全選手スタッツ・個人詳細・チーム詳細の選手表の「on/off」タブ。在コート基準の再集計の材料を使う画面だけの変更。DESIGN.md 303章）。
// - On: 本人がいた5人組の区間の合計（試合ログの onCourt）。Off: 本人が出場した（時間のある区間にいた）試合で、本人がコートにいない時間（チームの stintTotals − On）。
//   ランキングの On/Off（shared/onCourtTotals.ts）と同じ定義・同じ値（validate:player-oncourt が確かめる）
// - ORtg・DRtg は、得点と攻撃回数（攻撃の終わりの数）をシーズンで足してから割る（試合ごとの率の平均にしない）。平均／合計の切り替えでも試合数で割らない。
//   攻撃回数0は「-」。NetRtg＝ORtg−DRtg、On-Off は On − Off
// - Min は出場中・出場していない時間。平均のときは、材料のある試合の数で割る
// - 2020-21以降・試合全体だけ。2016-17〜2019-20、Q別・前後半は「-」（理由は注記）。材料の無い試合は数えない（0として扱わない）
// - 個人の ORtg（Dean Oliver 方式。Advanced）とは別の項目
import type { PlayerGameLog, TeamGameLog } from "../../shared/types";
import { onOffSplitFromLogs, type OnOffBucket } from "./onCourtSplit";
import { formatMinutesFromSeconds } from "./boxscoreAggregate";
import { formatDecimal } from "./format";
import { onCourtShareSeasonUnsupported } from "./onCourtShareSeason";
import type { SeasonBoxscoreColumn, SeasonBoxscoreCtx, SeasonDisplayMode, SeasonOnOffTotals } from "./playerSeasonBoxscore";

/** タブの名前 */
export const ONOFF_TAB_LABEL = "on/off";

/** シーズン（行）の On/Off の合計（型は playerSeasonBoxscore.ts に置く） */
export type OnOffSeasonTotals = SeasonOnOffTotals;

/**
 * 試合ログ（出場した試合）から On/Off の合計を作る。teamLogOf は、その試合の所属チームの試合ログ（移籍した選手は試合ごとの所属チーム）。
 * 材料のある試合が1つも無ければ null
 */
export function onOffTotalsFromLogs(logs: readonly PlayerGameLog[], teamLogOf: (g: PlayerGameLog) => TeamGameLog | undefined): OnOffSeasonTotals | null {
  // 出場時間0の行でも、長さ0秒の区間に記録だけある試合は On に入る（ランキングと同じ）。G は Off を数えた（時間のある区間に出た）試合
  const { on, off } = onOffSplitFromLogs(logs, teamLogOf);
  const games = logs.filter((g) => g.onCourt && g.onCourt[0]! > 0 && teamLogOf(g)?.stintTotals).length;
  return games > 0 ? { games, on, off } : null;
}

/** On/Off を出せない理由（null は出せる） */
export function onOffUnavailableReason(season: string | null, periodSelected: boolean): string | null {
  if (season && onCourtShareSeasonUnsupported(season)) return "2016-17〜2019-20 は、on/off の項目を出していません（出場中の記録の数え上げが無いため）。";
  if (periodSelected) return "on/off の項目は試合全体でだけ出します。Q別・前後半を選んでいるときは「-」です。";
  return null;
}

const rtg = (pts: number, poss: number): number | null => (poss > 0 ? (100 * pts) / poss : null);
const oRtg = (b: OnOffBucket) => rtg(b.ownPts, b.ownPoss);
const dRtg = (b: OnOffBucket) => rtg(b.oppPts, b.oppPoss);
const netRtg = (b: OnOffBucket) => {
  const o = oRtg(b);
  const d = dRtg(b);
  return o === null || d === null ? null : o - d;
};
const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);

function signed(v: number, digits: number): string {
  const t = v.toFixed(digits);
  return Number(t) > 0 ? `+${t}` : t;
}

function ratingColumn(key: string, label: string, get: (t: OnOffSeasonTotals) => number | null, isDiff: boolean, higherIsBetter = true): SeasonBoxscoreColumn {
  return {
    key,
    label,
    format: (c) => {
      const v = c.onOff ? get(c.onOff) : null;
      return v === null ? "-" : isDiff ? signed(v, 1) : formatDecimal(v, 1);
    },
    value: (c) => (c.onOff ? (get(c.onOff) ?? 0) : 0),
    higherIsBetter,
  };
}

function minutesColumn(key: string, label: string, get: (t: OnOffSeasonTotals) => number, isDiff: boolean): SeasonBoxscoreColumn {
  const seconds = (c: SeasonBoxscoreCtx, mode: SeasonDisplayMode): number | null => {
    if (!c.onOff) return null;
    const s = get(c.onOff);
    return mode === "total" ? s : s / c.onOff.games;
  };
  return {
    key,
    label,
    format: (c, mode) => {
      const s = seconds(c, mode);
      if (s === null) return "-";
      const text = formatMinutesFromSeconds(Math.round(Math.abs(s)));
      return isDiff ? `${s > 0 ? "+" : s < 0 ? "-" : ""}${text}` : text;
    },
    value: (c, mode) => (seconds(c, mode) ?? 0) / 60,
  };
}

export const SEASON_ONOFF_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "onoffg", label: "G", format: (c) => (c.onOff ? String(c.onOff.games) : "-"), value: (c) => c.onOff?.games ?? 0 },
  minutesColumn("onmin", "On Min", (t) => t.on.seconds, false),
  minutesColumn("offmin", "Off Min", (t) => t.off.seconds, false),
  minutesColumn("onoffmin", "On-Off Min", (t) => t.on.seconds - t.off.seconds, true),
  ratingColumn("onortg", "On ORtg", (t) => oRtg(t.on), false),
  ratingColumn("offortg", "Off ORtg", (t) => oRtg(t.off), false),
  ratingColumn("onoffortg", "On-Off ORtg", (t) => diff(oRtg(t.on), oRtg(t.off)), true),
  ratingColumn("ondrtg", "On DRtg", (t) => dRtg(t.on), false, false),
  ratingColumn("offdrtg", "Off DRtg", (t) => dRtg(t.off), false, false),
  ratingColumn("onoffdrtg", "On-Off DRtg", (t) => diff(dRtg(t.on), dRtg(t.off)), true, false),
  ratingColumn("onnetrtg", "On NetRtg", (t) => netRtg(t.on), false),
  ratingColumn("offnetrtg", "Off NetRtg", (t) => netRtg(t.off), false),
  ratingColumn("onoffnetrtg", "On-Off NetRtg", (t) => diff(netRtg(t.on), netRtg(t.off)), true),
];

/** 複数の行（シーズン）の On/Off を足す（通算の行。得点・攻撃回数を足してから割るので、行ごとの率の平均にはならない）。どれも無ければ null */
export function mergeOnOffTotals(list: readonly (OnOffSeasonTotals | null | undefined)[]): OnOffSeasonTotals | null {
  const present = list.filter((x): x is OnOffSeasonTotals => !!x);
  if (present.length === 0) return null;
  const add = (a: OnOffBucket, b: OnOffBucket): OnOffBucket => ({
    seconds: a.seconds + b.seconds,
    ownPts: a.ownPts + b.ownPts,
    oppPts: a.oppPts + b.oppPts,
    ownPoss: a.ownPoss + b.ownPoss,
    oppPoss: a.oppPoss + b.oppPoss,
    ownShooting: Object.fromEntries(Object.entries(a.ownShooting).map(([k, v]) => [k, v + b.ownShooting[k as keyof OnOffBucket["ownShooting"]]])) as OnOffBucket["ownShooting"],
    oppShooting: Object.fromEntries(Object.entries(a.oppShooting).map(([k, v]) => [k, v + b.oppShooting[k as keyof OnOffBucket["oppShooting"]]])) as OnOffBucket["oppShooting"],
  });
  return present.slice(1).reduce((acc, t) => ({ games: acc.games + t.games, on: add(acc.on, t.on), off: add(acc.off, t.off) }), present[0]!);
}
