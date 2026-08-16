// data/logos/{teamId}.png（透過PNG）から支配色を抽出し、data/team-colors.jsonとして保存する。
// デザイン刷新（チームカラーをUIのアクセントカラーに使う）の基盤データ（2026-08-16作成）。
//
// 手法: 不透明ピクセルのみを対象に、RGB各チャンネルを16段階に量子化してバケット集計するが、
// 単純な出現回数ではなく「彩度×明度重み」を加算したスコアで集計する（2026-08-16改良）。
// ロゴには縁取り線・影として低彩度色（黒・濃灰・焦げ茶等）が大きな面積を占めることが多く、
// 単純な頻度集計だとそれがブランドカラーを押しのけて選ばれてしまう（実例: SENDAI 89ERSの
// 太い輪郭線、京都ハンナリーズの黒文字、大阪エヴェッサの黒い炎シルエット等）。
// 彩度が高くL=0.5付近の明度を持つピクセルほど重みを大きくすることで、面積は小さくても
// 鮮やかなロゴの主色（黄緑・水色・赤等）を優先的に拾えるようにする。
// secondaryはprimaryと十分離れた色のうち次にスコアが高い色を採用する
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

/** RGB(0-255)を彩度s・明度l(共に0-1)に変換する（色相hは重み計算に使わないため省略） */
function saturationAndLightness(r: number, g: number, b: number): { s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  return { s, l };
}

/**
 * ピクセル1個の「ブランドカラーらしさ」の重み。彩度が高いほど重く、明度はL=0.5付近を
 * ピークに黒つぶれ(L→0)・白飛び(L→1)に近づくほど軽くする。縁取り線・影の黒灰色（低彩度）や
 * ハイライトの白っぽい色（高明度・低彩度）は自然に重みが小さくなり、頻度で勝っていても
 * 選ばれにくくなる
 */
function pixelWeight(s: number, l: number): number {
  const lightnessFactor = Math.max(0, 1 - Math.abs(l - 0.5) * 2); // L=0.5で1、L=0/1で0
  return s ** 1.5 * lightnessFactor;
}

async function extractColors(pngPath: string): Promise<{ primary: string; secondary: string }> {
  const { data, info } = await sharp(pngPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const buckets = new Map<string, { score: number; count: number; rgb: RGB }>();

  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 0;
    if (a < MIN_ALPHA) continue;
    if (isNearWhiteOrBlack(r, g, b)) continue;

    const { s, l } = saturationAndLightness(r, g, b);
    const weight = pixelWeight(s, l);
    if (weight <= 0) continue;

    const rgb: RGB = [quantize(r), quantize(g), quantize(b)];
    const key = rgb.join(",");
    const existing = buckets.get(key);
    if (existing) {
      existing.score += weight;
      existing.count += 1;
    } else {
      buckets.set(key, { score: weight, count: 1, rgb });
    }
  }

  const sorted = [...buckets.values()].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  if (!top) {
    // 全ピクセルが白/黒/透過/無彩色だった場合のフォールバック（想定上は発生しないはず）
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
