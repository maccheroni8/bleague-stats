// ルーキーの例外の一覧（DESIGN.md 215-8章）。規程 第5条〔新人選手〕は、海外リーグ（NBA Summer League含む）の在籍経験がある選手を新人選手としない。
// 選手ページの所属履歴には国内の B1・B2・B3 しか載らず、海外の経歴をデータから判定できないので、確認できた選手をここに1か所で記録し、ルーキーから外す
// （`judgeRookieForPlayer`。導出データ rookie-eligibility.json を作る集計と検証で共通）。
//
// ・**海外リーグの扱い**: NCAA（大学）の経験は「海外リーグ」に数えない（確定。2026-10-17）。プロのリーグ（NBA・Gリーグ・NBL・欧州・韓国・フィリピンなど）と NBA Summer League が対象。
// ・**この一覧は保存キーの対象外**: `shared/types.ts`・`scripts/aggregate.ts` から import されない場所に置く（ここを書き換えても、過去シーズンの作り直しは起きない）。
//   `data/` に新しいファイルを足すと `scripts/lib/dataLayout.ts`（キーの対象）の書き換えが要るので、ファイルにはしない。
// ・毎シーズンの初めに、規程の改定の確認（215-7章）と合わせて、`npm run validate:rookie-eligibility` が出す「初登録時に23歳以上の候補」を見直し、
//   海外プロ経験が確認できた選手は例外へ、そうでないと確認できた選手は「確認済み」へ足す。

export interface RookieOverseasException {
  playerId: string;
  /** 選手マスタの登録名（見やすさのため。判定には使わない） */
  name: string;
  /** 海外のプロ経験のリーグ。確認できていないものは「要確認」と書く */
  league: string;
  /** 確認の経緯 */
  note: string;
}

/** 海外のプロ経験があり、ルーキーから外す選手（初めての登録のシーズンも、延長のシーズンも外す） */
export const ROOKIE_OVERSEAS_EXCEPTIONS: readonly RookieOverseasException[] = [
  { playerId: "51000428", name: "渡邊 雄太", league: "NBA", note: "2024-25にNBAからBリーグへ。2026-10-17に例外へ（ユーザー指示）" },
  { playerId: "19755", name: "富永 啓生", league: "Gリーグ（NBA傘下）", note: "2025-26にGリーグからBリーグへ。2026-10-17に例外へ（ユーザー指示）" },
  { playerId: "51000104", name: "マシュー・アキノ", league: "要確認", note: "海外でのプロ経験あり（MACの確認。2026-10-17）。リーグ名は未確認" },
];

export interface RookieConfirmedAsRookie {
  playerId: string;
  name: string;
  /** ルーキーのままで正しいと確認できた理由 */
  note: string;
}

/**
 * 初めての登録のとき年齢が高い（23歳以上）が、確認の結果、ルーキーのままで正しい選手。
 * 検証の「候補」に出さないための一覧で、判定には使わない
 */
export const ROOKIE_CONFIRMED_AS_ROOKIE: readonly RookieConfirmedAsRookie[] = [
  { playerId: "18167", name: "笠井 康平", note: "社会人リーグなどを経ているため年齢が高いだけ（MACの確認。2026-10-17）" },
  { playerId: "32978", name: "大矢 孝太朗", note: "社会人リーグなどを経ているため年齢が高いだけ（MACの確認。2026-10-17）" },
  { playerId: "5100000063", name: "ザック・モーア", note: "社会人リーグなどを経ているため年齢が高いだけ（MACの確認。2026-10-17）" },
  { playerId: "51000097", name: "阿部 龍星", note: "社会人リーグなどを経ているため年齢が高いだけ（MACの確認。2026-10-17）" },
  { playerId: "51000322", name: "山本 楓己", note: "社会人リーグなどを経ているため年齢が高いだけ（MACの確認。2026-10-17）" },
];

const OVERSEAS = new Map(ROOKIE_OVERSEAS_EXCEPTIONS.map((e) => [e.playerId, e]));
const CONFIRMED = new Set(ROOKIE_CONFIRMED_AS_ROOKIE.map((e) => e.playerId));

export function rookieOverseasException(playerId: string): RookieOverseasException | undefined {
  return OVERSEAS.get(playerId);
}

export function isConfirmedRookie(playerId: string): boolean {
  return CONFIRMED.has(playerId);
}

/** 検証の「候補」にする初登録時の年齢（シーズンの開始年の4月1日時点）。この年齢以上で、例外・確認済みのどちらにも無い選手を出す */
export const ROOKIE_CANDIDATE_MIN_AGE = 23;
