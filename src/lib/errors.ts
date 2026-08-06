/**
 * Turning whatever went wrong into something a teacher can act on.
 *
 * The raw material here is unpleasant: `TypeError: Network request failed`,
 * `JWT expired`, PostgREST codes like `23505`, and Supabase's
 * `FunctionsHttpError`, whose message is the same sentence no matter what the
 * function actually said. None of that belongs in front of someone trying to
 * tell a class their lesson moved.
 *
 * Every message here follows two rules: name what happened in one line, and say
 * what to do about it. Nothing is phrased as the teacher's fault when it isn't.
 */

export type ErrorKind =
  | 'offline'
  | 'auth'
  | 'permission'
  | 'notFound'
  | 'conflict'
  | 'server'
  | 'unknown';

export type AppError = {
  kind: ErrorKind;
  title: string;
  message: string;
  /** Whether trying the same thing again could plausibly work. */
  retryable: boolean;
  /** The original text, for logs — never shown as the primary message. */
  detail?: string;
};

const textOf = (e: unknown): string => {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e ?? '');
};

/**
 * Did this fail because the device could not reach the server?
 *
 * React Native throws `TypeError: Network request failed` for a dead
 * connection, and supabase-js wraps the same condition in its own classes. This
 * app is reached through a PHP reverse proxy on shared hosting, so "the proxy is
 * down" and "the phone has no signal" arrive here identically — and that is
 * fine, because the teacher's next move is the same either way.
 */
export function isOfflineError(e: unknown): boolean {
  const name = e instanceof Error ? e.name : '';
  if (name === 'AuthRetryableFetchError' || name === 'FunctionsFetchError') return true;
  if (e instanceof TypeError) return true;

  const text = textOf(e).toLowerCase();
  return (
    text.includes('network request failed') ||
    text.includes('failed to fetch') ||
    text.includes('network error') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('unable to resolve host') ||
    text.includes('connection refused')
  );
}

const codeOf = (e: unknown): string =>
  e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';

const statusOf = (e: unknown): number | null => {
  if (e && typeof e === 'object' && 'status' in e) {
    const n = Number((e as { status: unknown }).status);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

export function describeError(e: unknown): AppError {
  const detail = textOf(e);
  const text = detail.toLowerCase();
  const code = codeOf(e);
  const status = statusOf(e);

  if (isOfflineError(e)) {
    return {
      kind: 'offline',
      title: 'No connection',
      message: 'Check your internet and try again.',
      retryable: true,
      detail,
    };
  }

  if (
    status === 401 ||
    text.includes('jwt expired') ||
    text.includes('invalid refresh token') ||
    text.includes('not signed in')
  ) {
    return {
      kind: 'auth',
      title: 'Signed out',
      message: 'Your session expired. Sign in again to continue.',
      retryable: false,
      detail,
    };
  }

  if (status === 403 || code === '42501' || text.includes('row level security')) {
    return {
      kind: 'permission',
      title: 'Not allowed',
      message: 'This account cannot make that change.',
      retryable: false,
      detail,
    };
  }

  if (status === 404 || text.includes('not found')) {
    return {
      kind: 'notFound',
      title: 'Not found',
      message: 'That item no longer exists. Refresh and try again.',
      retryable: false,
      detail,
    };
  }

  if (code === '23505' || text.includes('duplicate key')) {
    return {
      kind: 'conflict',
      title: 'Already exists',
      message: 'Something with those details is already saved.',
      retryable: false,
      detail,
    };
  }

  // A foreign key breaks in both directions and the code alone does not say
  // which, so the wording must be true either way. "Something else depends on
  // this" reads as a delete problem and is actively misleading on an insert,
  // where it means the row being pointed *at* is missing.
  if (code === '23503' || text.includes('violates foreign key')) {
    return {
      kind: 'conflict',
      title: 'Could not save',
      message: 'Something it links to is missing. Sign out, sign back in, then try again.',
      retryable: false,
      detail,
    };
  }

  if (status !== null && status >= 500) {
    return {
      kind: 'server',
      title: 'Server problem',
      message: 'The server had trouble with that. Try again in a moment.',
      retryable: true,
      detail,
    };
  }

  // A message the server wrote for a human — the send-message function's
  // "None of the 11 selected recipients have an email address on file", for
  // instance — is better than anything this function could invent. The test is
  // crude but effective: real sentences, no stack-trace punctuation.
  const looksHuman =
    detail.length > 0 && detail.length < 400 && / /.test(detail) && !/[{}<>]|\bat \w+\./.test(detail);

  return {
    kind: 'unknown',
    title: 'Something went wrong',
    message: looksHuman ? detail : 'Please try again. If it keeps happening, restart the app.',
    retryable: true,
    detail,
  };
}
