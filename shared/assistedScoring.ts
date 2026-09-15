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
// その"アシスト"イベントが（複数本のフリースローのうち）最初に成功した1本の直後に挿入される」
// という一貫したパターンを確認したため（B.LEAGUE公式の集計仕様とみられる。得点イベント側の
// PlayTextにも「シュートファウル」タグが付いており、シュート試投がファウルに置き換わった状況と
// 整合する）。
//
// 【2026-09-15追加】2本・3本のフリースローが絡むシュートファウルでは、公式データ上アシスト
// イベントは1回しか記録されない（後方スキャンで直前の1本だけが拾われる）が、実データ調査で
// 「同じ被ファウル選手が続けて成功させた2本目・3本目のフリースローも、同じ1回のアシストに
// 起因する得点である」ことを確認した（例: 1本目成功→アシスト→2本目成功、1本目失敗→2本目成功
// →アシスト→3本目成功）。そのため、後方スキャンでマッチした得点がFT成功だった場合に限り、
// アシストイベントの直後からも前方スキャンを行い、同一選手・同一チーム・同一ピリオドで続く
// フリースロー（管理系イベントは同様にスキップ）のうち成功したものを同じアシストへ追加で
// 紐付ける。FG成功（3P/2P）へのアシストやアンドワンのボーナスFTはこの前方スキャンの対象外
// （後方マッチがFT成功のときのみ発火するため、既存の後方スキャンの挙動には影響しない）。
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
const MAX_FORWARD_STEPS = 8;
const FT_MADE_CD = 7;
const FT_MISS_CD = 8;

export interface AssistedScoringCounts {
  assisted2m: number;
  assisted3m: number;
  assistedFtm: number;
}

const ZERO_ASSISTED: AssistedScoringCounts = { assisted2m: 0, assisted3m: 0, assistedFtm: 0 };

export interface AssistPair extends AssistedScoringCounts {
  assisterId: string;
  scorerId: string;
  /** このペアで成立したアシスト付き得点の回数（2P/3P/FT合算。assisted2m+assisted3m+assistedFtmと一致） */
  count: number;
}

export interface AssistedScoringResult {
  /** 得点者playerId -> 被アシスト内訳（2P/3P/FT別） */
  byScorer: Map<string, AssistedScoringCounts>;
  /** "assisterId:scorerId" -> ペア単位の集計（将来のペアランキングUI用。今回はUI未実装） */
  pairs: Map<string, AssistPair>;
  /**
   * 得点したチームのteamId -> 被アシスト内訳（byScorerのチーム集計版。2026-08-29、
   * チーム版Miscタブ拡張用に追加）。マッチした得点イベントのTeamID（=assistEventのTeamID、
   * 判定条件上必ず一致する）で集計するだけで、新規のPBP走査は発生しない
   */
  byTeam: Map<string, AssistedScoringCounts>;
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
  const byTeam = new Map<string, AssistedScoringCounts>();

  const recordMatch = (
    assisterId: string,
    scorerId: string,
    teamId: string | null,
    kind: keyof AssistedScoringCounts,
  ): void => {
    const scorerEntry = byScorer.get(scorerId) ?? { ...ZERO_ASSISTED };
    scorerEntry[kind] += 1;
    byScorer.set(scorerId, scorerEntry);

    const pairKey = `${assisterId}:${scorerId}`;
    const pairEntry = pairs.get(pairKey) ?? { assisterId, scorerId, count: 0, ...ZERO_ASSISTED };
    pairEntry.count += 1;
    pairEntry[kind] += 1;
    pairs.set(pairKey, pairEntry);

    if (teamId) {
      const teamEntry = byTeam.get(teamId) ?? { ...ZERO_ASSISTED };
      teamEntry[kind] += 1;
      byTeam.set(teamId, teamEntry);
    }
  };

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
          recordMatch(assisterId, scorerId, assistEvent.TeamID, kind);

          // シュートファウルで2本・3本のフリースローが絡む場合、成功した最初の1本の直後に
          // アシストイベントが挿入され、後続のフリースローはアシストイベントより後ろに
          // 位置するため後方スキャンでは拾えない。同一選手・同一チーム・同一ピリオドで続く
          // フリースローを前方スキャンし、成功分を同じアシストへ追加で紐付ける
          // （ファイル冒頭のコメント参照）。
          if (kind === "assistedFtm") {
            let k = i + 1;
            let forwardSteps = 0;
            while (k < playByPlays.length && forwardSteps < MAX_FORWARD_STEPS) {
              const next = playByPlays[k];
              if (!next) break;
              if (next.ActionCD1 === FT_MADE_CD || next.ActionCD1 === FT_MISS_CD) {
                const sameTrip =
                  next.TeamID === assistEvent.TeamID && next.Period === assistEvent.Period && next.PlayerID1 === scorerId;
                if (!sameTrip) break;
                if (next.ActionCD1 === FT_MADE_CD) {
                  recordMatch(assisterId, scorerId, assistEvent.TeamID, "assistedFtm");
                }
                k++;
                forwardSteps++;
                continue;
              }
              if (!SKIPPABLE_CODES.has(next.ActionCD1)) break;
              k++;
              forwardSteps++;
            }
          }
        }
        break;
      }
      if (!SKIPPABLE_CODES.has(candidate.ActionCD1)) break;
      j--;
      steps++;
    }
  }

  return { byScorer, pairs, byTeam };
}
