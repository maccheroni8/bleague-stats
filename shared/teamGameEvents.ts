// 試合のプレーバイプレー・ボックススコアから、チームの試合ごとの記録（TeamGameLog）の一部を数える部品（DESIGN.md 256章で scripts/aggregate.ts から移した）。
// 試合全体の値は aggregate.ts が、区間ごとの値はピリオド別の索引（scripts/lib/periodIndexBuild.ts）が、同じ関数で出す
// （区間ごとの値は、プレーバイプレーをその区間のピリオドに絞って渡す。ボックススコアはその区間の行を渡す）。保存キーの対象
import {
  DISQUALIFYING_FOUL_CODE,
  PLAYER_TECHNICAL_FOUL_CODES,
  TECHNICAL_FT_FOUL_CODES,
  UNSPORTSMANLIKE_FOUL_CODES,
  foulCategoryKey,
  teamTechnicalCategoryKey,
} from "./foulCodes.ts";
import type { BoxscoreRow, FoulCategoryCounts, PlayByPlayEvent } from "./types.ts";

/**
 * PlayByPlaysからテクニカルファウルの発生回数を数える（EFF計算専用。formulas.tsのeff()参照）。
 * - 選手個人（ActionCD1=24。2026-27以降の新表記は91・92。shared/foulCodes.ts）はPlayerID1で選手単位に集計する（個人EFFの補正に使う）
 * - チーム単位はActionCD1=20（HCテクニカル）・21（ベンチテクニカル）・24/91/92（選手個人テクニカル）
 *   の合計をTeamIDで集計する（チームEFFの補正に使う。20・21は選手に紐付かずCategory=2の
 *   チーム発生イベント行にのみ計上されるため、個人側には含めない。DESIGN.md 2-2章）
 */
export function countTechnicalFouls(playByPlays: PlayByPlayEvent[]): {
  byPlayer: Map<string, number>;
  byTeam: Map<string, number>;
} {
  const byPlayer = new Map<string, number>();
  const byTeam = new Map<string, number>();
  for (const play of playByPlays) {
    if (PLAYER_TECHNICAL_FOUL_CODES.has(play.ActionCD1) && play.PlayerID1) {
      byPlayer.set(play.PlayerID1, (byPlayer.get(play.PlayerID1) ?? 0) + 1);
    }
    if (TECHNICAL_FT_FOUL_CODES.has(play.ActionCD1) && play.TeamID) {
      byTeam.set(play.TeamID, (byTeam.get(play.TeamID) ?? 0) + 1);
    }
  }
  return { byPlayer, byTeam };
}

export interface MiscEventCounts extends FoulCategoryCounts {
  dunks: number;
  basketCounts: number;
  /** アンスポーツマン系（旧25・新93/94の合計） */
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
}

export const ZERO_MISC_EVENTS: MiscEventCounts = {
  dunks: 0,
  basketCounts: 0,
  unsportsmanlikeFouls: 0,
  disqualifyingFouls: 0,
  technicalFoulsCat1: 0,
  technicalFoulsCat2: 0,
  flagrantFouls: 0,
  disruptiveFouls: 0,
};

const DUNK_ACTION_CD1 = 4;
const BASKET_COUNT_ACTION_CD1 = 16;

/**
 * ダンク数・アンドワン（バスケットカウント）・アンスポーツマンファウル・ディスクォリファイング
 * ファウルを選手単位・チーム単位の両方で集計する（src/lib/boxscoreAggregate.tsの
 * buildMiscEventCounts()と同じロジック。DESIGN.md 15-6章参照。試合単位のPlayByPlaysから
 * 毎回集計する必要があるためバックエンド側にも同じロジックを移植した）。
 * チーム単位（byTeam）は2026-08-29、チーム版Miscタブ拡張のために追加した
 * （従来は個別関数countTeamDunks()でダンク数のみチーム集計していたが、同じPBPを二重に
 * 走査する無駄を避けるためこの関数に統合した）
 */
export function buildMiscEventCounts(playByPlays: PlayByPlayEvent[]): { byPlayer: Map<string, MiscEventCounts>; byTeam: Map<string, MiscEventCounts> } {
  const byPlayer = new Map<string, MiscEventCounts>();
  const byTeam = new Map<string, MiscEventCounts>();
  const bump = (target: Map<string, MiscEventCounts>, id: string | null, key: keyof MiscEventCounts) => {
    if (!id) return;
    const entry = target.get(id) ?? { ...ZERO_MISC_EVENTS };
    entry[key] += 1;
    target.set(id, entry);
  };
  for (const ev of playByPlays) {
    const keys: (keyof MiscEventCounts)[] = [];
    if (ev.ActionCD1 === DUNK_ACTION_CD1 && ev.PlayText.includes("ダンク")) {
      keys.push("dunks");
    } else if (ev.ActionCD1 === BASKET_COUNT_ACTION_CD1) {
      keys.push("basketCounts");
    } else if (UNSPORTSMANLIKE_FOUL_CODES.has(ev.ActionCD1)) {
      keys.push("unsportsmanlikeFouls");
    } else if (ev.ActionCD1 === DISQUALIFYING_FOUL_CODE) {
      keys.push("disqualifyingFouls");
    }
    // 新しい区分（91〜94）は、TF・UFOULの合計とは別に、区分ごとの件数も持つ（shared/foulCodes.ts）
    const category = foulCategoryKey(ev.ActionCD1);
    if (category) keys.push(category);
    for (const key of keys) {
      bump(byPlayer, ev.PlayerID1, key);
      bump(byTeam, ev.TeamID, key);
    }
    // HC/ベンチのテクニカル（20・21）は、文言に区分があるとき（2026-27〜）だけ、チームのTF1・TF2に数える（選手には紐付かない）
    const teamCategory = teamTechnicalCategoryKey(ev.ActionCD1, ev.PlayText);
    if (teamCategory) bump(byTeam, ev.TeamID, teamCategory);
  }
  return { byPlayer, byTeam };
}

/** チームの得点の内訳（ベンチ・スタメン、登録区分別） */
export interface TeamPointsBreakdown {
  bench: number;
  starter: number;
  japanese: number;
  foreign: number;
  naturalized: number;
  asianQuota: number;
}

/**
 * ベンチ得点・スタメン得点（DESIGN.md 12章、Phase H8）と、登録区分別の得点（Phase H8・Batch 1・Batch 5）。
 * 先発かどうかは、試合全体の個人行（Category=1・PeriodCategory=18）の StartingFlg で決める（先発以外＝StartingFlg!==1 がベンチ）。
 * 区分は選手マスタの classification（BoxscoreTable.tsx の「内訳集計」と同じ突合）。区分が分からない選手はどの区分にも数えない（推測しない。51章）。
 * pointRows を省くと試合全体の個人行の Point を数える。区間ごとの値は、その区間の個人行（rowsInPeriodRange の結果）を渡す
 * （区間の行の StartingFlg は空のことがあるので使わない）
 */
export function teamPointsBreakdown(
  allRows: readonly BoxscoreRow[],
  teamId: string,
  classify: (playerId: string) => string | undefined,
  pointRows?: readonly BoxscoreRow[],
): TeamPointsBreakdown {
  const rowKey = (r: BoxscoreRow) => r.PlayerID || `#${(r.PlayerNo ?? "").trim()}`;
  const gameRows = allRows.filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.TeamID === teamId);
  const startingByKey = new Map(gameRows.map((r) => [rowKey(r), r.StartingFlg]));
  const result: TeamPointsBreakdown = { bench: 0, starter: 0, japanese: 0, foreign: 0, naturalized: 0, asianQuota: 0 };
  for (const r of pointRows ?? gameRows) {
    if (r.Category !== 1 || r.TeamID !== teamId) continue;
    if (startingByKey.get(rowKey(r)) === 1) result.starter += r.Point;
    else result.bench += r.Point;
    const classification = r.PlayerID ? classify(r.PlayerID) : undefined;
    if (classification === "日本人") result.japanese += r.Point;
    else if (classification === "外国籍") result.foreign += r.Point;
    else if (classification === "帰化選手") result.naturalized += r.Point;
    else if (classification === "アジア特別枠") result.asianQuota += r.Point;
  }
  return result;
}
