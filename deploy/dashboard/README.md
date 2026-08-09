# Paste-ready function builds

For deploying from the Supabase dashboard when the CLI is not to hand.

**These are generated copies, not the source.** The real functions live in
`supabase/functions/`. Editing anything here changes nothing — regenerate after
touching the originals, or the dashboard gets yesterday's code.

| File | Source |
| --- | --- |
| `send-message.single-file.ts` | `supabase/functions/send-message/index.ts`, unchanged — it has no local imports |
| `inbound-email.single-file.ts` | `supabase/functions/inbound-email/index.ts` with `_shared/fcm.ts` inlined |
| `send-grades.single-file.ts` | `supabase/functions/send-grades/index.ts`, unchanged |

`inbound-email` imports `../_shared/fcm.ts`, which reaches into a sibling folder
— not something a one-file editor can express. Hence the inlined copy.

## Regenerating

```bash
cp supabase/functions/send-message/index.ts deploy/dashboard/send-message.single-file.ts
cp supabase/functions/send-grades/index.ts  deploy/dashboard/send-grades.single-file.ts
```

For `inbound-email`, paste the body of `_shared/fcm.ts` (minus its imports)
above the `const json = …` line and delete the `import { sendPush }` line.

## Verify JWT — get this right or things break silently

| Function | Verify JWT | Why |
| --- | --- | --- |
| `send-message` | **on** | Called by the app with the teacher's token. Off leaves it callable by anyone with the URL. |
| `send-grades` | **on** | Called by the app with the teacher's token, same as `send-message`. |
| `inbound-email` | **off** | Called by Resend, which has no Supabase token. It proves itself with a Svix signature checked inside the function. On answers every webhook 401 and replies stop arriving, with nothing in the app to say so. |

The CLI reads these from `supabase/config.toml`. The dashboard does not — set
them by hand each time you deploy there.
