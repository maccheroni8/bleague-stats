// 反則ポイントの導出データ（data/{season}/foul-points.json.gz・B.ONE は one/foul-points.json.gz）の形式と、作る関数（DESIGN.md 416章）。
// 図解「ファウル」のチームタブの「反則ポイント」の表が読む。点数（シーズンごとの規程）は画面側で当てる（shared/foulPointRules.ts）。
// ここは数だけを持つ（保存キーの対象。点数の表を変えても作り直しは起きない）。
//
// チームの行（試合の番号×2＋(ホーム 0／アウェイ 1)。並びは team-game-index.json と同じ）:
//   tf        テクニカルの合計（コーチ 20・ベンチ 21・選手 24/91/92）
//   tf1・tf2  2026-27 の新しい区分（選手 91/92、コーチ・ベンチ 20/21 は文言の「カテゴリ1・2」。区分の無い記録はどちらにも入らない）
//   tfStaff   コーチ・ベンチのテクニカル（20・21）。旧規程のコーチの退場（台帳）で、退場の3点に含める2回を引くのに使う
//   uf        アンスポーツマンライク系（25・93・94）／flagrant 93／disruptive 94
//   dq        ディスクォリファイング（26。2016-17〜2019-20 の記録は文言に「ファウルアウト」〔退場〕が付くが、どれも本物の DQ。5ファウルの退場は 22・23 に付く）
//   ejectPair 旧規程の「テクニカル・アンスポーツマンライク2回で退場」の選手の数（同じ試合で TF2回以上・UF2回以上・TF＋UF。DQ で退場した選手は除く）
//   ejectDq   ディスクォリファイングで退場した選手の数
//   absorbed  ejectPair の選手の TF・UF のうち、退場の3点だけを数えるために1点ずつから外す数（選手ごとに TF＋UF の数、最大2）
//   プレーバイプレーが無い試合は -1（数えない）。
//   entry     ボックススコアの選手の行の人数（出場しなかった選手を含む。選手IDが同じ行は1人）。ボックススコアが無い試合は -1
// 台帳の行（penalties）: 懲罰で決まった出場停止の試合数と、コーチの退場。対象行為の日・試合（同じ日のそのチームの試合）を持つ。

import type { StoredGame } from "./types.ts";
import { DISQUALIFYING_FOUL_CODE, PLAYER_TECHNICAL_FOUL_CODES, TEAM_TECHNICAL_FOUL_CODES, UNSPORTSMANLIKE_FOUL_CODES, teamFoulCategoryKey } from "./foulCodes.ts";

export const FOUL_POINTS_VERSION = 1;

export const FOUL_POINT_TEAM_COLUMNS = ["tf", "tf1", "tf2", "tfStaff", "uf", "flagrant", "disruptive", "dq", "ejectPair", "ejectDq", "absorbed", "entry"] as const;
export type FoulPointTeamColumn = (typeof FOUL_POINT_TEAM_COLUMNS)[number];

/** 集計に使う台帳の行（data/{season}/foul-penalties.json.gz の行。scripts/build-foul-penalties.ts が docs/foul-points/suspensions.json から作る） */
export interface FoulPenaltyRow {
  newsId: string;
  teamId: string;
  /** 対象行為の日（YYYY-MM-DD） */
  incidentDate: string;
  /** regular＝リーグ戦のレギュラーシーズンの試合、postseason＝ポストシーズン、other＝試合以外（SNS など）・不明 */
  competition: "regular" | "postseason" | "other";
  role: string;
  person: string;
  /** 懲罰で決まった出場停止の試合数 */
  suspensionGames: number;
  /** ヘッドコーチ・アシスタントコーチの失格・退場（旧規程の退場の3点。選手の退場はプレーバイプレーから数える） */
  coachEjection: boolean;
}

export interface FoulPenaltiesFile {
  season: string;
  league: "premier" | "one";
  note: string;
  rows: FoulPenaltyRow[];
}

export interface FoulPointsFile {
  version: typeof FOUL_POINTS_VERSION;
  generatedAt: string;
  season: string;
  teams: [id: string, name: string][];
  games: { key: string[]; date: string[]; flags: number[]; home: number[]; away: number[] };
  team: Record<FoulPointTeamColumn, number[]>;
  /** 台帳の行。game は対象行為の日のそのチームの試合の番号（無ければ -1） */
  penalties: (FoulPenaltyRow & { game: number })[];
}

interface TeamIndexLike {
  teams: [string, string, ...unknown[]][];
  games: { key: string[]; date: string[]; flags: number[]; home: number[]; away: number[] };
}

export function buildFoulPoints(season: string, teamIndex: TeamIndexLike, games: readonly StoredGame[], penalties: readonly FoulPenaltyRow[]): FoulPointsFile {
  const n = teamIndex.games.key.length;
  const team = Object.fromEntries(FOUL_POINT_TEAM_COLUMNS.map((c) => [c, new Array<number>(n * 2).fill(-1)])) as Record<FoulPointTeamColumn, number[]>;
  const gameNumber = new Map(teamIndex.games.key.map((k, i) => [k, i]));
  const teamNumber = new Map(teamIndex.teams.map(([id], i) => [id, i]));

  for (const game of games) {
    const g = gameNumber.get(String(game.scheduleKey));
    if (g === undefined) continue;
    const sides = new Map<string, 0 | 1>([
      [String(game.homeTeam.id), 0],
      [String(game.awayTeam.id), 1],
    ]);
    // エントリー人数（ボックススコアの試合全体の選手の行。選手IDの無い行も1人に数える）
    for (const [side, rows] of [[0, game.raw.HomeBoxscores], [1, game.raw.AwayBoxscores]] as const) {
      const list = (rows ?? []).filter((r) => r.Category === 1 && r.PeriodCategory === 18);
      if (list.length === 0) continue;
      const ids = new Set<string>();
      let noId = 0;
      for (const r of list) {
        if (r.PlayerID) ids.add(String(r.PlayerID));
        else noId++;
      }
      team.entry[g * 2 + side] = ids.size + noId;
    }
    const pbp = game.raw.PlayByPlays ?? [];
    if (pbp.length === 0) continue;
    for (const side of [0, 1]) for (const c of FOUL_POINT_TEAM_COLUMNS) if (c !== "entry") team[c][g * 2 + side] = 0;
    const byPlayer = new Map<string, { side: 0 | 1; tf: number; uf: number; dq: number }>();
    for (const ev of pbp) {
      const code = ev.ActionCD1;
      const side = ev.TeamID == null ? undefined : sides.get(String(ev.TeamID));
      if (side === undefined) continue;
      const row = g * 2 + side;
      const isTf = PLAYER_TECHNICAL_FOUL_CODES.has(code) || TEAM_TECHNICAL_FOUL_CODES.has(code);
      const isUf = UNSPORTSMANLIKE_FOUL_CODES.has(code);
      const isDq = code === DISQUALIFYING_FOUL_CODE;
      if (!isTf && !isUf && !isDq) continue;
      if (isTf) {
        team.tf[row]! += 1;
        if (TEAM_TECHNICAL_FOUL_CODES.has(code)) team.tfStaff[row]! += 1;
        const cat = teamFoulCategoryKey(code, ev.PlayText ?? "");
        if (cat === "technicalFoulsCat1") team.tf1[row]! += 1;
        if (cat === "technicalFoulsCat2") team.tf2[row]! += 1;
      }
      if (isUf) {
        team.uf[row]! += 1;
        if (code === 93) team.flagrant[row]! += 1;
        if (code === 94) team.disruptive[row]! += 1;
      }
      if (isDq) team.dq[row]! += 1;
      if (!ev.PlayerID1 || TEAM_TECHNICAL_FOUL_CODES.has(code)) continue;
      const key = `${side}:${ev.PlayerID1}`;
      const p = byPlayer.get(key) ?? { side, tf: 0, uf: 0, dq: 0 };
      if (isTf) p.tf++;
      if (isUf) p.uf++;
      if (isDq) p.dq++;
      byPlayer.set(key, p);
    }
    for (const p of byPlayer.values()) {
      const row = g * 2 + p.side;
      if (p.dq > 0) {
        team.ejectDq[row]! += 1;
      } else if (p.tf >= 2 || p.uf >= 2 || (p.tf >= 1 && p.uf >= 1)) {
        team.ejectPair[row]! += 1;
        team.absorbed[row]! += Math.min(2, p.tf + p.uf);
      }
    }
  }

  // 台帳の行を、対象行為の日のそのチームの試合に結び付ける（無ければ -1）
  const gameOn = new Map<string, number>();
  for (let g = 0; g < n; g++) {
    for (const t of [teamIndex.games.home[g]!, teamIndex.games.away[g]!]) gameOn.set(`${t}:${teamIndex.games.date[g]}`, g);
  }
  const rows = penalties
    .filter((p) => teamNumber.has(p.teamId))
    .map((p) => ({ ...p, game: gameOn.get(`${teamNumber.get(p.teamId)}:${p.incidentDate}`) ?? -1 }))
    .sort((a, b) => (a.incidentDate < b.incidentDate ? -1 : a.incidentDate > b.incidentDate ? 1 : Number(a.newsId) - Number(b.newsId)));

  return {
    version: FOUL_POINTS_VERSION,
    generatedAt: new Date().toISOString(),
    season,
    teams: teamIndex.teams.map(([id, name]) => [id, name]),
    games: { key: teamIndex.games.key, date: teamIndex.games.date, flags: teamIndex.games.flags, home: teamIndex.games.home, away: teamIndex.games.away },
    team,
    penalties: rows,
  };
}
