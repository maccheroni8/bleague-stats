// ランキング（個人）の通算・歴代の行の「最終所属：〇〇」の書き方（DESIGN.md 357章）の検証スクリプト（検証専用）。
//  1. 判定（isLastTeamRow）: 最後のシーズンが今季で名簿にいる → 今季の行／最後のシーズンが過去 → 最終所属（名簿にいても）／今季でも名簿に無い → 最終所属／
//     名簿が読めない間は最後のシーズンだけで判定／複数の選手の行は全員が今季のときだけ今季の行
//  2. 書き方: チーム名とシーズンの範囲を出す5つの一覧（達成記録・通算記録・勝負所・アシストペア・On/Off）が LastTeamName を通し、
//     名前の下の行にチーム名を出す表では、保存画像（写真なし）の名前の横にチーム略称（exportTeam）を足さない（重複させない）
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import type { GameSummary, PlayerGameLog } from "../shared/types.ts";
import { viewPlayerGameIndex } from "../src/lib/gameIndex.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS } from "../src/lib/gameRecordConditions.ts";
import { queryThresholdCount } from "../src/lib/thresholdQuery.ts";
import { queryClutch } from "../src/lib/clutchQuery.ts";
import { isLastTeamRow } from "../src/lib/lastTeamRule.ts";

const failures: string[] = [];
const check = (name: string, ok: boolean) => {
  if (!ok) failures.push(name);
};

const S = "2026-27";
const active = new Set(["a", "b"]);
check("今季・名簿にいる", isLastTeamRow(S, ["a"], active, S) === false);
check("過去の最後のシーズンは名簿にいても最終所属（別リーグ・移籍後）", isLastTeamRow("2025-26", ["a"], active, S) === true);
check("今季でも名簿に無い", isLastTeamRow(S, ["z"], active, S) === true);
check("名簿が読めない間は最後のシーズンだけで判定（今季）", isLastTeamRow(S, ["z"], null, S) === false);
check("名簿が読めない間は最後のシーズンだけで判定（過去）", isLastTeamRow("2023-24", ["a"], null, S) === true);
check("組み合わせは全員が今季のときだけ今季の行", isLastTeamRow(S, ["a", "b"], active, S) === false && isLastTeamRow(S, ["a", "z"], active, S) === true);

const files = ["ThresholdLists", "CareerRecordRanking", "PlayerClutchRanking"];
for (const f of files) {
  const src = readFileSync(`src/components/${f}.tsx`, "utf8");
  check(`${f}: LastTeamName を使う`, src.includes("<LastTeamName"));
  check(`${f}: 名前の下の行にチーム名を出す表で exportTeam を足さない`, !src.includes("exportTeam="));
}
// 行がチームごと・ペアが一緒にプレーしたチームの種類は「最終所属：」を付けず、その行のチームとシーズンの範囲だけを出す（359章）
for (const f of ["AssistPairRanking", "PlayerLineupRanking"]) {
  const src = readFileSync(`src/components/${f}.tsx`, "utf8");
  check(`${f}: 「最終所属」を付けない（LastTeamName・useLastTeamCheck を使わない）`, !src.includes("LastTeamName") && !src.includes("useLastTeamCheck"));
  check(`${f}: チーム名は ResponsiveTeamName で出す`, src.includes("<ResponsiveTeamName teamId={"));
  check(`${f}: exportTeam を足さない`, !src.includes("exportTeam="));
}
check("PlayerGameRecordRanking: exportTeam を足さない", !readFileSync("src/components/PlayerGameRecordRanking.tsx", "utf8").includes("exportTeam="));
check("在籍確認の文言は最終所属の書き方とセット", !/[^>}]シーズンまで在籍確認/.test(readFileSync("src/components/CareerRecordRanking.tsx", "utf8").replace(/\{r\.info\.latestSeason\}シーズンまで在籍確認/, "")));


// ---- 3. 実データ: 最終所属・シーズンの範囲は「最後に出場した試合」から決まる（条件を達成した試合ではない。DESIGN.md 358章） ----
{
  const seasons = readdirSync(DATA_DIR)
    .filter((x) => /^\d{4}-\d{2}$/.test(x) && existsSync(path.join(DATA_DIR, x, "player-game-index.json.gz")))
    .sort();
  const views = [];
  const last = new Map<string, { season: string; date: string; key: string; teamId: string }>();
  const first = new Map<string, string>();
  const lastHit = new Map<string, { date: string; key: string; teamId: string }>(); // 修正前の決め方（PTS 20以上を達成した最後の試合）
  for (const se of seasons) {
    views.push(viewPlayerGameIndex((await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, se, "player-game-index.json")))!));
    const sum = new Map(((await readJson<GameSummary[]>(path.join(DATA_DIR, se, "games-summary.json"))) ?? []).map((g) => [g.scheduleKey, g]));
    const dir = path.join(DATA_DIR, se, "player-games");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".json.gz"))) {
      const id = f.replace(/\.json\.gz$/, "");
      for (const g of (await readJson<PlayerGameLog[]>(path.join(dir, `${id}.json`))) ?? []) {
        if (g.gameType !== "regular" || g.min <= 0) continue;
        const sg = sum.get(g.scheduleKey);
        if (!sg) continue;
        const teamId = g.isHome ? sg.homeTeamId : sg.awayTeamId;
        if (!first.has(id)) first.set(id, se);
        const l = last.get(id);
        if (!l || g.date > l.date || (g.date === l.date && g.scheduleKey > l.key)) last.set(id, { season: se, date: g.date, key: g.scheduleKey, teamId });
        if (g.pts >= 20) {
          const h = lastHit.get(id);
          if (!h || g.date > h.date || (g.date === h.date && g.scheduleKey > h.key)) lastHit.set(id, { date: g.date, key: g.scheduleKey, teamId });
        }
      }
    }
  }
  const res = queryThresholdCount({
    views, gameType: "regular", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", positions: [], rookies: null,
    threshold: { match: "all", conditions: [{ id: 1, key: "pts", op: "gte", value: "20" }] }, includeSpecial: false, topN: 1_000_000, sort: "count", career: true,
  })!;
  let bad = 0;
  let differ = 0;
  const examples: string[] = [];
  for (const r of res.rows) {
    const l = last.get(r.playerId)!;
    if (r.teamId !== l.teamId || r.lastSeason !== l.season || r.firstSeason !== first.get(r.playerId)) {
      bad += 1;
      if (examples.length < 5) examples.push(`${r.playerId} ${r.playerName}: 行=${r.teamId}/${r.firstSeason}〜${r.lastSeason} 数え直し=${l.teamId}/${first.get(r.playerId)}〜${l.season}`);
    }
    if (lastHit.get(r.playerId)!.teamId !== l.teamId) {
      differ += 1;
      if (differ <= 6) console.log(`例: ${r.playerName}（${r.playerId}） 修正前=${lastHit.get(r.playerId)!.teamId} → 修正後=${r.teamName}（${r.firstSeason}〜${r.lastSeason}）`);
    }
  }
  check(`達成記録（通算・PTS20以上）の最終所属とシーズンの範囲が、最後に出場した試合の数え直しと一致（${res.rows.length}人。達成したチームと最後に出場したチームが違う選手 ${differ}人を含む）`, bad === 0 && differ > 0);
  if (bad) console.error(examples.join("\n"));
  const mab = res.rows.find((r) => r.playerId === "8709");
  check("マブンガ（8709）は最終所属が宇都宮（達成した最後のチームは富山）", !!mab && mab.teamName.includes("宇都宮") && lastHit.get("8709")!.teamId !== mab.teamId);
  // 勝負所（通算）: 勝負所の得点が無い試合に出ただけの最後のチームも最終所属に数える
  const cl = queryClutch({ views, gameType: "regular", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group: "all", rookies: null, measure: "goAhead", window: "5", topN: 1_000_000 }).rows;
  let cbad = 0;
  for (const r of cl) {
    const l = last.get(r.playerId)!;
    if (r.teamId !== l.teamId || r.lastSeason !== l.season || r.firstSeason !== first.get(r.playerId)) cbad += 1;
  }
  check(`勝負所（通算）の最終所属とシーズンの範囲が、最後に出場した試合の数え直しと一致（${cl.length}人）`, cbad === 0);
  // 通算記録（league-player-career-top.json）: 最新シーズンの名簿にいない選手は、最後に出場した試合のチーム・シーズン
  const top = (await readJson<{ players: Record<string, { teamId: string; latestSeason: string }> }>(path.join(DATA_DIR, "league-player-career-top.json")))!;
  const newest = seasons[seasons.length - 1]!;
  let tbad = 0;
  for (const [id, p] of Object.entries(top.players)) {
    const l = last.get(id);
    if (!l || p.latestSeason === newest) continue;
    if (p.teamId !== l.teamId || p.latestSeason !== l.season) tbad += 1;
  }
  check("通算記録の最終所属・在籍確認のシーズンが、最後に出場した試合（レギュラーシーズン）と一致（最新シーズンの名簿の選手を除く）", tbad === 0);
}

if (failures.length) {
  console.error(`NG ${failures.length}件:\n${failures.join("\n")}`);
  process.exit(1);
}
console.log("OK: 最終所属の書き方");
