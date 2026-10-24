// 成功率の最低成功数を、区間（Q別・前後半）の長さに合わせて下げる（ユーザー決定 2026-10-18。個人・チームの1試合記録で共通）。
// 1Q〜4Q は4分の1、前半・後半は2分の1、延長は8分の1（四捨五入、最低1）。試合全体（period が null）は基準のまま
const PERIOD_SHARE: Record<string, number> = { q1: 1 / 4, q2: 1 / 4, q3: 1 / 4, q4: 1 / 4, h1: 1 / 2, h2: 1 / 2, ot: 1 / 8 };

export function scaledMinForPeriod(base: number, period: string | null): number {
  return period ? Math.max(1, Math.round(base * (PERIOD_SHARE[period] ?? 1))) : base;
}
