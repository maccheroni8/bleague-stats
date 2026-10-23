import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { deriveClassification, fetchPlayerPage, parsePlayerDetail, updateRosterProfile } from "./scrape-roster.ts";
import { needsRosterDetail, fillMissingNationality } from "./lib/playerNationalitySupplements.ts";
import type { PlayerMasterEntry } from "../shared/types.ts";

const context = { season: "2026-27", currentTeamId: "1638" };
const player = (): PlayerMasterEntry => ({ playerId: "12607", name: "クリストファー・オリビエ", teamId: "1638", teamName: "佐賀バルーナーズ" });
const unavailable = async () => { throw new Error("GET roster_detail failed: 500"); };
const success = (nationality: string) => async () => ({
  detail: parsePlayerDetail(`<li class="rosterDetail-kv-playerProfile-list-item"><span>リーグ登録国籍</span><span>${nationality}</span></li>`),
  awards: [], clubHistory: null,
});

test("個人ページ500でも国籍を補完し、既存ルールで外国籍になる（保存なし）", async () => {
  const p = player();
  await updateRosterProfile(p, context, unavailable);
  assert.equal(p.nationality, "アメリカ合衆国");
  assert.equal(deriveClassification(p), "外国籍");
  assert.equal(p.birthDate, undefined);
});

test("正常200の非空欄の公式値は補完と異なっても優先する", async () => {
  const p = player();
  await updateRosterProfile(p, context, success("日本"));
  assert.equal(p.nationality, "日本");
  assert.equal(deriveClassification(p), "日本人");
});

test("補完済みの次回も取得対象にして、復旧した公式値を優先する", async () => {
  const p = { ...player(), nationality: "アメリカ合衆国", birthDate: "1992-03-27" };
  assert.equal(needsRosterDetail(p, context), true);
  await updateRosterProfile(p, context, success("日本"));
  assert.equal(p.nationality, "日本");
});

test("生年月日があっても国籍が無ければ再取得する", () => {
  assert.equal(needsRosterDetail({ ...player(), birthDate: "1992-03-27" }, context), true);
});

test("空白だけの国籍は欠落として補完する", async () => {
  const p = { ...player(), nationality: "  " };
  await updateRosterProfile(p, context, success("   "));
  assert.equal(p.nationality, "アメリカ合衆国");
});

test("既存国籍を500や正常ページの空欄で上書きしない", async () => {
  const p = { ...player(), nationality: "カナダ" };
  await updateRosterProfile(p, context, unavailable);
  assert.equal(p.nationality, "カナダ");
  await updateRosterProfile(p, context, success(""));
  assert.equal(p.nationality, "カナダ");
});

for (const [label, p, c] of [
  ["別シーズン", player(), { ...context, season: "2025-26" }],
  ["別所属", { ...player(), teamId: "9999" }, { ...context, currentTeamId: "9999" }],
  ["現行名簿に不在", player(), { season: "2026-27" }],
  ["別選手", { ...player(), playerId: "99999" }, context],
] as const) {
  test(`${label}には補完しない`, async () => {
    const entry = { ...p };
    await updateRosterProfile(entry, c, unavailable);
    assert.equal(entry.nationality, undefined);
  });
}

test("通常の属性取得済み選手は追加取得しない", () => {
  assert.equal(needsRosterDetail({ ...player(), playerId: "99999", nationality: "日本", birthDate: "2000-01-01" }, context), false);
});

test("既存の帰化・アジア枠の上書き判定を維持する", () => {
  assert.equal(deriveClassification({ ...player(), playerId: "8593", nationality: "日本" }), "帰化選手");
  assert.equal(deriveClassification({ ...player(), playerId: "51000102", nationality: "フィリピン" }), "アジア特別枠");
});

// 実マスタが障害状態（国籍未取得）でも修復後（国籍あり）でも成功するよう、入力は複製から国籍だけを外して作る
test("実マスタの複製だけを補完して外国籍になる。保存バイトと元の行は不変", async () => {
  const file = new URL("../data/players-master.json.gz", import.meta.url);
  const before = readFileSync(file);
  const master = JSON.parse(gunzipSync(before).toString()) as PlayerMasterEntry[];
  const original = master.find((p) => p.playerId === "12607")!;
  assert.ok(original);
  const snapshot = structuredClone(original);
  const copy = { ...original };
  delete copy.nationality;
  delete copy.classification;
  await updateRosterProfile(copy, context, unavailable);
  assert.equal(copy.nationality, "アメリカ合衆国");
  assert.equal(deriveClassification(copy), "外国籍");
  assert.deepEqual(original, snapshot);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(fillMissingNationality(copy, context), undefined);
});

test("実マスタの行が修復済みなら、500でも国籍を変えず外国籍のまま", async () => {
  const master = JSON.parse(gunzipSync(readFileSync(new URL("../data/players-master.json.gz", import.meta.url))).toString()) as PlayerMasterEntry[];
  const original = master.find((p) => p.playerId === "12607")!;
  if (!original.nationality?.trim()) return; // 障害状態の実マスタでは、上のテストが補完を確認する
  const copy = { ...original };
  await updateRosterProfile(copy, context, unavailable);
  assert.equal(copy.nationality, original.nationality);
  assert.equal(deriveClassification(copy), deriveClassification(original));
});

test("補完後の再確認だけの取得は外側の再試行を省く。欠落の取得は通常どおり", async () => {
  const seen: Array<{ attempts?: number } | undefined> = [];
  const spy = async (_id: string, options?: { attempts?: number }) => { seen.push(options); throw new Error("500"); };
  await updateRosterProfile({ ...player(), nationality: "アメリカ合衆国", birthDate: "1992-03-27" }, context, spy);
  await updateRosterProfile(player(), context, spy);
  await updateRosterProfile({ ...player(), nationality: "アメリカ合衆国" }, context, spy);
  assert.deepEqual(seen, [{ attempts: 1 }, {}, {}]);
});

test("実fetchPlayerPageの500継続: 再確認は2通信、欠落の取得は従来どおり6通信（実通信・実待機なし）", async (t) => {
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("", { status: 500 }); }) as typeof fetch;
  console.warn = () => {};
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const run = async (attempts?: number) => {
    calls = 0;
    const done = fetchPlayerPage("12607", attempts === undefined ? {} : { attempts }).then(() => "ok", () => "error");
    let settled = false;
    void done.then(() => { settled = true; });
    for (let i = 0; i < 200 && !settled; i++) {
      t.mock.timers.tick(1000);
      await new Promise<void>((r) => setImmediate(r));
    }
    return { outcome: await done, calls };
  };
  try {
    assert.deepEqual(await run(1), { outcome: "error", calls: 2 });
    assert.deepEqual(await run(), { outcome: "error", calls: 6 });
  } finally {
    globalThis.fetch = realFetch;
    console.warn = realWarn;
  }
});

test("正常取得のプロフィールと所属履歴を維持する", async () => {
  const p = player();
  const history: Awaited<ReturnType<typeof updateRosterProfile>> = [];
  const actual = await updateRosterProfile(p, context, async () => ({
    detail: { nationality: "アメリカ合衆国", birthDate: "1992-03-27", heightCm: 202, weightKg: 114, position: "C/PF" },
    awards: [], clubHistory: history,
  }));
  assert.equal(actual, history);
  assert.equal(p.birthDate, "1992-03-27");
  assert.equal(p.heightCm, 202);
  assert.equal(p.weightKg, 114);
  assert.equal(p.position, "C/PF");
  assert.equal(deriveClassification(p), "外国籍");
});

test("国籍補完は取得済みの他属性を変更しない", async () => {
  const p = { ...player(), birthDate: "1992-03-27", heightCm: 202, weightKg: 114, position: "C/PF" };
  await updateRosterProfile(p, context, unavailable);
  assert.deepEqual(p, { ...player(), birthDate: "1992-03-27", heightCm: 202, weightKg: 114, position: "C/PF", nationality: "アメリカ合衆国" });
});
