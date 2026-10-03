// 「試合/1Q/2Q/3Q/4Q/(OT1/OT2…)/前半/後半/(OT)」の範囲選択を、Period単位のデータを持つ画面
// （ショットチャート・ボックススコア等）で共通して使うためのロジック。
// UIコンポーネントはcomponents/PeriodRangeToggle.tsx側。

/** ot＝すべての延長の合計、ot1・ot2…＝個別の延長 */
export type PeriodRangeValue = "all" | `q${number}` | "ot" | `ot${number}` | "h1" | "h2";

export interface PeriodRangeOption {
  value: PeriodRangeValue;
  label: string;
  /** nullは全ピリオド対象（絞り込みなし）。それ以外はここに含まれるPeriod番号のみを対象とする */
  periods: number[] | null;
}

/**
 * 試合の合計ピリオド数（延長を含む）から選択肢一覧を組み立てる。
 * 延長が2回以上の試合: 試合・1Q〜4Q・OT1・OT2…・前半・後半・OT（すべての延長の合計）。
 * 延長が1回の試合: 試合・1Q〜4Q・前半・後半・OT（OT1は出さない）。延長のない試合には延長の選択肢を出さない。
 * 前半は1Q＋2Q、後半は3Q＋4Qで、延長は含まない
 */
export function buildPeriodRangeOptions(totalPeriods: number): PeriodRangeOption[] {
  const options: PeriodRangeOption[] = [{ value: "all", label: "試合", periods: null }];
  const regulation = Math.min(totalPeriods, 4);
  for (let q = 1; q <= regulation; q += 1) {
    options.push({ value: `q${q}`, label: `${q}Q`, periods: [q] });
  }
  const otCount = totalPeriods - 4;
  if (otCount >= 2) {
    for (let i = 1; i <= otCount; i += 1) {
      options.push({ value: `ot${i}`, label: `OT${i}`, periods: [4 + i] });
    }
  }
  if (regulation >= 2) {
    options.push({ value: "h1", label: "前半", periods: [1, 2] });
  }
  if (regulation >= 3) {
    options.push({ value: "h2", label: "後半", periods: Array.from({ length: regulation - 2 }, (_, i) => i + 3) });
  }
  if (otCount >= 1) {
    options.push({ value: "ot", label: "OT", periods: Array.from({ length: otCount }, (_, i) => 5 + i) });
  }
  return options;
}

/** 指定した選択肢（未選択時はundefined扱い）にそのPeriodが含まれるか */
export function periodInRange(option: PeriodRangeOption | undefined, period: number): boolean {
  if (!option || option.periods === null) return true;
  return option.periods.includes(period);
}
