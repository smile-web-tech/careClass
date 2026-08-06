// Firebase Cloud Messaging, HTTP v1.
//
// The legacy `/fcm/send` endpoint took a static server key in a header and was
// shut down in 2024. v1 wants a short-lived OAuth token, which means signing a
// JWT with the service account's private key and exchanging it. That is the
// whole of the complexity below.
//
// Not `exp.host`: Expo's push service is one more host that has to be reachable
// from the teacher's network, and this app already reaches Supabase through a
// reverse proxy because `*.supabase.co` is blocked in Turkmenistan. Talking to
// Google directly removes a dependency that could be filtered the same way, and
// the device token already comes from Play Services rather than Expo.
//
// Secret: supabase secrets set FCM_SERVICE_ACCOUNT="$(cat service-account.json)"

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

/** Cached across invocations of a warm instance; Google issues these for an hour. */
let cachedToken: { value: string; expires: number } | null = null;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

function serviceAccount(): ServiceAccount | null {
  const raw = Deno.env.get('FCM_SERVICE_ACCOUNT');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    console.warn('[classcare] FCM_SERVICE_ACCOUNT is not valid JSON');
    return null;
  }
}

/** PEM to the raw PKCS#8 bytes `crypto.subtle` wants. */
function pemToBytes(pem: string) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    // The JSON form carries literal `\n`; a pasted one carries real newlines.
    .replace(/\\n/g, '')
    .replace(/\s/g, '');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

/** Sign the assertion and trade it for an access token. */
async function accessToken(account: ServiceAccount): Promise<string> {
  if (cachedToken && cachedToken.expires > Date.now()) return cachedToken.value;

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64urlText(
    JSON.stringify(claims),
  )}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(new Uint8Array(signature))}`,
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(body?.error_description ?? `FCM auth failed: ${res.status}`);
  }

  // Refresh a minute early rather than racing the expiry.
  cachedToken = { value: body.access_token, expires: Date.now() + (body.expires_in - 60) * 1000 };
  return cachedToken.value;
}

export type PushResult = { sent: number; stale: string[] };

/**
 * Send one notification to one device.
 *
 * Returns the token if FCM says it is dead, so the caller can clear it. A token
 * outlives an app reinstall in the database but not on the device, and pushing
 * to a stale one forever is how a `teachers` row ends up permanently unable to
 * receive anything.
 */
export async function sendPush(opts: {
  token: string;
  title: string;
  body: string;
  /** Delivered to the app so tapping the notification can open the right screen. */
  data?: Record<string, string>;
}): Promise<PushResult> {
  const account = serviceAccount();
  if (!account || !opts.token) return { sent: 0, stale: [] };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${await accessToken(account)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: opts.token,
          notification: { title: opts.title, body: opts.body },
          data: opts.data ?? {},
          android: {
            priority: 'high',
            notification: {
              // Matches the channel `lib/notifications.ts` creates; without it
              // Android 8+ drops the notification silently.
              channel_id: 'replies',
              sound: 'default',
            },
          },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
    },
  );

  if (res.ok) return { sent: 1, stale: [] };

  const body = await res.json().catch(() => ({}));
  const status = body?.error?.details?.[0]?.errorCode ?? body?.error?.status;

  // UNREGISTERED: the app was uninstalled or the token rotated.
  // INVALID_ARGUMENT on a token we sent: it was never valid.
  if (res.status === 404 || status === 'UNREGISTERED' || status === 'INVALID_ARGUMENT') {
    return { sent: 0, stale: [opts.token] };
  }

  throw new Error(body?.error?.message ?? `FCM send failed: ${res.status}`);
}
