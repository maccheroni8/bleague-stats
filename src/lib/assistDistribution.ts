// 個人詳細「誰へのアシストが多いか」の割合のための、アシストの数え方（画面だけで使う）。
//
// アシスト1回（PBP のアシストのイベント1つ）を1回と数え、つながった相手（得点した選手）ごとに分ける。
// FG へのアシストも、シュートファウルで FT につながったアシストも1回（FT が2本入っても1回）。
// 相手の見つけ方は、アシストされた得点の集計（shared/assistedScoring.ts）の後ろ向きのたどり方と同じ
// （同じチーム・同じピリオドの、直前の成功した FG／FT。管理系のイベントは飛ばす。8件まで）。
// 相手が見つからないアシストは「相手不明」として本人の合計に残す。
//
// 保存キーの対象のファイル（shared/assistedScoring.ts など）は書き換えず、import もしない
// （このファイルを読む集計が無いので、変えても過去シーズンの作り直しは起きない）。
// たどり方を shared/assistedScoring.ts で変えたときは、ここも同じに直す
// （`npm run validate:assist-distribution` が、相手の見つかったアシストの数の一致を確かめる）。

/** この処理が読む PBP の項目だけ（shared/types.ts の PlayByPlayEvent と同じ形） */
export interface AssistPbpEvent {
  Period: number;
  TeamID: string | null;
  PlayerID1: string | null;
  ActionCD1: number;
}

const ASSIST_CD = 12;
const MADE_SCORE_CODES = new Set([1, 3, 4, 7]);
const FT_MADE_CD = 7;
const SKIPPABLE_CODES = new Set([16, 22, 84, 85, 86, 87, 88]);
const MAX_BACKWARD_STEPS = 8;

export interface AssistDistribution {
  /** 本人のアシストの数（相手不明を含む） */
  total: number;
  /** 得点した選手ごとのアシストの数 */
  byScorer: Map<string, number>;
  /** そのうち FT につながったアシストの数（得点した選手ごと） */
  ftByScorer: Map<string, number>;
  /** 相手が見つからなかったアシストの数 */
  unknown: number;
}

export function emptyAssistDistribution(): AssistDistribution {
  return { total: 0, byScorer: new Map(), ftByScorer: new Map(), unknown: 0 };
}

/** アシストのイベントの直前をたどって、つながった得点のイベントを返す（見つからなければ null） */
function matchedScore<T extends AssistPbpEvent>(pbp: T[], i: number): T | null {
  const assist = pbp[i]!;
  let j = i - 1;
  let steps = 0;
  while (j >= 0 && steps < MAX_BACKWARD_STEPS) {
    const candidate = pbp[j];
    if (!candidate) return null;
    if (MADE_SCORE_CODES.has(candidate.ActionCD1)) {
      return candidate.TeamID === assist.TeamID && candidate.Period === assist.Period && candidate.PlayerID1 ? candidate : null;
    }
    if (!SKIPPABLE_CODES.has(candidate.ActionCD1)) return null;
    j--;
    steps++;
  }
  return null;
}

/**
 * 1試合の PBP から、選手（アシストした側）ごとのアシストの配分を数える。
 * periods が null なら試合全体、配列ならそのピリオドだけ（Q別・前後半）。
 * 区間で絞るときは、先に PBP をその区間だけにしてからたどる（アシストされた得点の集計と同じ）
 */
export function countAssistDistribution(pbp: AssistPbpEvent[], periods: number[] | null = null): Map<string, AssistDistribution> {
  const events = periods === null ? pbp : pbp.filter((e) => periods.includes(e.Period));
  const out = new Map<string, AssistDistribution>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.ActionCD1 !== ASSIST_CD || !e.PlayerID1) continue;
    const entry = out.get(e.PlayerID1) ?? emptyAssistDistribution();
    entry.total += 1;
    const score = matchedScore(events, i);
    if (score && score.PlayerID1) {
      entry.byScorer.set(score.PlayerID1, (entry.byScorer.get(score.PlayerID1) ?? 0) + 1);
      if (score.ActionCD1 === FT_MADE_CD) entry.ftByScorer.set(score.PlayerID1, (entry.ftByScorer.get(score.PlayerID1) ?? 0) + 1);
    } else {
      entry.unknown += 1;
    }
    out.set(e.PlayerID1, entry);
  }
  return out;
}

/** 複数の試合の配分を足す（into を書き換える） */
export function addAssistDistribution(into: AssistDistribution, add: AssistDistribution): void {
  into.total += add.total;
  into.unknown += add.unknown;
  for (const [k, v] of add.byScorer) into.byScorer.set(k, (into.byScorer.get(k) ?? 0) + v);
  for (const [k, v] of add.ftByScorer) into.ftByScorer.set(k, (into.ftByScorer.get(k) ?? 0) + v);
}

/** 割合（%）。分母が0なら null（画面は「-」） */
export function assistSharePct(count: number, total: number): number | null {
  return total > 0 ? (100 * count) / total : null;
}
