// 選手ページ（bleague.jp/roster_detail/）の「クラブ所属履歴」を取得し、data/player-club-history.json（元データ）に保存する（DESIGN.md 214章）。
// ルーキー（新人賞の対象要件に準じた判定）で、「初めてB.LEAGUEに登録されたシーズン」（B2・B3を含む）を知るために使う。
//
// - 取得対象: 名簿に最初に載ったシーズンが2017-18以降の、登録区分が日本人の選手のうち、まだ履歴の無い選手。
//   元データ（シーズン別の選手一覧・今の選手名簿・選手マスタ）だけで決まる（scripts/lib/clubHistory.ts）
// - 問い合わせ: 既存の個人ページの取得（scrape-roster.ts の fetchPlayerPage。間隔2.5秒以上・直列・30秒で打ち切り・5xx/通信の失敗は再試行）をそのまま使う。
//   約290人で12〜13分。1件の失敗で止めず、最後に失敗した選手を一覧に出す（その選手は「判定不能」のまま。次の実行でやり直す）
// - 選手マスタ（players-master.json）は読まない・書き換えない（生年月日を読むために開くだけ）。scrape:roster は呼ばない。
//   深夜実行では、新しく登録された選手の履歴は scrape-roster.ts が同じ個人ページから読んで足す（追加の問い合わせは無い）ので、
//   このスクリプトが取るのは「読めなかった選手のやり直し」だけで、通常は0件
//
// 使い方:
//   npm run scrape:club-history                  取得対象のうち履歴が無い選手を、全員取る（初回の一括取得。失敗があれば終了コード1）
//   npm run scrape:club-history -- --dry-run     対象の人数だけ表示（問い合わせはしない）
//   npm run scrape:club-history -- --nightly --budget-min 12
//                                                深夜実行用。時間の上限（分）で打ち切り、残りは次の夜に回す。失敗は警告にとどめて終了コード0

import path from "node:path";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import { fetchPlayerPage } from "./scrape-roster.ts";
import { addClubHistory, clubHistoryTargets, readClubHistory } from "./lib/clubHistory.ts";
import { formatRequestCounts } from "./lib/throttle.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { ClubHistoryEntry, CurrentRosterFile, PlayerMasterEntry, SeasonRostersFile } from "../shared/types.ts";

const SAVE_EVERY = 20;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const nightly = args.includes("--nightly");
  const budgetIndex = args.indexOf("--budget-min");
  const budgetMs = budgetIndex !== -1 ? Number(args[budgetIndex + 1]) * 60_000 : Infinity;

  const rosters = (await readJson<SeasonRostersFile>(path.join(DATA_DIR, "season-rosters.json"))) ?? {};
  const currentRoster = await readJson<CurrentRosterFile>(path.join(DATA_DIR, "current-roster.json"));
  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const nameOf = new Map(master.map((p) => [p.playerId, p.name]));

  const targets = clubHistoryTargets(rosters, currentRoster, master);
  const have = (await readClubHistory()).players;
  const missing = targets.filter((t) => !have[t.playerId]);
  console.log(`[club-history] 取得対象${targets.length}名のうち、履歴が未取得の選手: ${missing.length}名（取得済み${targets.length - missing.length}名）`);
  if (dryRun || missing.length === 0) return;

  const startedAt = Date.now();
  const pending = new Map<string, ClubHistoryEntry[]>();
  const failed: { playerId: string; reason: string }[] = [];
  let saved = 0;
  let processed = 0;
  for (const t of missing) {
    if (Date.now() - startedAt > budgetMs) {
      console.warn(`[club-history] 時間の上限（${Math.round(budgetMs / 60_000)}分）に達したため、残り${missing.length - processed}名は次回に回します`);
      break;
    }
    processed += 1;
    try {
      const { clubHistory } = await fetchPlayerPage(t.playerId);
      if (clubHistory) pending.set(t.playerId, clubHistory);
      else failed.push({ playerId: t.playerId, reason: "個人ページに「クラブ所属履歴」の欄が見つからない" });
    } catch (err) {
      failed.push({ playerId: t.playerId, reason: String(err) });
    }
    // 途中で打ち切られても取得済みの分が無駄にならないよう、こまめに保存する
    if (pending.size >= SAVE_EVERY) {
      saved += await addClubHistory(pending);
      pending.clear();
    }
    if (processed % 25 === 0) console.log(`[club-history] ${processed}/${missing.length}名 処理（保存${saved + pending.size}名・失敗${failed.length}名）`);
  }
  saved += await addClubHistory(pending);

  console.log(`[club-history] 完了: 取得できて保存${saved}名／失敗${failed.length}名／次回に回した${missing.length - processed}名（${formatRequestCounts()}）`);
  for (const f of failed) {
    console.warn(`[club-history] 取得できず: ${nameOf.get(f.playerId) ?? "(名前不明)"}（${f.playerId}）: ${f.reason}`);
    if (nightly) console.log(`::warning title=Club history::${nameOf.get(f.playerId) ?? f.playerId}（${f.playerId}）の所属履歴を取得できませんでした（次の夜間実行でやり直します）`);
  }
  if (failed.length > 0 && !nightly) process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
