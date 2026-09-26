// リクエスト間隔を強制する共通ユーティリティ。
// 個人利用の範囲を守るため、ホストごとに直列実行・最低間隔を強制する（DESIGN.md 2章の制約）。
//
// 2026-09-25（DESIGN.md 8-9）:
// - 最低間隔はホストごとにプロセス全体で共有する。以前は呼び出し元のモジュールごとに別々に数えていたため、
//   日程の取得（scrape-schedule.ts）のすぐ後に開催予定の試合の問い合わせ（lib/upcomingGame.ts）が続くような場合に、
//   同じホストへの間隔が2.5秒を切ることがあった
// - 1回の問い合わせに待ち時間の上限（既定30秒）を設ける。以前は上限が無く、相手が応答しないとジョブの上限（90分）まで待ち続けた
// - 5xx の応答と通信の失敗（上限時間切れを含む）のときだけ、10秒待って1回だけ再試行する。4xx は再試行しない
//   （2026-09-25 21:22 の実行で日程のページが一時的に 502 を返し、以降のステップがすべて止まったため）

export interface ThrottledFetchOptions {
  /** 1回の問い合わせの待ち時間の上限（ミリ秒）。null で上限なし */
  timeoutMs?: number | null;
  /** 5xx・通信の失敗のときに1回だけ再試行するか */
  retryOnTransientError?: boolean;
  /** 再試行の前に待つ時間（ミリ秒） */
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 10_000;

/** ホストごとの直前の問い合わせ時刻と、直列にするための待ち行列（プロセス全体で共有） */
const lastRequestAtByHost = new Map<string, number>();
const queueByHost = new Map<string, Promise<unknown>>();
/** ホストごとの実際の問い合わせ回数（再試行を含む。プロセス全体で共有。ログ用、2026-09-26） */
const requestCountByHost = new Map<string, number>();

/** このプロセスで行った問い合わせ回数（再試行を含む）。ホストごとと合計 */
export function requestCounts(): { total: number; byHost: Record<string, number> } {
  const byHost = Object.fromEntries(requestCountByHost);
  return { total: Object.values(byHost).reduce((a, b) => a + b, 0), byHost };
}

/** ログに出す1行（例:「問い合わせ 4回（www.bleague.jp 4回）」） */
export function formatRequestCounts(): string {
  const { total, byHost } = requestCounts();
  const parts = Object.entries(byHost).map(([host, n]) => `${host} ${n}回`);
  return `問い合わせ ${total}回${parts.length > 0 ? `（${parts.join("・")}）` : ""}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForSlot(host: string, minIntervalMs: number): Promise<void> {
  const wait = minIntervalMs - (Date.now() - (lastRequestAtByHost.get(host) ?? 0));
  if (wait > 0) await sleep(wait);
  lastRequestAtByHost.set(host, Date.now());
}

export function createThrottledFetch(minIntervalMs: number, userAgent: string, options: ThrottledFetchOptions = {}) {
  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const retry = options.retryOnTransientError ?? true;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const once = async (url: string, host: string): Promise<Response> => {
    await waitForSlot(host, minIntervalMs);
    requestCountByHost.set(host, (requestCountByHost.get(host) ?? 0) + 1);
    return fetch(url, {
      headers: { "User-Agent": userAgent },
      ...(timeoutMs !== null ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  };

  const run = async (url: string, host: string): Promise<Response> => {
    let res: Response;
    try {
      res = await once(url, host);
    } catch (err) {
      if (!retry) throw err;
      console.warn(`[fetch] 通信に失敗したため${retryDelayMs / 1000}秒後に1回だけ再試行します: ${url}（${(err as Error).message}）`);
      await sleep(retryDelayMs);
      return once(url, host);
    }
    if (retry && res.status >= 500) {
      console.warn(`[fetch] ${res.status} が返ったため${retryDelayMs / 1000}秒後に1回だけ再試行します: ${url}`);
      await res.body?.cancel();
      await sleep(retryDelayMs);
      return once(url, host);
    }
    return res;
  };

  return async function throttledFetch(url: string): Promise<Response> {
    const host = new URL(url).host;
    // 同じホストへの問い合わせは、呼び出し元のモジュールをまたいでも1本ずつ順番に行う
    const previous = queueByHost.get(host) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(() => run(url, host));
    queueByHost.set(host, current.catch(() => undefined));
    return current;
  };
}
