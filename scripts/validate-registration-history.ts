// 旧B1（B.PREMIER の 2016-17〜2025-26）の登録区分の台帳の検証（DESIGN.md 388章）。データだけで動く（導出データは使わない）。
//
// 1. 根拠の台帳（docs/registration-history/{season}.json）の形と、集計に使う区分表（data/{season}/registrations.json.gz）が
//    根拠から作ったものと同じこと（根拠の区分・日付を直したのに区分表を作り直していない、を検出する）
// 2. ユーザーと確かめた選手の、試合ごとの区分（試合の日に当てた区分が決まりどおり）
// 3. 全10シーズンで、コート上の外国籍・帰化・アジア特別枠の人数がそのシーズンの上限を超えた区間・試合の数が、
//    台帳を入れたときの数（KNOWN_OVER_LIMIT）より増えていないこと（交代の記録のずれもあるので 0 は求めない）。
//    数え方は Codex の調査（ledger/check.ts）と同じ: 同じチーム・同じ5人・同じクォーターの正の長さの区間を1区間とし、
//    2016-17・2017-18 は 外国籍＋帰化≦2・帰化≦1、2018-19・2019-20 は 外国籍≦2・帰化≦1、2020-21 以降は 外国籍≦2・帰化＋アジア特別枠≦1。
//    制度ができる前（2019-20 以前）にアジア特別枠がいれば超過に数える。初期2季は各クォーターの外国籍の最大の合計が6を超えるチーム試合も数える（必要条件）
//   npm run validate:registration-history
import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import { evidenceProblems, minimalRegistrationFile, readEvidence, REGISTRATION_HISTORY_SEASONS } from "./lib/registrationHistory.ts";
import { makeClassifier, type Classification, type SeasonRegistrationFile } from "../shared/registration.ts";
import { onCourtPeriodCount, periodRangeSeconds, reconstructOnCourt, substitutionModelForSeason } from "../shared/onCourt.ts";
import { isExhibitionGame } from "./lib/exhibitionGames.ts";
import type { PlayerMasterEntry } from "../shared/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}

/** 台帳を入れたとき（2026-11-14）の超過の数。区間・試合・初期2季のクォーターの必要条件のチーム試合。増えたら失敗、減ったら知らせる */
const KNOWN_OVER_LIMIT: Record<string, { segments: number; games: number; quarterBudget: number }> = {
  "2016-17": { segments: 5, games: 5, quarterBudget: 10 },
  "2017-18": { segments: 1, games: 1, quarterBudget: 2 },
  "2018-19": { segments: 0, games: 0, quarterBudget: 0 },
  "2019-20": { segments: 0, games: 0, quarterBudget: 0 },
  "2020-21": { segments: 6, games: 5, quarterBudget: 0 },
  "2021-22": { segments: 3, games: 3, quarterBudget: 0 },
  "2022-23": { segments: 3, games: 3, quarterBudget: 0 },
  "2023-24": { segments: 3, games: 3, quarterBudget: 0 },
  "2024-25": { segments: 5, games: 4, quarterBudget: 0 },
  "2025-26": { segments: 8, games: 6, quarterBudget: 0 },
};

/** 検算から外す試合（前後半5分の特別な試合・プレーバイプレーの無い手入力の試合） */
const SKIP_GAMES = new Set(["1330", "1333", "2690", "2693", "1810"]);

/** ユーザーと確かめた選手（2026-11-14）。試合の日がこの日より前なら before、この日からは after（after が無ければシーズンを通して before） */
const EXPECTED: { season: string; playerId: string; name: string; before: Classification; after?: Classification; from?: string }[] = [
  { season: "2017-18", playerId: "8490", name: "ファジーカス（川崎）", before: "外国籍", after: "帰化選手", from: "2018-05-01" },
  { season: "2018-19", playerId: "9345", name: "ウィリアムス ニカ（秋田）", before: "外国籍", after: "帰化選手", from: "2019-04-21" },
  { season: "2019-20", playerId: "8649", name: "ロシター（宇都宮）", before: "外国籍", after: "帰化選手", from: "2019-12-09" },
  { season: "2020-21", playerId: "9418", name: "エヴァンス ルーク（島根）", before: "外国籍" },
  { season: "2023-24", playerId: "9369", name: "河田（広島）", before: "外国籍", after: "帰化選手", from: "2023-10-26" },
  { season: "2023-24", playerId: "12582", name: "カーク（琉球）", before: "外国籍", after: "帰化選手", from: "2024-01-30" },
  { season: "2025-26", playerId: "9456", name: "小寺（越谷・広島）", before: "帰化選手" },
  { season: "2025-26", playerId: "26890", name: "メイヨ（広島）", before: "帰化選手" },
];

const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
const masterById = new Map(master.map((p) => [p.playerId, p]));

for (const season of REGISTRATION_HISTORY_SEASONS) {
  // 1. 台帳と区分表
  const evidence = await readEvidence(season);
  const problems = evidenceProblems(evidence);
  check(`${season}: 根拠の台帳の形（${Object.keys(evidence.players).length}名）`, problems.length === 0, problems.slice(0, 5).join(" / "));
  const stored = await readJson<SeasonRegistrationFile>(path.join(DATA_DIR, season, "registrations.json"));
  const expected = minimalRegistrationFile(evidence);
  check(`${season}: 区分表が根拠から作ったものと同じ`, !!stored && JSON.stringify(stored) === JSON.stringify(expected), "scripts/build-registration-history.ts を流してください");
  const extra = stored ? Object.values(stored.players).filter((e) => Object.keys(e).some((k) => k !== "classification" && k !== "changes")) : [];
  check(`${season}: 区分表は区分と切り替えの日付だけを持つ（根拠は台帳の側）`, extra.length === 0);
  if (!stored) continue;
  const classifyAt = makeClassifier(season, stored, masterById);

  const games = (await readAllGames(season)).filter((g) => !isExhibitionGame(g.raw.Game.ConventionNameJ ?? "")).sort((a, b) => Number(a.scheduleKey) - Number(b.scheduleKey));

  // 2. 主な選手の試合ごとの区分
  for (const ex of EXPECTED.filter((e) => e.season === season)) {
    const dates = games.filter((g) => [...g.raw.HomeBoxscores, ...g.raw.AwayBoxscores].some((r) => r.PeriodCategory === 18 && String(r.PlayerID) === ex.playerId && r.PlayTime !== "DNP")).map((g) => g.date);
    const wrong = dates.filter((d) => classifyAt(ex.playerId, d) !== (ex.after && ex.from && d >= ex.from ? ex.after : ex.before));
    const afterCount = ex.from ? dates.filter((d) => d >= ex.from!).length : 0;
    check(
      `${season} ${ex.name}: ${dates.length}試合の区分が決まりどおり（${ex.from ? `${ex.from} から${ex.after}・その後の出場${afterCount}試合` : `すべて${ex.before}`}）`,
      wrong.length === 0 && (ex.from === undefined || registrationChangeAt(stored, ex.playerId, ex.from, ex.after!)),
      wrong.slice(0, 5).join(", "),
    );
  }

  // 3. コート上の人数の上限
  let segments = 0;
  let seconds = 0;
  const overGames = new Set<string>();
  let quarterBudget = 0;
  let checked = 0;
  let asiaBefore = 0;
  const examples: string[] = [];
  for (const g of games) {
    if (!g.gameEndedFlg || g.raw.PlayByPlays.length === 0 || SKIP_GAMES.has(g.scheduleKey)) continue;
    checked += 1;
    const pbp = g.raw.PlayByPlays;
    const periods = onCourtPeriodCount(season, g.quarterScores.home.length, pbp);
    const rec = reconstructOnCourt(pbp, g.raw.HomeBoxscores, g.raw.AwayBoxscores, g.homeTeam.id, g.awayTeam.id, periods, substitutionModelForSeason(season));
    const qmax = new Map<string, number[]>();
    for (const st of rec.lineupStints) {
      if (st.endSec <= st.startSec || st.playerIds.length !== 5) continue;
      const classes = st.playerIds.map((id) => classifyAt(id, g.date));
      if (classes.some((c) => !c)) continue;
      const foreign = classes.filter((c) => c === "外国籍").length;
      const nat = classes.filter((c) => c === "帰化選手").length;
      const asia = classes.filter((c) => c === "アジア特別枠").length;
      for (let q = 1; q <= periods; q++) {
        const [qs, qe] = periodRangeSeconds(q);
        const start = Math.max(qs, st.startSec);
        const end = Math.min(qe, st.endSec);
        if (end <= start) continue;
        const max = qmax.get(st.teamId) ?? [0, 0, 0, 0];
        if (q <= 4) max[q - 1] = Math.max(max[q - 1]!, foreign);
        qmax.set(st.teamId, max);
        const over =
          season < "2018-19"
            ? foreign + nat + asia > 2 || nat > 1 || asia > 0
            : foreign > 2 || nat + asia > 1 || (season < "2020-21" && asia > 0);
        if (season < "2020-21" && asia > 0) asiaBefore += 1;
        if (!over) continue;
        segments += 1;
        seconds += end - start;
        overGames.add(g.scheduleKey);
        if (examples.length < 3) examples.push(`${g.scheduleKey} Q${q} ${st.teamId}`);
      }
    }
    if (season < "2018-19") for (const max of qmax.values()) if (max.reduce((a, b) => a + b, 0) > 6) quarterBudget += 1;
  }
  const known = KNOWN_OVER_LIMIT[season]!;
  check(`${season}: 制度ができる前のアジア特別枠がコートにいない`, asiaBefore === 0, `${asiaBefore}区間`);
  check(
    `${season}: 上限を超えた区間 ${segments}（${overGames.size}試合・${seconds}秒）が台帳を入れたときの ${known.segments}区間・${known.games}試合を超えない（${checked}試合を検査）`,
    checked > 0 && segments <= known.segments && overGames.size <= known.games,
    examples.join(", "),
  );
  if (season < "2018-19") check(`${season}: クォーターの申請の必要条件（4Qの外国籍の最大の合計≦6）を満たさないチーム試合 ${quarterBudget} が ${known.quarterBudget} を超えない`, quarterBudget <= known.quarterBudget);
  if (segments < known.segments || overGames.size < known.games) console.log(`     ${season}: 超過が減りました（${known.segments}→${segments}区間）。KNOWN_OVER_LIMIT を下げてください`);
}

function registrationChangeAt(file: SeasonRegistrationFile, id: string, from: string, cls: Classification): boolean {
  return (file.players[id]?.changes ?? []).some((c) => c.from === from && c.classification === cls);
}

if (failed > 0) {
  console.error(`\n${failed}件の確認が通りませんでした`);
  process.exitCode = 1;
} else {
  console.log("\nすべての確認が通りました");
}
