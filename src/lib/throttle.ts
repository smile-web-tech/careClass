/**
 * Attempt throttling for the password screen.
 *
 * What this is for, stated plainly: it slows down someone sitting with the
 * phone in their hand, trying passwords. It is **not** the control that stops a
 * remote attacker — they would skip the app and post straight to the auth
 * endpoint, where Supabase's own per-IP rate limits apply. Nothing running on
 * the device can defend an API the device does not own.
 *
 * Two limits, because either alone is trivially escaped:
 *
 *  - per address, so guessing one account cannot be reset by trying another;
 *  - per device, so cycling through addresses does not buy unlimited attempts.
 *
 * State lives in AsyncStorage rather than the zustand store: it has to outlive
 * a sign-out, and the store is cleared on one. It does not survive clearing the
 * app's data, and a device clock moved forward will expire a lockout early —
 * both are accepted. This is a speed bump on a local attack, and a speed bump
 * that costs an attacker minutes per guess has already done its job.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThrottleState = {
  /** True while attempts are refused. */
  blocked: boolean;
  /** Milliseconds until the next attempt is allowed. Zero when not blocked. */
  msLeft: number;
  /** Consecutive failures recorded so far. */
  fails: number;
};

const FREE = { blocked: false, msLeft: 0, fails: 0 } as const;

/**
 * Lockout after each consecutive failure, indexed by failure count.
 *
 * The first three are free: a mistyped password is the overwhelmingly common
 * case, and a teacher locked out for fat-fingering their own login would go
 * looking for a different app. The escalation past that is steep enough that
 * an exhaustive guess is not worth attempting by hand.
 */
const LADDER = [0, 0, 0, 15_000, 60_000, 300_000, 900_000, 1_800_000];

const key = (scope: string) => `classcare.throttle.${scope}`;

/** Normalised so `A@B.com` and `a@b.com ` share one counter. */
const addressScope = (email: string) => `password:${email.trim().toLowerCase()}`;
const DEVICE_SCOPE = 'password:device';

async function read(scope: string): Promise<{ fails: number; until: number }> {
  try {
    const raw = await AsyncStorage.getItem(key(scope));
    if (!raw) return { fails: 0, until: 0 };
    const parsed = JSON.parse(raw) as { fails?: number; until?: number };
    return { fails: parsed.fails ?? 0, until: parsed.until ?? 0 };
  } catch {
    // Unreadable state must never lock a teacher out of their own account.
    return { fails: 0, until: 0 };
  }
}

async function write(scope: string, value: { fails: number; until: number }) {
  try {
    await AsyncStorage.setItem(key(scope), JSON.stringify(value));
  } catch {
    // Storage full or unavailable. Failing open is correct: the alternative is
    // an app that cannot sign anyone in.
  }
}

function toState({ fails, until }: { fails: number; until: number }): ThrottleState {
  const msLeft = Math.max(0, until - Date.now());
  return { blocked: msLeft > 0, msLeft, fails };
}

/** The stricter of the two limits — whichever has longer left to run. */
function stricter(a: ThrottleState, b: ThrottleState): ThrottleState {
  return b.msLeft > a.msLeft ? b : a;
}

/** Whether a sign-in may be attempted right now, and if not, for how long. */
export async function loginGate(email: string): Promise<ThrottleState> {
  const [byAddress, byDevice] = await Promise.all([read(addressScope(email)), read(DEVICE_SCOPE)]);
  return stricter(toState(byAddress), toState(byDevice));
}

/**
 * Record a rejected password and return the resulting lockout.
 *
 * Only call this for a genuinely wrong credential. A network failure is not
 * evidence of an attack, and counting one would lock a teacher out of their
 * account precisely when their connection is already failing them.
 */
export async function recordLoginFailure(email: string): Promise<ThrottleState> {
  const scopes = [addressScope(email), DEVICE_SCOPE];

  const next = await Promise.all(
    scopes.map(async (scope) => {
      const { fails } = await read(scope);
      const count = fails + 1;
      const wait = LADDER[Math.min(count, LADDER.length - 1)];
      const value = { fails: count, until: wait ? Date.now() + wait : 0 };
      await write(scope, value);
      return toState(value);
    }),
  );

  return next.reduce(stricter, FREE);
}

/** Forget the failures for this address and this device. Call on success. */
export async function clearLoginFailures(email: string): Promise<void> {
  await AsyncStorage.multiRemove([key(addressScope(email)), key(DEVICE_SCOPE)]).catch(() => {});
}

/** `45s`, or `2:30` once the wait passes a minute. Reads the same in any language. */
export function formatWait(ms: number): string {
  const total = Math.ceil(ms / 1000);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
