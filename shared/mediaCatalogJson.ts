/** 外部JSONの境界。構造を検査し、新しい型付きオブジェクトを組み立ててから意味的検証する。 */
import type { MediaAsset, MediaBinding, MediaCatalog, MediaRights, MediaSubject } from "./mediaCatalog.ts";
import { validateMediaCatalog, validMediaDate, type MediaIssue } from "./mediaCatalogValidation.ts";

export type MediaCatalogParseResult =
  | { ok: true; catalog: MediaCatalog }
  | { ok: false; issues: MediaIssue[] };

class StructureError extends Error {
  issue: MediaIssue;
  constructor(location: string, message: string) {
    super(message);
    this.issue = { code: "invalid-structure", location, message };
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function object(value: unknown, location: string, fields: readonly string[]): Record<string, unknown> {
  if (!record(value)) throw new StructureError(location, "JSONオブジェクトが必要です");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new StructureError(location, "JSONの項目名は文字列である必要があります");
    if (!fields.includes(key)) throw new StructureError(`${location}.${key}`, "未定義の項目です");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) {
      throw new StructureError(`${location}.${key}`, "アクセサーではなくJSONの値が必要です");
    }
  }
  return value;
}
function text(value: unknown, location: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new StructureError(location, "空でない文字列が必要です");
  return value;
}
function enumeration<T extends string>(value: unknown, allowed: readonly T[], location: string): T {
  const match = allowed.find(item => item === value);
  if (match === undefined) throw new StructureError(location, `許容値: ${allowed.join(", ")}`);
  return match;
}
function timestamp(value: unknown, location: string): string {
  const result = text(value, location);
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/.test(result) ||
      !validMediaDate(result.slice(0, 10))) throw new StructureError(location, "実在するUTC日時（ISO 8601、Z終端）が必要です");
  return result;
}
function date(value: unknown, location: string): string {
  const result = text(value, location);
  if (!validMediaDate(result)) throw new StructureError(location, "実在する日付（YYYY-MM-DD）が必要です");
  return result;
}
function optional(o: Record<string, unknown>, key: string, loc: string, read = text): string | undefined {
  return Object.hasOwn(o, key) ? read(o[key], `${loc}.${key}`) : undefined;
}
function list<T>(value: unknown, loc: string, read: (value: unknown, loc: string) => T): T[] {
  if (!Array.isArray(value)) throw new StructureError(loc, "配列が必要です");
  return Array.from(value, (item: unknown, index) => read(item, `${loc}[${index}]`));
}
function subject(value: unknown, loc: string): MediaSubject {
  const o = object(value, loc, ["kind", "teamId", "playerId"]);
  const kind = enumeration(o.kind, ["player", "team"] as const, `${loc}.kind`);
  const teamId = text(o.teamId, `${loc}.teamId`);
  if (kind === "player") return { kind, teamId, playerId: text(o.playerId, `${loc}.playerId`) };
  if (Object.hasOwn(o, "playerId")) throw new StructureError(`${loc}.playerId`, "チームロゴにplayerIdは指定できません");
  return { kind, teamId };
}
function rights(value: unknown, loc: string): MediaRights {
  const o = object(value, loc, ["status", "web", "export", "redistribute", "evidence", "checkedAt"]);
  const permissions = ["granted", "denied", "unknown"] as const;
  return {
    status: enumeration(o.status, ["confirmed", "unknown", "denied", "revoked"] as const, `${loc}.status`),
    web: enumeration(o.web, permissions, `${loc}.web`),
    export: enumeration(o.export, permissions, `${loc}.export`),
    redistribute: enumeration(o.redistribute, permissions, `${loc}.redistribute`),
    evidence: optional(o, "evidence", loc), checkedAt: optional(o, "checkedAt", loc, timestamp),
  };
}
function asset(value: unknown, loc: string): MediaAsset {
  const o = object(value, loc, ["assetId", "subject", "path", "sha256", "source", "rights"]);
  const s = object(o.source, `${loc}.source`, ["reference", "checkedAt"]);
  return {
    assetId: text(o.assetId, `${loc}.assetId`), subject: subject(o.subject, `${loc}.subject`),
    path: text(o.path, `${loc}.path`), sha256: text(o.sha256, `${loc}.sha256`),
    source: { reference: text(s.reference, `${loc}.source.reference`), checkedAt: timestamp(s.checkedAt, `${loc}.source.checkedAt`) },
    rights: rights(o.rights, `${loc}.rights`),
  };
}
function binding(value: unknown, loc: string): MediaBinding {
  const o = object(value, loc, ["bindingId", "assetId", "subject", "season", "period", "verification"]);
  const v = object(o.verification, `${loc}.verification`, ["chronology", "affiliation", "evidence", "checkedAt"]);
  const confirmations = ["confirmed", "unverified"] as const;
  const result: MediaBinding = {
    bindingId: text(o.bindingId, `${loc}.bindingId`), assetId: text(o.assetId, `${loc}.assetId`),
    subject: subject(o.subject, `${loc}.subject`), season: text(o.season, `${loc}.season`),
    verification: {
      chronology: enumeration(v.chronology, confirmations, `${loc}.verification.chronology`),
      affiliation: enumeration(v.affiliation, confirmations, `${loc}.verification.affiliation`),
      evidence: optional(v, "evidence", `${loc}.verification`), checkedAt: optional(v, "checkedAt", `${loc}.verification`, timestamp),
    },
  };
  if (Object.hasOwn(o, "period")) {
    const p = object(o.period, `${loc}.period`, ["from", "to"]);
    result.period = { from: optional(p, "from", `${loc}.period`, date), to: optional(p, "to", `${loc}.period`, date) };
  }
  return result;
}

/** unknownからの構造・列挙値・日時・意味的検証。型アサーションで台帳へ昇格しない。 */
export function parseMediaCatalog(value: unknown): MediaCatalogParseResult {
  try {
    const o = object(value, "$", ["schemaVersion", "assets", "bindings"]);
    if (o.schemaVersion !== 1) throw new StructureError("$.schemaVersion", "schemaVersionは1である必要があります");
    const catalog: MediaCatalog = {
      schemaVersion: 1, assets: list(o.assets, "$.assets", asset), bindings: list(o.bindings, "$.bindings", binding),
    };
    const issues = validateMediaCatalog(catalog);
    return issues.length ? { ok: false, issues } : { ok: true, catalog };
  } catch (error) {
    return { ok: false, issues: [error instanceof StructureError ? error.issue : {
      code: "invalid-structure", location: "$", message: "JSONデータを安全に読み取れません",
    }] };
  }
}

export function parseMediaCatalogText(json: string): MediaCatalogParseResult {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { return { ok: false, issues: [{ code: "invalid-json", location: "$", message: "JSONの構文が不正です" }] }; }
  return parseMediaCatalog(value);
}
