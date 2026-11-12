// EASL の海外クラブのロゴ。data/logos/easl/{EASLのチームID}.png に 400×400 の透過PNGで置く（B.LEAGUE のクラブの data/logos/{teamId}.png と同じ大きさ）。
// 取り先の台帳は data/logos/easl/sources.json（チームID → クラブ名・取り先URL・取得日）。取り先は EASL 公式の試合データ
// （https://easl.joshricha.com/api/v1/matches。公式サイト www.easl.basketball の日程・結果が使っているもの）の competitors[].logo。
// 既にあるロゴは取り直さない。取れなかったクラブは画面側でチームカラーの札になる（空白にしない）。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

export const EASL_LOGO_DIR = 'data/logos/easl';
export const EASL_LOGO_LEDGER = `${EASL_LOGO_DIR}/sources.json`;
export interface EaslLogoLedgerEntry { name: string; source: string; fetchedAt: string }

export function readEaslLogoLedger(): Record<string, EaslLogoLedgerEntry> {
  return fs.existsSync(EASL_LOGO_LEDGER) ? JSON.parse(fs.readFileSync(EASL_LOGO_LEDGER, 'utf8')) : {};
}

/** 足りないロゴだけ取る。1件の失敗で止めず、取れた数を返す */
export async function fetchMissingEaslLogos(sources: Map<string, { name: string; url: string }>, get: (url: string) => Promise<Response>): Promise<{ saved: number; failed: string[] }> {
  fs.mkdirSync(EASL_LOGO_DIR, { recursive: true });
  const ledger = readEaslLogoLedger();
  let saved = 0;
  const failed: string[] = [];
  for (const [teamId, { name, url }] of sources) {
    if (!/^[0-9a-f-]{36}$/.test(teamId)) { failed.push(name); continue; }
    const file = path.join(EASL_LOGO_DIR, `${teamId}.png`);
    if (fs.existsSync(file)) continue;
    try {
      const response = await get(url);
      if (!response.ok) throw new Error(String(response.status));
      const png = await sharp(Buffer.from(await response.arrayBuffer()))
        .resize({ width: 400, height: 400, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png({ palette: true, compressionLevel: 9 }).toBuffer();
      fs.writeFileSync(file, png);
      ledger[teamId] = { name, source: url, fetchedAt: new Date().toISOString().slice(0, 10) };
      saved += 1;
    } catch (error) {
      console.warn(`[easl-logo] ${name} 取得失敗: ${(error as Error).message}`);
      failed.push(name);
    }
  }
  if (saved) fs.writeFileSync(EASL_LOGO_LEDGER, `${JSON.stringify(Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b))), null, 2)}\n`);
  return { saved, failed };
}
