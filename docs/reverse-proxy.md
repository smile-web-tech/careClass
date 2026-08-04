# Reaching Supabase from Turkmenistan

`*.supabase.co` is not reachable from Turkmen networks. Supabase itself sits
behind Cloudflare (`104.18.x` / `172.64.x`), and Cloudflare as a whole plainly
is reachable — so the block is on the hostname, not the address. Serving the
same backend under a different hostname, from an IP that already works, is
enough.

## Shape

```
app  ──►  api.smiletech.dev        (Hostinger, reachable)
             │  nginx reverse proxy
             ▼
          epemnrnptzqarfsyvcxs.supabase.co
```

Only `EXPO_PUBLIC_SUPABASE_URL` changes in the app. Everything else — REST,
Realtime, Storage, Edge Functions, email OTP — flows through unchanged.

## The one thing a proxy cannot fix

Browser-based OAuth. `/auth/v1/authorize` sends Google a
`redirect_uri` of `https://<ref>.supabase.co/auth/v1/callback`, built from the
project's own external URL. A proxy cannot rewrite it; only Supabase's paid
Custom Domain add-on changes it. Google would authenticate and then redirect the
browser to a blocked host.

So Google sign-in must use the **native ID-token flow** instead: the Google SDK
returns an ID token on-device, and that token is posted to Supabase through the
proxy. No browser hop to `supabase.co` at all. Apple sign-in already works this
way.

## Shared hosting (no VPS): PHP

Hostinger shared hosting gives no nginx config and no long-lived sockets, so the
proxy is `deploy/php-proxy/` — `index.php` plus `.htaccess`, dropped into the
docroot of `api.smiletech.dev`.

It carries REST, Auth, Storage and Edge Functions. It cannot carry Realtime;
`subscribeToInbox` detects a non-`supabase.co` host and polls every 30s while
the app is foregrounded instead.

Two details that decide whether it works at all:

- **Upstream is hardcoded.** Taking it from a header or query parameter would
  make this an open proxy on your hosting account.
- **`.htaccess` re-injects `Authorization`.** Apache strips that header before
  PHP sees it under CGI/FastCGI, and every authenticated request would reach
  Supabase unauthenticated and come back 401.

## nginx (VPS alternative)

```nginx
# /etc/nginx/sites-available/api.smiletech.dev
upstream supabase {
    server epemnrnptzqarfsyvcxs.supabase.co:443;
    keepalive 32;
}

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.smiletech.dev;

    ssl_certificate     /etc/letsencrypt/live/api.smiletech.dev/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.smiletech.dev/privkey.pem;

    # Supabase routes by Host, and terminates TLS by SNI. Both must carry the
    # UPSTREAM name, not ours — get either wrong and every request 404s or the
    # handshake fails.
    proxy_set_header Host              epemnrnptzqarfsyvcxs.supabase.co;
    proxy_ssl_name                     epemnrnptzqarfsyvcxs.supabase.co;
    proxy_ssl_server_name              on;

    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # `apikey` and `Authorization` pass through untouched by default. Do not
    # add proxy_set_header for them — that would strip the client's own values.

    client_max_body_size 50m;

    location / {
        proxy_pass https://supabase;
        proxy_http_version 1.1;

        # Realtime is a WebSocket. Without these the inbox subscription
        # silently never connects and replies stop appearing.
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Long-lived sockets: default 60s would drop Realtime every minute.
        proxy_read_timeout  3600s;
        proxy_send_timeout  3600s;

        proxy_buffering off;
    }
}

server {
    listen 80;
    listen [::]:80;
    server_name api.smiletech.dev;
    return 301 https://$host$request_uri;
}
```

## Setup

```bash
# DNS: A record  api.smiletech.dev -> <hostinger ip>   (managed at Vercel today)

sudo apt install nginx certbot python3-certbot-nginx
sudo certbot --nginx -d api.smiletech.dev

sudo ln -s /etc/nginx/sites-available/api.smiletech.dev /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## Verify

```bash
# Should return the same JSON as the direct host.
curl -s https://api.smiletech.dev/auth/v1/settings -H "apikey: $PUBLISHABLE_KEY" | head -c 200

# WebSocket upgrade must answer 101, not 200 or 400.
curl -s -i -N -o /dev/null -w '%{http_code}\n' \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://api.smiletech.dev/realtime/v1/websocket?apikey=$PUBLISHABLE_KEY&vsn=1.0.0"
```

## App change

```
EXPO_PUBLIC_SUPABASE_URL=https://api.smiletech.dev
```

Rebuild is not required for this — it is read at bundle time by Metro.

## Operational notes

- The proxy is now a single point of failure and carries every byte of user
  data. Keep it patched, and keep TLS on both hops (nginx→Supabase is HTTPS
  above, not plaintext).
- Hostinger shared plans often forbid long-lived WebSocket connections; a VPS
  is the safer choice for Realtime.
- Rate limiting belongs here too, since the proxy is now the front door.

## Native Google sign-in

The browser flow cannot survive the proxy (see above), so Google uses
`@react-native-google-signin`. Two non-obvious pieces:

- **`google-services.json` is NOT needed.** That file is a Firebase artifact;
  auth here is Supabase. The library identifies the app by package name +
  signing SHA-1 registered in Google Cloud, and validates the token against
  `webClientId`.

- **The config plugin is deliberately not in `app.json`.** Passed no options it
  takes its Firebase branch and requires `google-services.json`; passed
  `iosUrlScheme` it only registers an iOS URL scheme. Android needs neither —
  autolinking picks up the native module. Add it back when building for iOS:

  ```json
  ["@react-native-google-signin/google-signin",
   { "iosUrlScheme": "com.googleusercontent.apps.<reversed iOS client id>" }]
  ```

Google Cloud must contain an **Android** OAuth client for package
`com.smiletechweb.classcare` with the release SHA-1, or the native call fails
with `DEVELOPER_ERROR`. Its client id is never referenced in code.
