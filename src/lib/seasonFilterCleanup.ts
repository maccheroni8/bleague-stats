import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { postseasonFormat } from "../../shared/postseasonFormat";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { fetchDivisionHistory, fetchGameSummaries, fetchSchedule, fetchTeams } from "./data";
import { useJsonData } from "./useJsonData";
import type { SituationalFilter } from "./situational";

/**
 * シーズンを変えたとき（とURLを直接開いたとき）に、そのシーズンでは意味が変わるフィルタを外す（DESIGN.md 164章）。
 * フィルタはURLに持ち、シーズンを変えても残す（163章）が、次のものはシーズンによって指す対象が変わるため例外にする。
 * - クラブ: そのシーズンに在籍していないクラブ
 * - 対戦地区: そのシーズンの地区構成に無い地区（同地区・他地区は外さない）
 * - 月: そのシーズンに試合が1つも無い月
 * - 期間指定: 始まり・終わりのどちらかの日付が、そのシーズンの期間（最初の試合〜最後の試合。今後の日程を含む）の外
 * - 試合種別のポストシーズン・合算: ポストシーズンが開催されなかったシーズン
 * 外したことは知らせず、表のタイトルの下の行と「適用中」の表示で分かる形にする（165章）。登録区分・出場試合率・ポジション・スタッツの条件などはそのまま残す
 */

export interface SeasonScope {
  season: string;
  start: string;
  end: string;
  months: Set<number>;
  /** 地区構成（分からなければ null＝地区は外さない） */
  divisions: Set<string> | null;
  /** 在籍クラブ（分からなければ null＝クラブは外さない） */
  teamIds: Set<string> | null;
  postseasonHeld: boolean;
}

/** シーズンの期間・月・地区構成・在籍クラブを読む（読み込み中は null） */
export function useSeasonScope(season: string): SeasonScope | null {
  // 読み込み中は前のシーズンのデータが残るため、どのシーズンのデータかを添えて読み、今のシーズンと一致するときだけ使う
  const { data } = useJsonData(
    () =>
      Promise.all([
        fetchGameSummaries(season).catch(() => []),
        fetchSchedule(season).catch(() => null),
        fetchDivisionHistory().catch(() => null),
        fetchTeams(season).catch(() => []),
      ]).then(([summaries, schedule, history, teams]) => ({ season, summaries, schedule, history, teams })),
    [season],
  );
  return useMemo(() => {
    if (!data || data.season !== season) return null;
    const { summaries, schedule, history, teams } = data;
    const dates = [...summaries.map((g) => g.date), ...(schedule?.upcomingGames ?? []).map((g) => g.date)].filter(Boolean).sort();
    if (dates.length === 0) return null;
    const seasonDivisions = history?.premier?.[season];
    return {
      season,
      start: dates[0]!,
      end: dates[dates.length - 1]!,
      months: new Set(dates.map((d) => Number(d.slice(5, 7)))),
      divisions: seasonDivisions ? new Set<string>(Object.values(seasonDivisions)) : null,
      teamIds: teams.length > 0 ? new Set(teams.map((t) => t.teamId)) : null,
      postseasonHeld: postseasonFormat(season) !== null,
    };
  }, [season, data]);
}

export interface SeasonScopedFilters {
  filter: SituationalFilter;
  clubs?: string[];
  gameType?: SeasonGameTypeFilter;
}

/** そのシーズンで意味が変わるフィルタを外した結果。外すものが無ければ null */
export function cleanupForSeason(input: SeasonScopedFilters, scope: SeasonScope): SeasonScopedFilters | null {
  let changed = false;
  let filter = input.filter;
  let clubs = input.clubs;
  let gameType = input.gameType;

  if (clubs && scope.teamIds) {
    const kept = clubs.filter((id) => scope.teamIds!.has(id));
    if (kept.length < clubs.length) {
      clubs = kept;
      changed = true;
    }
  }
  if (filter.division && (filter.division === "east" || filter.division === "west") && scope.divisions && !scope.divisions.has(filter.division)) {
    filter = { ...filter, division: undefined };
    changed = true;
  }
  if (filter.months?.length) {
    const kept = filter.months.filter((m) => scope.months.has(m));
    if (kept.length < filter.months.length) {
      filter = { ...filter, months: kept.length > 0 ? kept : undefined };
      changed = true;
    }
  }
  if (filter.range.kind === "dateRange") {
    const { start, end } = filter.range;
    const outside = (d: string) => d !== "" && (d < scope.start || d > scope.end);
    if (outside(start) || outside(end)) {
      filter = { ...filter, range: { kind: "all" } };
      changed = true;
    }
  }
  if (gameType && gameType !== "regular" && !scope.postseasonHeld) {
    gameType = "regular";
    changed = true;
  }
  return changed ? { filter, clubs, gameType } : null;
}

/**
 * ページで使うフック。シーズンが変わったとき（とページを開いたとき）に1回だけ確かめ、そのシーズンに無いものを外す
 */
export function useSeasonFilterCleanup(opts: {
  season: string;
  filter: SituationalFilter;
  setFilter: Dispatch<SetStateAction<SituationalFilter>>;
  clubs?: string[];
  setClubs?: Dispatch<SetStateAction<string[]>>;
  gameType?: SeasonGameTypeFilter;
  setGameType?: Dispatch<SetStateAction<SeasonGameTypeFilter>>;
}): void {
  const scope = useSeasonScope(opts.season);
  const checkedSeasonRef = useRef<string | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!scope || scope.season !== opts.season || checkedSeasonRef.current === opts.season) return;
    checkedSeasonRef.current = opts.season;
    const o = latest.current;
    const result = cleanupForSeason({ filter: o.filter, clubs: o.clubs, gameType: o.gameType }, scope);
    if (!result) return;
    if (result.filter !== o.filter) o.setFilter(result.filter);
    if (o.setClubs && result.clubs && result.clubs !== o.clubs) o.setClubs(result.clubs);
    if (o.setGameType && result.gameType && result.gameType !== o.gameType) o.setGameType(result.gameType);
  }, [scope, opts.season]);

}
