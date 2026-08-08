<?php
/**
 * ClassCare — Supabase reverse proxy for shared hosting.
 *
 * `*.supabase.co` is unreachable from Turkmen networks. Supabase sits behind
 * Cloudflare, which plainly is reachable, so the block is on the hostname
 * rather than the address: re-serving the same backend under a hostname that
 * resolves to this server is enough.
 *
 * Shared hosting means no nginx config and no long-lived sockets, so this is
 * PHP + cURL. That covers REST, Auth, Storage and Edge Functions — everything
 * the app does over HTTP. It CANNOT carry Realtime (WebSockets); see
 * `subscribeToInbox` in the app, which polls when Realtime is unavailable.
 *
 * Deploy: this file + .htaccess into the docroot of api.smiletech.dev
 */

declare(strict_types=1);

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Hardcoded on purpose. If the upstream were taken from a header or a query
 * parameter this would be an open proxy — anyone on the internet could route
 * arbitrary traffic through this domain and through your hosting account.
 */
const UPSTREAM = 'https://epemnrnptzqarfsyvcxs.supabase.co';

/**
 * Only the Supabase API surfaces the app actually uses. A path outside this
 * list is refused rather than forwarded, which keeps the blast radius small if
 * someone probes the host.
 */
const ALLOWED_PREFIXES = ['/auth/v1', '/rest/v1', '/storage/v1', '/functions/v1', '/realtime/v1'];

/** Hop-by-hop headers must not be relayed in either direction (RFC 7230 §6.1). */
const HOP_BY_HOP = [
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade',
];

/* -------------------------------------------------------------------------- */
/* Request                                                                    */
/* -------------------------------------------------------------------------- */

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$uri    = $_SERVER['REQUEST_URI'] ?? '/';

// Split off the query string; rebuild it verbatim so filters like
// `?select=*&id=eq.123` survive untouched.
$parts = explode('?', $uri, 2);
$path  = $parts[0];
$query = $parts[1] ?? '';

// Strip a subdirectory prefix if this is not deployed at the docroot.
$base = rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/');
if ($base !== '' && str_starts_with($path, $base)) {
    $path = substr($path, strlen($base));
}
if ($path === '') {
    $path = '/';
}

// The browser preflight never reaches upstream; answer it here.
if ($method === 'OPTIONS') {
    send_cors();
    header('Access-Control-Max-Age: 86400');
    http_response_code(204);
    exit;
}

if ($path === '/' || $path === '/health') {
    send_cors();
    header('Content-Type: application/json');
    echo json_encode(['ok' => true, 'proxy' => 'classcare', 'realtime' => false]);
    exit;
}

$allowed = false;
foreach (ALLOWED_PREFIXES as $prefix) {
    if (str_starts_with($path, $prefix)) {
        $allowed = true;
        break;
    }
}
if (!$allowed) {
    send_cors();
    header('Content-Type: application/json');
    http_response_code(404);
    echo json_encode(['error' => 'Not a proxied path']);
    exit;
}

// Realtime is a WebSocket upgrade. PHP on shared hosting cannot hold that
// socket open, so say so honestly instead of hanging until the client times
// out and retries forever.
if (str_starts_with($path, '/realtime/v1')) {
    send_cors();
    header('Content-Type: application/json');
    http_response_code(501);
    echo json_encode([
        'error'  => 'Realtime is not available through this proxy',
        'detail' => 'WebSockets need a VPS or a Cloudflare Worker. The app polls instead.',
    ]);
    exit;
}

/* -------------------------------------------------------------------------- */
/* Forward                                                                    */
/* -------------------------------------------------------------------------- */

$target = UPSTREAM . $path . ($query !== '' ? '?' . $query : '');
$body   = file_get_contents('php://input');

$forward = [];
foreach (request_headers() as $name => $value) {
    $lower = strtolower($name);
    if (in_array($lower, HOP_BY_HOP, true)) {
        continue;
    }
    // Host must name the UPSTREAM: Supabase routes by it, and cURL sets it
    // from the target URL. Relaying ours would 404 every request.
    if ($lower === 'host' || $lower === 'content-length') {
        continue;
    }
    // `apikey` and `authorization` are relayed untouched — they are the
    // caller's own credentials and this proxy has no business rewriting them.
    $forward[] = $name . ': ' . $value;
}

// cURL adds `Expect: 100-continue` to larger bodies on its own, then waits a
// full second for a response most servers never send. On an upload that is a
// second of dead time for nothing.
$forward[] = 'Expect:';

/**
 * Some requests are legitimately slow, and 30 seconds calls them dead.
 *
 * Two kinds:
 *
 *   Storage writes  — megabytes going up. Measured at ~5s for 6 MB from a
 *                     decent connection, but a phone on mobile data is a
 *                     different story.
 *   Edge Functions  — `send-message` renders and posts one email per
 *                     recipient, and when the message carries an attachment
 *                     Resend fetches that file for *each* of them. A class of
 *                     twenty is comfortably past thirty seconds, and the proxy
 *                     hanging up mid-flight is what surfaced to the teacher as
 *                     "Upstream unreachable" — while the emails were in fact
 *                     still going out.
 *
 * Everything else keeps the short timeout, so a genuinely sick upstream still
 * fails fast rather than leaving the app spinning.
 */
$isSlow = (str_starts_with($path, '/storage/v1')
        && in_array($method, ['POST', 'PUT', 'PATCH'], true))
    || str_starts_with($path, '/functions/v1');

// Belt and braces. Time spent waiting on a socket does not count towards
// max_execution_time on Linux, but shared hosts vary and being killed
// mid-upload would look exactly like the timeout we just raised.
if ($isSlow) {
    @set_time_limit(360);
}

$ch = curl_init($target);
curl_setopt_array($ch, [
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $forward,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => false,
    // Supabase answers auth redirects itself; following them here would hide
    // the Location header the client needs.
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_ENCODING       => '',
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT        => $isSlow ? 300 : 30,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
]);

if ($body !== '' && $body !== false) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$responseHeaders = [];
curl_setopt($ch, CURLOPT_HEADERFUNCTION, function ($_ch, string $line) use (&$responseHeaders) {
    $len = strlen($line);
    $trimmed = trim($line);
    if ($trimmed !== '' && str_contains($trimmed, ':')) {
        [$name, $value] = explode(':', $trimmed, 2);
        $lower = strtolower(trim($name));
        // Drop hop-by-hop and anything describing an encoding cURL already
        // undid for us — re-sending those corrupts the response.
        if (!in_array($lower, HOP_BY_HOP, true)
            && $lower !== 'content-encoding'
            && $lower !== 'content-length') {
            $responseHeaders[] = trim($name) . ': ' . trim($value);
        }
    }
    return $len;
});

$result  = curl_exec($ch);
$status  = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$error   = curl_error($ch);
$errno   = curl_errno($ch);
$elapsed = (float) curl_getinfo($ch, CURLINFO_TOTAL_TIME);
curl_close($ch);

if ($result === false) {
    send_cors();
    header('Content-Type: application/json');
    http_response_code(502);
    // The reason goes in `error`, not only in `detail`. Clients surface the
    // message and drop the rest, so "Upstream unreachable" was all anyone ever
    // saw — a sentence that names no cause and sent us round three wrong
    // theories. `curl_errno` is included because the text is localised on some
    // builds but the number never is.
    $reason = $error !== '' ? $error : 'no response from upstream';
    echo json_encode([
        'error'  => 'Upstream unreachable (' . $errno . '): ' . $reason,
        'detail' => $reason,
        'errno'  => $errno,
        'path'   => $path,
        'seconds' => round($elapsed, 1),
    ]);
    exit;
}

http_response_code($status);
foreach ($responseHeaders as $header) {
    header($header, false);
}
send_cors();
echo $result;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Incoming headers, whichever SAPI this is running under. */
function request_headers(): array
{
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        if (is_array($headers)) {
            return $headers;
        }
    }
    $out = [];
    foreach ($_SERVER as $key => $value) {
        if (str_starts_with($key, 'HTTP_')) {
            $name = str_replace(' ', '-', ucwords(strtolower(str_replace('_', ' ', substr($key, 5)))));
            $out[$name] = $value;
        }
    }
    foreach (['CONTENT_TYPE' => 'Content-Type', 'CONTENT_LENGTH' => 'Content-Length'] as $k => $name) {
        if (!empty($_SERVER[$k])) {
            $out[$name] = $_SERVER[$k];
        }
    }
    return $out;
}

/**
 * The native app does not need CORS, but the web build does. `*` is acceptable
 * here only because every protected route still requires the caller's own JWT —
 * the proxy grants no authority of its own.
 */
function send_cors(): void
{
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, range');
    header('Access-Control-Expose-Headers: content-range, x-supabase-api-version');
}
