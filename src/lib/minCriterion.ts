import { numberParam, type UrlCodec } from "./urlState";
import { scaledMinForPeriod } from "./periodMinimum";

/**
 * 掲載基準を詳細フィルタで変える・外すための共通の部品（画面だけ。保存キーの対象外）。
 * 1試合記録の成功率の項目の最低成功数（URL `mm`）: -1（書かない）＝その項目の最初の基準、0＝基準なし、1以上＝その成功数以上。
 * 項目を変えたら、呼び出し側が -1 に戻す（別の項目の基準を引き継がない）
 */
export const RECORD_MIN_MADE_PARAM = numberParam("mm", -1, { min: -1 });

/** 成功率の項目の最低成功数の、画面で出す名前（ランキングの掲載基準の書き方「FGM 1.5以上」と同じ） */
export const MIN_MADE_RULE_LABEL: Record<string, string> = { fgPct: "FGM", twoPct: "2PM", tpPct: "3PM", ftPct: "FTM" };

/** URL の値を、集計に渡す値にする。最初の基準のとき（-1）は undefined（今までの経路のまま） */
export function minMadeOverride(value: number): number | undefined {
  return value < 0 ? undefined : value;
}

/** 実際に使う最低成功数（0＝基準なし） */
export function effectiveMinMade(value: number, base: number): number {
  return value < 0 ? base : value;
}

/** 区間（Q別・前後半）を選んでいるときは、区間の長さに合わせて下げる。基準なし（0）は0のまま */
export function scaledMinMade(min: number, period: string | null): number {
  return min <= 0 ? 0 : scaledMinForPeriod(min, period);
}

/** 成功率の判定: 基準なし（0）でも、試投が1本以上ある試合だけ（試投が0の試合の率は出せない） */
export function passesMinMade(made: number, attempted: number, min: number): boolean {
  return min <= 0 ? attempted > 0 : made >= min;
}

/** 基準を変えている（最初の基準でない）ときの、タイトルの下の行・保存画像のサブタイトルの文。最初の基準のときは空 */
export function minMadeConditionLabels(value: number, base: number | null, ruleLabel: string | undefined): string[] {
  if (base === null || !ruleLabel || value < 0 || value === base) return [];
  return [value === 0 ? "掲載基準なし" : `${ruleLabel} ${value}以上`];
}

/** シュートタイプ・エリア別の成功率（Shooting）の最低試投数を外す（URL `sa=1`）。書かなければ今までの基準（チームの試合数の半分） */
export const SHOT_MIN_NONE_PARAM: UrlCodec<boolean> = {
  keys: ["sa"],
  read: (p) => (p.get("sa") === "1" ? true : undefined),
  write: (p, v) => {
    p.delete("sa");
    if (v) p.set("sa", "1");
  },
};
