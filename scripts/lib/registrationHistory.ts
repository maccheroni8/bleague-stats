// 旧B1（B.PREMIER の 2016-17〜2025-26）の登録区分の台帳（DESIGN.md 388章）。
// 根拠（docs/registration-history/{season}.json。URL・確かさ・所属の観測など）と、集計に使う最小の区分表（data/{season}/registrations.json.gz。
// 選手ID・シーズンの初めの区分・切り替えの日付だけ）を分ける。区分表は根拠から作るので、根拠を書き足しただけでは区分表（＝保存キー）は変わらない。
// 集計からは読まない（保存キーの対象外）。作るのは scripts/build-registration-history.ts、確かめるのは scripts/validate-registration-history.ts
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { Classification, SeasonRegistrationEntry, SeasonRegistrationFile } from "../../shared/registration.ts";

/** 台帳のあるシーズン（旧B1。B.ONE・旧B2 は対象外。2026-27 以降は record-registrations.ts の記録） */
export const REGISTRATION_HISTORY_SEASONS = ["2016-17", "2017-18", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"] as const;

export const REGISTRATION_HISTORY_DIR = path.join(import.meta.dirname, "..", "..", "docs", "registration-history");

export interface EvidenceSource {
  kind: string;
  url: string | null;
  summary: string;
}

export interface EvidenceInterval {
  /** この日（JST）から（含む） */
  from: string;
  /** この日の前日まで（含まない） */
  toExclusive: string;
  classification: Classification;
  confidence: "確実" | "推定" | "要確認";
  evidenceType: string;
  teamIds: string[];
  boundary?: string | null;
  sources: EvidenceSource[];
}

export interface EvidencePlayer {
  name: string;
  teams: { teamId: string; teamName: string; firstObserved: string; lastObserved: string }[];
  intervals: EvidenceInterval[];
  userReviewed: boolean;
  notes?: string[];
  correction?: string;
}

export interface EvidenceFile {
  season: string;
  league: "premier";
  note: string;
  reviewedAt: string;
  players: Record<string, EvidencePlayer>;
}

export async function readEvidence(season: string): Promise<EvidenceFile> {
  return JSON.parse(await readFile(path.join(REGISTRATION_HISTORY_DIR, `${season}.json`), "utf8")) as EvidenceFile;
}

/** 根拠の1選手から、区分表の1件（初めの区分と、区分が変わる日だけ。根拠・確かさ・期間の終わりは持たない） */
export function minimalEntry(p: EvidencePlayer): SeasonRegistrationEntry {
  const [first, ...rest] = p.intervals;
  if (!first) throw new Error(`${p.name}: 区間がありません`);
  const changes: { from: string; classification: Classification }[] = [];
  let prev = first.classification;
  for (const iv of rest) {
    if (iv.classification !== prev) changes.push({ from: iv.from, classification: iv.classification });
    prev = iv.classification;
  }
  return changes.length > 0 ? { classification: first.classification, changes } : { classification: first.classification };
}

/** 根拠のファイルから、集計に使う区分表（選手IDの昇順） */
export function minimalRegistrationFile(e: EvidenceFile): SeasonRegistrationFile {
  const players: Record<string, SeasonRegistrationEntry> = {};
  for (const id of Object.keys(e.players).sort((a, b) => a.localeCompare(b))) players[id] = minimalEntry(e.players[id]!);
  return { season: e.season, league: "premier", players };
}

/** 根拠の形の確かめ（区間がつながっている・期間がシーズンの中・アジア特別枠は 2020-21 から）。問題の一覧 */
export function evidenceProblems(e: EvidenceFile): string[] {
  const out: string[] = [];
  const y = Number(e.season.slice(0, 4));
  const start = `${y}-07-01`;
  const end = `${y + 1}-07-01`;
  for (const [id, p] of Object.entries(e.players)) {
    const ivs = p.intervals;
    if (ivs.length === 0) out.push(`${id}: 区間がない`);
    if (ivs[0] && ivs[0].from !== start) out.push(`${id}: 最初の区間が ${start} から始まらない`);
    if (ivs.at(-1) && ivs.at(-1)!.toExclusive !== end) out.push(`${id}: 最後の区間が ${end} で終わらない`);
    for (let i = 1; i < ivs.length; i++) if (ivs[i - 1]!.toExclusive !== ivs[i]!.from) out.push(`${id}: 区間 ${i} がつながっていない`);
    for (const iv of ivs) {
      if (iv.from >= iv.toExclusive) out.push(`${id}: 長さ0以下の区間 ${iv.from}`);
      if (iv.classification === "アジア特別枠" && e.season < "2020-21") out.push(`${id}: 制度ができる前のアジア特別枠`);
    }
  }
  return out;
}
