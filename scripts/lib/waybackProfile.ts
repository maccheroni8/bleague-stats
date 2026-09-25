// Wayback Machine に保存された bleague.jp の選手ページ（roster_detail）から、当時の身長・体重・ポジションを読み取る
// （scripts/scrape-wayback-profiles.ts。DESIGN.md 146章）。ページの作りは時期で3通りある:
// - 2018〜2019年: 「ポジション / SG」「身長(cm) 203cm 体重(kg) 100kg」
// - 2020〜2022年: <p class="position_name">SG/SF</p>、「身長(cm) 192cm 体重(kg) 88kg」
// - 2023年〜: 「ポジション SF」「身長／体重 196cm／95kg」
// 値が空欄（「身長(cm) cm」等）のときは持たない
import { gunzipSync } from "node:zlib";

export interface WaybackProfile {
  heightCm?: number;
  weightKg?: number;
  position?: string;
}

/** 保存時の圧縮のまま返ってくるスナップショットがあるので、gzip なら展開して文字列にする */
export function decodeSnapshot(buf: Buffer): string {
  const raw = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf) : buf;
  return raw.toString("utf-8");
}

const POSITION_PATTERN = /^(?:PG|SG|SF|PF|C)(?:\/(?:PG|SG|SF|PF|C))*$/;

function plainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

export function parseWaybackProfile(html: string): WaybackProfile {
  const text = plainText(html);
  const out: WaybackProfile = {};

  const newer = /身長／体重\s*(\d{3})?\s*cm\s*／\s*(\d{2,3})?\s*kg/.exec(text);
  const older = /身長\(cm\)\s*(\d{3})?\s*cm\s*体重\(kg\)\s*(\d{2,3})?\s*kg/.exec(text);
  const m = newer ?? older;
  if (m?.[1]) out.heightCm = Number(m[1]);
  if (m?.[2]) out.weightKg = Number(m[2]);

  const classPos = /class="position_name"[^>]*>\s*([^<]*?)\s*</.exec(html)?.[1];
  const labelPos = /ポジション\s*\/?\s*([A-Z]{1,2}(?:\/[A-Z]{1,2})*)(?=\s)/.exec(text)?.[1];
  const position = (classPos ?? labelPos ?? "").replace(/\s+/g, "");
  if (POSITION_PATTERN.test(position)) out.position = position;
  return out;
}
