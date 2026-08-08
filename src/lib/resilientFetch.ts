/**
 * `fetch`, for a network that drops packets rather than connections.
 *
 * Teachers using ClassCare are in Turkmenistan, where a request does not
 * usually fail — it stalls. The socket opens, nothing comes back, and the
 * default `fetch` waits forever while the app shows a spinner; or a single lost
 * SYN surfaces as "Network request failed" and the teacher is told they have no
 * internet on a connection that works perfectly well two seconds later.
 *
 * Three things fix most of that, and none of them require the server's help:
 *
 *  1. **A deadline.** Every request gets one, sized to what it is doing.
 *  2. **Retries with backoff**, but only where repeating cannot do damage.
 *  3. **Honest failures.** When the deadline passes, the error says timeout,
 *     which `isOfflineError` already classifies as "keep the write and retry"
 *     rather than "this write is rejected".
 */

/** A plain GET has to be quick or it is not worth waiting for. */
const READ_TIMEOUT_MS = 20_000;

/**
 * Uploads and Edge Functions are legitimately slow: `send-message` posts one
 * email per recipient and Resend fetches each attachment for each of them, and
 * the PHP proxy allows 300s for exactly that. Cutting the client off first
 * would abandon work that is still going through.
 */
const SLOW_TIMEOUT_MS = 180_000;

/** How many times a request may be attempted in total. */
const MAX_ATTEMPTS = 3;

/** Backoff between attempts, with jitter so a whole class does not retry in step. */
const backoff = (attempt: number) => 400 * 2 ** (attempt - 1) + Math.random() * 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isSlowPath = (url: string) =>
  url.includes('/functions/v1') || url.includes('/storage/v1/object');

/**
 * Never send an auth write twice.
 *
 * A refresh token is single-use: the moment `/auth/v1/token` accepts one it
 * issues a new pair and marks the old one spent. If the reply is lost on the
 * way back and the request is repeated, the second attempt presents a token
 * the server has already consumed, gets "Invalid Refresh Token: Already Used",
 * and gotrue-js ends the session. On a connection that loses replies for a
 * living, a retry here is not resilience — it is the cause of the "session
 * expired" the teacher keeps seeing. Sign-in and sign-up are excluded for the
 * same reason: repeating them can send a second OTP or create a second row.
 */
const isAuthWrite = (url: string, method: string) => url.includes('/auth/v1') && method !== 'GET';

/**
 * Can this be sent again without changing what the server ends up holding?
 *
 * Reads always. Writes never — not because retrying is likely to duplicate
 * anything, but because it might, and a duplicated register or a message sent
 * twice to a parent is worse than one honest failure the outbox will retry
 * deliberately later.
 *
 * The exception is a request that never reached the server at all, which is
 * handled at the call site below: if the connection itself failed on the first
 * attempt, nothing was applied and sending it again is safe.
 */
const isRead = (method: string) => method === 'GET' || method === 'HEAD';

/** Statuses worth another go: the upstream is busy or briefly unreachable. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function resilientFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init.method ?? 'GET').toUpperCase();
  const timeout = isSlowPath(url) ? SLOW_TIMEOUT_MS : READ_TIMEOUT_MS;
  const neverRepeat = isAuthWrite(url, method);

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    /*
      One controller per attempt, and it must be chained to the caller's own
      signal rather than replacing it — supabase-js passes an AbortSignal for
      `.abortSignal()` queries, and swallowing it would leave a cancelled
      request running.
    */
    const controller = new AbortController();
    const caller = init.signal;
    const onAbort = () => controller.abort();
    caller?.addEventListener('abort', onAbort);

    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });

      // A retryable status, on something safe to repeat, with an attempt left.
      if (
        RETRYABLE_STATUS.has(response.status) &&
        isRead(method) &&
        !neverRepeat &&
        attempt < MAX_ATTEMPTS
      ) {
        await sleep(backoff(attempt));
        continue;
      }
      return response;
    } catch (e) {
      lastError = e;

      // The caller cancelled. Not our business to retry.
      if (caller?.aborted) throw e;

      const timedOut = controller.signal.aborted;

      /*
        Nothing came back. For a read that is always worth repeating. For a
        write it is worth repeating only on the first attempt and only when the
        request did not time out: a connection that failed outright never
        delivered anything, whereas a timeout may well mean the server is
        working on it right now and a second copy would be applied too.
      */
      const worthRetrying = !neverRepeat && (isRead(method) || (attempt === 1 && !timedOut));

      if (!worthRetrying || attempt === MAX_ATTEMPTS) {
        if (timedOut) {
          // Say "timed out" explicitly. `isOfflineError` looks for that word,
          // and an AbortError left as-is reads to the sync queue as a rejected
          // write — which would drop the teacher's change instead of keeping
          // it for the next attempt.
          throw new Error(`Request timed out after ${Math.round(timeout / 1000)}s`);
        }
        throw e;
      }

      await sleep(backoff(attempt));
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Request failed');
}
