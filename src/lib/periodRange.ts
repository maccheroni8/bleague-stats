// 「試合/1Q/2Q/3Q/4Q/(OT)/前半/後半」の範囲選択を、Period単位のデータを持つ画面
// （ショットチャート・ボックススコア等）で共通して使うためのロジック。
// UIコンポーネントはcomponents/PeriodRangeToggle.tsx側。

export type PeriodRangeValue = "all" | `q${number}` | `ot${number}` | "h1" | "h2";

export interface PeriodRangeOption {
  value: PeriodRangeValue;
  label: string;
  /** nullは全ピリオド対象（絞り込みなし）。それ以外はここに含まれるPeriod番号のみを対象とする */
  periods: number[] | null;
}

/** 試合の合計ピリオド数（延長を含む）から選択肢一覧を組み立てる */
export function buildPeriodRangeOptions(totalPeriods: number): PeriodRangeOption[] {
  const options: PeriodRangeOption[] = [{ value: "all", label: "試合", periods: null }];
  const regulation = Math.min(totalPeriods, 4);
  for (let q = 1; q <= regulation; q += 1) {
    options.push({ value: `q${q}`, label: `${q}Q`, periods: [q] });
  }
  const otCount = totalPeriods - 4;
  for (let i = 1; i <= otCount; i += 1) {
    options.push({ value: `ot${i}`, label: otCount > 1 ? `OT${i}` : "OT", periods: [4 + i] });
  }
  if (regulation >= 2) {
    options.push({ value: "h1", label: "前半", periods: [1, 2] });
  }
  if (totalPeriods >= 3) {
    const secondHalf = Array.from({ length: totalPeriods - 2 }, (_, i) => i + 3);
    options.push({ value: "h2", label: "後半", periods: secondHalf });
  }
  return options;
}

/** 指定した選択肢（未選択時はundefined扱い）にそのPeriodが含まれるか */
export function periodInRange(option: PeriodRangeOption | undefined, period: number): boolean {
  if (!option || option.periods === null) return true;
  return option.periods.includes(period);
}
