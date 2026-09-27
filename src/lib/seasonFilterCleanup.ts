import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { postseasonFormat } from "../../shared/postseasonFormat";
import { teamShortName } from "../../shared/teamNames";
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
 * 外したときは、フィルタの近くに短く知らせる。登録区分・出場試合率・ポジション・スタッツの条件などはそのまま残す
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

const DIVISION_LABELS: Record<string, string> = { east: "対東地区", west: "対西地区" };

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

/** そのシーズンで意味が変わるフィルタを外した結果と、知らせる文言。外すものが無ければ null */
export function cleanupForSeason(input: SeasonScopedFilters, scope: SeasonScope): (SeasonScopedFilters & { notices: string[] }) | null {
  const notices: string[] = [];
  let filter = input.filter;
  let clubs = input.clubs;
  let gameType = input.gameType;

  if (clubs && scope.teamIds) {
    const missing = clubs.filter((id) => !scope.teamIds!.has(id));
    if (missing.length > 0) {
      clubs = clubs.filter((id) => scope.teamIds!.has(id));
      notices.push(`${missing.map((id) => teamShortName(id, id)).join("・")}はこのシーズンに在籍していないため、選択から外しました`);
    }
  }
  if (filter.division && (filter.division === "east" || filter.division === "west") && scope.divisions && !scope.divisions.has(filter.division)) {
    notices.push(`${DIVISION_LABELS[filter.division]}はこのシーズンの地区構成に無いため、選択から外しました`);
    filter = { ...filter, division: undefined };
  }
  if (filter.months?.length) {
    const outside = filter.months.filter((m) => !scope.months.has(m));
    if (outside.length > 0) {
      const kept = filter.months.filter((m) => scope.months.has(m));
      notices.push(`${outside.map((m) => `${m}月`).join("・")}はこのシーズンの期間外のため、選択から外しました`);
      filter = { ...filter, months: kept.length > 0 ? kept : undefined };
    }
  }
  if (filter.range.kind === "dateRange") {
    const { start, end } = filter.range;
    const outside = (d: string) => d !== "" && (d < scope.start || d > scope.end);
    if (outside(start) || outside(end)) {
      notices.push(`期間指定（${start || "…"}〜${end || "…"}）はこのシーズンの期間外のため、外しました`);
      filter = { ...filter, range: { kind: "all" } };
    }
  }
  if (gameType && gameType !== "regular" && !scope.postseasonHeld) {
    notices.push("このシーズンはポストシーズンが開催されなかったため、試合種別をレギュラーシーズンに戻しました");
    gameType = "regular";
  }
  return notices.length > 0 ? { filter, clubs, gameType, notices } : null;
}

/**
 * ページで使うフック。シーズンが変わったとき（とページを開いたとき）に1回だけ確かめ、外したものがあれば知らせる文言を返す。
 * 知らせはシーズンを変えるか、×で閉じるまで出す
 */
export function useSeasonFilterCleanup(opts: {
  season: string;
  filter: SituationalFilter;
  setFilter: Dispatch<SetStateAction<SituationalFilter>>;
  clubs?: string[];
  setClubs?: Dispatch<SetStateAction<string[]>>;
  gameType?: SeasonGameTypeFilter;
  setGameType?: Dispatch<SetStateAction<SeasonGameTypeFilter>>;
}): { notices: string[]; dismiss: () => void } {
  const scope = useSeasonScope(opts.season);
  const [notices, setNotices] = useState<string[]>([]);
  const checkedSeasonRef = useRef<string | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (checkedSeasonRef.current !== opts.season) setNotices([]);
  }, [opts.season]);

  useEffect(() => {
    if (!scope || scope.season !== opts.season || checkedSeasonRef.current === opts.season) return;
    checkedSeasonRef.current = opts.season;
    const o = latest.current;
    const result = cleanupForSeason({ filter: o.filter, clubs: o.clubs, gameType: o.gameType }, scope);
    if (!result) return;
    if (result.filter !== o.filter) o.setFilter(result.filter);
    if (o.setClubs && result.clubs && result.clubs !== o.clubs) o.setClubs(result.clubs);
    if (o.setGameType && result.gameType && result.gameType !== o.gameType) o.setGameType(result.gameType);
    setNotices(result.notices);
  }, [scope, opts.season]);

  return { notices, dismiss: () => setNotices([]) };
}
