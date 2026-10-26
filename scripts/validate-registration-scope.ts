// 登録区分の5択（全選手／日本人／外国籍／帰化／アジア特別枠）と「その区分で出場した試合だけ」の数え方（DESIGN.md 298章）の検証スクリプト。
// シーズンの途中で区分が変わった選手は今は0人なので、実際の 2026-27 の選手1人に人工の変更（外国籍 → 帰化）を入れて確かめる。
// 実データは書き換えない（読み込んだものをメモリの中だけで変える）。`npm run build:data` のあとに実行する。
//
//  1. 選択肢・URL: cls=jp／foreign／nat／asia／intl／rookie を読める。並びは全選手／日本人／外国籍／帰化／アジア特別枠／まとめ／ルーキー。2025-26 以前の分けた区分は理由を出す
//  2. 区分の判定: 見做し日本人は日本人。行ごとの区分（rows.cls）があればそれ、無ければ選手の辞書の jp／intl。分けた区分は行ごとの区分がある行だけ
//  3. 人工の変更（外国籍 → 帰化）で、試合ログが変更日の前後に分かれ、足し直したシーズンの値（出場試合数・得点・出場時間）の合計が players.json と一致する
//  4. 1試合記録・勝負所（索引）: 帰化を選ぶと変更日以降、外国籍を選ぶと変更日より前の行だけが出る。2つの合計＝全選手
//  5. チームの区分別: 外国籍＋帰化の得点が、変更前の外国籍の得点と一致する（試合ごと・シーズン合計）
//  6. On/Off: 途中で区分が変わった選手は、外国籍・帰化のそれぞれの試合だけで On・Off を数え直し、2つの合計＝全選手の値
//  7. 通算（集計の filterByClassification）: 外国籍は変更日より前、帰化は変更日以降の試合だけ。日本人には入らない
//  8. 感度: 変更を入れないと、外国籍の値が全試合の値のまま（足し直しが効いていることの確認）
//
// 使い方: npm run validate:registration-scope（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile } from "../shared/gameIndex.ts";
import { compactStints, type CompactStints } from "../shared/onCourtTotals.ts";
import { makeClassifier, registrationOn, type SeasonRegistrationFile } from "../shared/registration.ts";
import { filterByClassification } from "../shared/careerTopSplit.ts";
import type { PlayerGameLog, PlayerMasterEntry, PlayerSummary, TeamGameLog, TeamStintsFile } from "../shared/types.ts";
import {
  CLASSIFICATION_GROUP_OPTIONS,
  CLASSIFICATION_URL_ALIASES,
  classificationMatches,
  indexRowClassMatches,
  splitClassificationBlocked,
  topFileClassKey,
  type ClassificationGroupFilter,
} from "../src/lib/classificationFilter.ts";
import { classificationAxis } from "../src/lib/filterAxes.ts";
import { enumParam } from "../src/lib/urlState.ts";
import {
  changedRegistrations,
  needsClassificationRecompute,
  scopedPlayerMatches,
  scopeLogsByClassification,
  summaryScopedToClassification,
} from "../src/lib/registrationScopeCore.ts";
import { indexClassScope } from "../src/lib/indexClassScope.ts";
import { viewPlayerGameIndex } from "../shared/gameIndexRead.ts";
import { DEFAULT_GAME_RECORD_CONDITIONS } from "../src/lib/gameRecordConditions.ts";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions.ts";
import { playerQueryStats, queryPlayerGameRecords } from "../src/lib/gameRecordQuery.ts";
import { queryClutch } from "../src/lib/clutchQuery.ts";
import { buildClassSplitSource, classSideValues, sumClassTotals } from "../src/lib/teamClassSplit.ts";
import { buildLineupRows, type LineupBuildQuery } from "../src/lib/lineupRanking.ts";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

const SEASON = "2026-27";
const dir = path.join(DATA_DIR, SEASON);

// ---- 1. 選択肢・URL ----
{
  // urlFilterParams.ts の PLAYER_GROUP_PARAM と同じ定義（あちらは読み込みの部品をたどるので、ここでは同じ値・書き方で作る）
  const param = enumParam<string>("cls", ["all", ...CLASSIFICATION_GROUP_OPTIONS, "rookie"], "all", CLASSIFICATION_URL_ALIASES as Record<string, string>);
  const read = (cls: string) => param.read(new URLSearchParams(`cls=${cls}`));
  check(
    "URL の cls（jp・foreign・nat・asia・intl・rookie）を読める",
    read("jp") === "日本人" && read("foreign") === "外国籍" && read("nat") === "帰化" && read("asia") === "アジア特別枠" && read("intl") === "外国籍・帰化・アジア" && read("rookie") === "rookie",
  );
  const optionsOf = (value: "all" | "外国籍・帰化・アジア", season: string | null) =>
    (classificationAxis(value, () => {}, { rookie: {}, season }) as { options: { value: string }[] }).options.map((o) => o.value);
  const now = optionsOf("all", SEASON);
  const ORDER = ["all", "日本人", "外国籍", "帰化", "アジア特別枠", "外国籍・帰化・アジア", "rookie"];
  check(
    "選択肢は 全選手／日本人／外国籍／帰化／アジア特別枠／外国籍・帰化・アジア／ルーキー（2026-27・2025-26・通算で同じ）",
    [now, optionsOf("all", "2025-26"), optionsOf("all", null)].every((o) => JSON.stringify(o) === JSON.stringify(ORDER)),
    now.join(","),
  );
  check(
    "2025-26 以前で分けた区分を選ぶと理由を出す（通算・歴代と 2026-27 は出さない）",
    splitClassificationBlocked("帰化", "2025-26") && !splitClassificationBlocked("帰化", SEASON) && !splitClassificationBlocked("帰化", null) && !splitClassificationBlocked("日本人", "2016-17"),
  );
  check("分けた区分は上位20位のファイルに表が無い（索引から集計する）", topFileClassKey("帰化") === null && topFileClassKey("日本人") === "jp" && topFileClassKey("外国籍・帰化・アジア") === "intl");
}

// ---- 2. 区分の判定 ----
{
  const deemed = registrationOn({ classification: "日本人", deemedJapanese: true }, "2026-10-01");
  check("見做し日本人は日本人（日本人に当てはまり、外国籍等に当てはまらない）", classificationMatches(deemed.classification, "日本人") && !classificationMatches(deemed.classification, "外国籍・帰化・アジア") && deemed.deemedJapanese);
  const oneReg = await readJson<SeasonRegistrationFile>(path.join(dir, "one", "registrations.json"));
  const deemedIds = Object.entries(oneReg?.players ?? {}).filter(([, e]) => e.deemedJapanese).map(([id]) => id);
  const oneIndex = await readJson<PlayerGameIndexFile>(path.join(dir, "one", "player-game-index.json"));
  let deemedRows = 0;
  let deemedJp = 0;
  if (oneIndex) {
    const at = new Map(oneIndex.players.map((p, i) => [p[0], i] as const));
    for (const id of deemedIds) {
      const pi = at.get(id);
      for (let i = 0; i < oneIndex.rows.player.length; i++) {
        if (oneIndex.rows.player[i] !== pi) continue;
        deemedRows += 1;
        if (indexRowClassMatches(oneIndex, i, "日本人")) deemedJp += 1;
      }
    }
  }
  check(`B.ONE の見做し日本人（${deemedIds.join("・") || "なし"}）の出場の行（${deemedRows}行）は、すべて日本人に入る`, deemedIds.length > 0 && deemedJp === deemedRows);
  const old = await readJson<PlayerGameIndexFile>(path.join(DATA_DIR, "2025-26", "player-game-index.json"));
  if (old) {
    let split = 0;
    let jpOrIntl = 0;
    for (let i = 0; i < old.rows.player.length; i++) {
      if (indexRowClassMatches(old, i, "外国籍") || indexRowClassMatches(old, i, "帰化") || indexRowClassMatches(old, i, "アジア特別枠")) split += 1;
      if (indexRowClassMatches(old, i, "日本人") || indexRowClassMatches(old, i, "外国籍・帰化・アジア")) jpOrIntl += 1;
    }
    check(`2025-26 の索引（行ごとの区分なし）は、分けた区分に1行も入らず、日本人・まとめで全行を分けられる（${jpOrIntl}／${old.rows.player.length}行）`, split === 0 && jpOrIntl === old.rows.player.length);
  }
}

// ---- 3〜8. 人工の変更 ----
const players = (await readJson<PlayerSummary[]>(path.join(dir, "players.json")))!;
const registrations = (await readJson<SeasonRegistrationFile>(path.join(dir, "registrations.json")))!;
const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
const indexFile = (await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json")))!;

// 外国籍で、レギュラーシーズンに6試合以上出た選手のうち、出場の多い選手
let target: { p: PlayerSummary; logs: PlayerGameLog[] } | null = null;
for (const p of [...players].sort((a, b) => b.gamesPlayed - a.gamesPlayed || a.playerId.localeCompare(b.playerId))) {
  if (registrations.players[p.playerId]?.classification !== "外国籍") continue;
  const logs = ((await readJson<PlayerGameLog[]>(path.join(dir, "player-games", `${p.playerId}.json`))) ?? []).filter((g) => g.gameType === "regular" && g.min > 0);
  if (logs.length >= 6 && new Set(logs.map((g) => g.date)).size >= 6) {
    target = { p, logs };
    break;
  }
}
if (!target) {
  check("人工の変更を入れる選手（外国籍・6試合以上）がいる", false);
  process.exit(1);
}
const { p: P, logs: P_LOGS } = target;
const dates = [...new Set(P_LOGS.map((g) => g.date))].sort();
const CHANGE_FROM = dates[Math.floor(dates.length / 2)]!;
const before = P_LOGS.filter((g) => g.date < CHANGE_FROM);
const after = P_LOGS.filter((g) => g.date >= CHANGE_FROM);
console.log(`   人工の変更: ${P.name}（${P.playerId}）を ${CHANGE_FROM} から外国籍 → 帰化（前 ${before.length}試合・後 ${after.length}試合）`);

const synthetic: SeasonRegistrationFile = {
  ...registrations,
  players: {
    ...registrations.players,
    [P.playerId]: { ...registrations.players[P.playerId]!, classification: "外国籍", changes: [{ from: CHANGE_FROM, classification: "帰化選手", source: "検証用の人工の変更" }] },
  },
};
const changed = changedRegistrations(synthetic);

// ---- 3. 試合ログの足し直し ----
{
  check("途中で区分が変わった選手として、その1人だけが見つかる", changed.size === 1 && changed.has(P.playerId));
  const fo = scopeLogsByClassification(P_LOGS, P.playerId, "外国籍", changed);
  const na = scopeLogsByClassification(P_LOGS, P.playerId, "帰化", changed);
  check(
    "試合ログが変更日の前（外国籍）と後（帰化）に分かれる。日本人・アジア特別枠は0試合、まとめは全試合",
    fo.length === before.length &&
      na.length === after.length &&
      fo.every((g) => g.date < CHANGE_FROM) &&
      na.every((g) => g.date >= CHANGE_FROM) &&
      scopeLogsByClassification(P_LOGS, P.playerId, "日本人", changed).length === 0 &&
      scopeLogsByClassification(P_LOGS, P.playerId, "アジア特別枠", changed).length === 0 &&
      scopeLogsByClassification(P_LOGS, P.playerId, "外国籍・帰化・アジア", changed).length === P_LOGS.length,
  );
  const sFo = summaryScopedToClassification(P, fo)!;
  const sNa = summaryScopedToClassification(P, na)!;
  check(
    `足し直したシーズンの値の合計が players.json と一致する（出場 ${sFo.gamesPlayed}＋${sNa.gamesPlayed}＝${P.gamesPlayed}試合・得点 ${sFo.totals.pts}＋${sNa.totals.pts}＝${P.totals.pts}）`,
    sFo.gamesPlayed + sNa.gamesPlayed === P.gamesPlayed &&
      sFo.totals.pts === before.reduce((a, g) => a + g.pts, 0) &&
      sFo.totals.pts + sNa.totals.pts === P.totals.pts &&
      Math.abs(sFo.totals.min + sNa.totals.min - P.totals.min) < 0.01 &&
      Math.abs(sFo.perGame.pts - sFo.totals.pts / sFo.gamesPlayed) < 1e-9,
  );
  check("その区分の試合が無ければ、足し直したシーズンの値は無い（一覧から外す）", summaryScopedToClassification(P, []) === null);
  check(
    "選手の判定: 外国籍・帰化・まとめに入り、日本人・アジア特別枠に入らない（一度でもその区分になったか）",
    scopedPlayerMatches(P, "外国籍", changed) && scopedPlayerMatches(P, "帰化", changed) && scopedPlayerMatches(P, "外国籍・帰化・アジア", changed) && !scopedPlayerMatches(P, "日本人", changed) && !scopedPlayerMatches(P, "アジア特別枠", changed),
  );
  check("区分を選んでいて対象にこの選手がいるときだけ、試合ログから足し直す経路にする", needsClassificationRecompute([P], "帰化", changed) && !needsClassificationRecompute([P], "all", changed) && !needsClassificationRecompute([P], "rookie", changed));
  // 8. 感度: 変更が無ければ外国籍の値は全試合のまま
  check("感度: 変更を入れないと、外国籍の試合ログは全試合のまま（足し直しが効いている）", scopeLogsByClassification(P_LOGS, P.playerId, "外国籍", changedRegistrations(registrations)).length === P_LOGS.length && before.length < P_LOGS.length);
}

// 索引に人工の変更を入れる（P の、変更日以降の行の区分を帰化 2 に）
const playerNo = indexFile.players.findIndex((x) => x[0] === P.playerId);
const cls = [...indexFile.rows.cls!];
let changedRows = 0;
for (let i = 0; i < indexFile.rows.player.length; i++) {
  if (indexFile.rows.player[i] !== playerNo) continue;
  if (indexFile.games.date[indexFile.rows.game[i]!]! >= CHANGE_FROM) {
    cls[i] = 2;
    changedRows += 1;
  }
}
const modified: PlayerGameIndexFile = { ...indexFile, rows: { ...indexFile.rows, cls } };
const view = viewPlayerGameIndex(modified);
const baseView = viewPlayerGameIndex(indexFile);

// ---- 4. 1試合記録・勝負所 ----
{
  const scope = indexClassScope(modified, "外国籍");
  check(`索引の区分: この選手は外国籍・帰化とも「一部の試合」（帰化に変えた行 ${changedRows}行）`, scope.status(P.playerId) === "some" && indexClassScope(modified, "帰化").status(P.playerId) === "some" && indexClassScope(modified, "アジア特別枠").status(P.playerId) === "none");
  const stat = playerQueryStats("record").find((s) => s.key === "pts")!;
  const q = (group: ClassificationGroupFilter) =>
    queryPlayerGameRecords({ views: [view], gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group, positions: [], statConditions: DEFAULT_STAT_CONDITIONS, rookies: null, stat, includeSpecial: true, topN: 1_000_000 }).rows.filter((r) => r.playerId === P.playerId);
  const all = q("all");
  const fo = q("外国籍");
  const na = q("帰化");
  check(
    `1試合記録（得点）: 帰化は変更日以降（${na.length}試合）、外国籍は変更日より前（${fo.length}試合）だけ。2つの合計＝全選手（${all.length}試合）`,
    na.every((r) => r.date >= CHANGE_FROM) && fo.every((r) => r.date < CHANGE_FROM) && fo.length + na.length === all.length && na.length > 0 && fo.length > 0,
  );
  const clutch = (group: ClassificationGroupFilter, v = view) =>
    queryClutch({ views: [v], gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group, rookies: null, measure: "goAhead", window: "5", topN: 1_000_000 }).rows.find((r) => r.playerId === P.playerId);
  const ca = clutch("all");
  const cf = clutch("外国籍");
  const cn = clutch("帰化");
  check("勝負所（シーズン）: 外国籍＋帰化＝全選手（勝ち越し弾・残り5分）", (cf?.fg ?? 0) + (cn?.fg ?? 0) === (ca?.fg ?? 0) && (cf?.ft ?? 0) + (cn?.ft ?? 0) === (ca?.ft ?? 0));
  const baseFo = clutch("外国籍", baseView);
  check("勝負所: 変更を入れない索引では、外国籍＝全選手", (baseFo?.fg ?? 0) === (ca?.fg ?? 0));
}

// ---- 5. チームの区分別 ----
{
  const source = buildClassSplitSource(modified, null);
  const baseSource = buildClassSplitSource(indexFile, null);
  const teamIds = new Set(P_LOGS.map(() => P.teamId));
  let ok = true;
  let checkedGames = 0;
  let natAfter = 0;
  for (const teamId of teamIds) {
    const logs = ((await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${teamId}.json`))) ?? []).filter((g) => g.gameType === "regular");
    for (const g of logs) {
      const no = source.gameNo.get(g.scheduleKey);
      if (no === undefined) continue;
      const row = no * 2 + (g.isHome ? 0 : 1);
      const fo = classSideValues(source, row, "foreign").pts;
      const na = classSideValues(source, row, "naturalized").pts;
      const baseFo = classSideValues(baseSource, row, "foreign").pts;
      const baseNa = classSideValues(baseSource, row, "naturalized").pts;
      checkedGames += 1;
      if (fo + na !== baseFo + baseNa) ok = false;
      if (classSideValues(source, row, "intl").pts !== classSideValues(baseSource, row, "intl").pts) ok = false;
      if (g.date >= CHANGE_FROM) natAfter += na - baseNa;
    }
    const sumFo = sumClassTotals(source, logs, "foreign").totals.pts;
    const sumNa = sumClassTotals(source, logs, "naturalized").totals.pts;
    const baseSum = sumClassTotals(baseSource, logs, "foreign").totals.pts + sumClassTotals(baseSource, logs, "naturalized").totals.pts;
    if (sumFo + sumNa !== baseSum) ok = false;
  }
  const afterPts = after.reduce((a, g) => a + g.pts, 0);
  check(`チームの区分別（${checkedGames}試合）: 外国籍＋帰化は変更前と同じ、まとめは変わらず、帰化に移った得点（${natAfter}）＝変更日以降の選手の得点（${afterPts}）`, ok && natAfter === afterPts);
}

// ---- 6. On/Off ----
{
  const stints = await readJson<TeamStintsFile>(path.join(dir, "team-stints", `${P.teamId}.json`));
  if (!stints) {
    check("On/Off: 出場区間がある", false);
  } else {
    const data = [{ view, stints: new Map<string, CompactStints>([[P.teamId, compactStints(stints)]]) }];
    const q = (group: ClassificationGroupFilter): LineupBuildQuery => ({ data, unit: "onoff", gameType: "both", conditions: DEFAULT_GAME_RECORD_CONDITIONS, group, positions: [], rookies: null, periods: null });
    const row = (group: ClassificationGroupFilter) => buildLineupRows(q(group)).find((r) => r.players.length === 1 && r.players[0]!.id === P.playerId);
    const all = row("all");
    const fo = row("外国籍");
    const na = row("帰化");
    const ok =
      !!all && !!fo && !!na &&
      fo.on.games + na.on.games === all.on.games &&
      Math.abs(fo.on.seconds + na.on.seconds - all.on.seconds) < 1e-6 &&
      fo.on.ownPoints + na.on.ownPoints === all.on.ownPoints &&
      !!fo.off && !!na.off && !!all.off &&
      Math.abs(fo.off.seconds + na.off.seconds - all.off.seconds) < 1e-6 &&
      fo.off.ownPoints + na.off.ownPoints === all.off.ownPoints;
    check(
      `On/Off: 外国籍（On ${fo?.on.games ?? 0}試合）・帰化（On ${na?.on.games ?? 0}試合）のそれぞれの試合だけで数え直し、On・Off とも2つの合計＝全選手（On ${all?.on.games ?? 0}試合）`,
      ok,
    );
    const duo = (group: ClassificationGroupFilter) =>
      buildLineupRows({ ...q(group), unit: "duo" }).filter((r) => r.players.some((x) => x.id === P.playerId));
    const duoAll = duo("all");
    const duoSplit = [...duo("外国籍"), ...duo("帰化"), ...duo("外国籍・帰化・アジア")];
    // 2人組は、相手も同じ区分の組だけ。P を含む組の On の秒数は、外国籍・帰化に分けた組の秒数が、全選手の組の秒数を超えない
    const allSec = new Map(duoAll.map((r) => [r.key, r.on.seconds]));
    check("2人組: 途中で区分が変わった選手を含む組の秒数は、全選手の組の秒数を超えない", duoSplit.every((r) => (r.on.seconds ?? 0) <= (allSec.get(r.key) ?? 0) + 1e-6));
  }
}

// ---- 7. 通算（集計の filterByClassification） ----
{
  const masterById = new Map(master.map((m) => [m.playerId, m]));
  const classifiers = new Map([[SEASON, makeClassifier(SEASON, synthetic, masterById)]]);
  const byPlayer = new Map([[P.playerId, [{ season: SEASON, logs: P_LOGS }]]]);
  const fo = filterByClassification(byPlayer, classifiers, (_, c) => c === "外国籍").get(P.playerId)?.flatMap((s) => s.logs) ?? [];
  const na = filterByClassification(byPlayer, classifiers, (_, c) => c === "帰化選手").get(P.playerId)?.flatMap((s) => s.logs) ?? [];
  const jp = filterByClassification(byPlayer, classifiers, (_, c) => c === "日本人").get(P.playerId);
  check(
    `通算の集計: 外国籍は変更日より前（${fo.length}試合）、帰化は変更日以降（${na.length}試合）、日本人には入らない`,
    fo.length === before.length && na.length === after.length && fo.every((g) => g.date < CHANGE_FROM) && na.every((g) => g.date >= CHANGE_FROM) && jp === undefined,
  );
}

console.log(failures === 0 ? "\nすべて ok" : `\n${failures} 件の食い違い`);
process.exit(failures === 0 ? 0 : 1);
