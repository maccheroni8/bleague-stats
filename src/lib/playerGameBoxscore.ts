// 個人詳細ページ「試合ログ」タブのボックススコア形式表示（トラディショナル/アドバンスド/Misc/
// スコアリング）用。試合詳細ページのBoxscoreTeamPanelが1試合内の全選手について行っている
// per-player計算を、選手1人・試合N件分について繰り返す。シーズン集計版（playerSeasonBoxscore.ts）
// と異なり、各試合の生データ（PlayByPlays込み）をそのまま使えるため、PTSOFFTO・POSS/PACE/
// ORtg/DRtg/NetRtg等シーズン集計では「-」にせざるを得なかった列も、試合単位ならBoxscoreTable.tsx
// と全く同じロジックで算出できる（DESIGN.md参照）。

import type { PlayerGameLog, StoredGame, YahooGamePbp } from "../../shared/types";
import {
  buildPlayTypeCounts,
  buildPlayerBoxscores,
  buildTeamTotalCounts,
  computeIndividualRatings,
  computeTeamRatings,
  type BoxscoreCounts,
} from "./boxscoreAggregate";
import type { ColumnCtx } from "../components/BoxscoreTable";
import { computeOnCourtRatings, reconstructOnCourt, substitutionModelForSeason } from "../../shared/onCourt";

export interface PlayerGameBoxscoreRow {
  gameLog: PlayerGameLog;
  counts: BoxscoreCounts;
  ctx: ColumnCtx;
}

/**
 * 1試合分の生データ（StoredGame）から、指定選手のBoxscoreCounts・ColumnCtxを組み立てる。
 * 選手がその試合のボックススコアに存在しない（生データ欠落等）場合はnullを返す。
 * `shotChartSupported`はシーズン単位のcoverageフラグをそのまま渡す想定（試合ごとに変わらない）
 */
export function buildPlayerGameBoxscoreRow(
  game: StoredGame,
  gameLog: PlayerGameLog,
  playerId: string,
  yahooPbp: YahooGamePbp | null,
  shotChartSupported: boolean,
): PlayerGameBoxscoreRow | null {
  const ownRows = gameLog.isHome ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
  const oppRows = gameLog.isHome ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
  const side = gameLog.isHome ? "home" : "away";
  const periods = game.quarterScores.home.length;

  const teamTotal = buildTeamTotalCounts(ownRows, undefined);
  const oppTeamTotal = buildTeamTotalCounts(oppRows, undefined);
  const playType = buildPlayTypeCounts(game.raw.Summaries, side, undefined);
  const ratings = computeTeamRatings(teamTotal, oppTeamTotal);

  const players = buildPlayerBoxscores(ownRows, undefined, game.raw.PlayByPlays, yahooPbp?.turnovers ?? []);
  const player = players.find((p) => p.playerId === playerId);
  if (!player) return null;

  const { offRtg, defRtg, netRtg } = computeIndividualRatings(player.counts, teamTotal, oppTeamTotal, ratings.poss);

  // 個人PACE（在コート区間ベース）はショットチャートと同じcoverage制約（2022-23シーズン以降）。
  // reconstructOnCourt自体は試合詳細ページと同じロジックをそのまま1試合分実行するだけなので、
  // N試合分繰り返しても計算量は軽い（1試合あたり数百イベント）
  let onCourtPace: number | undefined;
  if (shotChartSupported && game.raw.PlayByPlays.length > 0) {
    const onCourt = reconstructOnCourt(
      game.raw.PlayByPlays,
      game.raw.HomeBoxscores,
      game.raw.AwayBoxscores,
      game.homeTeam.id,
      game.awayTeam.id,
      periods,
      substitutionModelForSeason(game.season),
    );
    onCourtPace = computeOnCourtRatings(onCourt.intervals)[playerId]?.pace;
  }

  return {
    gameLog,
    counts: { ...player.counts, offRtg, defRtg, netRtg, onCourtPace },
    // ctx.ratingsは意図的に省略する（BoxscoreTeamPanelのplayerCtxと同じ扱い）。
    // POSS列の表示条件が`ctx.ratings`の有無だけで判定されており（「選手個人のPOSSという
    // 概念は無い」という既存の設計）、ここに含めるとチーム合計行専用のはずのPOSSが
    // 選手行にも表示されてしまう。ratings自体はcomputeIndividualRatings()の入力として
    // 上で既に使用済みなので、ctxに含める必要はない
    ctx: {
      own: teamTotal,
      ownPlayType: playType,
      isPlayerRow: true,
      isTeamTotalRow: false,
      shotChartSupported,
      yahooPbpSupported: yahooPbp !== null,
    },
  };
}
