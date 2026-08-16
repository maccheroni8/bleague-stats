// data/logos/{teamId}.png（透過PNG）から支配色を抽出し、data/team-colors.jsonとして保存する。
// デザイン刷新（チームカラーをUIのアクセントカラーに使う）の基盤データ（2026-08-16作成）。
//
// 手法: 不透明ピクセルのみを対象に、RGB各チャンネルを16段階に量子化してバケット集計し、
// 最頻出色をprimaryとする。secondaryはprimaryと十分離れた色のうち次に頻出する色を採用する
// （見つからなければprimaryを暗くした色で代替する）。
// 純白・純黒は背景・輪郭線として頻出しブランドカラーとしての意味が薄いため候補から除外する。

import path from "node:path";
import sharp from "sharp";
import { TEAM_NAMES } from "./lib/divisions.ts";
import { DATA_DIR, fileExists, writeJson } from "./lib/storage.ts";

const LOGOS_DIR = path.join(DATA_DIR, "logos");
const OUTPUT_PATH = path.join(DATA_DIR, "team-colors.json");

const BUCKET_STEP = 16; // 256/16 = 16段階に量子化
const MIN_ALPHA = 128;
const MIN_DISTANCE_FOR_SECONDARY = 60; // RGB空間でのユークリッド距離

type RGB = [number, number, number];

function quantize(v: number): number {
  return Math.round(v / BUCKET_STEP) * BUCKET_STEP;
}

function isNearWhiteOrBlack(r: number, g: number, b: number): boolean {
  if (r >= 245 && g >= 245 && b >= 245) return true;
  if (r <= 10 && g <= 10 && b <= 10) return true;
  return false;
}

function toHex(rgb: RGB): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

function colorDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function darken(rgb: RGB, factor: number): RGB {
  return [Math.round(rgb[0] * factor), Math.round(rgb[1] * factor), Math.round(rgb[2] * factor)];
}

async function extractColors(pngPath: string): Promise<{ primary: string; secondary: string }> {
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const counts = new Map<string, { count: number; rgb: RGB }>();

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 0;
    if (a < MIN_ALPHA) continue;
    if (isNearWhiteOrBlack(r, g, b)) continue;

    const rgb: RGB = [quantize(r), quantize(g), quantize(b)];
    const key = rgb.join(",");
    const existing = counts.get(key);
    if (existing) existing.count += 1;
    else counts.set(key, { count: 1, rgb });
  }

  const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
  const top = sorted[0];
  if (!top) {
    // 全ピクセルが白/黒/透過だった場合のフォールバック（想定上は発生しないはず）
    return { primary: "#333333", secondary: "#999999" };
  }

  const primary = top.rgb;
  const secondaryEntry = sorted.slice(1).find((c) => colorDistance(c.rgb, primary) >= MIN_DISTANCE_FOR_SECONDARY);
  const secondary = secondaryEntry ? secondaryEntry.rgb : darken(primary, 0.6);

  return { primary: toHex(primary), secondary: toHex(secondary) };
}

async function main() {
  const result: Record<string, { primary: string; secondary: string }> = {};
  const teamIds = Object.keys(TEAM_NAMES);

  for (const teamId of teamIds) {
    const logoPath = path.join(LOGOS_DIR, `${teamId}.png`);
    if (!fileExists(logoPath)) {
      console.log(`[skip] ${teamId} (${TEAM_NAMES[teamId]}): ロゴファイルが見つかりません`);
      continue;
    }
    const colors = await extractColors(logoPath);
    result[teamId] = colors;
    console.log(`[ok] ${teamId} (${TEAM_NAMES[teamId]}): primary=${colors.primary} secondary=${colors.secondary}`);
  }

  await writeJson(OUTPUT_PATH, result);
  console.log(`\n${Object.keys(result).length}/${teamIds.length}クラブ分を${OUTPUT_PATH}に保存しました`);
}

main();
