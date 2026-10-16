import type { FinalAffiliation, MediaAsset, MediaBinding, MediaCatalog, MediaRequest, MediaResolution } from "./mediaCatalog.ts";
import { confirmedBinding, validateMediaCatalog, validMediaDate, validMediaSeason, validMediaTimestamp } from "./mediaCatalogValidation.ts";
import { exactMediaBindings } from './mediaExactMatch.ts';

/** 時計・ネットワーク・ファイルシステムに依存しない画像選択。台帳の不整合時は全体をfail closedにする。 */
export function resolveMedia(
  request: MediaRequest,
  catalog: MediaCatalog,
  affiliations: readonly FinalAffiliation[] = [],
): MediaResolution {
  let targetTeamId = request.teamId ?? null;
  const targetSeason = request.context === "career" ? null : request.season ?? null;
  const missing = (reason: Extract<MediaResolution, { status: "missing" }>["reason"]): MediaResolution => ({
    status: "missing", reason, targetSeason, targetTeamId, canExport: false, canRedistribute: false,
  });
  const nonempty = (value: string | undefined) => !!value?.trim();
  if (!["player", "team"].includes(request.kind) || !["season", "team", "game", "career"].includes(request.context) ||
      (request.kind === "player" && !nonempty(request.playerId)) ||
      (request.kind === "team" && (!nonempty(request.teamId) || request.playerId !== undefined)) ||
      (request.teamId !== undefined && !nonempty(request.teamId)) ||
      (request.currentTeamId !== undefined && !nonempty(request.currentTeamId)) ||
      (request.context !== "career" && (!request.season || !validMediaSeason(request.season))) ||
      (request.context === "career" && (request.season !== undefined || request.gameDate !== undefined)) ||
      (request.context === "career" && request.kind === "player" && request.teamId !== undefined) ||
      (request.currentSeason !== undefined && !validMediaSeason(request.currentSeason)) ||
      (request.gameDate !== undefined && (request.context !== "game" || !validMediaDate(request.gameDate))) ||
      (["game", "team"].includes(request.context) && !nonempty(request.teamId)) ||
      (request.context === "career" && !request.currentSeason) ||
      (request.season && request.currentSeason && request.season > request.currentSeason)) return missing("invalid-input");

  if (validateMediaCatalog(catalog).length > 0) return missing("invalid-catalog");
  if (request.kind === "player" && request.context === "season") {
    const rows = affiliations.filter(a => a.playerId === request.playerId && a.season === request.season);
    // 複数の主張がある場合は確認日時順で勝手に選ばない。
    const final = rows.length === 1 ? rows[0] : undefined;
    if (!final || final.status !== "confirmed" || !nonempty(final.teamId) || !nonempty(final.evidence) ||
        !validMediaTimestamp(final.checkedAt)) return missing("unconfirmed-affiliation");
    if (targetTeamId !== null && targetTeamId !== final.teamId) return missing("invalid-input");
    targetTeamId = final.teamId;
  }

  const assets = new Map(catalog.assets.map(a => [a.assetId, a]));
  const eligible = catalog.bindings.filter(b => {
    const a = assets.get(b.assetId)!;
    return b.subject.kind === request.kind &&
      (request.kind === "player" ? b.subject.playerId === request.playerId : b.subject.teamId === request.teamId) &&
      confirmedBinding(b) && a.rights.status === "confirmed" && a.rights.web === "granted";
  });
  const resolved = (b: MediaBinding, status: "exact" | "fallback" | "representative"): MediaResolution => {
    const a: MediaAsset = assets.get(b.assetId)!;
    const isRepresentative = status === "representative" || (request.kind === "player" && request.context === "season");
    const targetDate = request.gameDate ?? null;
    const actualPeriod = b.period ? { ...b.period } : null;
    return {
      status, assetId: a.assetId, path: a.path, targetSeason, actualSeason: b.season,
      targetTeamId, actualTeamId: b.subject.teamId, isRepresentative,
      targetDate, actualPeriod,
      annotation: status !== "exact" || isRepresentative ? {
        type: status === "fallback" ? "fallback" : "representative",
        targetSeason, actualSeason: b.season, targetTeamId, actualTeamId: b.subject.teamId,
        targetDate, actualPeriod: actualPeriod ? { ...actualPeriod } : null,
      } : null,
      // SNS等へ再配布する画像書き出しを想定。両方の明示的許可が必要。
      canExport: a.rights.export === "granted" && a.rights.redistribute === "granted",
      canRedistribute: a.rights.redistribute === "granted",
    };
  };

  /** 最新季が同じ場合、確認済みの適用開始日で比較可能なときだけ最新を選ぶ。 */
  const latest = (rows: readonly MediaBinding[]): MediaBinding | "ambiguous" | undefined => {
    const maxSeason = rows.reduce((max, b) => b.season > max ? b.season : max, "");
    const candidates = rows.filter(b => b.season === maxSeason);
    if (candidates.length <= 1) return candidates[0];
    if (candidates.some(b => !b.period?.from)) return "ambiguous";
    const maxFrom = candidates.reduce((max, b) => b.period!.from! > max ? b.period!.from! : max, "");
    const newest = candidates.filter(b => b.period!.from === maxFrom);
    return newest.length === 1 ? newest[0] : "ambiguous";
  };

  if (request.context === "career") {
    // 最新の所属を仮定せず、使用年代が確認された画像から選択。未来季は対象外。
    const selected = latest(eligible.filter(b => b.season <= request.currentSeason!));
    if (selected === "ambiguous") return missing("ambiguous");
    return selected ? resolved(selected, "representative") : missing("no-eligible-image");
  }

  let exact = exactMediaBindings(eligible, request, targetTeamId);
  if (request.gameDate) {
    exact = exact.filter(b => (!b.period?.from || b.period.from <= request.gameDate!) &&
      (!b.period?.to || b.period.to >= request.gameDate!));
  } else if (exact.some(b => b.period?.from || b.period?.to) && !(request.context === "team" && exact.length === 1)) {
    // チーム別で厳密一致が1件なら期間を保持して採用する。複数候補や日付なしの試合では日付を推測しない。
    // シーズン全体では確認済み最終所属の最新を代表にできる。
    if (request.context !== "season") return missing("ambiguous");
    const selected = latest(exact);
    if (selected === "ambiguous") return missing("ambiguous");
    exact = selected ? [selected] : [];
  }
  if (exact.length > 1) return missing("ambiguous");
  if (exact[0]) return resolved(exact[0], "exact");

  if (request.allowFallback !== true) return missing("no-eligible-image");
  if (!request.currentSeason || (request.kind === "player" && !request.currentTeamId)) return missing("invalid-input");
  const fallbackTeam = request.kind === "player" ? request.currentTeamId : request.teamId;
  // 今季の写真がまだ無い場合も、明示された現在所属の最新の確認済み写真を利用できる。
  // 写真の実際のシーズンは保持し、要求した過去シーズンのexactには昇格させない。
  const selected = latest(eligible.filter(b => b.season <= request.currentSeason! && b.subject.teamId === fallbackTeam));
  if (selected === "ambiguous") return missing("ambiguous");
  return selected ? resolved(selected, "fallback") : missing("no-eligible-image");
}
