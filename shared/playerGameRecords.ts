// 選手の1試合の記録（選手一覧「記録」タブの範囲「シーズン」。DESIGN.md 159章）の項目。
// 項目は個人詳細のキャリアハイ（src/pages/PlayerDetailPage.tsx の CAREER_HIGH_STATS）と同じ。ただしリーグ全体の記録なので、
// 少ない方が良い項目（TOV・F・UFOUL・TF）は0の同率が多くなりすぎて記録として意味を持たないため出さない。
// 成功率は最低試投数を満たす試合だけが対象（チームの記録と同じ考え方。shared/teamRecords.ts の TEAM_PCT_MIN_ATTEMPTS）。
// 日次の集計（scripts/aggregate-player-game-records.ts）が上位だけをファイルに書き出し、画面は全選手の試合ログを読まない
import { efgPct, eff, safeDiv, tsPct } from "./formulas.ts";
import type { PlayerGameLog } from "./types.ts";

export type PlayerRecordGame = PlayerGameLog & { season: string };

/** 成功率の記録の最低試投数（選手）。1試合の試投数の分布から、100%の同率が数件に収まる値にした */
export const PLAYER_PCT_MIN_ATTEMPTS = { fgPct: 10, twoPct: 8, tpPct: 6, ftPct: 10 } as const;

export interface PlayerGameRecordDef {
  key: string;
  label: string;
  value: (g: PlayerRecordGame) => number;
  /** 対象の試合（未指定なら出場した全試合） */
  filter?: (g: PlayerRecordGame) => boolean;
  /** 表示の形（画面側で使う） */
  kind?: "minutes" | "pct" | "ratio" | "signed" | "int";
}

function effOfGame(g: PlayerRecordGame): number {
  return eff(
    Number(g.season.split("-")[0]),
    {
      pts: g.pts,
      ast: g.ast,
      blk: g.blk,
      stl: g.stl,
      reb: g.reb,
      tov: g.tov,
      pf: g.pf,
      fgm: g.fgm,
      fga: g.fga,
      ftm: g.ftm,
      fta: g.fta,
      foulsDrawn: g.foulsDrawn,
      blockedAgainst: g.blockedAgainst,
      technicalFouls: g.technicalFouls,
    },
    1,
  );
}

const fgaMin = (g: PlayerRecordGame) => g.fga >= PLAYER_PCT_MIN_ATTEMPTS.fgPct;

export const PLAYER_GAME_RECORD_STATS: PlayerGameRecordDef[] = [
  { key: "min", label: "MIN", value: (g) => g.min, kind: "minutes" },
  { key: "pts", label: "PTS", value: (g) => g.pts },
  { key: "fgm", label: "FGM", value: (g) => g.fgm },
  { key: "fga", label: "FGA", value: (g) => g.fga },
  { key: "fgPct", label: "FG%", value: (g) => safeDiv(g.fgm, g.fga), filter: fgaMin, kind: "pct" },
  { key: "2pm", label: "2PM", value: (g) => g.fgm - g.tpm },
  { key: "2pa", label: "2PA", value: (g) => g.fga - g.tpa },
  {
    key: "2pPct",
    label: "2P%",
    value: (g) => safeDiv(g.fgm - g.tpm, g.fga - g.tpa),
    filter: (g) => g.fga - g.tpa >= PLAYER_PCT_MIN_ATTEMPTS.twoPct,
    kind: "pct",
  },
  { key: "tpm", label: "3PM", value: (g) => g.tpm },
  { key: "tpa", label: "3PA", value: (g) => g.tpa },
  { key: "tpPct", label: "3P%", value: (g) => safeDiv(g.tpm, g.tpa), filter: (g) => g.tpa >= PLAYER_PCT_MIN_ATTEMPTS.tpPct, kind: "pct" },
  { key: "ftm", label: "FTM", value: (g) => g.ftm },
  { key: "fta", label: "FTA", value: (g) => g.fta },
  { key: "ftPct", label: "FT%", value: (g) => safeDiv(g.ftm, g.fta), filter: (g) => g.fta >= PLAYER_PCT_MIN_ATTEMPTS.ftPct, kind: "pct" },
  // eFG%・TS% は FG% と同じ最低試投数（FGA）
  { key: "efgPct", label: "eFG%", value: (g) => efgPct(g.fgm, g.tpm, g.fga), filter: fgaMin, kind: "pct" },
  { key: "tsPct", label: "TS%", value: (g) => tsPct(g.pts, g.fga, g.fta), filter: fgaMin, kind: "pct" },
  { key: "oreb", label: "OR", value: (g) => g.oreb },
  { key: "dreb", label: "DR", value: (g) => g.dreb },
  { key: "reb", label: "TR", value: (g) => g.reb },
  { key: "ast", label: "AST", value: (g) => g.ast },
  // TOV=0 のときは AST をそのまま比率にする（src/lib/boxscoreAggregate.ts の astToTovRatio と同じ）
  { key: "astTov", label: "AST/TOV", value: (g) => (g.tov === 0 ? g.ast : g.ast / g.tov), kind: "ratio" },
  { key: "stl", label: "STL", value: (g) => g.stl },
  { key: "blk", label: "BLK", value: (g) => g.blk },
  { key: "blockedAgainst", label: "BSR", value: (g) => g.blockedAgainst },
  { key: "foulsDrawn", label: "FD", value: (g) => g.foulsDrawn },
  { key: "eff", label: "EFF", value: effOfGame },
  { key: "plusMinus", label: "+/-", value: (g) => g.plusMinus, kind: "signed" },
  { key: "pt2in", label: "PITP", value: (g) => g.pt2in },
  { key: "ptfb", label: "FBPS", value: (g) => g.ptfb },
  { key: "pt2nd", label: "2ND PTS", value: (g) => g.pt2nd },
  { key: "ptsOffTov", label: "PTSOFFTO", value: (g) => g.ptsOffTov },
  { key: "dunks", label: "DUNK", value: (g) => g.dunks },
  { key: "basketCounts", label: "AND1", value: (g) => g.basketCounts },
];

/** 上位何位まで書き出すか（同じ記録はすべて含むので、件数はこれより多くなることがある） */
export const PLAYER_GAME_RECORD_TOP_N = 10;
