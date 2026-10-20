// チーム詳細 > チームスタッツ > シーズン別成績の、区間別（1Q〜4Q・前半・後半・延長。DESIGN.md 274章）。
// 区間を選んだときだけ、そのクラブが在籍したシーズンのチームのピリオド別の索引（teamPeriodTotals.ts の loadTeamPeriodSource。全チームスタッツ・ランキングと
// 同じ読み込みの記憶を使い回す）をまとめて読み、各シーズンの区間の合計（sumTeamPeriodTotals。全チームスタッツの区間別と同じ関数）から、表の1行分の値を作る。
// 列は今のシーズン別成績のまま。列ごとの値の出し方は、全チームスタッツの列（teamStatsColumns.ts の build*Columns。AllTeamsRow から値を出す）を名前で引いて使い回し、
// 全チームスタッツに無い列（BSR・EFF）だけここで足す。名前が合わない列は「-」にする。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { useEffect, useMemo, useState } from "react";
import type { TeamGameLog } from "../../shared/types";
import type { BoxscoreTabKey } from "../components/BoxscoreTable";
import { formatDecimal, formatSigned } from "./format";
import type { SeasonDisplayMode } from "./playerSeasonBoxscore";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildPointsShareColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  perspectiveValue,
  scaledValue,
  type AllTeamsRow,
  type TeamPerspective,
  type TeamTotals,
} from "./teamStatsColumns";
import { teamPeriodEffTotal } from "./teamSituationalPeriod";
import { loadTeamPeriodSource, sumTeamPeriodTotals, type TeamPeriodSource, type TeamPeriodValue } from "./teamPeriodTotals";

/** 1シーズンの区間の読み込みの状態 */
export type SeasonPeriodSourceState = { status: "loading" } | { status: "ready"; source: TeamPeriodSource } | { status: "unreadable" };

/**
 * 区間を選んでいる間だけ、シーズンの索引を読む。読み込みが終わったシーズンから順に state に入る（全部を待たずに表の行を出せる）。
 * 読めなかった（ファイルが無い・古い形式・通信の失敗）シーズンは unreadable。読み直すときは retry()
 */
export function useTeamPeriodSources(seasons: readonly string[], enabled: boolean): {
  states: Map<string, SeasonPeriodSourceState>;
  loadedCount: number;
  total: number;
  retry: () => void;
} {
  const seasonsKey = seasons.join(",");
  const [loaded, setLoaded] = useState<Map<string, SeasonPeriodSourceState>>(new Map());
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    for (const season of seasonsKey ? seasonsKey.split(",") : []) {
      loadTeamPeriodSource(season).then(
        (source) => alive && setLoaded((prev) => new Map(prev).set(season, source ? { status: "ready", source } : { status: "unreadable" })),
        () => alive && setLoaded((prev) => new Map(prev).set(season, { status: "unreadable" })),
      );
    }
    return () => {
      alive = false;
    };
  }, [seasonsKey, enabled, nonce]);
  const states = useMemo(() => {
    const m = new Map<string, SeasonPeriodSourceState>();
    for (const s of seasonsKey ? seasonsKey.split(",") : []) m.set(s, loaded.get(s) ?? { status: "loading" });
    return m;
  }, [seasonsKey, loaded]);
  const total = seasons.length;
  const loadedCount = [...states.values()].filter((v) => v.status !== "loading").length;
  return {
    states,
    loadedCount,
    total,
    retry: () => {
      setLoaded(new Map());
      setNonce((n) => n + 1);
    },
  };
}

/** 1シーズンの区間の行。status: ready＝値あり／empty＝数える試合が無い（延長のあった試合が無いなど）／unreadable＝索引を読めない／loading＝読み込み中 */
export interface SeasonPeriodRow {
  season: string;
  status: "ready" | "empty" | "unreadable" | "loading";
  /** 数えた試合（区間の値がある試合）。平均の分母・勝敗に使う */
  games: TeamGameLog[];
  wins: number;
  losses: number;
  totals: TeamTotals;
}

export function buildSeasonPeriodRow(
  season: string,
  state: SeasonPeriodSourceState | undefined,
  regularLogs: readonly TeamGameLog[],
  value: TeamPeriodValue,
  emptyTotals: TeamTotals,
): SeasonPeriodRow {
  const none = { season, games: [], wins: 0, losses: 0, totals: emptyTotals };
  if (!state || state.status === "loading") return { ...none, status: "loading" };
  if (state.status === "unreadable") return { ...none, status: "unreadable" };
  const { games, totals } = sumTeamPeriodTotals(state.source, regularLogs, value);
  if (games.length === 0) return { ...none, status: "empty" };
  const wins = games.filter((g) => g.win).length;
  return { season, status: "ready", games, wins, losses: games.length - wins, totals };
}

function allTeamsRowOf(row: SeasonPeriodRow, teamId: string, teamName: string): AllTeamsRow {
  return { team: { teamId, teamName }, gamesPlayed: row.games.length, wins: row.wins, losses: row.losses, totals: row.totals };
}

/** 列の値の出し方。seasonStartYear は EFF の式（年度で違う）に使う */
export type PeriodFormatter = (row: AllTeamsRow, seasonStartYear: number) => string;

/** 全チームスタッツの列に無い列（シーズン別成績にはある）。BSR は相手のBLK、EFF は自チームの値で固定（今のシーズン別成績と同じ） */
function extraFormatters(mode: SeasonDisplayMode, perspective: TeamPerspective): Map<string, PeriodFormatter> {
  const m = new Map<string, PeriodFormatter>();
  m.set("G", (r) => String(r.gamesPlayed));
  m.set("BSR", (r) => {
    const v = perspectiveValue(
      scaledValue(r.totals.oppBlk, r.gamesPlayed, mode),
      scaledValue(r.totals.blk, r.gamesPlayed, mode),
      perspective,
    );
    const d = mode === "total" ? 0 : 1;
    return perspective === "diff" ? formatSigned(v, d) : formatDecimal(v, d);
  });
  m.set("EFF", (r, seasonStartYear) => {
    const total = teamPeriodEffTotal(r.totals, false, seasonStartYear);
    return mode === "total" ? formatDecimal(total, 0) : formatDecimal(r.gamesPlayed > 0 ? total / r.gamesPlayed : 0, 1);
  });
  return m;
}

/**
 * 列の名前（label）→ その列の値の出し方。全チームスタッツの4カテゴリの列をまとめ、BSR・EFF・G を足したもの。
 * 引けない名前の列は、呼び出し側で「-」にする
 */
export function seasonPeriodFormatters(mode: SeasonDisplayMode, perspective: TeamPerspective, foulSplit: boolean): Map<string, PeriodFormatter> {
  const m = new Map<string, PeriodFormatter>();
  const groups: Record<BoxscoreTabKey, ReturnType<typeof buildTraditionalColumns>> = {
    traditional: buildTraditionalColumns(mode, perspective),
    advanced: buildAdvancedColumns(mode, perspective),
    misc: buildMiscColumns(mode, perspective, true, foulSplit),
    scoring: buildScoringColumns(mode, perspective, true, true),
  } as Record<BoxscoreTabKey, ReturnType<typeof buildTraditionalColumns>>;
  // %3P・%PoutP・%FT・%OPA（総得点・FGAに対する割合。全チームスタッツの表にはないが、比較と同じ式の部品）も同じ式で出す
  for (const cols of [...Object.values(groups), buildPointsShareColumns(perspective)]) {
    for (const c of cols) if (!m.has(c.label)) m.set(c.label, (r) => c.format?.(r) ?? String(c.sortValue(r)));
  }
  for (const [k, v] of extraFormatters(mode, perspective)) m.set(k, v);
  return m;
}

/** 行（ready）の1つの列の表示。引けない列は「-」 */
export function seasonPeriodCell(
  formatters: Map<string, PeriodFormatter>,
  label: string,
  row: SeasonPeriodRow,
  teamId: string,
  teamName: string,
): string {
  if (row.status !== "ready") return "-";
  const f = formatters.get(label);
  return f ? f(allTeamsRowOf(row, teamId, teamName), Number(row.season.split("-")[0])) : "-";
}

/** 区間を選んだとき、シーズン別成績の表で出せない列（全チームスタッツにも無い列）の名前を調べる（検証と注記に使う） */
export function unavailableSeasonPeriodLabels(labels: readonly string[], formatters: Map<string, PeriodFormatter>): string[] {
  return labels.filter((l) => !formatters.has(l));
}
