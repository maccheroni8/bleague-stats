// 不戦勝／不戦敗の台帳（docs/forfeit-ledger/ledger.json。DESIGN.md 431章）を読み、結果だけの試合（resultOnlyGames）の項目にする。
// 公式の日程のカードが「不戦勝／不戦敗」＋得点に変わる前でも、公式のお知らせを根拠に勝敗・得失点へ入れるための手書きの行。
// 優先は「公式のカード＞台帳」: 台帳の行は、まだ結果だけの試合に無い試合にだけ足す（公式のカードから作った項目は、そのまま上書きされる）。
// この場所は保存キーの対象外（scripts/lib/storage.ts・shared/resultOnlyGames.ts は触らない）。
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Category } from "../../shared/types.ts";
import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames.ts";

const LEDGER_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "forfeit-ledger", "ledger.json");

export interface ForfeitLedgerRow extends ResultOnlyGameEntry {
  season: string;
  category: Category;
  source: { url: string; title: string; announcedOn: string; rule: string };
}

/** 台帳の行を読む。ファイルが無ければ空 */
export function readForfeitLedgerRows(ledgerPath: string = LEDGER_PATH): ForfeitLedgerRow[] {
  if (!existsSync(ledgerPath)) return [];
  const file = JSON.parse(readFileSync(ledgerPath, "utf-8")) as { games?: ForfeitLedgerRow[] };
  return file.games ?? [];
}

/** そのシーズン・カテゴリの台帳の行を、結果だけの試合の項目（source などの台帳だけの項目を除く）にして返す */
export function forfeitLedgerEntries(season: string, category: Category, ledgerPath?: string): ResultOnlyGameEntry[] {
  return readForfeitLedgerRows(ledgerPath)
    .filter((r) => r.season === season && (r.category ?? "premier") === category)
    .map(({ season: _s, category: _c, source: _src, ...entry }) => ({ ...entry, reason: "forfeit" as const }));
}

/**
 * 台帳の項目のうち、前回までの結果だけの試合にも今回公式のカードから作れた項目にも無い試合だけを返す
 * （公式のカードから作った項目、またはそれを引き継いだ項目を、台帳で上書きしない）
 */
export function ledgerFill(
  ledger: ResultOnlyGameEntry[],
  existing: ResultOnlyGameEntry[],
  builtFromOfficial: ResultOnlyGameEntry[],
): ResultOnlyGameEntry[] {
  const have = new Set([...existing, ...builtFromOfficial].map((g) => g.scheduleKey));
  return ledger.filter((g) => !have.has(g.scheduleKey));
}
