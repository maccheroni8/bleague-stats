// ターンオーバーからの得点（Points Off Turnovers）を選手単位で算出する。
//
// 当初はshared/onCourt.tsと同様にPlayByPlaysを時系列で走査し、ターンオーバー直後に始まる
// ポゼッションの得点を状態機械で追跡する実装を試みたが、公式Summariesの
// HomeTeamPTPFT/AwayTeamPTPFT（PTSOFFTOのBリーグ公式フィールド名。DESIGN.md 6章）との
// 突合検証で一致率62%（990/1596チーム×試合）にとどまり不採用にした
// （scripts/validate-points-off-turnovers.tsの開発過程で判明）。
//
// 代わりに、得点イベントのPlayText自体に公式の判定結果が直接埋め込まれていることを発見した:
// 得点が「ターンオーバーからの得点」に該当する場合、PlayTextに"ポインツオフターンオーバー"
// というタグが付与される（例:
// "#21 ジェイコブセン 2Pシュートインサイドペイント○  ジャンプショット
//   ポインツオフターンオーバーセカンドチャンス (4点)"）。既存のPTFB(ファストブレイクポイント)・
// PT2ND(セカンドチャンスポイント)が同じPlayText規則から個人単位のBoxscoreRowフィールドとして
// 導出されているのと同じ仕組みとみられる。このタグを持つ得点イベントの得点を選手単位で
// 合算するだけで、公式Summariesの値と完全に一致することを確認済み
// （scripts/validate-points-off-turnovers.ts参照）。
//
// そのため本モジュールは「ターンオーバー直後のポゼッションを自前で復元する」処理は行わず、
// 公式が既に判定済みのタグをそのまま集計する薄いラッパーにとどめている
// （ActionCD1コード自体の確認・状態機械のアルゴリズム検討はDESIGN.md参照）。
//
// 2016-17シーズン（B.LEAGUE発足シーズン）は、タグの表記が違う: 「ポイントフロムターンオーバ（ー）」（2017-18以降は「ポインツオフターンオーバ（ー）」）。
// 以前は「2016-17はタグが無く算出できない」と扱っていたが、表記の違いを数えていなかっただけだった（DESIGN.md 221章）。両方の表記を数えると、
// 2016-17の全557試合でチームの合計が公式SummariesのPTPFTと一致する（scripts/validate-points-off-turnovers.ts）。試合538だけは両方の表記が混ざる。
// 2017-18以降（B.PREMIER・B.ONE 2025-26）も公式SummariesのPTPFTと選手単位の合算値が完全一致することを確認済み
// （scripts/validate-points-off-turnovers.ts、DESIGN.md参照）。

import type { PlayByPlayEvent } from "./types.ts";

// 末尾の長音符「ー」は、後ろに別のタグ（"セカンドチャンス"等）が続く場合に脱落する表記ゆれが
// あるため、長音符を含めずに判定する（例:
// "ファストブレイクポインツオフターンオーバセカンドチャンス"。2026-08-17、実データで確認）
// 2016-17は「ポイントフロムターンオーバ」、2017-18以降は「ポインツオフターンオーバ」
const POINTS_OFF_TURNOVER_TAGS = ["ポインツオフターンオーバ", "ポイントフロムターンオーバ"];

const MADE_FG_CODES = new Set([1, 3, 4]);
const MADE_FT_CODE = 7;

export function pointsForMadeShot(actionCd1: number): number {
  if (actionCd1 === 1) return 3;
  if (actionCd1 === 3 || actionCd1 === 4) return 2;
  if (actionCd1 === MADE_FT_CODE) return 1;
  return 0;
}

export interface PointsOffTurnoversResult {
  /** playerId -> ターンオーバーからの得点（試合単位。callerがシーズン集計等にまとめる） */
  byPlayer: Map<string, number>;
  /** teamId -> ターンオーバーからの得点。公式Summaries.HomeTeamPTPFT/AwayTeamPTPFTと一致する */
  byTeam: Map<string, number>;
}

export function computePointsOffTurnovers(playByPlays: PlayByPlayEvent[]): PointsOffTurnoversResult {
  const byPlayer = new Map<string, number>();
  const byTeam = new Map<string, number>();

  for (const event of playByPlays) {
    if (!(MADE_FG_CODES.has(event.ActionCD1) || event.ActionCD1 === MADE_FT_CODE)) continue;
    if (!POINTS_OFF_TURNOVER_TAGS.some((tag) => event.PlayText?.includes(tag))) continue;
    const points = pointsForMadeShot(event.ActionCD1);
    if (points <= 0 || !event.TeamID) continue;

    byTeam.set(event.TeamID, (byTeam.get(event.TeamID) ?? 0) + points);
    if (event.PlayerID1) {
      byPlayer.set(event.PlayerID1, (byPlayer.get(event.PlayerID1) ?? 0) + points);
    }
  }

  return { byPlayer, byTeam };
}
