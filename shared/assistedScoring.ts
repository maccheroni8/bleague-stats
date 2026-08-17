// アシストからの得点（得点者単位の被アシスト内訳・アシスト者-得点者のペア単位カウント）。
//
// アシストイベント（ActionCD1=12）自体には、どの得点に紐づくかを示すタグが無い
// （15-6章のPlayTextタグ調査で判明。PTSOFFTO等とは異なりタグを数えるだけでは算出できない）。
// そのため「PlayByPlays配列内でアシストイベントの直前に位置する、同一チーム・同一ピリオドの
// 成功したFG/FTイベント」を構造的なペアとみなす方式で算出する（選手交代IN/OUTのペアリングと
// 同じ考え方）。DESIGN.md該当章の調査により、この構造的隣接パターンは全10シーズン
// （2016-17〜2025-26）で99.88%〜100%の一致率で成立することを確認済み（残る取りこぼしは
// 個別に追跡済みの既存データ品質問題に起因し、ペアリングの考え方自体の誤りではない）。
//
// バックワードスキャン中にスキップする「管理系イベント」は、実データの遭遇順に発見した以下の集合:
// 16=バスケットカウント（アンドワン）マーカー、22=パーソナル/シュートファウル、
// 84/85=タイムアウト開始/終了、86/87=選手交代IN/OUT、88=タイムアウト。
//
// 得点イベント側（マッチ対象）はActionCD1∈{1,3,4,7}（3P成功・2P成功（外/内）・FT成功）。
// FT成功を含めているのは一見不自然だが（フリースロー自体はアシストされない）、実データ調査で
// 「シュートファウルでフリースローに切り替わった際、パスを出した選手にアシストが記録され、
// その"アシスト"イベントが1本目と2本目のフリースローの間に挿入される」という一貫したパターンを
// 確認したため（B.LEAGUE公式の集計仕様とみられる。得点イベント側のPlayTextにも
// 「シュートファウル」タグが付いており、シュート試投がファウルに置き換わった状況と整合する）。
//
// マッチに失敗したアシストイベント（全体の0.12%以下、既知のデータ品質問題に起因）は、
// 得点との紐付け無しとして単純にスキップする（無理に処理しない）。
//
// なおASTボックススコア値そのもの（sumCounts()のast）は変更しない。本モジュールは
// 「アシストされた得点」という別の切り口の集計を追加するのみ。

import type { PlayByPlayEvent } from "./types.ts";

const MADE_SCORE_CODES = new Set([1, 3, 4, 7]);
const SKIPPABLE_CODES = new Set([16, 22, 84, 85, 86, 87, 88]);
const MAX_BACKWARD_STEPS = 8;

export interface AssistedScoringCounts {
  assisted2m: number;
  assisted3m: number;
  assistedFtm: number;
}

const ZERO_ASSISTED: AssistedScoringCounts = { assisted2m: 0, assisted3m: 0, assistedFtm: 0 };

export interface AssistPair {
  assisterId: string;
  scorerId: string;
  /** このペアで成立したアシスト付き得点の回数（2P/3P/FT合算） */
  count: number;
}

export interface AssistedScoringResult {
  /** 得点者playerId -> 被アシスト内訳（2P/3P/FT別） */
  byScorer: Map<string, AssistedScoringCounts>;
  /** "assisterId:scorerId" -> ペア単位の集計（将来のペアランキングUI用。今回はUI未実装） */
  pairs: Map<string, AssistPair>;
}

function scoreKindFor(actionCd1: number): keyof AssistedScoringCounts | null {
  if (actionCd1 === 1) return "assisted3m";
  if (actionCd1 === 3 || actionCd1 === 4) return "assisted2m";
  if (actionCd1 === 7) return "assistedFtm";
  return null;
}

export function computeAssistedScoring(playByPlays: PlayByPlayEvent[]): AssistedScoringResult {
  const byScorer = new Map<string, AssistedScoringCounts>();
  const pairs = new Map<string, AssistPair>();

  for (let i = 0; i < playByPlays.length; i++) {
    const assistEvent = playByPlays[i];
    if (!assistEvent || assistEvent.ActionCD1 !== 12 || !assistEvent.PlayerID1) continue;
    const assisterId = assistEvent.PlayerID1;

    let j = i - 1;
    let steps = 0;
    while (j >= 0 && steps < MAX_BACKWARD_STEPS) {
      const candidate = playByPlays[j];
      if (!candidate) break;
      const kind = scoreKindFor(candidate.ActionCD1);
      if (kind) {
        if (candidate.TeamID === assistEvent.TeamID && candidate.Period === assistEvent.Period && candidate.PlayerID1) {
          const scorerId = candidate.PlayerID1;
          const scorerEntry = byScorer.get(scorerId) ?? { ...ZERO_ASSISTED };
          scorerEntry[kind] += 1;
          byScorer.set(scorerId, scorerEntry);

          const pairKey = `${assisterId}:${scorerId}`;
          const pairEntry = pairs.get(pairKey) ?? { assisterId, scorerId, count: 0 };
          pairEntry.count += 1;
          pairs.set(pairKey, pairEntry);
        }
        break;
      }
      if (!SKIPPABLE_CODES.has(candidate.ActionCD1)) break;
      j--;
      steps++;
    }
  }

  return { byScorer, pairs };
}
