import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';
import 'react-native-url-polyfill/auto';

import type { Database } from '@/lib/database.types';
import { resilientFetch } from '@/lib/resilientFetch';

/**
 * Supabase client.
 *
 * Only the *publishable* key belongs here — it is compiled into the app bundle
 * and is safe precisely because every table is behind row level security. The
 * secret key must never appear anywhere under `src/`; it lives in Edge Function
 * secrets on the server.
 *
 * When the environment is not configured the app falls back to the local seed
 * store, so `npm start` works on a fresh clone with no backend at all.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

/** True once both env vars point at a real project. */
export const hasSupabase = !!url && !!publishableKey && !url.includes('YOUR-PROJECT-REF');

/** Base URL, for the reachability probe in `data/sync.ts`. */
export const supabaseUrl = url ?? '';

function build(): SupabaseClient<Database> {
  const client = createClient<Database>(url!, publishableKey!, {
    global: {
      // Every call the SDK makes — REST, Auth, Storage, Functions — goes
      // through a fetch with a deadline and a retry, because on a Turkmen
      // connection the usual failure is a request that stalls rather than one
      // that is refused. See `resilientFetch` for which requests may be
      // repeated and why the rest may not.
      fetch: resilientFetch,
    },
    auth: {
      // On web the SDK uses localStorage and reads the OAuth code out of the
      // URL; on native it needs an explicit store and must not touch `window`.
      storage: Platform.OS === 'web' ? undefined : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
      // Not the default. Without this the OAuth callback comes back as an
      // implicit-flow fragment (`#access_token=…`) and `exchangeCodeForSession`
      // finds no `?code=` to exchange. PKCE is also the correct choice for a
      // mobile client, which cannot keep a client secret.
      flowType: 'pkce',
    },
  });

  // Refresh tokens only tick while the app is in front. Without this a session
  // can expire in the background and the next query fails with a 401.
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (state) => {
      if (state === 'active') client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    });
  }

  return client;
}

/**
 * Throws with a useful message rather than `undefined is not an object` if
 * something reaches for the client before the project is configured.
 */
const unconfigured = new Proxy({} as SupabaseClient<Database>, {
  get() {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env, fill in ' +
        'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, ' +
        'then restart the dev server.',
    );
  },
});

export const supabase: SupabaseClient<Database> = hasSupabase ? build() : unconfigured;
