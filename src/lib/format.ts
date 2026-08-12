export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function formatPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** すでに0〜100スケールになっている値（ORB%・Usage%など）を%表記にする */
export function formatPct100(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function formatSigned(value: number, digits = 1): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

export function formatRecord(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}
