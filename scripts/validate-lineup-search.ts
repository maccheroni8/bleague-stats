// ラインナップ検索（src/lib/lineupSearch.ts。DESIGN.md 207章）の照合スクリプト（検証専用）。
//
// 1. 5人の組み合わせを選んだときの Players On が、lineups/{teamId}.json のその組み合わせの値（出場時間・得点・失点・攻撃の数・試合数）と一致するか
// 2. 選手1人を選んだときの Players On／Off（レギュラーシーズン）の得失点差が、画面に出ているその選手のオン／オフの値
//    （players.json の advanced.onCourtNet／offCourtNet。公式の+/-が無いシーズンは復元した値）と一致するか
// 3. 同じ選手の Players On／Off が、個人詳細のオンコート/オフコート（src/lib/onCourtSplit.ts。生のプレーバイプレーを秒の境界で振り分ける）の
//    出場時間・得点・失点と一致するか（交代と同じ秒の得点の振り分けが違うため、完全には合わない。攻撃の数は数え方が違うので差だけを出す）
//
// 使い方: npm run validate:lineup-search -- --season 2025-26 [--players 8]
//   （src/ のコードを使うため esbuild でまとめて実行する）

import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import { onCourtPeriodCount, reconstructOnCourt, substitutionModelForSeason } from "../shared/onCourt.ts";
import { computeGameOnOffSplit, mergeOnOffSplits, type OnOffSplit } from "../src/lib/onCourtSplit";
import { searchLineup } from "../src/lib/lineupSearch";
import type { GameSummary, PlayerSummary, StoredGame, TeamLineupsFile, TeamStintsFile } from "../shared/types.ts";

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string) => (args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback);
const season = argValue("--season", "2025-26");
const playersPerTeam = Number(argValue("--players", "8"));
const all = { includeGame: () => true, periods: null };

async function main() {
  const games = (await readAllGames(season)).filter((g) => g.gameEndedFlg);
  const gameByKey = new Map(games.map((g) => [g.scheduleKey, g]));

  // ---- 1. 5人の組み合わせ ----
  const teamIds = new Set<string>();
  for (const g of games) {
    teamIds.add(g.homeTeam.id);
    teamIds.add(g.awayTeam.id);
  }
  let lineupChecked = 0;
  const lineupMismatch: string[] = [];
  const stintsByTeam = new Map<string, TeamStintsFile>();
  for (const teamId of teamIds) {
    const stints = await readJson<TeamStintsFile>(path.join(DATA_DIR, season, "team-stints", `${teamId}.json`));
    const lineups = await readJson<TeamLineupsFile>(path.join(DATA_DIR, season, "lineups", `${teamId}.json`));
    if (!stints || !lineups) continue;
    stintsByTeam.set(teamId, stints);
    for (const l of lineups.lineups) {
      const r = searchLineup(stints, l.playerIds, "on", all);
      lineupChecked += 1;
      const same =
        r.seconds === l.secondsPlayed && r.ownPoints === l.ownPoints && r.oppPoints === l.oppPoints && r.ownPoss === (l.ownPoss ?? 0) && r.oppPoss === (l.oppPoss ?? 0) && r.games === l.gamesPlayed;
      if (!same) lineupMismatch.push(`${teamId} ${l.lineupKey}: 検索 ${r.games}試合 ${r.seconds}秒 ${r.ownPoints}-${r.oppPoints} 攻撃${r.ownPoss}/${r.oppPoss} ／ 一覧 ${l.gamesPlayed}試合 ${l.secondsPlayed}秒 ${l.ownPoints}-${l.oppPoints} 攻撃${l.ownPoss}/${l.oppPoss}`);
    }
  }
  // 出場区間が試合の全時間を覆い、得失点差が最終スコアの差と一致する試合（チームごと）。5人を割り出せなかった時間がある試合は含まない
  const completeGames = new Map<string, Set<string>>();
  for (const [teamId, st] of stintsByTeam) {
    const nKeys = st.countKeys.length;
    const ptsIdx = st.countKeys.indexOf("pts");
    const secByGame = new Map<number, number>();
    const netByGame = new Map<number, number>();
    for (const r of st.rows) {
      secByGame.set(r[0]!, (secByGame.get(r[0]!) ?? 0) + r[3]! - r[2]!);
      netByGame.set(r[0]!, (netByGame.get(r[0]!) ?? 0) + r[9 + ptsIdx]! - r[9 + nKeys + ptsIdx]!);
    }
    const set = new Set<string>();
    for (const [gi, sec] of secByGame) {
      const g = gameByKey.get(st.games[gi]!);
      if (!g) continue;
      const margin = (g.homeScore - g.awayScore) * (g.homeTeam.id === teamId ? 1 : -1);
      const periods = onCourtPeriodCount(season, g.quarterScores.home.length, g.raw.PlayByPlays);
      const expected = 4 * 600 + Math.max(0, periods - 4) * 300;
      if (sec === expected && netByGame.get(gi) === margin) set.add(st.games[gi]!);
    }
    completeGames.set(teamId, set);
  }
  console.log(`[1] 5人の組み合わせ: ${lineupChecked}通りを照合、不一致 ${lineupMismatch.length}`);
  for (const m of lineupMismatch.slice(0, 10)) console.log("  " + m);

  // ---- 2・3. 選手1人 ----
  const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
  const regularKeys = new Set(summaries.filter((g) => g.gameType === "regular").map((g) => g.scheduleKey));
  const regular = { includeGame: (k: string) => regularKeys.has(k), periods: null };
  const playerSummaries = (await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, "players.json"))) ?? [];
  const summaryByPlayer = new Map(playerSummaries.map((p) => [p.playerId, p]));
  const substitutionModel = substitutionModelForSeason(season);
  // 選手×チームごとに、出場した試合のオン/オフを合算（個人詳細と同じ。出場した試合だけが対象）
  const refByPlayerTeam = new Map<string, OnOffSplit[]>();
  const minutesByPlayerTeam = new Map<string, number>();
  // 復元した個人+/-（reconstructOnCourt().plusMinus）の合計。Players On の得失点差と同じ元データから出ているので、完全に一致するはず
  const reconstructedPm = new Map<string, number>();
  const reconstructedPmComplete = new Map<string, number>();
  for (const game of games) {
    if (game.raw.PlayByPlays.length === 0) continue;
    const onCourt = reconstructOnCourt(game.raw.PlayByPlays, game.raw.HomeBoxscores, game.raw.AwayBoxscores, game.homeTeam.id, game.awayTeam.id, onCourtPeriodCount(season, game.quarterScores.home.length, game.raw.PlayByPlays), substitutionModel);
    const byPlayer = new Map<string, { startSec: number; endSec: number }[]>();
    for (const iv of onCourt.intervals) {
      const key = `${iv.playerId}|${iv.teamId}`;
      let list = byPlayer.get(key);
      if (!list) byPlayer.set(key, (list = []));
      list.push(iv);
    }
    for (const [key, ivs] of byPlayer) {
      const sec = ivs.reduce((s, iv) => s + (iv.endSec - iv.startSec), 0);
      if (sec <= 0) continue;
      const teamId = key.split("|")[1]!;
      const split = computeGameOnOffSplit(game, teamId, ivs);
      let list = refByPlayerTeam.get(key);
      if (!list) refByPlayerTeam.set(key, (list = []));
      list.push(split);
      minutesByPlayerTeam.set(key, (minutesByPlayerTeam.get(key) ?? 0) + sec);
      reconstructedPm.set(key, (reconstructedPm.get(key) ?? 0) + (onCourt.plusMinus[key.split("|")[0]!] ?? 0));
      if (completeGames.get(teamId)?.has(game.scheduleKey)) {
        reconstructedPmComplete.set(key, (reconstructedPmComplete.get(key) ?? 0) + (onCourt.plusMinus[key.split("|")[0]!] ?? 0));
      }
    }
  }
  // チームごとに出場時間の多い上位の選手を照合する
  const byTeam = new Map<string, string[]>();
  for (const [key] of [...minutesByPlayerTeam.entries()].sort((a, b) => b[1] - a[1])) {
    const teamId = key.split("|")[1]!;
    const list = byTeam.get(teamId) ?? [];
    if (list.length < playersPerTeam) list.push(key);
    byTeam.set(teamId, list);
  }
  let checked = 0;
  let netChecked = 0;
  let pmChecked = 0;
  const pmBad: string[] = [];
  const pmCompleteBad: string[] = [];
  const netBad: string[] = [];
  const netDiffs: number[] = [];
  const bad: string[] = [];
  let possDiffSum = 0;
  let possDiffN = 0;
  const diffs: Record<string, number[]> = { onSec: [], onOwn: [], onOpp: [], offSec: [], offOwn: [], offOpp: [], games: [] };
  for (const [teamId, keys] of byTeam) {
    const stints = stintsByTeam.get(teamId);
    if (!stints) continue;
    for (const key of keys) {
      const playerId = key.split("|")[0]!;
      const ref = mergeOnOffSplits(refByPlayerTeam.get(key)!);
      const on = searchLineup(stints, [playerId], "on", all);
      const off = searchLineup(stints, [playerId], "off", all);
      checked += 1;
      pmChecked += 1;
      const pmDiff = on.ownPoints - on.oppPoints - (reconstructedPm.get(key) ?? 0);
      if (pmDiff !== 0) pmBad.push(`${playerId} (${teamId}): 検索 ${on.ownPoints - on.oppPoints} / 復元した+/-の合計 ${reconstructedPm.get(key)}`);
      const completeSet = completeGames.get(teamId) ?? new Set<string>();
      const onC = searchLineup(stints, [playerId], "on", { includeGame: (k) => completeSet.has(k), periods: null });
      if (onC.ownPoints - onC.oppPoints !== (reconstructedPmComplete.get(key) ?? 0)) pmCompleteBad.push(`${playerId} (${teamId}): 検索 ${onC.ownPoints - onC.oppPoints} / 復元 ${reconstructedPmComplete.get(key) ?? 0}`);
      const summary = summaryByPlayer.get(playerId);
      // 移籍した選手は、チームごとの合算にならないので、1チームだけの選手を対象にする
      if (summary && summary.teamId === teamId && summary.advanced) {
        const onR = searchLineup(stints, [playerId], "on", regular);
        const offR = searchLineup(stints, [playerId], "off", regular);
        netChecked += 1;
        const dOn = onR.ownPoints - onR.oppPoints - summary.advanced.onCourtNet;
        const dOff = offR.ownPoints - offR.oppPoints - summary.advanced.offCourtNet;
        netDiffs.push(Math.max(Math.abs(dOn), Math.abs(dOff)));
        if (dOn !== 0 || dOff !== 0) netBad.push(`${summary.name} (${teamId}): On ${onR.ownPoints - onR.oppPoints} / 画面 ${summary.advanced.onCourtNet}、Off ${offR.ownPoints - offR.oppPoints} / 画面 ${summary.advanced.offCourtNet}`);
      }
      const d = { onSec: on.seconds - ref.on.seconds, onOwn: on.ownPoints - ref.on.ownPts, onOpp: on.oppPoints - ref.on.oppPts, offSec: off.seconds - ref.off.seconds, offOwn: off.ownPoints - ref.off.ownPts, offOpp: off.oppPoints - ref.off.oppPts, games: on.games - refByPlayerTeam.get(key)!.length };
      for (const [k, v] of Object.entries(d)) diffs[k]!.push(v);
      if (Object.values(d).some((v) => v !== 0)) bad.push(`${playerId} (${teamId}): ${JSON.stringify(d)}`);
      possDiffSum += on.ownPoss - ref.on.ownPoss;
      possDiffN += 1;
    }
  }
  const completeCount = [...completeGames.values()].reduce((a, s) => a + s.size, 0);
  const allCount = [...stintsByTeam.values()].reduce((a, st) => a + st.games.length, 0);
  console.log(`[2a] 選手1人: ${pmChecked}人・チームで、Players On の得失点差を復元した個人+/-の合計と比べた。全試合では違う: ${pmBad.length}（5人を割り出せなかった時間がある試合の分）。時間と得点が完全に覆われた試合（${completeCount}／${allCount}チーム・試合）だけでは違う: ${pmCompleteBad.length}`);
  for (const b of pmCompleteBad.slice(0, 5)) console.log("  " + b);
  for (const b of pmBad.slice(0, 6)) console.log("  " + b);
  console.log(`[2] 選手1人（レギュラーシーズン）: ${netChecked}人を照合。On／Offの得失点差が画面のオン／オフの値と違う: ${netBad.length}`);
  console.log(`   差の大きさ（On・Offのうち大きいほう）: 0 ${netDiffs.filter((d) => d === 0).length}人、1 ${netDiffs.filter((d) => d === 1).length}人、2 ${netDiffs.filter((d) => d === 2).length}人、3以上 ${netDiffs.filter((d) => d >= 3).length}人`);
  for (const b of netBad.slice(0, 6)) console.log("  " + b);
  console.log(`[3] 選手1人（全試合）: ${checked}人・チームを照合（出場時間の多い順に各チーム${playersPerTeam}人）。個人詳細の秒の境界で振り分ける方法と、出場時間・得点・失点・試合数のどれかが違う: ${bad.length}`);
  for (const k of Object.keys(diffs)) {
    const v = diffs[k]!;
    const nz = v.filter((x) => x !== 0);
    console.log(`   ${k}: 差が0でない ${nz.length}件${nz.length ? `（範囲 ${Math.min(...nz)}〜${Math.max(...nz)}、絶対値の合計 ${nz.reduce((s, x) => s + Math.abs(x), 0)}）` : ""}`);
  }
  console.log(`   Players On の自チームの攻撃の数: 個人詳細（攻撃の始まりから数えた推定）との差の平均 ${(possDiffSum / Math.max(1, possDiffN)).toFixed(1)}（検索のほうが多い場合は＋）`);
  for (const b of bad.slice(0, 5)) console.log("  " + b);
}

main();
