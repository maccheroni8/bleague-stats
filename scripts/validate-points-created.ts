// ポイントクリエイト（PC＝PTS＋本人のアシストから生まれた得点。DESIGN.md 333章）の検証。
//
// 確かめること:
//  1. 手で追った例（PBP のイベント番号で数えた値。作り直しの調査メモ）と、試合ログの PC が一致する。FT は成功した本数をすべて数える
//  2. 全シーズン・両リーグで、プレーバイプレーのある試合はすべての出場行に assistPoints があり、無い試合（2017-18 の1810）には無い。
//     チームごとに、アシストした側で数えた合計（Σ assistPoints）と、アシストされた側で数えた得点（Σ アシストされた2PM×2＋3PM×3＋FTM）が一致する
//  3. シーズンの合計（全選手スタッツ・個人詳細・ランキングの値）: 1810 に出た選手は PC の対象試合が G より1少なく、平均はその試合数で割る
//  4. 1試合の索引の列 assistPoints が試合ログと一致し（無い試合は -1）、Q別の索引の区間の合計（1Q〜4Q＋延長）が試合全体と一致する
//  5. 1試合記録の項目 PC は、プレーバイプレーの無い試合を数えない
//
// 使い方: npm run validate:points-created（先に npm run build:data）。1つでも食い違いがあれば終了コード1
import { CLUTCH_ATOM_INDEX } from "../shared/periodIndex.ts";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { PlayerGameLog, PlayerSummary } from "../shared/types.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import type { PlayerPeriodIndexFile } from "../shared/periodIndex.ts";
import { PLAYER_GAME_RECORD_STATS } from "../shared/playerGameRecords.ts";
import { pointsCreatedValue, sumPlayerGameLogs } from "../src/lib/playerSeasonBoxscore.ts";

const DATA = path.join(process.cwd(), "data");
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok ${label}`);
  else {
    failures += 1;
    console.error(`NG ${label} ${detail}`);
  }
}
const readJson = <T>(file: string): T => JSON.parse(gunzipSync(readFileSync(file)).toString()) as T;

// 1. 手で追った例
const EXAMPLES = [
  { season: "2016-17", key: "101", name: "田中 大貴", pts: 8, assistPoints: 8, pc: 16 },
  { season: "2017-18", key: "1574", name: "ダニエル・オルトン", pts: 10, assistPoints: 9, pc: 19 },
  { season: "2019-20", key: "4151", name: "橋本 竜馬", pts: 4, assistPoints: 10, pc: 14 },
  { season: "2025-26", key: "504728", name: "タイラー・クック", pts: 20, assistPoints: 7, pc: 27 },
  { season: "2026-27", key: "506379", name: "テレンス・デイビス", pts: 24, assistPoints: 14, pc: 38 },
];
for (const e of EXAMPLES) {
  const players = readJson<PlayerSummary[]>(path.join(DATA, e.season, "players.json.gz"));
  const p = players.find((x) => x.name.replace(/\s+/g, " ") === e.name);
  const log = p ? readJson<PlayerGameLog[]>(path.join(DATA, e.season, "player-games", `${p.playerId}.json.gz`)).find((g) => g.scheduleKey === e.key) : undefined;
  check(
    `${e.season} ${e.key} ${e.name}: PTS ${e.pts}＋アシストから生まれた得点 ${e.assistPoints}＝PC ${e.pc}`,
    !!log && log.pts === e.pts && log.assistPoints === e.assistPoints && log.pts + (log.assistPoints ?? 0) === e.pc,
    log ? `PTS ${log.pts} アシスト由来 ${log.assistPoints}` : "試合ログが見つかりません",
  );
}

// 2〜4. 全シーズン・両リーグ
const NO_PBP_GAMES = new Set(["2017-18|1810"]);
let files = 0;
let rows = 0;
for (const season of readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  for (const dir of [path.join(DATA, season), path.join(DATA, season, "one")]) {
    if (!existsSync(path.join(dir, "players.json.gz"))) continue;
    files += 1;
    const label = path.relative(DATA, dir);
    const players = readJson<PlayerSummary[]>(path.join(dir, "players.json.gz"));
    const missing: string[] = [];
    const unexpected: string[] = [];
    // チーム×試合ごとの、アシストした側の合計とアシストされた側の得点
    const byTeamGame = new Map<string, { given: number; received: number }>();
    const logByRow = new Map<string, PlayerGameLog>();
    const seasonMismatch: string[] = [];
    for (const p of players) {
      const logs = readJson<PlayerGameLog[]>(path.join(dir, "player-games", `${p.playerId}.json.gz`));
      for (const g of logs) {
        if (!(g.min > 0)) continue;
        rows += 1;
        logByRow.set(`${p.playerId}|${g.scheduleKey}`, g);
        const noPbp = NO_PBP_GAMES.has(`${season}|${g.scheduleKey}`);
        if (noPbp && g.assistPoints !== undefined) unexpected.push(`${p.name} ${g.scheduleKey}`);
        if (!noPbp && g.assistPoints === undefined) missing.push(`${p.name} ${g.scheduleKey}`);
        const k = `${g.scheduleKey}|${g.isHome}`;
        const t = byTeamGame.get(k) ?? { given: 0, received: 0 };
        t.given += g.assistPoints ?? 0;
        t.received += g.assisted2m * 2 + g.assisted3m * 3 + g.assistedFtm;
        byTeamGame.set(k, t);
      }
      // 3. シーズンの合計（レギュラーシーズン）
      const regular = logs.filter((g) => g.gameType === "regular");
      const raw = sumPlayerGameLogs(regular);
      const played = regular.filter((g) => g.min > 0);
      const withPbp = played.filter((g) => g.assistPoints !== undefined);
      const total = withPbp.reduce((a, g) => a + g.pts + g.assistPoints!, 0);
      const expectAvg = withPbp.length > 0 ? total / withPbp.length : null;
      const avg = pointsCreatedValue(raw, "perGame");
      const sum = pointsCreatedValue(raw, "total");
      const ok =
        (raw.pcGames ?? 0) === withPbp.length &&
        (expectAvg === null ? avg === null && sum === null : avg !== null && Math.abs(avg - expectAvg) < 1e-9 && sum === total);
      if (!ok) seasonMismatch.push(`${p.name} PC G ${raw.pcGames}/${withPbp.length} 平均 ${avg}/${expectAvg}`);
      if (season === "2017-18" && dir === path.join(DATA, season) && played.some((g) => g.scheduleKey === "1810") && raw.pcGames !== raw.gamesPlayed - 1) {
        seasonMismatch.push(`${p.name} 1810 に出たのに PC G ${raw.pcGames}・G ${raw.gamesPlayed}`);
      }
    }
    check(`${label}: プレーバイプレーのある試合の出場行はすべて assistPoints を持つ`, missing.length === 0, missing.slice(0, 5).join("、"));
    check(`${label}: プレーバイプレーの無い試合（1810）は assistPoints を持たない`, unexpected.length === 0, unexpected.slice(0, 5).join("、"));
    const teamMismatch = [...byTeamGame].filter(([, t]) => t.given !== t.received).map(([k, t]) => `${k} ${t.given}/${t.received}`);
    check(`${label}: チームごとに、アシストした側の合計＝アシストされた側の得点`, teamMismatch.length === 0, teamMismatch.slice(0, 5).join("、"));
    check(`${label}: シーズンの PC（合計・平均）と対象試合数`, seasonMismatch.length === 0, seasonMismatch.slice(0, 5).join("、"));

    // 4. 1試合の索引・Q別の索引
    const indexFile = path.join(dir, "player-game-index.json.gz");
    if (!existsSync(indexFile)) continue;
    const index = readJson<PlayerGameIndexFile>(indexFile);
    const col = index.rows.stats.assistPoints;
    const indexMismatch: string[] = [];
    if (!col) indexMismatch.push("assistPoints の列がありません");
    else {
      for (let i = 0; i < index.rows.player.length; i++) {
        const pid = index.players[index.rows.player[i]!]![0];
        const key = index.games.key[index.rows.game[i]!]!;
        const log = logByRow.get(`${pid}|${key}`);
        const want = log?.assistPoints ?? -1;
        if (col[i] !== want) indexMismatch.push(`${pid} ${key} ${col[i]}/${want}`);
      }
    }
    check(`${label}: 1試合の索引の assistPoints が試合ログと一致`, indexMismatch.length === 0, indexMismatch.slice(0, 5).join("、"));
    const periodFile = path.join(dir, "player-period-index.json.gz");
    if (existsSync(periodFile) && col) {
      const period = readJson<PlayerPeriodIndexFile>(periodFile);
      const pcol = period.rows.stats.assistPoints;
      const sums = new Map<number, number>();
      let negative = 0;
      if (pcol) {
        for (let k = 0; k < period.rows.row.length; k++) {
          // クラッチの行（第4Q・延長と重なる。設計書373章）は試合全体の合計に入れない
          if (period.rows.period[k] === CLUTCH_ATOM_INDEX) continue;
          const v = pcol[k]!;
          if (v < 0) negative += 1;
          else sums.set(period.rows.row[k]!, (sums.get(period.rows.row[k]!) ?? 0) + v);
        }
      }
      const periodMismatch: string[] = [];
      for (const [row, sum] of sums) {
        if (col[row]! >= 0 && col[row] !== sum) periodMismatch.push(`行${row} 区間の合計 ${sum}・試合 ${col[row]}`);
      }
      check(`${label}: Q別の索引の assistPoints の列がある`, !!pcol);
      check(`${label}: Q別の区間（1Q〜4Q＋延長）の合計が試合全体と一致（${sums.size}行）`, periodMismatch.length === 0 && negative === 0, periodMismatch.slice(0, 5).join("、") + (negative ? ` 値なし${negative}行` : ""));
    }
  }
}
console.log(`${files} ファイル・出場 ${rows} 行を確認`);

// 5. 1試合記録の項目
{
  const def = PLAYER_GAME_RECORD_STATS.find((d) => d.key === "pc");
  const base = { pts: 20, assisted2m: 0, assisted3m: 0, assistedFtm: 0, fgm: 8, fga: 15, tpm: 0, tpa: 0, ftm: 4, fta: 4 } as unknown as PlayerGameLog & { season: string };
  check("1試合記録に PC がある", !!def);
  check("1試合記録の PC＝PTS＋アシストから生まれた得点", !!def && def.value({ ...base, assistPoints: 7 }) === 27);
  check("1試合記録の PC は、プレーバイプレーの無い試合（assistPoints なし）を数えない", !!def?.filter && !def.filter(base) && def.filter({ ...base, assistPoints: 0 }));
}

if (failures > 0) {
  console.error(`NG: ${failures} 件の食い違い`);
  process.exit(1);
}
console.log("OK: ポイントクリエイト");
