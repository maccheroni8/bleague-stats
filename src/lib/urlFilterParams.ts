import { SEASON_GAME_TYPE_KEYS, type SeasonGameTypeFilter } from "../../shared/gameType";
import { CLASSIFICATION_GROUP_OPTIONS, type ClassificationGroupFilter, type PlayerGroupFilter } from "./classificationFilter";
import { SEASON_BOX_PERIOD_OPTIONS, type SeasonDisplayMode } from "./playerSeasonBoxscore";
import type { PeriodRangeValue } from "./periodRange";
import type { TeamPerspective } from "./teamStatsColumns";
import type { LeagueVenue } from "./conditionLabels";
import { CLUTCH_MEASURES, CLUTCH_WINDOWS, PAIR_UNITS, type ClutchMeasure, type ClutchWindowKey, type PairUnit } from "./clutchQuery";
import { enumParam, listParam } from "./urlState";

/**
 * 個人一覧・チーム一覧・ランキングで共通のフィルタのURLのキー（DESIGN.md 163章）。
 * mode（表示: tot＝合計）・gt（試合種別: po＝ポストシーズン、all＝合算）・v（視点）・q（Q別・前後半）・cls（登録区分: jp／intl）・
 * pos（ポジション）・club（クラブ）
 */
export const DISPLAY_MODE_PARAM = enumParam<SeasonDisplayMode>("mode", ["perGame", "total", "per30"], "perGame", { total: "tot", per30: "p30" });

export const GAME_TYPE_PARAM = enumParam<SeasonGameTypeFilter>("gt", SEASON_GAME_TYPE_KEYS, "regular", {
  regular: "reg",
  playoff: "po",
  both: "all",
});

export const PERSPECTIVE_PARAM = enumParam<TeamPerspective>("v", ["own", "opp", "diff"], "own");

export const PERIOD_PARAM = enumParam<PeriodRangeValue>(
  "q",
  SEASON_BOX_PERIOD_OPTIONS.map((o) => o.value),
  "all",
);

export const CLASSIFICATION_PARAM = enumParam<ClassificationGroupFilter>("cls", ["all", ...CLASSIFICATION_GROUP_OPTIONS], "all", {
  日本人: "jp",
  "外国籍・帰化・アジア": "intl",
});

/** 登録区分＋ルーキー（cls=jp／intl／rookie）。ランキングのシーズン成績（個人）と全選手スタッツで使う（DESIGN.md 217章） */
export const PLAYER_GROUP_PARAM = enumParam<PlayerGroupFilter>("cls", ["all", ...CLASSIFICATION_GROUP_OPTIONS, "rookie"], "all", {
  日本人: "jp",
  "外国籍・帰化・アジア": "intl",
});

export const POSITION_PARAM = listParam("pos");
export const CLUB_PARAM = listParam("club");

/** 記録の範囲（歴代／シーズン）。選手・チームの記録タブとランキングの1試合記録で共通（DESIGN.md 190章） */
export type RecordsScope = "allTime" | "season";
export const RECORDS_SCOPE_PARAM = enumParam<RecordsScope>("scope", ["allTime", "season"], "allTime", { allTime: "all" });

/** 歴代の記録の会場（トータル／ホーム／アウェイ）。個人・チームの記録タブとランキングの通算記録で共通 */
export const VENUE_PARAM = enumParam<LeagueVenue>("venue", ["total", "home", "away"], "total");

/** ランキング > 個人 > 勝負所: 窓（cw＝残り5・2・1分。初期値2）と種類（cm＝勝ち越し弾・同点弾・決勝弾）。アシストペアの単位（u＝1試合・シーズン・通算。DESIGN.md 221章） */
export const CLUTCH_WINDOW_PARAM = enumParam<ClutchWindowKey>("cw", CLUTCH_WINDOWS, "2");
export const CLUTCH_MEASURE_PARAM = enumParam<ClutchMeasure>("cm", CLUTCH_MEASURES, "goAhead", { goAhead: "ga", winner: "win" });
export const PAIR_UNIT_PARAM = enumParam<PairUnit>("u", PAIR_UNITS, "season");
