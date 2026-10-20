// 2017-18 ScheduleKey=1810（2018-01-01 A東京67-49千葉・第15節）の手入力ボックススコア。
// 公式（bleague.jp）にこの1試合だけボックススコアが無いため（DESIGN.md 70-6・227-8・228章）、
// basketballnavi.com/games/1810/ の試合合計（BASIC）から生データ（data/2017-18/games/1810.json.gz）を作る。
// 実行は一度だけ: node --experimental-strip-types scripts/manual-boxscore-1810.ts
// 作れるもの: 選手の合計行（PeriodCategory=18）とチーム合計行、クォーター別得点。
// 作れないもの（空・0のまま）: ピリオド別の選手行・PBP・チームリバウンド・出場区間（在コート・ラインナップ）。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = path.resolve(import.meta.dirname, "..");
const SEASON_DIR = path.join(ROOT, "data", "2017-18");
const OUT = path.join(SEASON_DIR, "games", "1810.json.gz");

type P = {
  no: string; name: string; gs: boolean; min: string; pts: number;
  tp: [number, number]; p2: [number, number]; ip: number; ft: [number, number];
  or: number; dr: number; ast: number; stl: number; blk: number; bsr: number; tov: number;
  pft: number; scp: number; fbp: number; pf: number; fd: number;
};
const DNP = (no: string, name: string): P => ({
  no, name, gs: false, min: "DNP", pts: 0, tp: [0, 0], p2: [0, 0], ip: 0, ft: [0, 0],
  or: 0, dr: 0, ast: 0, stl: 0, blk: 0, bsr: 0, tov: 0, pft: 0, scp: 0, fbp: 0, pf: 0, fd: 0,
});

// 列: 背番号, 名前, 先発, MIN, PTS, 3P, 2P, IP成功数, FT, OR, DR, AST, STL, BLK, BSR, TOV, PfT, SCP, FBP, PF, FD
const home: P[] = [
  { no: "53", name: "アレックス・カーク", gs: true, min: "26:10", pts: 20, tp: [0, 2], p2: [8, 13], ip: 8, ft: [4, 5], or: 6, dr: 5, ast: 2, stl: 0, blk: 2, bsr: 0, tov: 1, pft: 1, scp: 3, fbp: 2, pf: 2, fd: 5 },
  { no: "13", name: "菊地祥平", gs: true, min: "25:33", pts: 1, tp: [0, 1], p2: [0, 2], ip: 0, ft: [1, 2], or: 0, dr: 4, ast: 3, stl: 1, blk: 0, bsr: 2, tov: 1, pft: 0, scp: 0, fbp: 0, pf: 3, fd: 3 },
  { no: "3", name: "安藤誓哉", gs: true, min: "23:05", pts: 6, tp: [0, 1], p2: [3, 8], ip: 1, ft: [0, 0], or: 2, dr: 1, ast: 4, stl: 1, blk: 0, bsr: 2, tov: 1, pft: 2, scp: 1, fbp: 2, pf: 4, fd: 1 },
  { no: "15", name: "竹内譲次", gs: true, min: "19:10", pts: 4, tp: [0, 2], p2: [2, 5], ip: 2, ft: [0, 0], or: 1, dr: 8, ast: 2, stl: 0, blk: 0, bsr: 0, tov: 1, pft: 1, scp: 0, fbp: 2, pf: 1, fd: 2 },
  { no: "6", name: "馬場雄大", gs: true, min: "16:05", pts: 4, tp: [0, 1], p2: [2, 2], ip: 2, ft: [0, 0], or: 0, dr: 0, ast: 1, stl: 2, blk: 0, bsr: 0, tov: 2, pft: 2, scp: 1, fbp: 2, pf: 1, fd: 1 },
  { no: "10", name: "ザック・バランスキー", gs: false, min: "25:13", pts: 11, tp: [1, 1], p2: [3, 8], ip: 3, ft: [2, 2], or: 1, dr: 1, ast: 0, stl: 3, blk: 0, bsr: 0, tov: 0, pft: 3, scp: 2, fbp: 2, pf: 1, fd: 1 },
  { no: "1", name: "小島元基", gs: false, min: "22:31", pts: 10, tp: [2, 3], p2: [1, 1], ip: 1, ft: [2, 2], or: 1, dr: 0, ast: 1, stl: 0, blk: 0, bsr: 0, tov: 1, pft: 1, scp: 0, fbp: 2, pf: 2, fd: 2 },
  { no: "31", name: "ジャワッド・ウィリアムズ", gs: false, min: "19:10", pts: 9, tp: [1, 2], p2: [3, 4], ip: 1, ft: [0, 0], or: 1, dr: 3, ast: 0, stl: 3, blk: 1, bsr: 0, tov: 1, pft: 0, scp: 2, fbp: 0, pf: 2, fd: 0 },
  { no: "21", name: "ブレンダン・レーン", gs: false, min: "13:50", pts: 2, tp: [0, 0], p2: [1, 4], ip: 1, ft: [0, 0], or: 1, dr: 3, ast: 2, stl: 0, blk: 0, bsr: 0, tov: 1, pft: 0, scp: 0, fbp: 0, pf: 4, fd: 0 },
  { no: "7", name: "正中岳城", gs: false, min: "9:13", pts: 0, tp: [0, 2], p2: [0, 0], ip: 0, ft: [0, 0], or: 1, dr: 1, ast: 0, stl: 0, blk: 0, bsr: 0, tov: 2, pft: 0, scp: 0, fbp: 0, pf: 1, fd: 0 },
  DNP("2", "齋藤拓実"),
];
const away: P[] = [
  { no: "34", name: "小野龍猛", gs: true, min: "29:25", pts: 9, tp: [0, 2], p2: [3, 6], ip: 2, ft: [3, 5], or: 1, dr: 1, ast: 2, stl: 0, blk: 0, bsr: 0, tov: 2, pft: 1, scp: 0, fbp: 0, pf: 1, fd: 3 },
  { no: "21", name: "ギャビン・エドワーズ", gs: true, min: "27:37", pts: 16, tp: [0, 0], p2: [6, 10], ip: 6, ft: [4, 10], or: 0, dr: 4, ast: 1, stl: 1, blk: 2, bsr: 1, tov: 1, pft: 0, scp: 1, fbp: 2, pf: 3, fd: 9 },
  { no: "3", name: "マイケル・パーカー", gs: true, min: "20:00", pts: 3, tp: [1, 2], p2: [0, 1], ip: 0, ft: [0, 2], or: 1, dr: 3, ast: 1, stl: 1, blk: 0, bsr: 0, tov: 1, pft: 0, scp: 0, fbp: 0, pf: 2, fd: 1 },
  { no: "31", name: "原修太", gs: true, min: "10:41", pts: 0, tp: [0, 0], p2: [0, 0], ip: 0, ft: [0, 0], or: 0, dr: 2, ast: 1, stl: 0, blk: 1, bsr: 0, tov: 1, pft: 0, scp: 0, fbp: 0, pf: 1, fd: 1 },
  { no: "2", name: "富樫勇樹", gs: true, min: "10:16", pts: 2, tp: [0, 2], p2: [0, 1], ip: 0, ft: [2, 2], or: 0, dr: 1, ast: 0, stl: 2, blk: 0, bsr: 0, tov: 2, pft: 1, scp: 0, fbp: 1, pf: 1, fd: 1 },
  { no: "8", name: "レオ・ライオンズ", gs: false, min: "31:18", pts: 13, tp: [0, 2], p2: [4, 9], ip: 3, ft: [5, 5], or: 1, dr: 4, ast: 2, stl: 1, blk: 0, bsr: 2, tov: 4, pft: 0, scp: 1, fbp: 0, pf: 1, fd: 2 },
  { no: "11", name: "西村文男", gs: false, min: "24:50", pts: 2, tp: [0, 2], p2: [1, 4], ip: 1, ft: [0, 0], or: 1, dr: 3, ast: 1, stl: 2, blk: 0, bsr: 0, tov: 0, pft: 1, scp: 0, fbp: 2, pf: 3, fd: 3 },
  { no: "27", name: "石井講祐", gs: false, min: "22:17", pts: 2, tp: [0, 1], p2: [1, 1], ip: 0, ft: [0, 0], or: 0, dr: 0, ast: 0, stl: 0, blk: 0, bsr: 0, tov: 1, pft: 0, scp: 0, fbp: 0, pf: 2, fd: 0 },
  { no: "10", name: "アキ・チェンバース", gs: false, min: "17:34", pts: 0, tp: [0, 0], p2: [0, 2], ip: 0, ft: [0, 0], or: 1, dr: 2, ast: 0, stl: 0, blk: 1, bsr: 0, tov: 1, pft: 0, scp: 0, fbp: 0, pf: 1, fd: 0 },
  { no: "1", name: "阿部友和", gs: false, min: "6:02", pts: 2, tp: [0, 0], p2: [0, 0], ip: 0, ft: [2, 2], or: 0, dr: 0, ast: 0, stl: 0, blk: 0, bsr: 0, tov: 0, pft: 0, scp: 0, fbp: 0, pf: 0, fd: 1 },
  DNP("25", "荒尾岳"),
  DNP("44", "伊藤俊亮"),
];

const norm = (s: string) => s.replace(/[\s　]/g, "");

function main(): void {
  // テンプレートと選手ID・チーム名は、同じシーズンの既存の試合から読む
  const dir = path.join(SEASON_DIR, "games");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json.gz") && f !== "1810.json.gz");
  const ids = new Map<string, { id: string; nameE: string; nameJ: string }>();
  const teams: Record<string, Record<string, string>> = {};
  let template: any = null;
  for (const f of files) {
    const g = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString("utf8"));
    const G = g.raw.Game;
    if (!template && G.ConventionNameJ === "2017-18 B1リーグ" && g.raw.PlayByPlays.length > 0) template = g;
    for (const side of ["Home", "Away"]) {
      const tid = G[`${side}TeamID`];
      if (tid === "706" || tid === "704") {
        teams[tid] = Object.fromEntries(
          ["NameE", "NameJ", "ShortNameE", "ShortNameJ", "SubNameE", "SubNameJ"].map((k) => [k, G[`${side}Team${k}`]]),
        );
      }
    }
    for (const r of [...g.raw.HomeBoxscores, ...g.raw.AwayBoxscores]) {
      if ((r.TeamID === "706" || r.TeamID === "704") && r.PlayerID && r.Category === 1) {
        ids.set(`${r.TeamID}|${norm(r.PlayerNameJ)}`, { id: r.PlayerID, nameE: r.PlayerNameE, nameJ: r.PlayerNameJ });
      }
    }
  }

  const rowFor = (teamId: string, p: P, no: number) => {
    const info = ids.get(`${teamId}|${norm(p.name)}`);
    if (!info) throw new Error(`選手IDが見つからない: ${teamId} ${p.name}`);
    const fgm = p.tp[0] + p.p2[0];
    const fga = p.tp[1] + p.p2[1];
    const reb = p.or + p.dr;
    const played = p.min !== "DNP";
    const eff = played ? p.pts + reb + p.ast + p.stl + p.blk - (fga - fgm) - (p.ft[1] - p.ft[0]) - p.tov : 0;
    return {
      AS: p.ast, BS: p.blk, BSON: p.bsr, Category: 1, Code: 6, EFF: eff, FOUL: p.pf, FOULON: p.fd,
      FTA: p.ft[1], FTM: p.ft[0], No: no, PT2A: p.p2[1], PT2DUNK: 0, PT2IN: p.ip * 2, PT2M: p.p2[0], PT2ND: p.scp,
      PT3A: p.tp[1], PT3M: p.tp[0], PTFB: p.fbp, PTPFT: p.pft * 2, PeriodCategory: 18,
      PlayTime: p.min.length === 4 ? `0${p.min}` : p.min, PlayerID: info.id, PlayerNameE: info.nameE, PlayerNameJ: info.nameJ,
      PlayerNo: p.no, PlayingFlg: false, Point: p.pts, RB_DEF: p.dr, RB_OFF: p.or, RB_TOT: reb, ST: p.stl,
      ScheduleKey: 1810, StartingFlg: p.gs ? 1 : null, TO: p.tov, TeamID: teamId,
    };
  };
  const build = (teamId: string, ps: P[]) => {
    const t = teams[teamId]!;
    const common = { Code: 6, PeriodCategory: 18, PlayerNameE: "", PlayerNameJ: "", PlayerNo: "", PlayingFlg: false, ScheduleKey: 1810, StartingFlg: null, TeamID: teamId, TeamNameE: t.NameE, TeamNameJ: t.NameJ };
    const rows: any[] = ps.map((p, i) => ({ ...rowFor(teamId, p, i + 1), TeamNameE: t.NameE, TeamNameJ: t.NameJ }));
    const sum = (k: string) => rows.reduce((a, r) => a + (r[k] as number), 0);
    const coaches = {
      ...common, AS: 0, BS: 0, BSON: 0, Category: 2, EFF: 0, FOUL: 0, FOULON: 0, FTA: 0, FTM: 0, No: rows.length + 1,
      PT2A: 0, PT2DUNK: 0, PT2IN: 0, PT2M: 0, PT2ND: 0, PT3A: 0, PT3M: 0, PTFB: 0, PTPFT: 0, PlayTime: "DNP", PlayerID: "",
      Point: 0, RB_DEF: 0, RB_OFF: 0, RB_TOT: 0, ST: 0, TO: 0,
    };
    const total: any = { ...common, Category: 3, No: rows.length + 2, PlayTime: "200:00", PlayerID: "" };
    for (const k of ["AS", "BS", "BSON", "EFF", "FOUL", "FOULON", "FTA", "FTM", "PT2A", "PT2DUNK", "PT2IN", "PT2M", "PT2ND", "PT3A", "PT3M", "PTFB", "PTPFT", "Point", "RB_DEF", "RB_OFF", "RB_TOT", "ST", "TO"]) total[k] = sum(k);
    return [...rows, coaches, total];
  };

  const H = build("706", home);
  const A = build("704", away);
  const hs = H[H.length - 1].Point as number;
  const as = A[A.length - 1].Point as number;
  if (hs !== 67 || as !== 49) throw new Error(`得点が合わない: ${hs}-${as}`);

  const qs = { home: [18, 17, 15, 17], away: [9, 19, 10, 11] };
  const tip = 1514786700; // 2018-01-01 15:05 JST
  const G0 = template.raw.Game;
  const Game = {
    ...G0,
    Attendance: null,
    AwayTeamID: "704", AwayTeamNameE: teams["704"]!.NameE, AwayTeamNameJ: teams["704"]!.NameJ, AwayTeamScore: as,
    AwayTeamShortNameE: teams["704"]!.ShortNameE, AwayTeamShortNameJ: teams["704"]!.ShortNameJ,
    HomeTeamID: "706", HomeTeamNameE: teams["706"]!.NameE, HomeTeamNameJ: teams["706"]!.NameJ, HomeTeamScore: hs,
    HomeTeamShortNameE: teams["706"]!.ShortNameE, HomeTeamShortNameJ: teams["706"]!.ShortNameJ,
    HomeTeamWinFlg: true, BoxscoreExistsFlg: true, PlayByPlayExistsFlg: false, RecordFixedFlg: true, GameEndedFlg: true,
    GameCurrentPeriod: 4, GameRestTime: 0, MaxPeriod: 4, GameDateTime: String(tip), GameStartTime: String(tip), GameEndTime: String(tip + 6600),
    ScheduleKey: 1810, Setu: 15, ScheduleState: 2, StadiumNameJ: "駒沢",
    Report: "", ReportExistsFlg: false, PictureExistsFlg: false,
  } as Record<string, unknown>;
  quarterKeys(Game, qs);

  const out = {
    scheduleKey: "1810",
    season: "2017-18",
    date: "2018-01-01",
    meta: {
      firstScrapedAt: new Date().toISOString(), lastCheckedAt: new Date().toISOString(), lastChangedAt: new Date().toISOString(),
      status: "final", revisionCount: 0, latestRevisionId: 0,
      source: "manual:basketballnavi.com/games/1810 (BASIC・試合合計。公式にボックススコアが無い)",
    },
    homeTeam: { id: "706", name: teams["706"]!.NameJ },
    awayTeam: { id: "704", name: teams["704"]!.NameJ },
    homeScore: hs,
    awayScore: as,
    quarterScores: qs,
    gameEndedFlg: true,
    recordFixedFlg: true,
    raw: { Game, PlayByPlays: [], HomeBoxscores: H, AwayBoxscores: A, Summaries: [] },
  };
  fs.writeFileSync(OUT, zlib.gzipSync(JSON.stringify(out)));
  console.log(`wrote ${path.relative(ROOT, OUT)} (${hs}-${as})`);
}

function quarterKeys(Game: Record<string, unknown>, qs: { home: number[]; away: number[] }): void {
  for (let i = 1; i <= 14; i++) {
    const k = String(i).padStart(2, "0");
    Game[`HomeTeamScore${k}`] = qs.home[i - 1] ?? 0;
    Game[`AwayTeamScore${k}`] = qs.away[i - 1] ?? 0;
  }
}

main();
