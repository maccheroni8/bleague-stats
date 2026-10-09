// 過去シーズンの保存キー（scripts/build-data.ts の seasonKey。DESIGN.md 206-4章）の検証スクリプト（検証専用。CIには入れず、必要なときに手で実行する）。
// シーズンをまたいで読む元データ（SEASON_BUILD_GLOBAL_INPUTS）を一時の data/ に写し、変えたときにキーが変わるか・変わらないかを確かめる。
//
//  変わらないこと: ① current-roster.json.gz の中身を変える ② players-master.json.gz を、JSONの内容は同じでバイトだけ違う形に書き直す（圧縮の強さを変える・整形して書く）
//  変わること（感度）: ③ players-master の内容を1か所変える ④ season-rosters の内容を1か所変える
//  仕組みの確認: ⑤ current-roster が SEASON_BUILD_GLOBAL_INPUTS に入っていない
//
// 使い方: npm run validate:season-key

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { SEASON_BUILD_GLOBAL_INPUTS } from "./lib/dataLayout.ts";
import { seasonKey } from "./build-data.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SEASON = "2016-17"; // 元データ（games など）は一時の data/ に写さない（元データの変化は、このスクリプトの対象ではない）

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `（${detail}）` : ""}`);
  if (!ok) failed += 1;
}

function readGz(file: string): unknown {
  return JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8"));
}

const tmp = mkdtempSync(path.join(tmpdir(), "season-key-"));
try {
  const data = path.join(tmp, "data");
  mkdirSync(data, { recursive: true });
  for (const e of [...SEASON_BUILD_GLOBAL_INPUTS, "current-roster.json.gz"]) {
    const src = path.join(ROOT, "data", e);
    if (existsSync(src)) cpSync(src, path.join(data, e), { recursive: true });
  }
  const key = () => seasonKey(SEASON, data);
  const base = key();

  // ① current-roster の中身を変える（選手を1人足す）
  const rosterPath = path.join(data, "current-roster.json.gz");
  const roster = readGz(rosterPath) as { players: { playerId: string; teamId: string }[] };
  roster.players.push({ playerId: "99999999", teamId: "0" });
  writeFileSync(rosterPath, gzipSync(JSON.stringify(roster)));
  check("current-roster だけを変えても、過去シーズンのキーは変わらない", key() === base);

  // ② players-master を、内容は同じでバイトだけ違う形に書き直す
  const masterPath = path.join(data, "players-master.json.gz");
  const original = readFileSync(masterPath);
  const master = readGz(masterPath);
  const variants: [string, Buffer][] = [
    ["圧縮を最速にする", gzipSync(JSON.stringify(master), { level: 1 })],
    ["圧縮を最大にする", gzipSync(JSON.stringify(master), { level: 9 })],
    ["字下げをつけて書く", gzipSync(JSON.stringify(master, null, 2))],
  ];
  for (const [label, bytes] of variants) {
    writeFileSync(masterPath, bytes);
    check(`players-master を内容は同じでバイトだけ変える（${label}）と、キーは変わらない`, !bytes.equals(original) && key() === base, `${original.length}→${bytes.length}バイト`);
  }

  // ③ players-master の内容を1か所変える（感度）
  const changed = JSON.parse(JSON.stringify(master)) as { name?: string }[];
  changed[0]!.name = `${changed[0]!.name ?? ""}（変更）`;
  writeFileSync(masterPath, gzipSync(JSON.stringify(changed)));
  check("players-master の内容を1か所変えると、キーが変わる", key() !== base);
  writeFileSync(masterPath, original);
  check("players-master を元に戻すと、キーも元に戻る", key() === base);

  // ④ season-rosters の内容を1か所変える（感度）
  const rostersPath = path.join(data, "season-rosters.json.gz");
  const rostersOriginal = readFileSync(rostersPath);
  const rosters = readGz(rostersPath) as Record<string, { playerIds: string[] }[]>;
  const firstSeason = Object.keys(rosters)[0]!;
  rosters[firstSeason]![0]!.playerIds.push("99999999");
  writeFileSync(rostersPath, gzipSync(JSON.stringify(rosters)));
  check("season-rosters の内容を1か所変えると、キーが変わる", key() !== base);
  writeFileSync(rostersPath, rostersOriginal);

  // ⑤ 仕組み
  check("current-roster は SEASON_BUILD_GLOBAL_INPUTS に入っていない", !(SEASON_BUILD_GLOBAL_INPUTS as readonly string[]).includes("current-roster.json.gz"));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed}件が失敗しました`);
  process.exitCode = 1;
} else {
  console.log("\nすべて ok");
}
