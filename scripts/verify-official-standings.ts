// 公式の順位表（bleague.jp/standings/?year=YYYY&tab=1）と、当方の順位表を突き合わせる
// （手で実行する検証。CIには入れない。DESIGN.md 228章・229章）。見るもの:
//   1. チームごとの勝・負・得点・失点（standings-history.json の最終日）
//   2. 各地区の順位（公式の地区別の表の並び ＝ 当方の divisionRank の並び）
//   3. ワイルドカードの順位（公式のワイルドカードの表の並び ＝ 当方の wildcardRank の並び。古いデータは rank）
// 使い方: npm run build:data の後に
//   node --experimental-strip-types scripts/verify-official-standings.ts [--season 2017-18 ...]
// 問い合わせは throttle.ts を通す（2.5秒間隔・直列）。シーズンごとに1回
import path from "node:path";
import { existsSync } from "node:fs";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { StandingsSnapshot, StandingsTeamSnapshot } from "../shared/types.ts";

const throttledFetch = createThrottledFetch(2500, "Mozilla/5.0 (bleague-stats personal scraper)");

export interface OfficialRow {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface OfficialTable {
  /** 表の見出し（「東地区」「ワイルドカード」など。読めないときは空） */
  title: string;
  /** 表に載っている順（公式の順位の並び） */
  rows: OfficialRow[];
}

/** 公式の側の誤りで、当方が合わせない行（DESIGN.md 228-7章）。その行は順位の比較から外し、注記だけ出す */
const KNOWN_OFFICIAL_ERRORS: { season: string; teamId: string; reason: string }[] = [
  { season: "2018-19", teamId: "753", reason: "ライジングゼファー福岡: 公式の行の中で勝数が矛盾（勝7・ホーム6-24＋アウェー6-24＝12勝）" },
];

/**
 * 順位表のHTMLを、表ごとに読む。表は地区別（東・中・西）と、地区の上位を除いたワイルドカード争いの表に分かれる。
 * 見出しは表の直前の `<h3 class="box-container">`。行は TeamID・勝・負・得点・失点を読む
 */
export function parseOfficialStandingTables(html: string): OfficialTable[] {
  const headings = [...html.matchAll(/<h3[^>]*class="box-container"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => ({
    pos: m.index ?? 0,
    text: m[1]!.replace(/<[^>]*>/g, "").trim(),
  }));
  const tables: OfficialTable[] = [];
  for (const m of html.matchAll(/<table\b[\s\S]*?<\/table>/g)) {
    const title = headings.filter((h) => h.pos < (m.index ?? 0)).at(-1)?.text ?? "";
    const rows: OfficialRow[] = [];
    for (const tr of m[0].split(/<tr\b/).slice(1)) {
      const teamId = /club_detail\/\?TeamID=(\d+)/.exec(tr)?.[1];
      if (!teamId) continue;
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]!.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
      // 順位・クラブ・勝・負・勝率・差・得点・失点・得失点差…
      const [, , wins, losses, , , pf, pa] = cells;
      if (![wins, losses, pf, pa].every((v) => v !== undefined && /^\d+$/.test(v))) continue;
      rows.push({ teamId, wins: Number(wins), losses: Number(losses), pointsFor: Number(pf), pointsAgainst: Number(pa) });
    }
    if (rows.length > 0) tables.push({ title, rows });
  }
  return tables;
}

/** すべての表の行を TeamID で1つにまとめる（同じクラブが複数の表に載るときは同じ値） */
export function parseOfficialStandings(html: string): OfficialRow[] {
  const byId = new Map<string, OfficialRow>();
  for (const table of parseOfficialStandingTables(html)) for (const row of table.rows) byId.set(row.teamId, row);
  return [...byId.values()];
}

/** 当方のスナップショットのクラブを、並びの値の昇順に並べた TeamID の一覧にする */
function orderIds(ids: string[], ours: Map<string, StandingsTeamSnapshot>, valueOf: (t: StandingsTeamSnapshot) => number): string[] {
  return ids
    .filter((id) => ours.has(id))
    .sort((a, b) => valueOf(ours.get(a)!) - valueOf(ours.get(b)!));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.flatMap((a, i) => (args[i - 1] === "--season" ? [a] : []));
  const seasons = (
    only.length > 0
      ? only
      : ["2016-17", "2017-18", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26", "2026-27"]
  ).sort();
  let mismatches = 0;
  for (const season of seasons) {
    const file = path.join(DATA_DIR, season, "standings-history.json");
    if (!existsSync(`${file}.gz`)) {
      console.log(`${season}: standings-history.json が無い（先に npm run build:data）`);
      mismatches++;
      continue;
    }
    const history = (await readJson<StandingsSnapshot[]>(file)) ?? [];
    const latest = history.at(-1);
    const year = Number(season.slice(0, 4));
    const res = await throttledFetch(`https://www.bleague.jp/standings/?year=${year}&tab=1`);
    const tables = parseOfficialStandingTables(await res.text());
    const ours = new Map((latest?.teams ?? []).map((t) => [t.teamId, t]));
    const known = KNOWN_OFFICIAL_ERRORS.filter((e) => e.season === season);
    const knownIds = new Set(known.map((e) => e.teamId));

    // 1. 勝・負・得点・失点
    const diffs: string[] = [];
    const officialById = new Map(tables.flatMap((t) => t.rows).map((r) => [r.teamId, r]));
    for (const o of officialById.values()) {
      const t = ours.get(o.teamId);
      if (!t) {
        diffs.push(`${o.teamId}: 当方に無い`);
        continue;
      }
      if (t.wins !== o.wins || t.losses !== o.losses || t.pointsFor !== o.pointsFor || t.pointsAgainst !== o.pointsAgainst) {
        diffs.push(`${t.teamName}(${o.teamId}) 公式 ${o.wins}-${o.losses} ${o.pointsFor}/${o.pointsAgainst} ／ 当方 ${t.wins}-${t.losses} ${t.pointsFor}/${t.pointsAgainst}${knownIds.has(o.teamId) ? "（公式側の誤り。既知）" : ""}`);
      }
    }
    for (const t of ours.values()) if (!officialById.has(t.teamId)) diffs.push(`${t.teamName}(${t.teamId}): 公式に無い`);
    const unexpected = diffs.filter((d) => !d.endsWith("（公式側の誤り。既知）"));
    mismatches += unexpected.length;
    console.log(
      `${season}: 公式${officialById.size}クラブ・当方${ours.size}クラブ → ${
        unexpected.length === 0
          ? `全クラブ一致（勝・負・得点・失点${diffs.length > 0 ? `。既知の公式側の誤り${diffs.length}件を除く` : ""}）`
          : `${unexpected.length}件の違い`
      }`,
    );
    for (const d of diffs) console.log(`   - ${d}`);

    // 2・3. 地区順位とワイルドカードの順位（公式の表の並びと比べる）
    for (const table of tables) {
      const isWildcard = table.title.includes("ワイルドカード");
      const isDivision = table.title.endsWith("地区");
      if (!isWildcard && !isDivision) continue;
      const label = isWildcard ? "ワイルドカード順位" : `${table.title}の順位`;
      const ids = table.rows.map((r) => r.teamId).filter((id) => !knownIds.has(id));
      // 勝敗が違うクラブがある表は、順位の比べようが無い（公式の更新と当方のデータの時点のずれなど）
      const lagging = table.rows.filter((r) => {
        const t = ours.get(r.teamId);
        return !knownIds.has(r.teamId) && (!t || t.wins !== r.wins || t.losses !== r.losses);
      });
      if (lagging.length > 0) {
        console.log(`   ${label}: 勝敗が違うクラブがあるので順位は比べない（${lagging.map((r) => r.teamId).join("・")}）`);
        continue;
      }
      const officialOrder = ids;
      const ourOrder = orderIds(ids, ours, isWildcard ? (t) => t.wildcardRank ?? t.rank : (t) => t.divisionRank ?? Number.POSITIVE_INFINITY);
      const same = officialOrder.length === ourOrder.length && officialOrder.every((id, i) => id === ourOrder[i]);
      const note = known.some((e) => table.rows.some((r) => r.teamId === e.teamId)) ? "（既知の公式の誤りのクラブを除く）" : "";
      if (same) {
        console.log(`   ${label}: 公式と一致${note}`);
      } else {
        mismatches++;
        console.log(`   ${label}: 公式と違う${note}`);
        officialOrder.forEach((id, i) => {
          const ourPos = ourOrder.indexOf(id) + 1;
          const mark = ourPos !== i + 1 ? "  <<<" : "";
          console.log(`      公式${String(i + 1).padStart(2)}位 ${ours.get(id)?.teamName ?? id} → 当方${ourPos}位${mark}`);
        });
      }
    }
    for (const e of known) console.log(`   （既知の公式の誤り・順位の比較から除外）${e.reason}`);
  }
  if (mismatches > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
