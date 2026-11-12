// ファウルの導出データ（data/{season}/fouls.json.gz・one/fouls.json.gz）の検証。先に npm run build:data で作っておく。
// 1. 生データから作り直した中身が、ファイルと同じ（作成時刻を除く）
// 2. チームの値が、試合ログ（team-games）の technicalFouls（＝コーチ＋ベンチ＋選手）・unsportsmanlikeFouls・disqualifyingFouls・flagrantFouls・disruptiveFouls と一致する
// 3. 選手の値が、試合ログ（player-games）の technicalFouls・unsportsmanlikeFouls・disqualifyingFouls・flagrantFouls・disruptiveFouls と一致する（試合ログのある選手）
// 4. 公式のボックススコアの選手の PF（FOUL）＝ プレーバイプレーのファウルの数（22・23・24・25・26・91〜94）。合わない行は、その選手に
//    ファウルの種類の書かれていない記録（ActionCD1=31）があるときだけ許す（種類が分からないので、どの数にも入れていない）
// 5. 画面の集計（src/lib/figureFouls.ts）の「1試合で2回」・順位・トップ3の塗りの決まり
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./lib/storage.ts";
import { buildFoulsIndex } from "./lib/foulsIndexBuild.ts";
import { PLAYER_FOUL_COLUMNS, TEAM_FOUL_COLUMNS, type FoulsIndexFile } from "../shared/foulsIndex.ts";
import type { Category, PlayerGameLog, TeamGameLog } from "../shared/types.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../shared/gameIndex.ts";
import { competitionRanks, foulSortLabel, playerFoulRows, sortFoulRows, teamFoulRows, topThreeLevels } from "../src/lib/figureFouls.ts";

const PERSONAL_FOUL_CODES = new Set([22, 23, 24, 25, 26, 91, 92, 93, 94]);
const UNTYPED_FOUL_CODE = 31;

const seasons = readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort();
let checks = 0;
const summary: string[] = [];

for (const season of seasons) {
  for (const category of ["premier", "one"] as Category[]) {
    const dir = path.join(DATA_DIR, seasonDirName(season, category));
    const name = category === "one" ? `${season} B.ONE` : season;
    if (!existsSync(path.join(dir, "team-game-index.json.gz"))) continue;
    const file = await readJson<FoulsIndexFile>(path.join(dir, "fouls.json"));
    assert.ok(file, `${name}: fouls.json.gz がありません`);
    const teamIndex = (await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json")))!;
    const playerIndex = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
    const games = await readAllGames(season, category);

    // 1. 作り直した中身と同じ
    const rebuilt = buildFoulsIndex(season, teamIndex, playerIndex, games);
    assert.deepEqual({ ...rebuilt, generatedAt: "" }, { ...file, generatedAt: "" }, `${name}: 作り直した中身がファイルと違います`);
    checks++;

    // 2. チームの値と試合ログ
    const gameNo = new Map(file.games.key.map((k, i) => [k, i]));
    let teamRows = 0, noPbp = 0;
    for (const [teamId] of file.teams) {
      const logs = await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${teamId}.json`));
      if (!logs) continue;
      for (const log of logs) {
        const g = gameNo.get(log.scheduleKey);
        if (g === undefined) continue;
        const side: 0 | 1 = file.teams[file.games.home[g]!]![0] === teamId ? 0 : 1;
        const row = g * 2 + side;
        if (file.team.tfCoach[row] === -1) {
          noPbp++;
          for (const c of TEAM_FOUL_COLUMNS) assert.equal(file.team[c][row], -1, `${name} ${log.scheduleKey}: 値なしの行は全部 -1`);
          continue;
        }
        const v = (c: (typeof TEAM_FOUL_COLUMNS)[number]): number => file.team[c][row]!;
        assert.equal(v("tfCoach") + v("tfBench") + v("tfPlayer"), log.technicalFouls, `${name} ${log.scheduleKey} ${teamId}: TF`);
        assert.equal(v("uf"), log.unsportsmanlikeFouls, `${name} ${log.scheduleKey} ${teamId}: UF`);
        assert.equal(v("dq"), log.disqualifyingFouls, `${name} ${log.scheduleKey} ${teamId}: DQ`);
        assert.equal(v("flagrant"), log.flagrantFouls ?? 0, `${name} ${log.scheduleKey} ${teamId}: フレグラント`);
        assert.equal(v("disruptive"), log.disruptiveFouls ?? 0, `${name} ${log.scheduleKey} ${teamId}: ディスラプティブ`);
        assert.ok(v("uf") >= v("flagrant") + v("disruptive"), `${name} ${log.scheduleKey}: UF は内訳以上`);
        teamRows++;
      }
    }
    assert.equal(teamRows + noPbp, file.games.key.length * 2, `${name}: チームの行が試合ログとすべて突き合わない`);
    checks++;

    // 3. 選手の値と試合ログ（試合ログのある選手。出場していない選手のテクニカルは試合ログに行が無いことがある）
    const fromFile = new Map<string, Record<string, number>>();
    for (let i = 0; i < file.player.player.length; i++) {
      const key = `${file.players[file.player.player[i]!]![0]}:${file.games.key[file.player.game[i]!]}`;
      const cur = fromFile.get(key) ?? Object.fromEntries(PLAYER_FOUL_COLUMNS.map((c) => [c, 0]));
      for (const c of PLAYER_FOUL_COLUMNS) cur[c]! += file.player[c][i]!;
      fromFile.set(key, cur);
    }
    const seen = new Set<string>();
    let playerLogRows = 0;
    const playersDir = path.join(dir, "player-games");
    for (const f of existsSync(playersDir) ? readdirSync(playersDir) : []) {
      const playerId = f.replace(/\.json\.gz$/, "");
      const logs = (await readJson<PlayerGameLog[]>(path.join(playersDir, `${playerId}.json`))) ?? [];
      for (const log of logs) {
        const key = `${playerId}:${log.scheduleKey}`;
        if (!gameNo.has(log.scheduleKey)) continue;
        const g = gameNo.get(log.scheduleKey)!;
        if (file.team.tfCoach[g * 2] === -1) continue; // プレーバイプレーが無い試合
        const got = fromFile.get(key) ?? { tf: 0, uf: 0, flagrant: 0, disruptive: 0, dq: 0 };
        const want = { tf: log.technicalFouls, uf: log.unsportsmanlikeFouls, flagrant: log.flagrantFouls ?? 0, disruptive: log.disruptiveFouls ?? 0, dq: log.disqualifyingFouls };
        assert.deepEqual(got, want, `${name} ${key}: 選手の値が試合ログと違います`);
        seen.add(key);
        playerLogRows++;
      }
    }
    const withoutLog = [...fromFile.keys()].filter((k) => !seen.has(k));
    checks++;

    // 4. 公式の PF との照合
    let pfRows = 0, pfMismatch = 0, untyped = 0;
    for (const game of games) {
      const pbp = game.raw.PlayByPlays ?? [];
      if (!pbp.length || !gameNo.has(String(game.scheduleKey))) continue;
      const counted = new Map<string, number>();
      const untypedBy = new Map<string, number>();
      for (const ev of pbp) {
        if (!ev.PlayerID1) continue;
        if (PERSONAL_FOUL_CODES.has(ev.ActionCD1)) counted.set(String(ev.PlayerID1), (counted.get(String(ev.PlayerID1)) ?? 0) + 1);
        if (ev.ActionCD1 === UNTYPED_FOUL_CODE) {
          untyped++;
          untypedBy.set(String(ev.PlayerID1), (untypedBy.get(String(ev.PlayerID1)) ?? 0) + 1);
        }
      }
      for (const b of [...game.raw.HomeBoxscores, ...game.raw.AwayBoxscores]) {
        if (b.PeriodCategory !== 18 || b.Category !== 1 || !b.PlayerID) continue;
        pfRows++;
        const id = String(b.PlayerID);
        const diff = b.FOUL - (counted.get(id) ?? 0);
        if (diff === 0) continue;
        pfMismatch++;
        assert.ok(diff > 0 && diff <= (untypedBy.get(id) ?? 0), `${name} ${game.scheduleKey} ${b.PlayerNameJ}: 公式の PF ${b.FOUL} とプレーバイプレーのファウル ${counted.get(id) ?? 0} が合わず、種類の書かれていない記録でも説明できません`);
      }
    }
    checks++;
    summary.push(`${name}: 試合 ${file.games.key.length}（PBPなし ${noPbp / 2}）・選手の行 ${file.player.player.length}（試合ログに無い ${withoutLog.length}）・試合ログと照合 ${playerLogRows} 行・公式PFと合わない行 ${pfMismatch}/${pfRows}（種類の書かれていない記録 ${untyped} 件で説明）`);
  }
}

// 5. 画面の集計の決まり
assert.deepEqual(competitionRanks([5, 4, 3, 3, 3, 1]), [1, 2, 3, 3, 3, 6]);
assert.deepEqual(topThreeLevels([5, 4, 3, 3, 0, 0]), [1, 2, 3, 3, null, null]);
assert.deepEqual(topThreeLevels([2, 2, 2, 1]), [1, 1, 1, null], "同数の1位が3人なら全員が1位の濃さ、次（4位）は塗らない");
assert.deepEqual(topThreeLevels([4, 3, 2, 2, 2, 1]), [1, 2, 3, 3, 3, null], "3位が何人いても全員塗る");
assert.deepEqual(topThreeLevels([0, 0]), [null, null], "0 は塗らない");
{
  // 並べ替え: 多い順の順位、少ない順は並びと順位をそのまま逆に（順位の数字は変えない）
  const rows = [{ n: "A", v: 1, w: 5 }, { n: "B", v: 3, w: 0 }, { n: "C", v: 3, w: 2 }, { n: "D", v: 0, w: 9 }];
  const desc = sortFoulRows(rows, (r) => r.v, [(r) => r.w], (r) => r.n, true);
  assert.deepEqual(desc.rows.map((r) => r.n), ["C", "B", "A", "D"], "同じ数はほかの列の多い順");
  assert.deepEqual(desc.ranks, [1, 1, 3, 4]);
  const asc = sortFoulRows(rows, (r) => r.v, [(r) => r.w], (r) => r.n, false);
  assert.deepEqual(asc.rows.map((r) => r.n), ["D", "A", "B", "C"]);
  assert.deepEqual(asc.ranks, [4, 3, 1, 1], "少ない順でも順位の数字は多い順のまま");
  assert.equal(foulSortLabel("合計", true), "合計↓");
  assert.equal(foulSortLabel("コーチ", false), "コーチ↑");
  checks += 6;
}
{
  const mini: FoulsIndexFile = {
    version: 1, generatedAt: "", season: "2026-27",
    teams: [["1", "A"], ["2", "B"]],
    games: { key: ["g1", "g2"], date: ["2026-10-01", "2026-10-02"], flags: [0, 1], home: [0, 1], away: [1, 0] },
    players: [["p1", "選手1"], ["p2", "選手2"]],
    team: { tfCoach: [1, 0, 0, 0], tfBench: [0, 0, 0, 1], tfPlayer: [2, 0, 0, 0], uf: [1, 0, 0, 1], flagrant: [1, 0, 0, 0], disruptive: [0, 0, 0, 1], dq: [0, 0, 0, 0] },
    player: { player: [0, 1], game: [0, 1], team: [0, 0], tf: [2, 0], uf: [1, 1], flagrant: [1, 0], disruptive: [0, 1], dq: [0, 0] },
  };
  const teams = teamFoulRows(mini, { gameType: "both", range: { kind: "all" } });
  const a = teams.find((t) => t.teamId === "1")!;
  assert.deepEqual([a.tfCoach, a.tfBench, a.tfPlayer, a.tf, a.uf, a.flagrant, a.disruptive, a.dq, a.games], [1, 1, 2, 4, 2, 1, 1, 0, 2]);
  assert.equal(teamFoulRows(mini, { gameType: "regular", range: { kind: "all" } }).find((t) => t.teamId === "1")!.tf, 3, "レギュラーだけ");
  assert.equal(teamFoulRows(mini, { gameType: "both", range: { kind: "recent", n: 1 } }).find((t) => t.teamId === "1")!.tf, 1, "直近1試合");
  const players = playerFoulRows(mini, { gameType: "both", range: { kind: "all" } });
  const p1 = players.find((p) => p.playerId === "p1")!;
  assert.deepEqual([p1.tf, p1.tfTwice, p1.uf, p1.ufTwice], [2, 1, 1, 0]);
  checks += 6;
}

for (const line of summary) console.log(line);
console.log(`validate:fouls-index: ${checks} 件の確認が通りました`);
