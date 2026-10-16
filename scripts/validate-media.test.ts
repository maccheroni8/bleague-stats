/** 架空のID・画像台帳だけで実行。node --experimental-strip-types --test scripts/validate-media.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import type { FinalAffiliation, MediaAsset, MediaBinding, MediaCatalog, MediaRequest, MediaSubject } from "../shared/mediaCatalog.ts";
import { resolveMedia } from "../shared/mediaResolver.ts";
import { validateMediaCatalog } from "../shared/mediaCatalogValidation.ts";
import { validateMediaFiles } from "./lib/mediaFileValidation.ts";

const checkedAt = "2032-10-01T00:00:00Z";
const rights: MediaAsset["rights"] = {
  status: "confirmed", web: "granted", export: "granted", redistribute: "granted",
  evidence: "fictional permission for tests only", checkedAt,
};
const player = (teamId = "fictional-A"): Extract<MediaSubject, { kind: "player" }> => ({ kind: "player", playerId: "fictional-player", teamId });
const team = (): MediaSubject => ({ kind: "team", teamId: "fictional-A" });
function entry(id: string, season: string, subject: MediaSubject = player()): { asset: MediaAsset; binding: MediaBinding } {
  return {
    asset: { assetId: id, subject, path: `media/${id}.webp`, sha256: "a".repeat(64), source: { reference: "fixture:synthetic", checkedAt }, rights: { ...rights } },
    binding: { bindingId: `binding-${id}`, assetId: id, subject, season,
      verification: { chronology: "confirmed", affiliation: "confirmed", evidence: "fictional season record", checkedAt } },
  };
}
function catalog(...entries: ReturnType<typeof entry>[]): MediaCatalog {
  return { schemaVersion: 1, assets: entries.map(e => e.asset), bindings: entries.map(e => e.binding) };
}
const past = () => entry("past", "2030-31");
const current = () => entry("current", "2032-33", player("fictional-B"));
const query = (patch: Partial<MediaRequest> = {}): MediaRequest => ({ kind: "player", context: "team", playerId: "fictional-player", teamId: "fictional-A", season: "2030-31", ...patch });
const final: FinalAffiliation = { playerId: "fictional-player", teamId: "fictional-B", season: "2030-31", status: "confirmed", evidence: "fixture:final-affiliation", checkedAt };
function expectAsset(request: MediaRequest, data: MediaCatalog, status: "exact" | "fallback" | "representative", assetId: string, affiliations: FinalAffiliation[] = []) {
  const r = resolveMedia(request, data, affiliations);
  assert.equal(r.status, status);
  assert.notEqual(r.status, "missing");
  assert.equal(r.assetId, assetId);
  return r;
}
function missing(request: MediaRequest, data: MediaCatalog, reason?: string, affiliations: FinalAffiliation[] = []) {
  const r = resolveMedia(request, data, affiliations);
  assert.equal(r.status, "missing");
  if (r.status === "missing" && reason) assert.equal(r.reason, reason);
  assert.equal(r.canExport, false);
}
const fallback = () => query({ allowFallback: true, currentSeason: "2032-33", currentTeamId: "fictional-B" });
const career = () => query({ context: "career", season: undefined, teamId: undefined, currentSeason: "2032-33" });

test("01 同じ選手のシーズンを切り替える", () => {
  const data = catalog(past(), entry("next", "2031-32"));
  expectAsset(query(), data, "exact", "past");
  expectAsset(query({ season: "2031-32" }), data, "exact", "next");
});
test("02 同じシーズンの異なる所属チームを区別する", () => {
  const data = catalog(past(), entry("transferred", "2030-31", player("fictional-B")));
  expectAsset(query(), data, "exact", "past");
  expectAsset(query({ teamId: "fictional-B" }), data, "exact", "transferred");
});
test("03 シーズン全体は独立した最終所属記録を使う", () => {
  const data = catalog(past(), entry("transferred", "2030-31", player("fictional-B")));
  const r = expectAsset(query({ context: "season", teamId: undefined }), data, "exact", "transferred", [final]);
  assert.equal(r.targetTeamId, "fictional-B");
  assert.equal(r.isRepresentative, true);
});
test("04 試合は最終所属ではなく試合のチームを使う", () => {
  expectAsset(query({ context: "game", gameDate: "2030-10-01" }), catalog(past(), entry("transferred", "2030-31", player("fictional-B"))), "exact", "past", [final]);
});
test("05 過去写真がないとき指定された現在画像へfallback", () => {
  expectAsset(fallback(), catalog(current()), "fallback", "current");
});
test("06 fallbackは実際のシーズンとチームと注記情報を保持", () => {
  const r = expectAsset(fallback(), catalog(current()), "fallback", "current");
  assert.equal(r.actualSeason, "2032-33");
  assert.equal(r.targetSeason, "2030-31");
  assert.equal(r.actualTeamId, "fictional-B");
  assert.equal(r.targetTeamId, "fictional-A");
  assert.equal(r.annotation?.type, "fallback");
});
test("07 通算は最新の確認済み写真を使用し、未確認の新しい画像を除外", () => {
  const unverified = entry("unverified", "2032-33");
  unverified.binding.verification.chronology = "unverified";
  expectAsset(career(), catalog(past(), entry("verified", "2031-32"), unverified), "representative", "verified");
});
test("08 通算は対象シーズンを捏造せず代表画像と注記を返す", () => {
  const r = expectAsset(career(), catalog(current()), "representative", "current");
  assert.equal(r.targetSeason, null);
  assert.equal(r.actualSeason, "2032-33");
  assert.equal(r.isRepresentative, true);
  assert.equal(r.annotation?.type, "representative");
});
test("09 ロゴもシーズンで切り替える", () => {
  const data = catalog(entry("old-logo", "2030-31", team()), entry("new-logo", "2032-33", team()));
  expectAsset(query({ kind: "team", playerId: undefined }), data, "exact", "old-logo");
  expectAsset(query({ kind: "team", playerId: undefined, season: "2032-33" }), data, "exact", "new-logo");
});
test("10 ロゴも現在季へのfallbackと実シーズンを保持", () => {
  const r = expectAsset(query({ kind: "team", playerId: undefined, currentSeason: "2032-33", allowFallback: true }), catalog(entry("logo", "2032-33", team())), "fallback", "logo");
  assert.equal(r.actualSeason, "2032-33");
});
for (const status of ["unknown", "denied", "revoked"] as const) {
  test(`11 権利${status}の画像はexact/fallback/通算すべてで返さない`, () => {
    const p = past(), c = current();
    for (const e of [p, c]) e.asset.rights = { status, web: "unknown", export: "unknown", redistribute: "unknown" };
    const data = catalog(p, c);
    for (const q of [query(), fallback(), career()]) missing(q, data, "no-eligible-image");
  });
}
test("12 空の台帳でmissing", () => missing(query(), catalog(), "no-eligible-image"));
test("13 不整合台帳を検出し解決はfail closed", () => {
  const e = past(); e.binding.assetId = "missing";
  assert.ok(validateMediaCatalog(catalog(e)).some(i => i.code === "unknown-asset"));
  missing(query(), catalog(e), "invalid-catalog");
});
test("14 同季内の適用期間・境界日・期間外", () => {
  const a = past(), b = entry("later", "2030-31");
  a.binding.period = { from: "2030-09-01", to: "2030-12-31" };
  b.binding.period = { from: "2031-01-01", to: "2031-06-30" };
  const data = catalog(a, b);
  expectAsset(query({ context: "game", gameDate: "2030-12-31" }), data, "exact", "past");
  expectAsset(query({ context: "game", gameDate: "2031-01-01" }), data, "exact", "later");
  missing(query({ context: "game", gameDate: "2031-07-01" }), data, "no-eligible-image");
});
test("15 所属・日付が不明な入力からexactを推測しない", () => {
  missing(query({ teamId: undefined }), catalog(past()), "invalid-input");
  const e = past(); e.binding.period = { from: "2030-09-01" };
  missing(query({ context: "game" }), catalog(e), "ambiguous");
  missing(query(), catalog(current()), "no-eligible-image");
});
test("16 Web表示のみ許可された画像の書き出しは禁止", () => {
  const e = past(); e.asset.rights.export = "denied";
  assert.equal(expectAsset(query(), catalog(e), "exact", "past").canExport, false);
});
test("再配布不許可もcanExportに反映", () => {
  const e = past(); e.asset.rights.redistribute = "unknown";
  const r = expectAsset(query(), catalog(e), "exact", "past");
  assert.equal(r.canExport, false); assert.equal(r.canRedistribute, false);
});
test("Web不許可は他の許可があっても返さない", () => {
  const e = past(); e.asset.rights.web = "denied";
  missing(query(), catalog(e), "no-eligible-image");
});
test("確認済み画像は明示的許可時に書き出し可能", () => assert.equal(expectAsset(query(), catalog(past()), "exact", "past").canExport, true));
test("同一ロゴ実体を異なるシーズンから参照できる", () => {
  const e = entry("same-logo", "2030-31", team());
  const data = catalog(e);
  const reused = { ...e.binding, bindingId: "reuse", season: "2031-32" };
  const both = { ...data, bindings: [...data.bindings, reused] };
  assert.deepEqual(validateMediaCatalog(both), []);
  expectAsset(query({ kind: "team", playerId: undefined, season: "2031-32" }), both, "exact", "same-logo");
  assert.equal(both.assets.length, 1);
});
test("最終所属が未確認・競合・欠損の場合は写真を推測しない", () => {
  for (const rows of [[], [{ ...final, status: "unverified" as const }], [final, { ...final, teamId: "fictional-A" }]]) {
    missing(query({ context: "season", teamId: undefined }), catalog(past()), "unconfirmed-affiliation", rows);
  }
});
test("最終所属と矛盾する要求チームを拒否", () => missing(query({ context: "season" }), catalog(past()), "invalid-input", [final]));
test("年代か所属が未確認ならexactもfallbackも返さない", () => {
  for (const key of ["chronology", "affiliation"] as const) {
    const e = current(); e.binding.verification[key] = "unverified";
    missing(fallback(), catalog(e), "no-eligible-image");
  }
});
test("現在シーズン・現在所属を省略したfallbackは推測しない", () => {
  for (const patch of [{ currentSeason: undefined }, { currentTeamId: undefined }]) missing({ ...fallback(), ...patch }, catalog(current()), "invalid-input");
});
test("fallback無効時は現在写真があってもmissing", () => missing(query(), catalog(current()), "no-eligible-image"));
test("今季写真未公開でも現在所属の最新の過去写真をfallbackにできる", () => {
  const e = entry("previous-current", "2031-32", player("fictional-B"));
  const r = expectAsset(fallback(), catalog(e), "fallback", "previous-current");
  assert.equal(r.actualSeason, "2031-32");
});
test("現在所属が異なる選手の写真をfallbackに混ぜない", () => {
  missing(fallback(), catalog(entry("wrong-current-team", "2032-33", player("fictional-C"))), "no-eligible-image");
});
test("同季の期間外画像をfallbackにする場合も日付と期間を保持", () => {
  const e = past(); e.binding.period = { from: "2031-01-01" };
  const q = query({ context: "game", gameDate: "2030-12-01", currentSeason: "2030-31", currentTeamId: "fictional-A", allowFallback: true });
  const r = expectAsset(q, catalog(e), "fallback", "past");
  assert.equal(r.annotation?.targetDate, "2030-12-01");
  assert.deepEqual(r.annotation?.actualPeriod, { from: "2031-01-01" });
});
test("最新の通算写真は配列順に左右されない", () => {
  expectAsset(career(), catalog(current(), past()), "representative", "current");
});
test("exactがあればfallbackより優先", () => { expectAsset(fallback(), catalog(past(), current()), "exact", "past"); });
test("通算の未来シーズンを除外", () => { expectAsset(career(), catalog(past(), entry("future", "2033-34")), "representative", "past"); });
test("同季に複数所属で新旧不明の通算写真は曖昧として返さない", () => missing(career(), catalog(entry("a", "2032-33"), current()), "ambiguous"));
test("通算の同季内で使用開始日が明確なら最新を選ぶ", () => {
  const a = entry("early", "2032-33"), b = current();
  a.binding.period = { from: "2032-09-01", to: "2032-12-31" }; b.binding.period = { from: "2033-01-01" };
  expectAsset(career(), catalog(a, b), "representative", "current");
});
test("入力の不正日付・シーズン・通算への季指定を拒否", () => {
  for (const q of [query({ season: "2030-32" }), query({ context: "game", gameDate: "2031-02-30" }), { ...career(), season: "2030-31" }, { ...career(), currentSeason: undefined }]) missing(q, catalog(past()), "invalid-input");
});
test("入力オブジェクトを変更せず決定的に解決する", () => {
  const q = query(), data = catalog(past()), before = JSON.stringify([q, data]);
  assert.deepEqual(resolveMedia(q, data), resolveMedia(q, data));
  assert.equal(JSON.stringify([q, data]), before);
});

const invalidCases: [string, string, (e: ReturnType<typeof entry>) => void][] = [
  ["シーズン終了年", "invalid-season", e => { e.binding.season = "2030-99"; }],
  ["種別", "subject-mismatch", e => { e.binding.subject = team(); }],
  ["選手ID", "subject-mismatch", e => { e.binding.subject = { ...player(), playerId: "another-fictional-player" }; }],
  ["チームID", "subject-mismatch", e => { e.binding.subject = player("fictional-C"); }],
  ["期間の逆転", "invalid-period", e => { e.binding.period = { from: "2031-01-01", to: "2030-12-31" }; }],
  ["存在しない日付", "invalid-period", e => { e.binding.period = { from: "2031-02-29" }; }],
  ["不明な権利で公開可能", "unsubstantiated-rights", e => { e.asset.rights.status = "unknown"; }],
  ["権利の根拠なし", "unsubstantiated-rights", e => { e.asset.rights.evidence = undefined; }],
  ["年代の根拠なし", "invalid-verification", e => { e.binding.verification.evidence = undefined; }],
  ["外部URL", "invalid-path", e => { e.asset.path = "https://example.invalid/synthetic.webp"; }],
  ["親ディレクトリ", "invalid-path", e => { e.asset.path = "media/../synthetic.webp"; }],
  ["ハッシュ形式", "invalid-hash", e => { e.asset.sha256 = "broken"; }],
  ["確認日時", "invalid-source", e => { e.asset.source.checkedAt = "2031-02-30T00:00:00Z"; }],
];
for (const [label, code, mutate] of invalidCases) test(`台帳検証: ${label}`, () => {
  const e = past(); mutate(e);
  assert.ok(validateMediaCatalog(catalog(e)).some(i => i.code === code));
});
test("矛盾する対応と期間境界の重複を検出", () => {
  const a = past(), b = entry("other", "2030-31");
  assert.ok(validateMediaCatalog(catalog(a, b)).some(i => i.code === "overlapping-binding"));
  a.binding.period = { to: "2031-01-01" }; b.binding.period = { from: "2031-01-01" };
  assert.ok(validateMediaCatalog(catalog(a, b)).some(i => i.code === "overlapping-binding"));
});
test("重複assetId・bindingId・保存パスを検出", () => {
  const e = past(), errors = validateMediaCatalog(catalog(e, e));
  for (const code of ["duplicate-asset", "duplicate-binding", "duplicate-path"]) assert.ok(errors.some(i => i.code === code));
});
test("画像なし台帳と、実ファイル観測結果ありの検証を区別", () => {
  const e = past(), data = catalog(e);
  assert.deepEqual(validateMediaCatalog(data), []);
  assert.ok(validateMediaCatalog(data, []).some(i => i.code === "file-path-mismatch"));
  assert.ok(validateMediaCatalog(data, [{ path: e.asset.path, sha256: "b".repeat(64) }]).some(i => i.code === "file-hash-mismatch"));
});
test("実ファイルのパス・ハッシュ照合とルート外symlink拒否（架空バイトのみ）", async () => {
  const temp = await mkdtemp(path.join(tmpdir(), "public-media-test-"));
  try {
    const e = past(), data = catalog(e), root = path.join(temp, "root");
    const bytes = Buffer.from("synthetic test bytes, not an official image");
    e.asset.sha256 = createHash("sha256").update(bytes).digest("hex");
    await mkdir(path.join(root, "media"), { recursive: true });
    const file = path.join(root, e.asset.path);
    await writeFile(file, bytes);
    assert.deepEqual(await validateMediaFiles(data, root), []);
    await writeFile(file, "different synthetic bytes");
    assert.ok((await validateMediaFiles(data, root)).some(i => i.code === "file-hash-mismatch"));
    await rm(file);
    assert.ok((await validateMediaFiles(data, root)).some(i => i.code === "file-path-mismatch"));
    const outside = path.join(temp, "outside.webp"); await writeFile(outside, bytes); await symlink(outside, file);
    assert.ok((await validateMediaFiles(data, root)).some(i => i.code === "outside-root"));
  } finally { await rm(temp, { recursive: true, force: true }); }
});
