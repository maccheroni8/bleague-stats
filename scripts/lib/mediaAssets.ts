// チームロゴ・選手写真の自前ダウンロード。data/logos/{teamId}.png・
// data/player-photos/{playerId}.webp として保存する。
//
// ホットリンク（bleague.jpの画像URLをそのまま<img src>で参照する方式）は採用しない。
// 実機調査でCORSヘッダー（Access-Control-Allow-Origin）が一切無いことを確認しており、
// 既存の画像出力機能（html2canvas）がロゴ・写真を含むページでcanvasを汚染して壊れるため。
//
// URLパターン（2026-08-16調査。DESIGN.md参照）:
//   ロゴ: https://bleague.bl.kuroco-img.app/files/user/common/img/logo/{年}/m/{クラブコード}.png
//     クラブコードはTeamID→teamLogoCodes.tsの対応表で解決する
//   選手写真: https://bleague.bl.kuroco-img.app/files/user/roster/{TeamID}/{シーズン}/{PlayerID}_03.png
//     シーズンフォルダはそのシーズンの写真がbleague.jp側で公開されて初めて中身ができるため、
//     開幕前（プレシーズン）は現在シーズンのフォルダが404になることがある（実機確認済み）。
//     その場合は1つ前のシーズンのフォルダにフォールバックする
//
// なお`v=xxxxx/`のバージョンプレフィックスは省略可能（実機確認済み。省略時も200で同じ画像が返る）。

import path from "node:path";
import sharp from "sharp";
import { DATA_DIR, fileExists, writeBinaryFile } from "./storage.ts";
import { TEAM_LOGO_CODES } from "./teamLogoCodes.ts";

const IMG_HOST = "https://bleague.bl.kuroco-img.app";
const LOGOS_DIR = path.join(DATA_DIR, "logos");
const PHOTOS_DIR = path.join(DATA_DIR, "player-photos");

const PHOTO_TARGET_BYTES = 20 * 1024;
const PHOTO_SIZE = 240;

/** "2026-27" → "2025-26" */
function previousSeason(season: string): string {
  const startYear = Number(season.split("-")[0]);
  return `${startYear - 1}-${String(startYear).slice(-2)}`;
}

async function fetchBinary(
  throttledFetch: (url: string) => Promise<Response>,
  url: string,
): Promise<Buffer | null> {
  const res = await throttledFetch(url);
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/**
 * チームロゴを全26クラブ分ダウンロードする。ブランド刷新への追従を自動化するため、
 * 既存ファイルの有無に関わらず毎回取得し直す（26枚と軽量なので週次実行でも問題ない）。
 *
 * Bリーグ側は開幕（10月）を待たずに翌シーズンのロゴを先行公開することがある
 * （2026-08-18、北海道・仙台・東京SR・信州・三遠・島根の6クラブでこの先行公開を確認済み。
 * DESIGN.md参照）。一方`season`（`currentSeason()`）は10月にならないと繰り上がらないため、
 * `season`が指す年のフォルダだけを見ていると、先行公開されたロゴに何ヶ月も気付けない。
 * そこで`season`の年＋1のフォルダを毎回先に試し、無ければ`season`の年のフォルダに
 * フォールバックする（まだ先行公開されていないクラブ向け）。毎回両方を再チェックする
 * ことで、後から別のクラブが新ロゴを公開した場合も次回の週次実行で自動的に追従する
 */
export async function downloadTeamLogos(
  season: string,
  throttledFetch: (url: string) => Promise<Response>,
): Promise<void> {
  const year = Number(season.split("-")[0]);
  let savedCount = 0;
  for (const [teamId, code] of Object.entries(TEAM_LOGO_CODES)) {
    const preferredUrl = `${IMG_HOST}/files/user/common/img/logo/${year + 1}/m/${code}.png`;
    const fallbackUrl = `${IMG_HOST}/files/user/common/img/logo/${year}/m/${code}.png`;
    const buf = (await fetchBinary(throttledFetch, preferredUrl)) ?? (await fetchBinary(throttledFetch, fallbackUrl));
    if (!buf) {
      console.warn(`[logo] teamId=${teamId} (${code}) 取得失敗: ${preferredUrl} / ${fallbackUrl}`);
      continue;
    }
    await writeBinaryFile(path.join(LOGOS_DIR, `${teamId}.png`), buf);
    savedCount += 1;
  }
  console.log(`[logo] ${savedCount}/${Object.keys(TEAM_LOGO_CODES).length}クラブ分保存`);
}

/** 顔写真中心にクロップしてWebPへリサイズ変換する。品質を段階的に下げてPHOTO_TARGET_BYTES以下に収める */
async function toCompactWebp(buf: Buffer): Promise<Buffer> {
  const qualities = [80, 65, 50, 35];
  let out = buf;
  for (const quality of qualities) {
    out = await sharp(buf)
      .resize({ width: PHOTO_SIZE, height: PHOTO_SIZE, fit: "cover", position: "top" })
      .webp({ quality })
      .toBuffer();
    if (out.byteLength <= PHOTO_TARGET_BYTES) break;
  }
  return out;
}

/**
 * 1選手分の写真をダウンロードする。既に保存済みならスキップする（force指定時は除く）。
 * 現在シーズンのパスが404の場合（開幕前でまだ公開されていない等）は1つ前のシーズンへフォールバックする。
 * 取得できた時点でリサイズ・WebP変換まで行ってから保存する（取得時に解決し、表示時に毎回変換しない）
 */
export async function downloadPlayerPhoto(
  teamId: string,
  playerId: string,
  season: string,
  throttledFetch: (url: string) => Promise<Response>,
  options: { force?: boolean } = {},
): Promise<boolean> {
  const destPath = path.join(PHOTOS_DIR, `${playerId}.webp`);
  if (fileExists(destPath) && !options.force) return false;

  const seasonsToTry = [season, previousSeason(season)];
  for (const s of seasonsToTry) {
    const url = `${IMG_HOST}/files/user/roster/${teamId}/${s}/${playerId}_03.png`;
    const buf = await fetchBinary(throttledFetch, url);
    if (buf) {
      const webp = await toCompactWebp(buf);
      await writeBinaryFile(destPath, webp);
      return true;
    }
  }
  return false;
}
