// 条件別順位表の条件が、チーム詳細の「シチュエーション別勝敗」と同じ試合を数えているかの検証（設計書387章）。
// 使い方: npm run validate:conditional-situational（先に npm run build:data）
//  1. 全シーズン・全チーム・レギュラーシーズンで、チーム詳細の行（buildSituationalRecordGroups の predicate。第Q終了時点・延長は試合の生データ quarterScores から）と、
//     条件別順位表の条件（applyConditionalCondition。第Q終了時点は試合ログの 1Q〜4Q の得点から）の、試合の集合・勝敗が一致する
//  2. 「●人以下／以上」「●点以下／以上」は、1試合ごとの値を直接比べた数と一致する（人数 0〜5・点数 40〜140）
//  3. 感度: 試合ログの得点を1つ壊すと食い違いとして検出される
//  4. 外国籍の人数の3つの数え方（設計書392章）:
//     - チーム詳細のシチュエーション別成績・個人詳細のシチュエーション別成績の行（foreignSituationalGroups。自チーム・相手）が、条件別順位表の条件と同じ試合になる
//       （相手の行は、相手チームの試合ログの自チームの値と同じ試合）
//     - 個人の試合ログの4つの人数は、同じ試合の所属チームの試合ログと同じ値
//     - 出場人数は、試合の生データ（出場時間が0秒より長い選手・試合の日の登録区分）から数え直した値と同じ。区分の分からない選手の数を出す
//     - 感度: 人数を1つ壊すと食い違いとして検出される
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { DivisionHistoryFile, StoredGame, TeamGameLog, TeamSummary } from "../shared/types";
import { applyConditionalCondition, type ConditionalCondition } from "../src/components/ConditionalStandingsTable";
import { buildSituationalRecordGroups } from "../src/pages/TeamDetailPage";
import { buildOpponentSeasonWinRates } from "../src/lib/opponentStrength";
import { FOREIGN_MEASURES, FOREIGN_MEASURE_MAX, foreignMeasureValue, foreignSituationalGroups, FOREIGN_COMPARE_GROUP_KEY, type ForeignMeasure } from "../src/lib/situationalRecords";
import { makeClassifier } from "../shared/registration";
import { applyBoxscoreNameFills } from "../shared/boxscoreNameFills";
import type { PlayerGameLog, PlayerMasterEntry, SeasonRegistrationFile } from "../shared/types";
import { applySituationalRange, type MarginCondition, type SituationalRange } from "../src/lib/situational";
import type { League } from "../src/lib/league";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(p.endsWith(".gz") ? gunzipSync(readFileSync(p)).toString("utf8") : readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};
const history: DivisionHistoryFile = rj(`${DATA}/division-history.json`);
let failures = 0;
let playerLogsCompared = 0;
let noRawGames = 0;
const overMax = new Map<string, number>();
let ok = 0;
const check = (label: string, good: boolean, detail = "") => {
  if (good) ok += 1;
  else {
    failures += 1;
    if (failures <= 30) console.error(`NG ${label} ${detail}`);
  }
};

/** チーム詳細の行（グループ・行のキー）→ 条件別順位表の条件 */
function conditionFor(group: string, row: string): ConditionalCondition | null {
  switch (group) {
    case "foreignPlayerCount": return { kind: "foreign", mode: "eq", n: Number(row.replace("own", "")) };
    case "foreignPlayedCount": return { kind: "foreign", mode: "eq", n: Number(row.replace("own", "")), measure: "foreignPlayed" };
    case "intlPlayedCount": return { kind: "foreign", mode: "eq", n: Number(row.replace("own", "")), measure: "intlPlayed" };
    case "score":
      switch (row) {
        case "score80plus": return { kind: "score", side: "own", mode: "ge", n: 80 };
        case "score80under": return { kind: "score", side: "own", mode: "le", n: 79 };
        case "allow80under": return { kind: "score", side: "opp", mode: "le", n: 79 };
        case "allow80plus": return { kind: "score", side: "opp", mode: "ge", n: 80 };
        case "both80plus": return { kind: "bothScore", value: "ge" };
        case "both80under": return { kind: "bothScore", value: "lt" };
        case "century": return { kind: "century" };
      }
      return null;
    case "margin":
      switch (row) {
        case "margin10": return { kind: "marginAtLeast", points: 10 };
        case "margin20": return { kind: "marginAtLeast", points: 20 };
        case "poss1": return { kind: "margin", points: 3 };
        case "poss2": return { kind: "margin", points: 6 };
      }
      return null;
    case "inGameMargin": return { kind: "inGameMargin", value: row as MarginCondition };
    case "overtime": return { kind: "overtime", value: row === "ot" ? "ot" : "regulation" };
    case "q1status": return { kind: "checkpoint", q: 1, status: row as "lead" | "tie" | "behind" };
    case "halfStatus": return { kind: "checkpoint", q: 2, status: row as "lead" | "tie" | "behind" };
    case "q3status": return { kind: "checkpoint", q: 3, status: row as "lead" | "tie" | "behind" };
    case "opponentStrength":
      return row === "unclassified" ? null : { kind: "opponentLatestWinRate", tier: row as "under50" | "atLeast50" | "atLeast60" };
  }
  return null;
}

const compared = new Map<string, number>();
const masterById = new Map(((rj(`${DATA}/players-master.json`) ?? []) as PlayerMasterEntry[]).map((p) => [p.playerId, p]));
const unknownPlayed = { players: 0, games: new Set<string>() };
/** 人数の比べで除いた試合数（シーズン・リーグごと） */
const compareExcluded = new Map<string, number>();
let periodChecked = 0;
const OWN_GROUP_MEASURE: Record<string, ForeignMeasure> = { foreignPlayedCount: "foreignPlayed", intlPlayedCount: "intlPlayed", foreignPlayerCount: "longestOnCourt" };
const OPP_GROUP_MEASURE: Record<string, ForeignMeasure> = { opponentForeignPlayedCount: "foreignPlayed", opponentIntlPlayedCount: "intlPlayed", opponentForeignPlayerCount: "longestOnCourt" };
const FOREIGN_FIELDS = ["foreignPlayedCount", "intlPlayedCount", "opponentForeignPlayedCount", "opponentIntlPlayedCount", "foreignPlayerCount", "opponentForeignPlayerCount"] as const;
const isPlayed = (t: string | undefined) => { const m = /^(\d+):(\d{2})$/.exec(t ?? ""); return !!m && Number(m[1]) * 60 + Number(m[2]) > 0; };
for (const [league, base] of [["premier", ""], ["one", "/one"]] as [League, string][]) {
  for (const season of Object.keys(history[league] ?? {})) {
    const dir = `${DATA}/${season}${base}`;
    if (!existsSync(`${dir}/team-games`)) continue;
    const teams: TeamSummary[] = (rj(`${dir}/teams.json`) ?? []) as TeamSummary[];
    const winRates = buildOpponentSeasonWinRates(teams);
    const registrations = rj(`${dir}/registrations.json`) as SeasonRegistrationFile | null;
    const classifyAt = makeClassifier(season, registrations, masterById);
    const allTeamLogs = new Map<string, Map<string, TeamGameLog>>();
    for (const f of readdirSync(`${dir}/team-games`)) {
      allTeamLogs.set(f.replace(/\.json(\.gz)?$/, ""), new Map(((rj(`${dir}/team-games/${f}`) ?? []) as TeamGameLog[]).map((g) => [g.scheduleKey, g])));
    }
    const summary = ((rj(`${dir}/games-summary.json`) ?? []) as { gameType: string; gameEndedFlg: boolean; date: string; homeTeamId: string; awayTeamId: string; homeScore: number; awayScore: number }[]);
    const raws = new Map<string, StoredGame>();
    if (existsSync(`${dir}/games`)) {
      for (const f of readdirSync(`${dir}/games`)) {
        const g = rj(`${dir}/games/${f}`) as StoredGame | null;
        if (g) raws.set(f.replace(/\.json(\.gz)?$/, ""), g);
      }
    }
    for (const f of readdirSync(`${dir}/team-games`)) {
      const teamId = f.replace(/\.json(\.gz)?$/, "");
      const logs = ((rj(`${dir}/team-games/${f}`) ?? []) as TeamGameLog[]).filter((g) => g.gameType === "regular");
      const groups = buildSituationalRecordGroups(logs, teamId, undefined, winRates, history, season, league);
      const ctx = { teamId, season, league, divisionHistory: history, opponentLatestWinRates: winRates };
      for (const group of groups) {
        for (const row of group.rows) {
          const cond = conditionFor(group.key, row.key);
          if (!cond) continue;
          // チーム詳細: 生データが必要な区分は、生データのある試合だけ
          const pool = group.needsRawGame ? logs.filter((g) => raws.has(g.scheduleKey)) : logs;
          const want = pool.filter((g) => row.predicate(g, raws.get(g.scheduleKey)));
          // 条件別順位表: 試合ログだけ。生データのある試合に絞って比べる（無い試合は別に数える）
          const got = applyConditionalCondition(pool, cond, ctx);
          const same = want.length === got.length && want.every((g, i) => g.scheduleKey === got[i].scheduleKey);
          check(`${league} ${season} ${teamId} ${group.key}/${row.key}`, same, `チーム詳細 ${want.length} ≠ 順位表 ${got.length}`);
          compared.set(`${group.key}/${row.key}`, (compared.get(`${group.key}/${row.key}`) ?? 0) + want.length);
        }
      }
      // 4. 外国籍の人数の3つの数え方（チーム詳細のシチュエーション別成績の行。自チーム・相手）
      {
        const ctxAll = { teamId, season, league, divisionHistory: history, opponentLatestWinRates: winRates };
        for (const group of foreignSituationalGroups<TeamGameLog>(["own", "opp"])) {
          for (const row of group.rows) {
            const n = Number(row.key.replace(/^(own|opp)/, ""));
            const want = logs.filter(row.predicate).map((g) => g.scheduleKey);
            let got: string[];
            if (group.key === FOREIGN_COMPARE_GROUP_KEY) {
              // 自チームと相手の人数の比べ（457章）: 条件別順位表の条件と同じ試合。さらに、相手チーム自身の試合ログの人数（独立した読み方）でも数え直す
              const value = row.key as "more" | "same" | "fewer";
              got = applyConditionalCondition(logs, { kind: "foreignCompare", value }, ctxAll).map((g) => g.scheduleKey);
              const viaOpponent = logs.filter((g) => {
                const o = allTeamLogs.get(g.opponentTeamId)?.get(g.scheduleKey);
                const own = g.intlPlayedCount;
                const opp = o?.intlPlayedCount;
                if (own == null || opp == null) return false;
                return value === "more" ? own > opp : value === "fewer" ? own < opp : own === opp;
              }).map((g) => g.scheduleKey);
              check(`${league} ${season} ${teamId} 比べ ${row.key} 相手の試合ログの人数と一致`, viaOpponent.length === got.length && viaOpponent.every((k, i) => k === got[i]), `${viaOpponent.length} ≠ ${got.length}`);
            } else if (group.key in OWN_GROUP_MEASURE) {
              got = applyConditionalCondition(logs, { kind: "foreign", mode: "eq", n, measure: OWN_GROUP_MEASURE[group.key] }, ctxAll).map((g) => g.scheduleKey);
            } else {
              // 相手の行＝相手チームの試合ログで、自チームの値がその人数
              const m = OPP_GROUP_MEASURE[group.key];
              got = logs.filter((g) => {
                const o = allTeamLogs.get(g.opponentTeamId)?.get(g.scheduleKey);
                return o != null && foreignMeasureValue(o, m, "own") === n;
              }).map((g) => g.scheduleKey);
            }
            check(`${league} ${season} ${teamId} 成績 ${group.key}/${row.key}`, want.length === got.length && want.every((k, i) => k === got[i]), `チーム詳細 ${want.length} ≠ ${got.length}`);
            compared.set(`成績 ${group.key}/${row.key}`, (compared.get(`成績 ${group.key}/${row.key}`) ?? 0) + want.length);
          }
        }
        // 条件別順位表の対象期間（458章）: 期間で絞った試合の勝敗が、試合結果の一覧（games-summary。試合ログとは別の元）の同じ期間の勝敗と一致する
        {
          const dates = logs.map((g) => g.date).sort();
          if (dates.length >= 4) {
            const mid = dates[Math.floor(dates.length / 2)]!;
            const quarter = dates[Math.floor(dates.length / 4)]!;
            const ranges: SituationalRange[] = [{ kind: "dateRange", start: mid, end: "" }, { kind: "dateRange", start: "", end: quarter }, { kind: "dateRange", start: quarter, end: mid }];
            for (const range of ranges) {
              if (range.kind !== "dateRange") continue;
              const inRange = applySituationalRange([...logs].sort((x, y) => x.date.localeCompare(y.date) || x.scheduleKey.localeCompare(y.scheduleKey)), range);
              const mine = summary.filter((g) => g.gameType === "regular" && g.gameEndedFlg && (g.homeTeamId === teamId || g.awayTeamId === teamId) && (!range.start || g.date >= range.start) && (!range.end || g.date <= range.end));
              const winsBySummary = mine.filter((g) => (g.homeTeamId === teamId ? g.homeScore > g.awayScore : g.awayScore > g.homeScore)).length;
              const w = inRange.filter((g) => g.win).length;
              check(`${league} ${season} ${teamId} 期間 ${range.start || "…"}〜${range.end || "…"}`, inRange.length === mine.length && w === winsBySummary, `試合ログ ${w}-${inRange.length - w} ≠ 試合結果 ${winsBySummary}-${mine.length - winsBySummary}`);
              periodChecked += 1;
            }
          }
        }
        // 多い・同数・少ないの合計＝両チームの人数が数えられる試合の数
        {
          const counted = logs.filter((g) => g.intlPlayedCount != null && g.opponentIntlPlayedCount != null).length;
          const sum = (["more", "same", "fewer"] as const).reduce((t, value) => t + applyConditionalCondition(logs, { kind: "foreignCompare", value }, ctxAll).length, 0);
          check(`${league} ${season} ${teamId} 比べの合計`, sum === counted, `${sum} ≠ ${counted}`);
          compareExcluded.set(`${league} ${season}`, (compareExcluded.get(`${league} ${season}`) ?? 0) + (logs.length - counted));
        }
        // 3つの数え方の「●人以下／以上」（0〜5人）
        for (const measure of FOREIGN_MEASURES) {
          for (let n = 0; n <= 5; n++) {
            for (const mode of ["le", "ge"] as const) {
              const got = applyConditionalCondition(logs, { kind: "foreign", mode, n, measure }, ctxAll).length;
              const want = logs.filter((g) => { const v = foreignMeasureValue(g, measure); return v != null && (mode === "le" ? v <= n : v >= n); }).length;
              check(`${league} ${season} ${teamId} ${measure}${n}人${mode}`, got === want, `${got} ≠ ${want}`);
            }
          }
          // 上限を超える人数の試合が無いか（行の「●人」に入らない試合。外国籍＝3人・外国籍等＝4人。旧B2 の 2025-26 は画面に出ないので数だけ）
          const over = logs.filter((g) => (foreignMeasureValue(g, measure) ?? 0) > FOREIGN_MEASURE_MAX[measure]).length;
          if (over > 0) overMax.set(`${league} ${season} ${measure}`, (overMax.get(`${league} ${season} ${measure}`) ?? 0) + over);
        }
        // 出場人数を生データから数え直す（出場時間が0秒より長い選手・試合の日の登録区分）
        for (const g of logs) {
          const raw = raws.get(g.scheduleKey);
          if (!raw) {
            noRawGames += 1;
            continue;
          }
          // 集計の読み込み（readAllGames）と同じく、選手ID・氏名が空の行に手で補う選手を当てる（5858 の三河 #22。設計書253・256章）
          applyBoxscoreNameFills(raw);
          const count = (tid: string) => {
            let f = 0, i = 0;
            const seen = new Set<string>();
            for (const r of [...raw.raw.HomeBoxscores, ...raw.raw.AwayBoxscores]) {
              if (r.Category !== 1 || r.PeriodCategory !== 18 || r.TeamID !== tid || !r.PlayerID || !isPlayed(r.PlayTime) || seen.has(r.PlayerID)) continue;
              seen.add(r.PlayerID);
              const c = classifyAt(r.PlayerID, raw.date);
              if (c === undefined) { if (tid === teamId) { unknownPlayed.players += 1; unknownPlayed.games.add(`${league} ${season} ${g.scheduleKey}`); } }
              else if (c === "外国籍") { f += 1; i += 1; }
              else if (c === "帰化選手" || c === "アジア特別枠") i += 1;
            }
            return { f, i };
          };
          const own = count(teamId), opp = count(g.opponentTeamId);
          check(`${league} ${season} ${teamId} ${g.scheduleKey} 出場人数の数え直し`,
            g.foreignPlayedCount === own.f && g.intlPlayedCount === own.i && g.opponentForeignPlayedCount === opp.f && g.opponentIntlPlayedCount === opp.i,
            `試合ログ ${g.foreignPlayedCount}/${g.intlPlayedCount}/${g.opponentForeignPlayedCount}/${g.opponentIntlPlayedCount} ≠ 数え直し ${own.f}/${own.i}/${opp.f}/${opp.i}`);
        }
      }
      // 第Q終了時点・延長は、生データが無い試合も試合ログだけで判定できるか（生データのある試合では上で一致を確認済み）
      // 「●人」「●点」の以下／以上
      for (let n = 0; n <= 5; n++) {
        const le = applyConditionalCondition(logs, { kind: "foreign", mode: "le", n }, ctx).length;
        const ge = applyConditionalCondition(logs, { kind: "foreign", mode: "ge", n }, ctx).length;
        check(`${league} ${season} ${teamId} 外国籍${n}人以下`, le === logs.filter((g) => g.foreignPlayerCount != null && g.foreignPlayerCount <= n).length);
        check(`${league} ${season} ${teamId} 外国籍${n}人以上`, ge === logs.filter((g) => g.foreignPlayerCount != null && g.foreignPlayerCount >= n).length);
      }
      for (let n = 40; n <= 140; n += 5) {
        for (const side of ["own", "opp"] as const) {
          const v = (g: TeamGameLog) => (side === "own" ? g.teamScore : g.opponentScore);
          const le = applyConditionalCondition(logs, { kind: "score", side, mode: "le", n }, ctx).length;
          const ge = applyConditionalCondition(logs, { kind: "score", side, mode: "ge", n }, ctx).length;
          check(`${league} ${season} ${teamId} ${side}${n}点以下`, le === logs.filter((g) => v(g) <= n).length);
          check(`${league} ${season} ${teamId} ${side}${n}点以上`, ge === logs.filter((g) => v(g) >= n).length);
        }
      }
      // 感度: 得点を1つ壊すと検出される
      if (logs.length > 0 && league === "premier" && season === "2025-26" && teamId === Object.keys(history.premier[season] ?? {})[0]) {
        const broken = logs.map((g, i) => (i === 0 ? { ...g, teamScore: g.teamScore + 1000 } : g));
        const a = applyConditionalCondition(broken, { kind: "score", side: "own", mode: "ge", n: 80 }, ctx).length;
        const b = logs.filter((g) => g.teamScore >= 80).length;
        check("感度: 得点を壊すと数が変わる", a !== b || logs[0].teamScore >= 80);
        // 感度: 出場人数を1つ壊すと数え直しと食い違う
        const g0 = logs.find((g) => g.foreignPlayedCount != null);
        if (g0) {
          const broken0 = { ...g0, foreignPlayedCount: (g0.foreignPlayedCount ?? 0) + 1 };
          const before = applyConditionalCondition([g0], { kind: "foreign", mode: "eq", n: g0.foreignPlayedCount ?? 0, measure: "foreignPlayed" }, ctx).length;
          const after = applyConditionalCondition([broken0], { kind: "foreign", mode: "eq", n: g0.foreignPlayedCount ?? 0, measure: "foreignPlayed" }, ctx).length;
          check("感度: 出場人数を壊すと条件の試合が変わる", before === 1 && after === 0);
        }
      }
    }
    // 個人の試合ログの人数は、同じ試合の所属チームの試合ログと同じ値（個人詳細のシチュエーション別成績も同じ試合になる）
    if (existsSync(`${dir}/player-games`)) {
      for (const f of readdirSync(`${dir}/player-games`)) {
        const plogs = (rj(`${dir}/player-games/${f}`) ?? []) as (PlayerGameLog & { teamId?: string })[];
        for (const pg of plogs) {
          // 試合の両チームのうち、自チーム側（相手の試合ログ＝pg.opponentTeamId）から見た自チームの記録
          const oppLog = allTeamLogs.get(pg.opponentTeamId)?.get(pg.scheduleKey);
          if (!oppLog) continue;
          const ownLog = allTeamLogs.get(oppLog.opponentTeamId)?.get(pg.scheduleKey);
          if (!ownLog) continue;
          const same = FOREIGN_FIELDS.every((k) => pg[k] === ownLog[k]);
          check(`${league} ${season} 選手 ${f} ${pg.scheduleKey} 人数がチームの試合ログと同じ`, same, FOREIGN_FIELDS.map((k) => `${k}:${pg[k]}/${ownLog[k]}`).join(" "));
          playerLogsCompared += 1;
          // 個人詳細の行（自チーム・相手）が同じ試合を選ぶ
          for (const group of foreignSituationalGroups<PlayerGameLog>(["own", "opp"])) {
            const teamGroup = foreignSituationalGroups<TeamGameLog>(["own", "opp"]).find((tg) => tg.key === group.key)!;
            for (const [ri, row] of group.rows.entries()) {
              if (row.predicate(pg) !== teamGroup.rows[ri].predicate(ownLog)) check(`${league} ${season} 選手 ${f} ${pg.scheduleKey} ${group.key}/${row.key}`, false);
            }
          }
        }
      }
    }
  }
}
console.log(`\nok ${ok} 件（対象期間の勝敗の照合 ${periodChecked} 件）`);
console.log(`個人の試合ログ ${playerLogsCompared} 件を所属チームの試合ログと照合（生データの無い試合 ${noRawGames} は数え直しなし）`);
console.log(`出場したが区分が分からず数えなかった選手: のべ ${unknownPlayed.players} 人・${unknownPlayed.games.size} 試合${unknownPlayed.games.size > 0 ? `（${[...unknownPlayed.games].slice(0, 10).join("、")}）` : ""}`);
for (const [k, v] of [...compareExcluded.entries()].filter(([, v]) => v > 0)) console.log(`  人数の比べで除いた試合: ${k} ${v} 試合（延べ）`);
for (const [k, v] of overMax) console.log(`  上限を超える人数の試合（チームの延べ）: ${k} ${v} 試合`);
for (const [k, v] of [...compared.entries()].sort()) console.log(`  ${k}: 延べ ${v} 試合`);
if (failures > 0) {
  console.error(`\n${failures} 件の食い違い`);
  process.exitCode = 1;
} else console.log("\nすべて一致しました");
