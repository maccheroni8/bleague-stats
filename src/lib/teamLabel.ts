// スマホ幅（560px以下）ではチーム名を略称にする（CLAUDE.md のルール。2026-09-26）。
// ページのタイトル・見出し（h1〜h4）以外のチーム名はすべてこれか ResponsiveTeamName を通す
import { shortenTeamNamesInText, teamShortName } from "../../shared/teamNames";
import type { TeamHistoryEntry } from "../../shared/types";
import { useMediaQuery } from "./useMediaQuery";

export const NARROW_QUERY = "(max-width: 560px)";

export function useNarrow(): boolean {
  return useMediaQuery(NARROW_QUERY);
}

/** 画面幅に応じたチーム名を返す関数。teamId が無い場合は名前だけで略称を探す */
export function useTeamLabel(): (teamId: string | null | undefined, name: string) => string {
  const narrow = useNarrow();
  return (teamId, name) => (narrow ? (teamId ? teamShortName(teamId, name) : shortenTeamNamesInText(name)) : name);
}

/** 画面幅に応じて、文章の中のチーム名を略称にする関数 */
export function useTeamText(): (text: string) => string {
  const narrow = useNarrow();
  return (text) => (narrow ? shortenTeamNamesInText(text) : text);
}

/**
 * そのシーズンのクラブ名（team-history.json の名称変更履歴から。2026-09-26）。過去のシーズンの記録を出す一覧で、
 * 今の名称ではなく当時の名称（と、スマホ幅では当時の略称）を出すために使う。履歴に無いクラブ・未読み込みのときは fallback
 */
export function teamNameInSeason(
  history: readonly TeamHistoryEntry[] | null | undefined,
  teamId: string,
  season: string,
  fallback: string,
): string {
  const names = history?.find((h) => h.teamId === teamId)?.names;
  if (!names || names.length === 0) return fallback;
  const hit = names.find((n) => (!n.fromSeason || n.fromSeason <= season) && (!n.toSeason || season <= n.toSeason));
  return hit?.name ?? fallback;
}
