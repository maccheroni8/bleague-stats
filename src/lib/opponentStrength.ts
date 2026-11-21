import type { GameSummary, TeamSummary, UpcomingGameEntry } from "../../shared/types";

/**
 * 対戦相手の強さの共通の部品（設計書251章・444章・450章）。相手の勝率で試合を分ける画面は、すべてここを通す
 * （チーム詳細の概要「シチュエーション別勝敗」・チームスタッツ／全チームスタッツの「シチュエーション別」・個人詳細の「シチュエーション別成績」・
 * 条件別順位表・絞り込み（ランキング・一覧・比較・個人／チーム詳細）の「対戦相手の勝率」・On-Court Foreign の「対勝率6割以上」・
 * 図解の「条件付きの勝率」・md・順位表の「対戦相手の強さ」「残り相手勝率」）。
 *
 * 相手の強さには2つの考え方がある（どの画面でも両方を選べる。名前は「対5割以上（最新勝率）」「対5割以上（試合時点の勝率）」の形）:
 * - 最新勝率: 相手のそのシーズンの今の（終わったシーズンは最終の）勝率。下の buildOpponentSeasonWinRates
 * - 試合時点の勝率: その試合に入る前の時点の相手の勝率。相手が5試合以上消化した試合だけ。下の buildRecordsBeforeGame
 *
 * 最新勝率＝そのシーズンのレギュラーシーズンの勝÷(勝＋敗)。終わったシーズンは最終、進行中は今の成績。
 * 元は teams.json の wins/losses（結果だけの試合〔不戦勝など〕を含む）。順位表の最新日のスナップショットも同じ勝敗
 * （全シーズン・両リーグで一致することを validate:opponent-strength で確かめる）なので、どちらを渡しても同じ値になる。
 *
 * 試合時点の勝率は games-summary.json（ボックススコアのある試合）から作るので、結果だけの試合（不戦勝など）は数えない。
 * 区切り（5割未満・5割以上・6割以上）はどちらも同じ。保存キーの対象のファイル（集計）からは使わない。
 */

export type OpponentSeasonRecord = Pick<TeamSummary, "teamId" | "wins" | "losses">;
export type OpponentSeasonTier = "under50" | "atLeast50" | "atLeast60";

/** チームID → 最新勝率。0試合・欠損・不正な勝敗は推測せず載せない（その相手との試合は、どの計算でも数えない） */
export function buildOpponentSeasonWinRates(teams: readonly OpponentSeasonRecord[] | null | undefined): ReadonlyMap<string, number> {
  const rates = new Map<string, number>();
  for (const team of teams ?? []) {
    const games = team.wins + team.losses;
    if (!Number.isSafeInteger(team.wins) || !Number.isSafeInteger(team.losses) ||
        team.wins < 0 || team.losses < 0 || !Number.isSafeInteger(games) || games <= 0) continue;
    rates.set(team.teamId, team.wins / games);
  }
  return rates;
}

/** 1試合ごとの相手の強さ（その試合の相手の最新勝率）。勝率を出せない相手は undefined */
export function opponentLatestWinRate(opponentTeamId: string, rates: ReadonlyMap<string, number>): number | undefined {
  return rates.get(opponentTeamId);
}

/** 区分（対5割未満・対5割以上・対6割以上）。6割以上は5割以上にも含める。消化試合数の下限は設けない */
export function matchesOpponentSeasonWinRate(
  opponentTeamId: string,
  tier: OpponentSeasonTier,
  rates: ReadonlyMap<string, number>,
): boolean {
  const rate = opponentLatestWinRate(opponentTeamId, rates);
  if (rate === undefined) return false;
  switch (tier) {
    case "under50": return rate < 0.5;
    case "atLeast50": return rate >= 0.5;
    case "atLeast60": return rate >= 0.6;
  }
}

/** 数字で選ぶ区分（●以上／●未満。図解の条件付きの勝率・条件別順位表の「対勝率●以上の相手」） */
export function matchesOpponentLatestRate(
  opponentTeamId: string,
  mode: "ge" | "lt",
  rate: number,
  rates: ReadonlyMap<string, number>,
): boolean {
  const r = opponentLatestWinRate(opponentTeamId, rates);
  if (r === undefined) return false;
  return mode === "ge" ? r >= rate - 1e-9 : r < rate - 1e-9;
}

/** 試合時点の勝率が rate 以上（ge）／未満（lt）か。相手が5試合未満の試合は入らない（図解の条件付きの勝率で数字を選ぶ条件） */
export function matchesOpponentAtGameRate<T extends { scheduleKey: string; opponentTeamId: string }>(
  g: T,
  mode: "ge" | "lt",
  rate: number,
  opponentRecords: ReadonlyMap<string, ReadonlyMap<string, { wins: number; losses: number }>> | undefined,
): boolean {
  const rec = opponentRecords?.get(g.scheduleKey)?.get(g.opponentTeamId);
  if (!rec) return false;
  const gp = rec.wins + rec.losses;
  if (gp < MIN_GAMES_FOR_OPPONENT_WIN_RATE) return false;
  const r = rec.wins / gp;
  return mode === "ge" ? r >= rate - 1e-9 : r < rate - 1e-9;
}

/** 相手の最新勝率の平均（ここまで・残り）。value は加重平均（同じ相手と複数回なら、その回数だけ数える）、games はその試合数 */
export interface OpponentStrength {
  /** 相手の最新勝率の、試合数での加重平均（0〜1） */
  value: number;
  /** 値を出した試合数 */
  games: number;
  /** リーグ内の順位（高い順。同じ表示値＝小数第3位まで同じなら同じ順位で、次の順位は飛ばす） */
  rank: number;
}

/** 平均と順位を付ける（順位は表示している値〔小数第3位〕が同じなら同じ順位。ランキングの順位の付け方と同じ） */
function rankAverages(sums: Map<string, { sum: number; games: number }>): Map<string, OpponentStrength> {
  const entries = [...sums].filter(([, s]) => s.games > 0).map(([teamId, s]) => ({ teamId, value: s.sum / s.games, games: s.games }));
  const key = (v: number) => v.toFixed(3);
  const sorted = [...entries].sort((a, b) => b.value - a.value);
  const result = new Map<string, OpponentStrength>();
  sorted.forEach((e, i) => {
    let j = i;
    while (j > 0 && key(sorted[j - 1]!.value) === key(e.value)) j -= 1;
    result.set(e.teamId, { value: e.value, games: e.games, rank: j + 1 });
  });
  return result;
}

/**
 * ここまでの相手の強さ（順位表の列「対戦相手の強さ」）: すでに戦ったレギュラーシーズンの試合の、相手の最新勝率の平均。
 * games はレギュラーシーズンの終了した試合（結果だけの試合〔不戦勝など〕も、順位表と同じく戦った試合として含めて渡す）。
 * 自チームの勝率を出せない（まだ試合をしていない）クラブは値を持たない
 */
export function computeOpponentStrength(
  teams: readonly OpponentSeasonRecord[],
  games: readonly GameSummary[],
): Map<string, OpponentStrength> {
  const rates = buildOpponentSeasonWinRates(teams);
  const sums = new Map<string, { sum: number; games: number }>();
  const add = (teamId: string, opponentId: string) => {
    const opponentWinPct = rates.get(opponentId);
    if (opponentWinPct === undefined || !rates.has(teamId)) return;
    const s = sums.get(teamId) ?? { sum: 0, games: 0 };
    s.sum += opponentWinPct;
    s.games += 1;
    sums.set(teamId, s);
  };
  for (const g of games) {
    if (g.gameType !== "regular" || !g.gameEndedFlg) continue;
    add(g.homeTeamId, g.awayTeamId);
    add(g.awayTeamId, g.homeTeamId);
  }
  return rankAverages(sums);
}

/**
 * 残りの相手の強さ（順位表の列「残り相手勝率」）: これからの試合（開催予定）の、相手の最新勝率の平均。同じ相手と複数回なら、その回数だけ数える。
 * upcoming は、まだ試合の記録が無い開催予定（`pendingUpcomingGames` を通したもの）。中止・延期で日程が決まっていない試合は開催予定に載らないので入らない。
 * excludeKeys（結果だけの試合など、すでに勝敗が付いた試合）は数えない。開催予定はチーム名しか持たないので、teamIdByName で名寄せする
 * （名寄せできない試合は数えない）。勝率を出せない相手（まだ試合をしていない）との試合も数えない。残り試合が無いクラブは値を持たない
 */
export function computeRemainingOpponentStrength(
  teams: readonly OpponentSeasonRecord[],
  upcoming: readonly UpcomingGameEntry[],
  teamIdByName: ReadonlyMap<string, string>,
  excludeKeys: ReadonlySet<string> = new Set(),
): Map<string, OpponentStrength> {
  const rates = buildOpponentSeasonWinRates(teams);
  const sums = new Map<string, { sum: number; games: number }>();
  const add = (teamId: string, opponentId: string) => {
    const opponentWinPct = rates.get(opponentId);
    if (opponentWinPct === undefined) return;
    const s = sums.get(teamId) ?? { sum: 0, games: 0 };
    s.sum += opponentWinPct;
    s.games += 1;
    sums.set(teamId, s);
  };
  for (const g of upcoming) {
    if (excludeKeys.has(g.scheduleKey)) continue;
    const homeId = teamIdByName.get(g.homeTeamName);
    const awayId = teamIdByName.get(g.awayTeamName);
    if (!homeId || !awayId) continue;
    add(homeId, awayId);
    add(awayId, homeId);
  }
  return rankAverages(sums);
}

// ───────── 試合時点の勝率（設計書450章で situational.ts から移した） ─────────

/** 対戦相手のその試合時点までの勝率で絞り込む際、これ未満の消化試合数は対象外にする（DESIGN.md参照） */
export const MIN_GAMES_FOR_OPPONENT_WIN_RATE = 5;

export interface RecordBeforeGame {
  wins: number;
  losses: number;
}

/**
 * シーズンの試合日程（games-summary.json、レギュラーシーズンのみ対象）から、各試合について
 * 「その試合が始まる時点（その試合自体は含まない）」での両チームの勝敗数を求める。
 * Map<scheduleKey, Map<teamId, RecordBeforeGame>>（1試合につき対戦した2チーム分のキーを持つ）。
 * 「対勝率別」フィルタ（opponentWinRate）で、対戦相手のscheduleKeyをキーに引く用途で使う
 */
export function buildRecordsBeforeGame(games: GameSummary[]): Map<string, Map<string, RecordBeforeGame>> {
  const sorted = games
    .filter((g) => g.gameType === "regular" && g.gameEndedFlg)
    .sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));

  const result = new Map<string, Map<string, RecordBeforeGame>>();
  const running = new Map<string, RecordBeforeGame>();
  const ensure = (teamId: string): RecordBeforeGame => {
    let r = running.get(teamId);
    if (!r) {
      r = { wins: 0, losses: 0 };
      running.set(teamId, r);
    }
    return r;
  };

  for (const g of sorted) {
    const perGame = new Map<string, RecordBeforeGame>();
    perGame.set(g.homeTeamId, { ...ensure(g.homeTeamId) });
    perGame.set(g.awayTeamId, { ...ensure(g.awayTeamId) });
    result.set(g.scheduleKey, perGame);

    if (g.homeScore > g.awayScore) {
      ensure(g.homeTeamId).wins += 1;
      ensure(g.awayTeamId).losses += 1;
    } else {
      ensure(g.awayTeamId).wins += 1;
      ensure(g.homeTeamId).losses += 1;
    }
  }
  return result;
}


/**
 * 対戦相手のその試合時点までの勝率が指定の閾値区分に該当するか。opponentRecordsが未指定、
 * または相手の消化試合数がMIN_GAMES_FOR_OPPONENT_WIN_RATE未満の場合は常にfalse（DESIGN.md参照）
 */
export function matchesOpponentWinRateTier<T extends { scheduleKey: string; opponentTeamId: string }>(
  g: T,
  tier: "under50" | "atLeast50" | "atLeast60",
  opponentRecords: OpponentRecords | undefined,
): boolean {
  const rec = opponentRecords?.get(g.scheduleKey)?.get(g.opponentTeamId);
  if (!rec) return false;
  const gp = rec.wins + rec.losses;
  if (gp < MIN_GAMES_FOR_OPPONENT_WIN_RATE) return false;
  const winPct = rec.wins / gp;
  switch (tier) {
    case "under50":
      return winPct < 0.5;
    case "atLeast50":
      return winPct >= 0.5;
    case "atLeast60":
      return winPct >= 0.6;
  }
}


// ───────── 2つの考え方をまとめて扱う（設計書450章） ─────────

/** 相手の強さの考え方。latest＝最新勝率、atGame＝試合時点の勝率 */
export type OpponentStrengthBasis = "latest" | "atGame";

/**
 * 試合時点の勝率（scheduleKey → チームID → その試合の前の勝敗）に、最新勝率（チームID → 勝率）を添えたもの。
 * 絞り込みの部品（matchesSituationalAndFilters）には、これ1つを渡せば両方の条件を判定できる。
 * latestWinRates が無い（teams.json を読めていない）ときは、最新勝率の条件を選べない
 */
export type OpponentRecords = Map<string, Map<string, RecordBeforeGame>> & { latestWinRates?: ReadonlyMap<string, number> };

/** 試合時点の勝率に最新勝率を添えて作る（teams はそのシーズン・そのリーグの teams.json） */
export function buildOpponentRecords(
  games: GameSummary[],
  teams: readonly OpponentSeasonRecord[] | null | undefined,
): OpponentRecords {
  const records: OpponentRecords = buildRecordsBeforeGame(games);
  if (teams) records.latestWinRates = buildOpponentSeasonWinRates(teams);
  return records;
}

/** 区切りの並び（どの画面でも同じ） */
export const OPPONENT_STRENGTH_TIERS: readonly OpponentSeasonTier[] = ["under50", "atLeast50", "atLeast60"];
export const OPPONENT_TIER_LABELS: Record<OpponentSeasonTier, string> = { under50: "対5割未満", atLeast50: "対5割以上", atLeast60: "対6割以上" };
export const OPPONENT_BASIS_LABELS: Record<OpponentStrengthBasis, string> = { latest: "最新勝率", atGame: "試合時点の勝率" };

/** 「対5割以上（最新勝率）」「対5割以上（試合時点の勝率）」 */
export function opponentStrengthLabel(tier: OpponentSeasonTier, basis: OpponentStrengthBasis): string {
  return `${OPPONENT_TIER_LABELS[tier]}（${OPPONENT_BASIS_LABELS[basis]}）`;
}

/** 選択肢の並び: 同じ区切りの最新勝率と試合時点の勝率を隣り合わせに（対5割未満〔最新〕・対5割未満〔試合時点〕・対5割以上〔最新〕…） */
export function opponentStrengthChoices(): { tier: OpponentSeasonTier; basis: OpponentStrengthBasis; label: string }[] {
  return OPPONENT_STRENGTH_TIERS.flatMap((tier) =>
    (["latest", "atGame"] as const).map((basis) => ({ tier, basis, label: opponentStrengthLabel(tier, basis) })),
  );
}

/** 1試合が区切りに入るか（考え方を選んで判定）。latestRates が無ければ最新勝率の条件はどの試合も入らない */
export function matchesOpponentStrength<T extends { scheduleKey: string; opponentTeamId: string }>(
  g: T,
  tier: OpponentSeasonTier,
  basis: OpponentStrengthBasis,
  source: { atGame?: OpponentRecords; latest?: ReadonlyMap<string, number> },
): boolean {
  return basis === "latest"
    ? matchesOpponentSeasonWinRate(g.opponentTeamId, tier, source.latest ?? source.atGame?.latestWinRates ?? new Map())
    : matchesOpponentWinRateTier(g, tier, source.atGame);
}

/** どちらの区切りにも入らない試合（最新勝率: 相手の勝率が出せない／試合時点の勝率: 相手が5試合未満） */
export function isOpponentStrengthUnclassified<T extends { scheduleKey: string; opponentTeamId: string }>(
  g: T,
  basis: OpponentStrengthBasis,
  source: { atGame?: OpponentRecords; latest?: ReadonlyMap<string, number> },
): boolean {
  if (basis === "latest") return !(source.latest ?? source.atGame?.latestWinRates ?? new Map()).has(g.opponentTeamId);
  const rec = source.atGame?.get(g.scheduleKey)?.get(g.opponentTeamId);
  return !rec || rec.wins + rec.losses < MIN_GAMES_FOR_OPPONENT_WIN_RATE;
}
