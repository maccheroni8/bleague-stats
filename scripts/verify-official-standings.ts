// 公式の順位表（bleague.jp/standings/?year=YYYY&tab=1）と、当方のチームごとの勝・負・得点・失点（standings-history.json の最終日）を突き合わせる
// （手で実行する検証。CIには入れない。DESIGN.md 228章）。公式側の行は TeamID・勝・負・得点・失点を読む。
// 使い方: npm run build:data の後に
//   node --experimental-strip-types scripts/verify-official-standings.ts [--season 2017-18 ...]
// 問い合わせは throttle.ts を通す（2.5秒間隔・直列）。シーズンごとに1回
import path from "node:path";
import { existsSync } from "node:fs";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { StandingsSnapshot } from "../shared/types.ts";

const throttledFetch = createThrottledFetch(2500, "Mozilla/5.0 (bleague-stats personal scraper)");

interface OfficialRow {
  teamId: string;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
}

/**
 * 順位表のHTMLの行を読む。表は地区別（東・中・西）と、地区の上位を除いたワイルドカード争いの表に分かれているため、
 * すべての表の行を TeamID で1つにまとめる（同じクラブが複数の表に載るときは同じ値）
 */
export function parseOfficialStandings(html: string): OfficialRow[] {
  const byId = new Map<string, OfficialRow>();
  for (const t of html.split(/<table\b/).slice(1)) {
    for (const tr of t.split(/<tr\b/).slice(1)) {
      const teamId = /club_detail\/\?TeamID=(\d+)/.exec(tr)?.[1];
      if (!teamId) continue;
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]!.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim());
      // 順位・クラブ・勝・負・勝率・差・得点・失点・得失点差…
      const [, , wins, losses, , , pf, pa] = cells;
      if (![wins, losses, pf, pa].every((v) => v !== undefined && /^\d+$/.test(v))) continue;
      byId.set(teamId, { teamId, wins: Number(wins), losses: Number(losses), pointsFor: Number(pf), pointsAgainst: Number(pa) });
    }
  }
  return [...byId.values()];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const only = args.flatMap((a, i) => (args[i - 1] === "--season" ? [a] : []));
  const seasons = (only.length > 0 ? only : ["2016-17", "2017-18", "2018-19", "2019-20", "2020-21", "2021-22", "2022-23", "2023-24", "2024-25", "2025-26"]).sort();
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
    const official = parseOfficialStandings(await res.text());
    const ours = new Map((latest?.teams ?? []).map((t) => [t.teamId, t]));
    const diffs: string[] = [];
    for (const o of official) {
      const t = ours.get(o.teamId);
      if (!t) {
        diffs.push(`${o.teamId}: 当方に無い`);
        continue;
      }
      if (t.wins !== o.wins || t.losses !== o.losses || t.pointsFor !== o.pointsFor || t.pointsAgainst !== o.pointsAgainst) {
        diffs.push(`${t.teamName}(${o.teamId}) 公式 ${o.wins}-${o.losses} ${o.pointsFor}/${o.pointsAgainst} ／ 当方 ${t.wins}-${t.losses} ${t.pointsFor}/${t.pointsAgainst}`);
      }
    }
    for (const t of ours.values()) if (!official.some((o) => o.teamId === t.teamId)) diffs.push(`${t.teamName}(${t.teamId}): 公式に無い`);
    mismatches += diffs.length;
    console.log(`${season}: 公式${official.length}クラブ・当方${ours.size}クラブ → ${diffs.length === 0 ? "全クラブ一致（勝・負・得点・失点）" : `${diffs.length}件の違い`}`);
    for (const d of diffs) console.log(`   - ${d}`);
  }
  if (mismatches > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
