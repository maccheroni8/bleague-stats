// bleague.jpのroster_detail/?PlayerID=ページの「受賞歴」セクション（.rosterDetail-awardHistory）を、
// players-master.json記載の全選手について再取得し、data/player-awards.json に保存する。
//
// scrape-roster.tsの個人ページ取得は「まだマスタに無い新規選手だけ」に限定されている
// （生年月日・身長体重等は不変データで、既知選手を毎回取り直す必要が無いため）。しかし
// 受賞歴は不変データではなく、シーズン終了後の授賞タイミングで既存選手にも新しい受賞が
// 追加されうる。そのため受賞歴だけは独立した再取得ポリシー（このスクリプトを月1回、
// players-master.json記載の全選手に対して実行する）を設ける。
//
// 頻度について（2026-08-21調査）: bleague.jp公式サイトのナビゲーションに"Monthly MVP"という
// 動画タグ（video_list/?tag_id=24）が存在することを確認したが、実際にroster_detailの
// 「受賞歴」セクションに月間表彰が記録されている形跡は無かった（複数シーズン・複数選手の
// サンプル調査でシーズン単位の賞のみ確認。DESIGN.md 44章・46章参照）。年間表彰（MVP・
// ベストファイブ・新人賞・スタッツ王等）はシーズン終了直後（5〜6月頃）に集中して発表される
// 想定のため、月1回の全選手再取得で取りこぼしのリスクは低いと判断した。写真の週次リトライ
// ほど鮮度が重要なデータではない。将来的に月間表彰が「受賞歴」欄に反映されるようになった
// ことが確認できれば、実行頻度を見直す。
//
// players-master.json記載の全選手（＝現在契約中の選手のみ、11章の既知の制約）を毎回取得し
// 直すため、300名超で2〜3秒間隔のレート制限により15〜20分程度かかる（scrape-roster.tsの
// 初回フル実行と同程度のコスト）。退団・引退済みの過去選手の受賞歴は、players-master.json
// 自体が現在契約中の選手のスナップショットという既存の制約により対象外（11章と同じ限定）。
//
// 使い方:
//   npm run scrape:player-awards

import path from "node:path";
import { DATA_DIR, readJson, writeJson } from "./lib/storage.ts";
import { fetchPlayerPage } from "./scrape-roster.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { PlayerAwardsFile, PlayerMasterEntry } from "../shared/types.ts";

const MASTER_PATH = path.join(DATA_DIR, "players-master.json");
const AWARDS_PATH = path.join(DATA_DIR, "player-awards.json");

export async function scrapePlayerAwards(): Promise<PlayerAwardsFile> {
  const master = (await readJson<PlayerMasterEntry[]>(MASTER_PATH)) ?? [];
  const result: PlayerAwardsFile = {};
  let withAwardsCount = 0;

  for (const [i, entry] of master.entries()) {
    const { awards } = await fetchPlayerPage(entry.playerId);
    if (awards.length > 0) {
      result[entry.playerId] = awards;
      withAwardsCount += 1;
    }
    if ((i + 1) % 20 === 0) console.log(`[player-awards] ${i + 1}/${master.length}名処理済み`);
  }

  console.log(`[player-awards] 受賞歴あり: ${withAwardsCount}/${master.length}名`);
  return result;
}

async function main(): Promise<void> {
  const awards = await scrapePlayerAwards();
  await writeJson(AWARDS_PATH, awards);
  console.log(`保存完了: ${AWARDS_PATH}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
