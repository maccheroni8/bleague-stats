// data/player-careers.json（ランキングの個人「Career」カテゴリと、個人詳細の「優勝回数」）を生成する（DESIGN.md 145・147章）。
//
// 各シーズンに登録していた選手（出場の有無を問わない。DESIGN.md 175章）について、そのシーズン終了時点までの累計の回数（在籍シーズン数・所属クラブ数・
// 出場試合数・ポストシーズン／ファイナル出場・優勝・地区優勝・個人賞）を持つ。対象は Bリーグ（2016-17）以降の
// B1／B.PREMIER の記録だけ（B.ONE・B2 は持っていないため数えない）。
//
// - 在籍シーズン・所属クラブ: 名簿（終了したシーズンはシーズン別の選手一覧、進行中のシーズンは在籍中の一覧）に載っている、
//   ベンチ入りした試合がある（出場時間0でもボックススコアに名前がある）、または1試合以上出場したシーズン・クラブ（登録ベース。DESIGN.md 176・177章）。通算出場試合・ポストシーズン／ファイナル出場は出場ベース
// - 出場: 試合ログのうち出場時間がある試合（min > 0）。オールスター等は試合ログに含まれない
// - 所属チーム（試合ごと）: 試合の要約（games-summary.json）のホーム/アウェイのうち、相手ではない方
// - ファイナル: 試合データにラウンドの区別が無いため、「そのシーズンのポストシーズン最後の試合の2チームどうしの
//   ポストシーズンの試合」とする。優勝チーム（club-honors.json の Bリーグチャンピオンシップ優勝）がその2チームに
//   含まれるシーズンだけ判定する（ポストシーズンの途中のシーズンで準決勝等をファイナルと取り違えないため）
// - 優勝・地区優勝: 優勝（地区1位）チームに「レギュラーシーズン終了時に所属していた」選手（出場0試合を含む）。
//   当時の選手一覧（season-rosters.json）は多くのシーズンでシーズン終了時点の名簿だが、1年を通して出場した選手が
//   載っていない年がある（特に2016-17）ため、出場記録と組み合わせる（isMemberAtSeasonEnd。DESIGN.md 147章）
// - 個人賞: player-awards.json のうち B2 の賞以外（MVP・ベストファイブ等の区分の無い賞は B1）を、種類ごと（MVP・ベストファイブ・最優秀新人賞・新人賞ベストファイブ・個人タイトル）に数える
//
// 夜間実行で歴代記録の順位と一緒に作り直す。作った時刻以外が前回と同じならファイルを書き換えない。
//
// 使い方:
//   npm run aggregate:player-careers [-- --compare]
//   --compare: 優勝・地区優勝チームの所属の判定を「当時の選手一覧のまま」と比べ、違う選手を理由付きで表示する

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import type {
  ClubHonorsFile,
  GameSummary,
  PlayerAwardsFile,
  PlayerCareerCounts,
  PlayerCareersFile,
  PlayerGameLog,
  CurrentRosterFile,
  PlayerMasterEntry,
  SeasonRostersFile,
} from "../shared/types.ts";
import { awardCountKeyOf, type AwardCountKey } from "../shared/playerAwardKinds.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;

function listSeasonDirs(): string[] {
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
}

/** ファイナルの試合（scheduleKey）。判定できないシーズンは空 */
function finalsScheduleKeys(summaries: GameSummary[], championTeamId: string | undefined): Set<string> {
  const playoff = summaries.filter((g) => g.gameType === "playoff");
  if (!championTeamId || playoff.length === 0) return new Set();
  const last = playoff.reduce((a, b) => (b.date > a.date || (b.date === a.date && Number(b.scheduleKey) > Number(a.scheduleKey)) ? b : a));
  const pair = new Set([last.homeTeamId, last.awayTeamId]);
  if (!pair.has(championTeamId)) return new Set();
  return new Set(playoff.filter((g) => pair.has(g.homeTeamId) && pair.has(g.awayTeamId)).map((g) => g.scheduleKey));
}

/** 1試合の出場（所属チーム付き） */
interface Appearance {
  scheduleKey: string;
  date: string;
  teamId: string;
  gameType: "regular" | "playoff";
}

const byGameOrder = (a: { date: string; scheduleKey: string }, b: { date: string; scheduleKey: string }) =>
  a.date.localeCompare(b.date) || Number(a.scheduleKey) - Number(b.scheduleKey);

/**
 * レギュラーシーズン終了時にそのチームに所属していたか（優勝・地区優勝の判定。DESIGN.md 147章）。
 * - 当時の選手一覧にそのチームで載っている: 出場記録が無ければ所属。あれば、そのシーズン最後に出場したチームがそのチームなら所属
 * - どの一覧にも載っていない: そのチームでポストシーズンに出場した、またはそのチームのレギュラーシーズン最後の2試合のどちらかに
 *   出場したときだけ所属
 * - 一覧のチームと、そのシーズン最後に出場したチームが違う: 一覧に載っていない選手と同じ扱い（2026-09-26。2017-18 のレーンは
 *   一覧が島根だが、12月に A東京と契約してファイナルまで出場していた）
 * - 別のチームの一覧に載っていて、最後に出場したのもそのチーム（または出場記録が無い）: 所属としない
 */
function isMemberAtSeasonEnd(
  teamId: string,
  listedTeamId: string | undefined,
  appearances: Appearance[],
  lastTwoRegularKeys: Set<string>,
): boolean {
  const lastTeamId = [...appearances].sort(byGameOrder).at(-1)?.teamId;
  if (listedTeamId !== undefined && (lastTeamId === undefined || lastTeamId === listedTeamId)) return listedTeamId === teamId;
  return appearances.some((a) => a.teamId === teamId && (a.gameType === "playoff" || lastTwoRegularKeys.has(a.scheduleKey)));
}

interface Running {
  seasons: Set<string>;
  clubs: Set<string>;
  games: number;
  postseasons: Set<string>;
  finals: Set<string>;
  titles: Set<string>;
  divisionTitles: Set<string>;
}

const emptyRunning = (): Running => ({
  seasons: new Set(),
  clubs: new Set(),
  games: 0,
  postseasons: new Set(),
  finals: new Set(),
  titles: new Set(),
  divisionTitles: new Set(),
});

async function main() {
  const compare = process.argv.includes("--compare");
  const honors = (await readJson<ClubHonorsFile>(path.join(DATA_DIR, "club-honors.json"))) ?? {};
  const awards = (await readJson<PlayerAwardsFile>(path.join(DATA_DIR, "player-awards.json"))) ?? {};
  const rosters = (await readJson<SeasonRostersFile>(path.join(DATA_DIR, "season-rosters.json"))) ?? {};
  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  // 進行中のシーズンの名簿（公式の「在籍中」の一覧。夜間実行で保存）。在籍シーズン・所属クラブの数え方に使う（DESIGN.md 176章）
  const currentRoster = await readJson<CurrentRosterFile>(path.join(DATA_DIR, "current-roster.json"));
  const nameOf = new Map(master.map((p) => [p.playerId, p.name]));
  const championBySeason = new Map<string, string>();
  const divisionWinnersBySeason = new Map<string, Set<string>>();
  for (const [teamId, list] of Object.entries(honors)) {
    for (const h of list) {
      if (h.category === "overall") championBySeason.set(h.season, teamId);
      if (h.category === "division") {
        const set = divisionWinnersBySeason.get(h.season) ?? new Set<string>();
        set.add(teamId);
        divisionWinnersBySeason.set(h.season, set);
      }
    }
  }
  // 個人賞は種類ごとに数える（MVP・ベストファイブ・最優秀新人賞・新人賞ベストファイブ・個人タイトル。B2の賞は数えない。DESIGN.md 195章）
  const unknownAwardNames = new Set<string>();
  const awardCountsThrough = (playerId: string, season: string) => {
    const counts: Record<AwardCountKey, number> = { awardMvp: 0, awardBestFive: 0, awardRookie: 0, awardRookieBestFive: 0, awardTitles: 0 };
    for (const a of awards[playerId] ?? []) {
      if (a.season > season || a.category === "B2") continue;
      const key = awardCountKeyOf(a.name);
      if (key) counts[key] += 1;
      else if (!unknownAwardNames.has(a.name)) {
        // 種類分けに無い賞（新しい賞が増えたとき）は数えないので、気づけるように知らせる
        unknownAwardNames.add(a.name);
        console.warn(`個人賞の種類に無い賞のため数えません: ${a.name}`);
      }
    }
    return counts;
  };

  const running = new Map<string, Running>();
  const out: PlayerCareersFile["seasons"] = {};
  const championships: PlayerCareersFile["championships"] = {};

  for (const season of listSeasonDirs()) {
    const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
    const summaryByKey = new Map(summaries.map((g) => [g.scheduleKey, g]));
    const champion = championBySeason.get(season);
    const finals = finalsScheduleKeys(summaries, champion);
    const divisionWinners = divisionWinnersBySeason.get(season) ?? new Set<string>();
    const listedTeamOf = new Map<string, string>();
    const teamNameOf = new Map<string, string>();
    // 登録していたクラブ（在籍シーズン・所属クラブは「名簿に載っている・ベンチ入りした・出場した」で数える。DESIGN.md 176・177章）。
    // 名簿は、終了したシーズンはシーズン別の選手一覧、進行中のシーズンは在籍中の一覧。ベンチ入り・出場は下の試合ログで足す
    const registeredTeamsOf = new Map<string, Set<string>>();
    const addRegisteredTeam = (id: string, teamId: string) => {
      const set = registeredTeamsOf.get(id) ?? new Set<string>();
      set.add(teamId);
      registeredTeamsOf.set(id, set);
    };
    for (const entry of rosters[season] ?? []) {
      teamNameOf.set(entry.teamId, entry.teamName);
      for (const id of entry.playerIds) {
        listedTeamOf.set(id, entry.teamId);
        addRegisteredTeam(id, entry.teamId);
      }
    }
    if (currentRoster?.season === season) for (const p of currentRoster.players) addRegisteredTeam(p.playerId, p.teamId);

    // 選手ごとの出場（所属チーム付き）
    const appearancesOf = new Map<string, Appearance[]>();
    const logsOf = new Map<string, PlayerGameLog[]>();
    const dir = path.join(DATA_DIR, season, "player-games");
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
      const playerId = file.replace(/\.json\.gz$/, "");
      const logs = await readJson<PlayerGameLog[]>(path.join(dir, `${playerId}.json`));
      // ベンチ入り（出場時間0でもボックススコアに名前がある試合）も、在籍シーズン・所属クラブの登録の根拠にする（DESIGN.md 177章）
      for (const g of logs ?? []) {
        if (g.gameType !== "regular" && g.gameType !== "playoff") continue;
        const s = summaryByKey.get(g.scheduleKey);
        if (s) addRegisteredTeam(playerId, s.homeTeamId === g.opponentTeamId ? s.awayTeamId : s.homeTeamId);
      }
      const played = (logs ?? []).filter((g) => g.min > 0 && (g.gameType === "regular" || g.gameType === "playoff"));
      if (played.length === 0) continue;
      logsOf.set(playerId, played);
      const apps: Appearance[] = [];
      for (const g of played) {
        const s = summaryByKey.get(g.scheduleKey);
        if (!s) continue;
        const teamId = s.homeTeamId === g.opponentTeamId ? s.awayTeamId : s.homeTeamId;
        apps.push({ scheduleKey: g.scheduleKey, date: g.date, teamId, gameType: g.gameType as "regular" | "playoff" });
      }
      appearancesOf.set(playerId, apps);
    }

    // --compare: 一覧のチームと最後に出場したチームが違う選手（優勝・地区優勝に関係しないチームを含む全員）
    if (compare) {
      const lastTwoOf = (teamId: string) =>
        new Set(
          summaries
            .filter((g) => g.gameType === "regular" && (g.homeTeamId === teamId || g.awayTeamId === teamId))
            .sort(byGameOrder)
            .slice(-2)
            .map((g) => g.scheduleKey),
        );
      for (const [id, apps] of appearancesOf) {
        const listed = listedTeamOf.get(id);
        const last = [...apps].sort(byGameOrder).at(-1)!;
        if (listed === undefined || listed === last.teamId) continue;
        const mine = apps.filter((a) => a.teamId === last.teamId);
        const po = mine.filter((a) => a.gameType === "playoff").length;
        const lastTwo = lastTwoOf(last.teamId);
        const inLastTwo = mine.filter((a) => lastTwo.has(a.scheduleKey)).length;
        const member = isMemberAtSeasonEnd(last.teamId, listed, apps, lastTwo);
        const name = (t: string) => teamNameOf.get(t) ?? summaries.find((g) => g.homeTeamId === t)?.homeTeamName ?? t;
        const title = last.teamId === champion ? "優勝" : divisionWinners.has(last.teamId) ? "地区優勝" : "";
        console.log(
          `MISMATCH ${season} ${nameOf.get(id) ?? id}: 一覧=${name(listed)} 最後=${name(last.teamId)}（${last.date}）${title ? `【${title}】` : ""} ` +
            `最後のチームで${mine.length}試合・PS${po}・最後の2試合中${inLastTwo} → ${member ? `${name(last.teamId)}の所属` : "どこの所属にもしない"}`,
        );
      }
    }

    // 優勝・地区優勝チームの、レギュラーシーズン終了時の所属選手
    const titleTeams = new Set([...(champion ? [champion] : []), ...divisionWinners]);
    const membersOf = new Map<string, Set<string>>();
    for (const teamId of titleTeams) {
      const regular = summaries.filter((g) => g.gameType === "regular" && (g.homeTeamId === teamId || g.awayTeamId === teamId)).sort(byGameOrder);
      const lastTwo = new Set(regular.slice(-2).map((g) => g.scheduleKey));
      const candidates = new Set([...[...listedTeamOf].filter(([, t]) => t === teamId).map(([id]) => id), ...appearancesOf.keys()]);
      const members = new Set<string>();
      for (const id of candidates) {
        if (isMemberAtSeasonEnd(teamId, listedTeamOf.get(id), appearancesOf.get(id) ?? [], lastTwo)) members.add(id);
      }
      membersOf.set(teamId, members);
      if (compare) {
        const listed = new Set([...listedTeamOf].filter(([, t]) => t === teamId).map(([id]) => id));
        const label = `${season} ${teamNameOf.get(teamId) ?? teamId}（${teamId === champion ? "優勝" : ""}${divisionWinners.has(teamId) ? "地区優勝" : ""}）`;
        for (const id of members) if (!listed.has(id)) {
          const apps = (appearancesOf.get(id) ?? []).filter((a) => a.teamId === teamId);
          const po = apps.filter((a) => a.gameType === "playoff").length;
          const inLastTwo = apps.filter((a) => lastTwo.has(a.scheduleKey)).length;
          const listedElsewhere = listedTeamOf.get(id);
          const where = listedElsewhere ? `一覧は${teamNameOf.get(listedElsewhere) ?? listedElsewhere}だが最後の出場はこのチーム` : "一覧に無い";
          console.log(`+ ${label} ${nameOf.get(id) ?? id}: ${where}。このチームで${apps.length}試合、ポストシーズン${po}試合、最後の2試合のうち${inLastTwo}試合に出場`);
        }
        for (const id of listed) if (!members.has(id)) {
          const last = [...(appearancesOf.get(id) ?? [])].sort(byGameOrder).at(-1);
          console.log(`- ${label} ${nameOf.get(id) ?? id}: 一覧に載っているが、最後の出場は ${last?.date} の${teamNameOf.get(last?.teamId ?? "") ?? last?.teamId}`);
        }
        const others = [...appearancesOf].filter(([id, apps]) => !members.has(id) && !listed.has(id) && apps.some((a) => a.teamId === teamId));
        for (const [id, apps] of others) {
          const mine = apps.filter((a) => a.teamId === teamId).sort(byGameOrder);
          const listedElsewhere = listedTeamOf.get(id);
          console.log(`  （対象外）${label} ${nameOf.get(id) ?? id}: このチームで${mine.length}試合（最後 ${mine.at(-1)!.date}）、${listedElsewhere ? `一覧は${teamNameOf.get(listedElsewhere)}` : "どの一覧にも無い"}`);
        }
      }
    }

    const seasonOut: Record<string, PlayerCareerCounts> = {};
    // そのシーズンに登録していた選手（players.json と、名簿から足した registered-players.json。ランキングの Career の対象。DESIGN.md 175章）。
    // 出場の無い選手も、そのシーズン終了時点までの累計を持たせる
    const registeredIds = new Set<string>();
    for (const file of ["players.json", "registered-players.json"]) {
      for (const p of (await readJson<{ playerId: string }[]>(path.join(DATA_DIR, season, file))) ?? []) registeredIds.add(p.playerId);
    }
    const playerIds = new Set([
      ...appearancesOf.keys(),
      ...[...membersOf.values()].flatMap((m) => [...m]),
      ...registeredIds,
      ...registeredTeamsOf.keys(),
    ]);
    for (const playerId of playerIds) {
      const r = running.get(playerId) ?? emptyRunning();
      running.set(playerId, r);
      if (champion && membersOf.get(champion)?.has(playerId)) {
        r.titles.add(season);
        (championships[playerId] ??= []).push({ season, teamId: champion, teamName: teamNameOf.get(champion) ?? champion });
      }
      for (const teamId of divisionWinners) if (membersOf.get(teamId)?.has(playerId)) r.divisionTitles.add(season);
      const played = logsOf.get(playerId);
      // 在籍シーズン・所属クラブ: 名簿に載っている・ベンチ入りした試合がある・1試合以上出場した（登録ベース。DESIGN.md 176・177章）
      const rosterTeams = registeredTeamsOf.get(playerId);
      if (played || rosterTeams) r.seasons.add(season);
      for (const teamId of rosterTeams ?? []) r.clubs.add(teamId);
      if (played) {
        for (const a of appearancesOf.get(playerId) ?? []) {
          r.clubs.add(a.teamId);
          if (a.gameType === "playoff") r.postseasons.add(season);
          if (finals.has(a.scheduleKey)) r.finals.add(season);
        }
        r.games += played.filter((g) => g.gameType === "regular").length;
      }
      // 出場0試合で登録もしていない（一覧に無いが優勝チームの所属と判定された等）選手は、累計にだけ数えてランキングの対象にはしない
      if (!played && !registeredIds.has(playerId)) continue;
      seasonOut[playerId] = {
        seasons: r.seasons.size,
        clubs: r.clubs.size,
        games: r.games,
        postseasons: r.postseasons.size,
        finals: r.finals.size,
        titles: r.titles.size,
        divisionTitles: r.divisionTitles.size,
        ...awardCountsThrough(playerId, season),
      };
    }
    out[season] = seasonOut;
    if (!compare) console.log(`${season}: ${Object.keys(seasonOut).length}名（ファイナル${finals.size}試合）`);
  }

  if (compare) return;
  const file: PlayerCareersFile = { generatedAt: new Date().toISOString(), seasons: out, championships };
  const changed = await writeJsonIfChanged(path.join(DATA_DIR, "player-careers.json"), file as unknown as Record<string, unknown>);
  console.log(changed ? "\ndata/player-careers.jsonに保存しました" : "\n内容に変化が無いため data/player-careers.json は書き換えませんでした");
}

main();
