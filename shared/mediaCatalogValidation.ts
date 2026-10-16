import type { MediaBinding, MediaCatalog, MediaPeriod, MediaSubject } from "./mediaCatalog.ts";

export interface MediaIssue { code: string; location: string; message: string }
/** 実ファイル検証は任意。純粋な検証に、読み取り側が観測したハッシュを渡す。 */
export interface MediaFileObservation { path: string; sha256: string }

export function validMediaSeason(value: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return !!m && Number(m[1]) >= 1000 && Number(m[2]) === (Number(m[1]) + 1) % 100;
}
export function validMediaDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}
export function validMediaTimestamp(value: string | undefined): boolean {
  return !!value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value) &&
    validMediaDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
export function validMediaPath(value: string): boolean {
  return /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*\.(?:webp|png|jpg|jpeg|avif)$/.test(value) &&
    value.split("/").every(p => p !== "." && p !== "..");
}
export function sameMediaSubject(a: MediaSubject, b: MediaSubject): boolean {
  return a.kind === b.kind && a.teamId === b.teamId && a.playerId === b.playerId;
}
export function mediaPeriodsOverlap(a: MediaPeriod = {}, b: MediaPeriod = {}): boolean {
  return (a.from ?? "0000-01-01") <= (b.to ?? "9999-12-31") &&
    (b.from ?? "0000-01-01") <= (a.to ?? "9999-12-31");
}
export function confirmedBinding(b: MediaBinding): boolean {
  return b.verification.chronology === "confirmed" && b.verification.affiliation === "confirmed";
}

/** 型付き台帳の意味的検証。任意のJSONをこの型へ無検証でcastするAPIではない。 */
export function validateMediaCatalog(
  catalog: MediaCatalog,
  files?: readonly MediaFileObservation[],
): MediaIssue[] {
  const issues: MediaIssue[] = [];
  const add = (code: string, location: string, message: string) => issues.push({ code, location, message });
  const nonempty = (v: string | undefined) => typeof v === "string" && v.trim().length > 0;
  const subject = (s: MediaSubject, loc: string) => {
    if (!nonempty(s.teamId) || (s.kind === "player" && !nonempty(s.playerId)) ||
        (s.kind === "team" && s.playerId !== undefined) || !["player", "team"].includes(s.kind)) {
      add("invalid-subject", loc, "種別・選手ID・チームIDの組み合わせが不正です");
    }
  };
  if (catalog.schemaVersion !== 1) add("schema-version", "schemaVersion", "未対応の台帳形式です");
  const assets = new Map(catalog.assets.map(a => [a.assetId, a]));
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const a of catalog.assets) {
    const loc = `assets.${a.assetId}`;
    if (!nonempty(a.assetId) || ids.has(a.assetId)) add("duplicate-asset", loc, "画像IDが空または重複しています");
    ids.add(a.assetId);
    subject(a.subject, loc);
    if (!validMediaPath(a.path)) add("invalid-path", loc, "安全な画像相対パスではありません");
    if (paths.has(a.path)) add("duplicate-path", loc, "同一の画像実体は1つのassetIdで管理してください");
    paths.add(a.path);
    if (!/^[a-f0-9]{64}$/.test(a.sha256)) add("invalid-hash", loc, "SHA-256は小文字16進64桁です");
    if (!nonempty(a.source.reference) || !validMediaTimestamp(a.source.checkedAt)) add("invalid-source", loc, "取得元と確認日時が必要です");
    const r = a.rights;
    if (!["confirmed", "unknown", "denied", "revoked"].includes(r.status) ||
        [r.web, r.export, r.redistribute].some(p => !["granted", "denied", "unknown"].includes(p))) {
      add("invalid-rights", loc, "権利状態が不正です");
    }
    if ((r.status !== "confirmed" && [r.web, r.export, r.redistribute].includes("granted")) ||
        (r.status === "confirmed" && (!nonempty(r.evidence) || !validMediaTimestamp(r.checkedAt)))) {
      add("unsubstantiated-rights", loc, "許可設定には確認済みの権利根拠と確認日時が必要です");
    }
    if (files) {
      const observed = files.filter(f => f.path === a.path);
      if (observed.length !== 1) add("file-path-mismatch", loc, "画像パスに対応する実ファイルが一意に見つかりません");
      else if (observed[0]!.sha256 !== a.sha256) add("file-hash-mismatch", loc, "実ファイルのハッシュが一致しません");
    }
  }
  ids.clear();
  for (const [index, b] of catalog.bindings.entries()) {
    const loc = `bindings.${b.bindingId}`;
    if (!nonempty(b.bindingId) || ids.has(b.bindingId)) add("duplicate-binding", loc, "対応IDが空または重複しています");
    ids.add(b.bindingId);
    subject(b.subject, loc);
    const a = assets.get(b.assetId);
    if (!a) add("unknown-asset", loc, "参照先の画像IDが存在しません");
    else if (!sameMediaSubject(a.subject, b.subject)) add("subject-mismatch", loc, "画像実体と対応表の種別・選手ID・チームIDが一致しません");
    if (!validMediaSeason(b.season)) add("invalid-season", loc, "シーズン形式または終了年が不正です");
    const p = b.period;
    if (p && ((p.from !== undefined && !validMediaDate(p.from)) ||
        (p.to !== undefined && !validMediaDate(p.to)) || (p.from && p.to && p.from > p.to))) {
      add("invalid-period", loc, "適用期間の日付または前後関係が不正です");
    }
    const v = b.verification;
    if (![v.chronology, v.affiliation].every(s => ["confirmed", "unverified"].includes(s)) ||
        ([v.chronology, v.affiliation].includes("confirmed") && (!nonempty(v.evidence) || !validMediaTimestamp(v.checkedAt)))) {
      add("invalid-verification", loc, "年代・所属の確認には根拠と確認日時が必要です");
    }
    for (const prev of catalog.bindings.slice(0, index)) {
      if (sameMediaSubject(prev.subject, b.subject) && prev.season === b.season && mediaPeriodsOverlap(prev.period, b.period)) {
        add("overlapping-binding", loc, "同一対象・シーズンの適用期間が重複しています（両端を含む）");
      }
    }
  }
  return issues;
}
