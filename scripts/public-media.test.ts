/** 架空の選手・ロゴ・JSONのみ。実写真や外部ネットワークに依存しない。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { MediaAsset, MediaBinding, MediaCatalog, MediaRequest, FinalAffiliation } from "../shared/mediaCatalog.ts";
import { parseMediaCatalogText } from "../shared/mediaCatalogJson.ts";
import { createMediaCatalogLoader, createMediaCatalogSelection, type MediaCatalogLoadResult, type MediaCatalogFetch } from "../src/lib/mediaCatalogLoader.ts";
import { mediaCatalogUrl, mediaAssetUrl } from "../src/lib/mediaCatalogUrls.ts";
import { selectPublicMedia, fallbackPublicMediaImage, currentPublicMediaUrl } from "../src/lib/publicMediaSelection.ts";

const baseUrl = "/bleague-stats/";
const checkedAt = "2032-10-01T00:00:00Z";
function entry(id: string, season = "2030-31", teamId = "fictional-A", kind: "player" | "team" = "player") {
  const subject: MediaAsset["subject"] = kind === "player" ? { kind, playerId: "fictional-player", teamId } : { kind, teamId };
  const asset: MediaAsset = { assetId: id, subject, path: `media/assets/${id}.webp`, sha256: "a".repeat(64),
    source: { reference: "fixture:synthetic", checkedAt },
    rights: { status: "confirmed", web: "granted", export: "granted", redistribute: "granted", evidence: "fixture:public-usage", checkedAt } };
  const binding: MediaBinding = { bindingId: `binding-${id}-${season}`, assetId: id, subject, season,
    verification: { chronology: "confirmed", affiliation: "confirmed", evidence: "fixture:season-record", checkedAt } };
  return { asset, binding };
}
function catalog(...rows: ReturnType<typeof entry>[]): MediaCatalog {
  return { schemaVersion: 1, assets: rows.map(r => r.asset), bindings: rows.map(r => r.binding) };
}
function ready(...rows: ReturnType<typeof entry>[]): MediaCatalogLoadResult {
  return { status: "ready", seasons: [...new Set(rows.map(r => r.binding.season))], catalog: catalog(...rows) };
}
const request: MediaRequest = { kind: "player", context: "team", playerId: "fictional-player", teamId: "fictional-A", season: "2030-31" };
const choose = (state: MediaCatalogLoadResult, patch: Partial<MediaRequest> = {}, affiliations: FinalAffiliation[] = []) =>
  selectPublicMedia({ baseUrl, request: { ...request, ...patch }, state, affiliations });
const response = (value: unknown, status = 200) => ({ ok: status === 200, status, text: async () => JSON.stringify(value) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
function expectCurrent(result: ReturnType<typeof choose>, reason: string) {
  assert.equal(result.source, "current");
  if (result.source !== "current") throw new Error("current expected");
  assert.equal(result.reason, reason);
  assert.equal(result.actualSeason, null); assert.equal(result.affiliationVerified, false);
  return result;
}

test("public/media のURL・サブパスを使う", () => {
  assert.equal(mediaCatalogUrl(baseUrl, "2030-31"), "/bleague-stats/media/catalog/2030-31.json");
  assert.equal(mediaCatalogUrl("/nested/site", "2030-31"), "/nested/site/media/catalog/2030-31.json");
  assert.equal(mediaAssetUrl(baseUrl, "media/assets/fake.webp"), "/bleague-stats/media/assets/fake.webp");
  for (const base of ["//host/", "https://invalid.example/", "/../", "/%2e%2e/"]) assert.throws(() => mediaCatalogUrl(base, "2030-31"));
  assert.throws(() => mediaAssetUrl(baseUrl, "../secret.webp"));
  assert.throws(() => mediaCatalogUrl(baseUrl, "2030-32"));
});
test("現在画像のURLは既存写真・ロゴの形を維持する", () => {
  assert.equal(currentPublicMediaUrl(baseUrl, request), "/bleague-stats/data/player-photos/fictional-player.webp");
  assert.equal(currentPublicMediaUrl(baseUrl, { kind: "team", teamId: "fictional-A" }), "/bleague-stats/data/logos/fictional-A.png");
  assert.throws(() => currentPublicMediaUrl(baseUrl, { ...request, playerId: "../secret" }));
});
test("シーズンで同じ選手の画像が切り替わる", () => {
  const state = ready(entry("old"), entry("next", "2031-32"));
  const a = choose(state), b = choose(state, { season: "2031-32" });
  assert.equal(a.source, "catalog"); assert.equal(b.source, "catalog");
  if (a.source === "catalog" && b.source === "catalog") {
    assert.equal(a.resolution.assetId, "old"); assert.equal(b.resolution.assetId, "next");
    assert.notEqual(a.url, b.url);
  }
});
test("チームロゴもシーズン別に選べる", () => {
  const state = ready(entry("logo-old", "2030-31", "fictional-A", "team"), entry("logo-next", "2031-32", "fictional-A", "team"));
  for (const [season, id] of [["2030-31", "logo-old"], ["2031-32", "logo-next"]]) {
    const r = choose(state, { kind: "team", playerId: undefined, season });
    assert.equal(r.source, "catalog"); if (r.source === "catalog") assert.equal(r.resolution.assetId, id);
  }
});
test("同一季の移籍: シーズン全体は確認済み最終所属、チーム別は対象所属", () => {
  const state = ready(entry("before"), entry("after", "2030-31", "fictional-B"));
  const final: FinalAffiliation = { playerId: "fictional-player", season: "2030-31", teamId: "fictional-B", status: "confirmed", evidence: "fixture:final-roster", checkedAt };
  const all = choose(state, { context: "season", teamId: undefined }, [final]);
  const a = choose(state), b = choose(state, { teamId: "fictional-B" });
  assert.equal(all.source, "catalog"); if (all.source === "catalog") assert.equal(all.resolution.assetId, "after");
  assert.equal(a.source, "catalog"); if (a.source === "catalog") assert.equal(a.resolution.assetId, "before");
  assert.equal(b.source, "catalog"); if (b.source === "catalog") assert.equal(b.resolution.assetId, "after");
});
for (const finals of [[], [{ playerId: "fictional-player", season: "2030-31", teamId: "fictional-B", status: "unverified" }]] satisfies FinalAffiliation[][]) {
  test(`最終所属が未確認なら推測せず現在画像: ${finals.length}`, () => {
    expectCurrent(choose(ready(entry("before"), entry("after", "2030-31", "fictional-B")), { context: "season", teamId: undefined }, finals), "unconfirmed-affiliation");
  });
}
test("試合時点は明示チームと適用期間で選び、期間外は現在画像", () => {
  const early = entry("early"), late = entry("late", "2030-31", "fictional-B");
  early.binding.period = { from: "2030-10-01", to: "2031-01-10" };
  late.binding.period = { from: "2031-01-11", to: "2031-06-01" };
  const state = ready(early, late);
  const a = choose(state, { context: "game", gameDate: "2031-01-10" });
  const b = choose(state, { context: "game", gameDate: "2031-01-11", teamId: "fictional-B" });
  assert.equal(a.source, "catalog"); if (a.source === "catalog") assert.equal(a.resolution.assetId, "early");
  assert.equal(b.source, "catalog"); if (b.source === "catalog") assert.equal(b.resolution.assetId, "late");
  expectCurrent(choose(state, { context: "game", gameDate: "2031-01-11" }), "no-eligible-image");
  expectCurrent(choose(state, { context: "game" }), "ambiguous");
});
test("通算は最新の確認済み代表写真、候補・未来画像は除外", () => {
  const latest = entry("latest", "2032-33", "fictional-B"), unknown = entry("unconfirmed", "2032-33", "fictional-C");
  unknown.binding.verification.chronology = "unverified";
  const r = choose(ready(entry("old"), latest, unknown, entry("future", "2033-34")), {
    context: "career", season: undefined, teamId: undefined, currentSeason: "2032-33",
  });
  assert.equal(r.source, "catalog"); if (r.source === "catalog") {
    assert.equal(r.resolution.assetId, "latest"); assert.equal(r.resolution.status, "representative");
  }
});
test("通算の代表写真がなければ現在画像", () => {
  const e = entry("unknown", "2032-33"); e.binding.verification.chronology = "unverified";
  expectCurrent(choose(ready(e), { context: "career", season: undefined, teamId: undefined, currentSeason: "2032-33" }), "no-eligible-image");
});
test("未登録の過去季へ別季の台帳画像を流用しない", () => {
  const r = choose({ status: "ready", seasons: ["2030-31", "2032-33"], catalog: catalog(entry("current", "2032-33")) }, {
    allowFallback: true, currentSeason: "2032-33", currentTeamId: "fictional-A",
  });
  expectCurrent(r, "no-eligible-image");
});
test("別選手・別チーム・別季の取得結果は採用しない", () => {
  const state = ready(entry("only"));
  expectCurrent(choose(state, { playerId: "fictional-other" }), "no-eligible-image");
  expectCurrent(choose(state, { teamId: "fictional-B" }), "no-eligible-image");
  expectCurrent(choose(state, { season: "2031-32" }), "season-not-loaded");
});
for (const status of ["idle", "loading"] as const) test(`${status}では旧台帳画像を表示対象にせず現在画像`, () => {
  expectCurrent(selectPublicMedia({ baseUrl, request, state: status === "idle" ? { status } : { status, seasons: ["2030-31"] } }), `catalog-${status}`);
});
for (const [label, fetcher, reason] of [
  ["network", async () => { throw new Error("offline"); }, "catalog-network"],
  ["404", async () => response({}, 404), "catalog-not-found"],
  ["503", async () => response({}, 503), "catalog-http"],
  ["JSON構文", async () => ({ ok: true, status: 200, text: async () => "<!doctype html>" }), "invalid-catalog"],
  ["構造", async () => response({ assets: null }), "invalid-catalog"],
  ["別季の登録ミス", async () => response(catalog(entry("wrong", "2031-32"))), "invalid-catalog"],
  ["本文読み取り失敗", async () => ({ ok: true, status: 200, text: async () => { throw new Error("read"); } }), "catalog-network"],
] satisfies [string, MediaCatalogFetch, string][]) test(`対応表${label}は理由を区別して現在画像`, async () => {
  const state = await createMediaCatalogLoader({ baseUrl, fetcher }).load("2030-31");
  expectCurrent(choose(state), reason);
});
test("登録画像404と原因不明の画像失敗を区別して現在画像へ戻す", () => {
  const r = choose(ready(entry("registered"))); assert.equal(r.source, "catalog");
  if (r.source !== "catalog") throw new Error("catalog expected");
  const notFound = fallbackPublicMediaImage(r, r.url, "not-found");
  expectCurrent(notFound, "asset-not-found");
  expectCurrent(fallbackPublicMediaImage(r, r.url), "asset-load-error");
  assert.equal(fallbackPublicMediaImage(r, "/old/other.webp"), r);
  assert.equal(fallbackPublicMediaImage(notFound, notFound.source === "current" ? notFound.url : ""), notFound);
});
test("未確認画像・Web不許可は登録済みでも選ばない", () => {
  const unverified = entry("unverified"); unverified.binding.verification.affiliation = "unverified";
  expectCurrent(choose(ready(unverified)), "no-eligible-image");
  const denied = entry("denied"); denied.asset.rights.web = "denied";
  expectCurrent(choose(ready(denied)), "no-eligible-image");
});
test("保存許可値を選択処理で変更しない（保存処理との接続はしない）", () => {
  const e = entry("web-only"); e.asset.rights.export = "denied"; e.asset.rights.redistribute = "denied";
  const r = choose(ready(e)); assert.equal(r.source, "catalog");
  if (r.source === "catalog") assert.equal(r.resolution.canExport, false);
  assert.equal(e.asset.rights.export, "denied");
});
test("不正IDを現在URLへ埋め込まない", () => {
  assert.deepEqual(choose(ready(entry("only")), { playerId: "../secret" }), { source: "none", reason: "invalid-input" });
});
test("壊れた参照・重複期間の登録ミスは現在画像へ戻す", async () => {
  const a = entry("a"), b = entry("b");
  const state = await createMediaCatalogLoader({ baseUrl, fetcher: async () => response(catalog(a, b)) }).load("2030-31");
  expectCurrent(choose(state), "invalid-catalog");
});
test("複数季で同じassetを共有し、矛盾を検出する", async () => {
  const a = entry("shared"), b = entry("shared", "2031-32");
  const loader = createMediaCatalogLoader({ baseUrl, fetcher: async url => response(catalog(url.includes("2031-32") ? b : a)) });
  const state = await loader.loadMany(["2030-31", "2031-32"]);
  assert.equal(state.status, "ready"); if (state.status === "ready") assert.equal(state.catalog.assets.length, 1);
  b.asset.sha256 = "b".repeat(64);
  expectCurrent(choose(await loader.loadMany(["2030-31", "2031-32"])), "invalid-catalog");
});
test("一部季が404でも不完全な通算代表を選ばず現在画像", async () => {
  const loader = createMediaCatalogLoader({ baseUrl, fetcher: async url => url.includes("2031-32") ? response({}, 404) : response(catalog(entry("past"))) });
  expectCurrent(choose(await loader.loadMany(["2030-31", "2031-32"]), { context: "career", season: undefined, teamId: undefined, currentSeason: "2031-32" }), "catalog-not-found");
});
test("同一季の進行中HTTPを共有し、失敗後の再試行を妨げない", async () => {
  const gate = deferred<ReturnType<typeof response>>(); let calls = 0;
  const loader = createMediaCatalogLoader({ baseUrl, fetcher: async () => { calls++; return calls === 1 ? gate.promise : response(catalog(entry("ready"))); } });
  const a = loader.load("2030-31"), b = loader.load("2030-31"); assert.equal(a, b); assert.equal(calls, 1);
  gate.resolve(response({}, 404)); await a;
  assert.equal((await loader.load("2030-31")).status, "ready"); assert.equal(calls, 2);
});
test("A→B→Aと古い成功・失敗は新しい選択を上書きしない", async () => {
  for (const oldStatus of [200, 503]) {
    const gate = deferred<ReturnType<typeof response>>();
    const selection = createMediaCatalogSelection(createMediaCatalogLoader({ baseUrl, fetcher: async url => url.includes("2030-31") ? gate.promise : response(catalog(entry("b", "2031-32"))) }));
    const a = selection.select(["2030-31"]);
    await selection.select(["2031-32"]);
    const lastA = selection.select(["2030-31"]);
    assert.equal(selection.getState().status, "loading");
    gate.resolve(response(catalog(entry("a")), oldStatus));
    assert.deepEqual(await a, { status: "superseded" });
    assert.equal((await lastA).status, oldStatus === 200 ? "ready" : "unresolved");
  }
});
test("reset後の遅延応答は破棄する", async () => {
  const gate = deferred<ReturnType<typeof response>>();
  const selection = createMediaCatalogSelection(createMediaCatalogLoader({ baseUrl, fetcher: async () => gate.promise }));
  const task = selection.select(["2030-31"]); selection.reset(); gate.resolve(response(catalog(entry("old"))));
  assert.deepEqual(await task, { status: "superseded" }); assert.equal(selection.getState().status, "idle");
});
test("外部JSONは検証し、入力オブジェクトと分離する", () => {
  for (const text of ["{", "null", '{"schemaVersion":1,"assets":[],"bindings":[],"private":true}']) assert.equal(parseMediaCatalogText(text).ok, false);
  const parsed = parseMediaCatalogText(JSON.stringify(catalog(entry("ok")))); assert.equal(parsed.ok, true);
});

// 最終レビュー: 単独の期間つき画像だけをチーム別の日付なし表示へ採用する。
test("期間つき単独のチーム別写真とロゴを期間を保持して採用",()=>{
 for(const kind of ["player","team"]as const){const e=entry("bounded","2030-31","fictional-A",kind);e.binding.period={from:"2030-10-01",to:"2030-12-31"};const r=choose(ready(e),{kind,playerId:kind==="player"?"fictional-player":undefined});assert.equal(r.source,"catalog");if(r.source==="catalog"){assert.equal(r.resolution.targetDate,null);assert.deepEqual(r.resolution.actualPeriod,e.binding.period);}}
});
test("同じ対象の期間別複数候補は日付なしで選ばない",()=>{
 const a=entry("first"),b=entry("last");a.binding.period={from:"2030-10-01",to:"2030-12-31"};b.binding.period={from:"2031-01-01",to:"2031-06-30"};expectCurrent(choose(ready(a,b)),"ambiguous");
});
test("単独期間つき画像でも選手・季・チームの一致と確認状態を維持",()=>{
 const e=entry("bounded");e.binding.period={from:"2030-10-01"};for(const patch of [{playerId:"other"},{teamId:"other"},{season:"2031-32"}])assert.notEqual(choose(ready(e),patch).source,"catalog");e.binding.verification.affiliation="unverified";expectCurrent(choose(ready(e)),"no-eligible-image");
});
