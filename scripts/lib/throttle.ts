// リクエスト間隔を強制する共通ユーティリティ。
// 個人利用の範囲を守るため、ホストごとに直列実行・最低間隔を強制する（DESIGN.md 2章の制約）。

export function createThrottledFetch(minIntervalMs: number, userAgent: string) {
  let lastRequestAt = 0;

  return async function throttledFetch(url: string): Promise<Response> {
    const wait = minIntervalMs - (Date.now() - lastRequestAt);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastRequestAt = Date.now();
    return fetch(url, { headers: { "User-Agent": userAgent } });
  };
}
