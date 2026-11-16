// 懲罰のリリースの取得と、根拠の本文ファイル（docs/foul-points/releases/{id}.txt）の読み書き（DESIGN.md 416章）。
// 集計（build:data）からは読まない。保存キーの対象外。

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const FOUL_POINTS_DOCS_DIR = path.join(ROOT, "docs", "foul-points");
export const RELEASES_DIR = path.join(FOUL_POINTS_DOCS_DIR, "releases");

export interface ReleaseText {
  id: string;
  url: string;
  /** 発表日（YYYY-MM-DD） */
  date: string;
  title: string;
  /** 取った日（YYYY-MM-DD） */
  fetchedAt: string;
  /** 本文（見出し「●懲罰対象」などを1行ずつ） */
  body: string;
}

/** 懲罰に関するリリースのタイトルか（「規約・規程違反による懲罰について」「懲罰免除」「懲罰の適用」「懲罰内容」など） */
export const isPenaltyTitle = (title: string) => title.includes("懲罰");

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** HTML の断片を、行の区切りを残した文に */
function htmlToLines(html: string): string {
  const text = decode(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h\d|div|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t　]+/g, " ").trim())
    .filter((l) => l.length > 0)
    .join("\n");
}

/** 一覧のページ（/news/?pageID=N）から、ニュースの id とタイトル（日付・分類つきの1行） */
export function parseNewsList(html: string): { id: string; title: string }[] {
  const out: { id: string; title: string }[] = [];
  const re = /<a[^>]*href="https:\/\/www\.bleague\.jp\/news_detail\/id=(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) out.push({ id: m[1]!, title: htmlToLines(m[2]!).replace(/\n/g, " ") });
  return out;
}

/** 詳細のページから、発表日・タイトル・本文 */
export function parseReleaseHtml(html: string, id: string, url: string): ReleaseText {
  const date = /newsDetail-heading-date[^>]*>\s*(\d{4})\.(\d{2})\.(\d{2})/.exec(html);
  const title = /<h2 class="newsDetail-heading-1">([\s\S]*?)<\/h2>/.exec(html);
  // 本文は <article class="body"> の中（2026-11 からの新しいページは見出しの直後に段落だけが並ぶので、見出しの後から数える）
  const article = html.indexOf('<article class="body">');
  const heading = html.indexOf('class="newsDetail-heading-1"');
  const start = article >= 0 ? article : heading >= 0 ? html.indexOf("</h2>", heading) + 5 : -1;
  const end = html.indexOf("SHARE ON", start);
  if (!date || !title || start < 5 || end < 0) throw new Error("本文の場所が見つからない");
  return {
    id,
    url,
    date: `${date[1]}-${date[2]}-${date[3]}`,
    title: htmlToLines(title[1]!).replace(/\n/g, " "),
    fetchedAt: new Date().toISOString().slice(0, 10),
    body: htmlToLines(html.slice(start, end))
      .replace(/\nSHARE ON.*$/s, "")
      // 見出しの直後の分類（ANNOUNCEMENT など）は本文に入れない
      .replace(/^(ANNOUNCEMENT|RELEASE|INFORMATION)\n/, ""),
  };
}

export function releaseFileText(r: ReleaseText): string {
  return `id: ${r.id}\nurl: ${r.url}\ndate: ${r.date}\ntitle: ${r.title}\nfetchedAt: ${r.fetchedAt}\n---\n${r.body}\n`;
}

export async function readReleaseFile(file: string): Promise<ReleaseText> {
  const text = await readFile(file, "utf8");
  const [head, ...rest] = text.split("\n---\n");
  const field = (name: string) => new RegExp(`^${name}: (.*)$`, "m").exec(head!)?.[1] ?? "";
  return { id: field("id"), url: field("url"), date: field("date"), title: field("title"), fetchedAt: field("fetchedAt"), body: rest.join("\n---\n").trim() };
}
