// 夜間実行で記録を取り直す期間（試合日から何日間か）。ボックススコアの再チェック（status=watching）と、
// スポーツナビのPBPの取り直しで共通に使う。公式記録の後日訂正は約1週間後に入ることが多いため、その3倍を見ている。
// 21日を過ぎた修正は、この仕組みでは拾わない（個別に取り直す。DESIGN.md 8-1・8-11章）

export const RECHECK_PERIOD_DAYS = 21;

/** JSTの試合日（YYYY-MM-DD）が、再チェックの期間を過ぎているか */
export function isPastRecheckPeriod(jstDateStr: string, now: number = Date.now()): boolean {
  const daysSince = (now - new Date(`${jstDateStr}T00:00:00+09:00`).getTime()) / 86_400_000;
  return daysSince > RECHECK_PERIOD_DAYS;
}
