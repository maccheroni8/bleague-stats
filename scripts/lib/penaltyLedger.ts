// 出場停止の台帳（docs/foul-points/suspensions.json）の形と、リリースの本文からの下書き（DESIGN.md 416章）。
// 台帳は根拠（保存キーの対象外）。集計に使う最小の表 data/{season}/foul-penalties.json.gz は scripts/build-foul-penalties.ts が台帳から作る。
// 読み取れないところは推測で埋めず、status を「要確認」にする。

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { FOUL_POINTS_DOCS_DIR, type ReleaseText } from "./penaltyReleaseFetch.ts";

export const LEDGER_FILE = path.join(FOUL_POINTS_DOCS_DIR, "suspensions.json");

export type LedgerRole = "選手" | "ヘッドコーチ" | "アシスタントコーチ" | "スタッフ" | "クラブ";
/** 対象行為の試合の種類（regular＝リーグ戦のレギュラーシーズン、postseason＝プレーオフ・チャンピオンシップ・入替戦など、other＝試合以外・ほかの大会・不明） */
export type LedgerCompetition = "regular" | "postseason" | "other";
/** 失格・退場の種類 */
export type EjectionKind = "DQ" | "TF2" | "UF2" | "TF+UF" | "FF2" | "TF+FF" | "コーチのTF";
/**
 * 行の状態。
 * 自動読み取り＝本文から決まった形で読めた行、手で確認＝本文を読んで値を確かめた（直した）行、
 * 要確認＝読み取れなかった（集計に使わない）、取り消し＝免除などで無くなった（集計に使わない）、
 * 後の発表に含む＝同じ人・同じ日の行為について後で最終の懲罰が発表され、この行の出場停止はその試合数に含まれる（規律委員長が次の試合の出場停止を先に決めた発表など。集計に使わない）
 */
export type LedgerStatus = "自動読み取り" | "手で確認" | "要確認" | "取り消し" | "後の発表に含む";

export interface LedgerRow {
  newsId: string;
  url: string;
  /** 発表日 */
  announced: string;
  /** 対象行為のシーズン（YYYY-YY） */
  season: string | null;
  /** 対象行為のリーグ（本文の表記を正規化: B1・B2・B3・B.PREMIER・B.ONE・B.NEXT） */
  league: string | null;
  competition: LedgerCompetition | null;
  /** 対象行為の日（YYYY-MM-DD） */
  incidentDate: string | null;
  club: string | null;
  person: string;
  role: LedgerRole | null;
  /** 懲罰で決まった出場停止の試合数（消化した数ではない。0＝出場停止なし。null＝読み取れない） */
  suspensionGames: number | null;
  /** 内容の分類（「テクニカル2回で退場」「試合後の行為」「SNS」など） */
  category: string;
  ejected: boolean;
  ejectionKind: EjectionKind | null;
  /** 発表で失格・退場が取り消された（反則ポイントの退場の点に数えない。試合の記録の DQ などはそのまま） */
  ejectionCancelled?: boolean;
  /** 「失効」「消化済み」「翌シーズンに持ち越し」「免除」などの本文の注記 */
  notes: string[];
  status: LedgerStatus;
  /** 取り消し・変更をしたリリースの id */
  changedBy?: string;
  /** 手で確かめたときのメモ（何を見て、何を直したか） */
  reviewNote?: string;
}

export interface Ledger {
  note: string;
  rows: LedgerRow[];
}

const LEDGER_NOTE =
  "出場停止の台帳（反則ポイントの出場停止・旧規程のコーチの退場の根拠。集計には直接使わない）。本文は releases/{newsId}.txt。" +
  "集計に使う表 data/{season}/foul-penalties.json.gz は scripts/build-foul-penalties.ts がこの台帳から作る（status が「自動読み取り」「手で確認」の行だけ）。" +
  "suspensionGames は懲罰で決まった試合数（消化した数ではない）。読み取れない行は「要確認」のまま残し、推測で埋めない";

export async function readLedger(): Promise<Ledger> {
  try {
    return JSON.parse(await readFile(LEDGER_FILE, "utf8")) as Ledger;
  } catch {
    return { note: LEDGER_NOTE, rows: [] };
  }
}

export async function writeLedger(ledger: Ledger): Promise<void> {
  await writeFile(LEDGER_FILE, `${JSON.stringify({ ...ledger, note: LEDGER_NOTE }, null, 1)}\n`);
}

const toHalf = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const KANJI_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 本文を見出し（●…）ごとに分ける。見出しの名前は「懲罰対象」「処分対象選手」→ target、「対象行為」→ act、「懲罰内容」「処分内容」→ result */
export function releaseSections(body: string): { target: string; act: string; clause: string; result: string } {
  const out = { target: "", act: "", clause: "", result: "" };
  let current: keyof typeof out | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const head = /^[●○■]\s*(.+?)\s*$/.exec(line);
    if (head) {
      const name = head[1]!;
      current = /対象(選手|者)?$|懲罰対象|処分対象/.test(name) && !/行為/.test(name) ? "target" : /行為/.test(name) ? "act" : /条項/.test(name) ? "clause" : /内容|懲罰適用/.test(name) ? "result" : null;
      continue;
    }
    if (/^＜関連リンク＞/.test(line)) current = null;
    if (current) out[current] += (out[current] ? "\n" : "") + line;
  }
  return out;
}

function leagueOf(text: string): string | null {
  const t = toHalf(text).replace(/Ｂ/g, "B");
  if (/B\.?(LEAGUE\s*)?PREMIER/i.test(t)) return "B.PREMIER";
  if (/B\.?(LEAGUE\s*)?ONE(?![A-Za-z])/i.test(t)) return "B.ONE";
  if (/B\.?(LEAGUE\s*)?NEXT/i.test(t)) return "B.NEXT";
  const m = /B([123])(?![0-9])/.exec(t.replace(/B1・B2|B1B2|B1・B2/g, ""));
  return m ? `B${m[1]}` : null;
}

function competitionOf(act: string): LedgerCompetition | null {
  if (/プレーオフ|チャンピオンシップ|CHAMPIONSHIP|SEMIFINALS|QUARTERFINALS|FINALS|ファイナル|入れ替え戦|入替戦|クォーターファイナル|セミファイナル/i.test(act)) return "postseason";
  if (/天皇杯|アーリーカップ|オールスター|ALL-STAR|EASL|ポストシーズン|プレシーズン|カップ戦/i.test(act)) return "other";
  if (/リーグ戦/.test(act)) return "regular";
  return null;
}

/** 対象行為の日。「5月7日（金）」などは発表日から年を決める（発表日より後の月日なら前の年） */
function incidentDateOf(act: string, announced: string): string | null {
  const t = toHalf(act);
  const full = /(20\d\d)年\s*(\d{1,2})月\s*(\d{1,2})日/.exec(t);
  if (full) return `${full[1]}-${full[2]!.padStart(2, "0")}-${full[3]!.padStart(2, "0")}`;
  const md = /(\d{1,2})月\s*(\d{1,2})日/.exec(t);
  if (!md) return null;
  const [ay, am, ad] = announced.split("-").map(Number) as [number, number, number];
  const m = Number(md[1]);
  const d = Number(md[2]);
  const year = m > am || (m === am && d > ad) ? ay - 1 : ay;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 7月始まりのシーズン */
export function seasonOfDate(date: string): string {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const start = m >= 7 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

function roleOf(target: string): LedgerRole | null {
  if (/ヘッドコーチ|HC(?![A-Za-z])/.test(target)) return "ヘッドコーチ";
  if (/アシスタントコーチ|AC(?![A-Za-z])/.test(target)) return "アシスタントコーチ";
  if (/#\s*\d|選手/.test(target)) return "選手";
  if (/株式会社|クラブ$|^[^（(]+$/.test(target.trim())) return null;
  return null;
}

/** 懲罰対象の1行から、人の名前（背番号・役職を除く）とクラブ */
function personAndClub(target: string): { person: string; club: string | null } {
  const t = target.replace(/\s+/g, " ").trim();
  const m = /^(.*?)[（(]([^（）()]+)[）)]\s*$/.exec(t);
  const who = (m ? m[1]! : t)
    .replace(/#\s*\d*\s*/, "")
    .replace(/ヘッドコーチ|アシスタントコーチ|選手|HC|AC/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { person: who, club: m ? m[2]!.trim() : null };
}

const countWord = (s: string) => {
  const m = /([0-9０-９]+|[一二三四五六七八九十])\s*(度|回)/.exec(s);
  if (!m) return null;
  const v = m[1]!;
  return KANJI_NUM[v] ?? Number(toHalf(v));
};

/** 失格・退場の種類（読み取れなければ null） */
function ejectionKindOf(act: string, role: LedgerRole | null): EjectionKind | null {
  if (/ディスク[ォオ]リファイ(イ)?ング/.test(act)) return "DQ";
  const tf = (act.match(/テクニカル/g) ?? []).length;
  const uf = (act.match(/アンスポーツマンライク|アンスポーツマン/g) ?? []).length;
  const ff = (act.match(/フレグラント/g) ?? []).length;
  if (role === "ヘッドコーチ" || role === "アシスタントコーチ") return tf > 0 ? "コーチのTF" : null;
  // 反則の種類が書かれず暴力行為で失格・退場（ディスクォリファイング）
  if (tf === 0 && uf === 0 && ff === 0 && /暴力|暴行/.test(act)) return "DQ";
  const times = countWord(act);
  if (tf > 0 && uf > 0) return "TF+UF";
  if (tf > 0 && ff > 0) return "TF+FF";
  if (uf > 0 && ff === 0 && tf === 0) return uf >= 2 || times === 2 ? "UF2" : null;
  if (ff > 0 && tf === 0 && uf === 0) return ff >= 2 || times === 2 ? "FF2" : null;
  if (tf > 0 && uf === 0 && ff === 0) return tf >= 2 || times === 2 ? "TF2" : null;
  return null;
}

function categoryOf(act: string, ejected: boolean, kind: EjectionKind | null): string {
  if (ejected) {
    const names: Record<EjectionKind, string> = {
      DQ: "ディスクォリファイングで退場",
      TF2: "テクニカル2回で退場",
      UF2: "アンスポーツマンライク2回で退場",
      "TF+UF": "テクニカルとアンスポーツマンライクで退場",
      FF2: "フレグラント2回で退場",
      "TF+FF": "テクニカルとフレグラントで退場",
      コーチのTF: "コーチ・ベンチのテクニカルで退場",
    };
    return kind ? names[kind] : "退場（種類は要確認）";
  }
  if (/SNS|インスタグラム|Instagram|X（旧Twitter）|ツイッター|Twitter/i.test(act)) return "SNS";
  if (/試合終了後|試合後|終了後/.test(act)) return "試合後の行為";
  if (/暴行|暴力|乱闘|喧嘩|つば/.test(act)) return "暴行・乱闘など";
  if (/侮辱|威嚇|挑発|ジェスチャー|抗議|異論/.test(act)) return "侮辱・抗議など";
  if (/看板|ゴールポスト|椅子|扉|破損|破壊|ボールゲージ/.test(act)) return "看板・設備への行為";
  if (/遅らせ|妨害/.test(act)) return "試合進行・プレーの妨害";
  if (/観客|扇動/.test(act)) return "観客への行為";
  if (/エントリー|登録|契約|出場資格/.test(act)) return "登録・契約など";
  return "その他";
}

function suspensionOf(result: string): number | null {
  const t = toHalf(result);
  if (!/出場停止|指揮.*停止|ベンチ入り.*停止/.test(t) || /^(本行為についての)?懲罰は科さない|^免除/.test(t.trim())) return 0;
  const m = /(?:最低|最大)?\s*(\d+)\s*試合(?:の)?(?:の)?(?:公式試合への)?(?:出場|指揮|ベンチ入り)/.exec(t) ?? /出場停止\s*(\d+)\s*試合/.exec(t);
  return m ? Number(m[1]) : null;
}

function notesOf(text: string): string[] {
  const notes: string[] = [];
  if (/失効/.test(text)) notes.push("失効（出場停止の残りが消えた）");
  if (/消化済み|既に.*出場を停止|減ずる/.test(text)) notes.push("決定までに消化した試合を差し引いた記載");
  if (/翌シーズン/.test(text)) notes.push("翌シーズンに持ち越し");
  if (/免除/.test(text)) notes.push("免除の記載");
  if (/最低/.test(text)) notes.push("「最低」の記載");
  return notes;
}

/** 1本のリリースから台帳の下書きの行。読み取れないところがあれば「要確認」。対象が複数・免除などは1行の「要確認」 */
export function draftLedgerRow(r: ReleaseText): LedgerRow[] {
  const s = releaseSections(r.body);
  const base: LedgerRow = {
    newsId: r.id,
    url: r.url,
    announced: r.date,
    season: null,
    league: null,
    competition: null,
    incidentDate: null,
    club: null,
    person: "",
    role: null,
    suspensionGames: null,
    category: "その他",
    ejected: false,
    ejectionKind: null,
    notes: notesOf(`${s.result}\n${r.title}`),
    status: "要確認",
  };
  const special = !/^規約・規程違反による懲罰について$/.test(r.title.replace(/\s+/g, "").replace(/^.*?(規約・規程違反による懲罰について)$/, "$1"));
  const targets = s.target.split("\n").map((l) => l.trim()).filter(Boolean);
  if (special || targets.length !== 1 || !s.act || !s.result) {
    return [{ ...base, person: targets.join("・") || r.title, category: special ? `取り消し・変更など（${r.title}）` : "その他", reviewNote: "対象が1人に決まらない・見出しが無い・懲罰の変更などのため自動では読まない" }];
  }
  const { person, club } = personAndClub(targets[0]!);
  const role = roleOf(targets[0]!);
  const incidentDate = incidentDateOf(s.act, r.date);
  const seasonInText = /(20\d\d)\s*[-－–]\s*(\d\d)/.exec(toHalf(s.act));
  const season = seasonInText ? `${seasonInText[1]}-${seasonInText[2]}` : incidentDate ? seasonOfDate(incidentDate) : null;
  const ejected = /失格・退場|失格退場|退場処分|失格・退場処分/.test(s.act) || /ディスクォリファイ/.test(s.act);
  const ejectionKind = ejected ? ejectionKindOf(s.act, role) : null;
  const row: LedgerRow = {
    ...base,
    season,
    league: leagueOf(s.act),
    competition: competitionOf(s.act) ?? (/において|開催/.test(s.act) ? null : "other"),
    incidentDate,
    club,
    person,
    role,
    suspensionGames: suspensionOf(s.result),
    category: categoryOf(s.act, ejected, ejectionKind),
    ejected,
    ejectionKind,
  };
  const missing = [
    row.season ? null : "シーズン",
    row.club ? null : "クラブ",
    row.role ? null : "人の種類",
    row.suspensionGames === null ? "出場停止の試合数" : null,
    row.competition === null ? "試合の種類" : null,
    row.competition === "regular" && !row.league ? "リーグ" : null,
    row.ejected && !row.ejectionKind ? "退場の種類" : null,
  ].filter(Boolean);
  row.status = missing.length === 0 ? "自動読み取り" : "要確認";
  if (missing.length > 0) row.reviewNote = `読み取れない: ${missing.join("・")}`;
  return [row];
}

/** 同じ人・同じ日の行為の行のうち、後の発表（最終の懲罰）だけを残し、先の発表を「後の発表に含む」にする（自動読み取り・手で確認の行だけ） */
export function linkSameIncident(rows: LedgerRow[]): void {
  const key = (r: LedgerRow) => `${r.person.replace(/[\s・･]/g, "")}:${r.incidentDate}`;
  const groups = new Map<string, LedgerRow[]>();
  for (const r of rows) {
    if (r.status === "後の発表に含む") {
      r.status = r.reviewNote?.startsWith("手で確認") ? "手で確認" : "自動読み取り";
      delete r.changedBy;
    }
  }
  for (const r of rows) {
    if ((r.status !== "自動読み取り" && r.status !== "手で確認") || !r.incidentDate || !r.person) continue;
    const list = groups.get(key(r)) ?? [];
    list.push(r);
    groups.set(key(r), list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => (a.announced < b.announced ? -1 : a.announced > b.announced ? 1 : Number(a.newsId) - Number(b.newsId)));
    const last = list[list.length - 1]!;
    for (const r of list.slice(0, -1)) {
      r.status = "後の発表に含む";
      r.changedBy = last.newsId;
    }
  }
}

/** 手で確かめた行（docs/foul-points/manual.json。newsId → 行）。あれば本文からの下書きの代わりに使う */
export const MANUAL_FILE = path.join(FOUL_POINTS_DOCS_DIR, "manual.json");
export async function readManualRows(): Promise<Record<string, { reviewNote: string; rows: Omit<LedgerRow, "newsId" | "url" | "announced" | "status" | "reviewNote">[] }>> {
  try {
    const raw = JSON.parse(await readFile(MANUAL_FILE, "utf8")) as Record<string, unknown>;
    delete raw.note;
    return raw as never;
  } catch {
    return {};
  }
}
