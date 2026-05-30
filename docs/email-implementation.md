# Email Implementation

## Current State (updated 2026-05-30)

All three transport modes are implemented in `adapter/mail/`:

1. **HTTP providers** — Resend, Postmark, SendGrid, Mailgun (`POCKETFLARE_MAIL_PROVIDER` + `POCKETFLARE_MAIL_API_KEY`).
2. **Generic webhook** — legacy path (`POCKETFLARE_MAIL_WEBHOOK_URL`).
3. **SMTP** — `cloudflare:sockets` via `smtp-transport.mjs`, supporting implicit TLS (465) and STARTTLS (587). Reads PocketBase admin SMTP settings at send time so admin UI changes take effect without re-deploy.

See `adapter/mail/payload.go` for the shared JSON payload format used by webhook and HTTP providers.

## Original Design Doc

The sections below describe the original design and provider-specific API shapes.

- `POCKETFLARE_MAIL_WEBHOOK_URL`: required to enable the webhook mailer.
- `POCKETFLARE_MAIL_WEBHOOK_TOKEN`: optional bearer token.
- Implementation: `adapter/webmailer`.
- Registration: `adapter.New` replaces `e.Mailer` in `OnMailerSend`.

Payload shape:

```json
{
  "from": {"name": "Support", "address": "support@example.com"},
  "to": [{"address": "user@example.com"}],
  "cc": [],
  "bcc": [],
  "subject": "Subject",
  "html": "<p>Hello</p>",
  "text": "Hello",
  "headers": [{"name": "X-Example", "value": "1"}],
  "attachments": [
    {
      "name": "file.txt",
      "contentType": "text/plain; charset=utf-8",
      "contentBase64": "..."
    }
  ],
  "inlineAttachments": []
}
```

Attachments are capped at 10 MiB each to avoid turning email into another Worker memory hazard.

## Why SMTP Needs Its Own Work

Cloudflare Workers support outbound TCP through JavaScript `cloudflare:sockets`, including TLS and StartTLS patterns needed by SMTP on ports 465 and 587. Workers prohibit outbound port 25.

PocketBase does not use that API. It uses Go `net/smtp` through `tools/mailer.SMTPClient`. In Go WASM on Workers, `net/smtp` does not automatically map to `cloudflare:sockets`. Changing the recommended SMTP port in settings will not fix delivery.

Treat SMTP-over-Workers-sockets as a separate implementation, not a docs tweak.

## Track 1: Production HTTP Mail Providers (IMPLEMENTED)

Supports: resend, postmark, sendgrid, mailgun, webhook. Factory in `adapter/mail/factory.go`.

Suggested first providers:
- Resend
- Postmark
- SendGrid
- Mailgun HTTP API

Design:
- Add `adapter/webmailer` provider modes, not ad hoc app hooks.
- Env vars:
  - `POCKETFLARE_MAIL_PROVIDER=resend|postmark|sendgrid|mailgun|webhook`
  - `POCKETFLARE_MAIL_API_KEY`
  - provider-specific non-secret defaults in `wrangler.toml` only when they are not credentials.
- Keep the current generic webhook mode as the fallback/escape hatch.
- Preserve PocketBase `OnMailerSend` customization. The adapter should only replace the final transport.
- Keep payload conversion in one shared internal representation.

Validation:
- Unit-test payload conversion with in-memory `mailer.Message`.
- Run `make build`.
- Use `wrangler dev` or a deploy target with a controlled webhook endpoint and send a password-reset email through the real PocketBase route.

## Track 2: SMTP Over Workers Sockets (IMPLEMENTED)

JS transport in `smtp-transport.mjs`, Go wrapper in `adapter/mail/smtp.go`. Connection reuse via RSET.

Constraints:
- Do not depend on Go `net/smtp` dialing.
- Do not open sockets in global scope.
- Support port 465 implicit TLS and port 587 StartTLS.
- Do not support port 25; fail with a clear configuration error.
- Honor PocketBase SMTP settings: host, port, username, password, TLS, auth method, local name.

Likely implementation:
1. Add a JavaScript mail transport module that imports `connect` from `cloudflare:sockets`.
2. Expose it to Go through the existing WASM binding context or a small `syscall/js` API.
3. Implement SMTP protocol commands directly or port a small JS SMTP client that works with Workers streams.
4. Add a Go `mailer.Mailer` wrapper that serializes `mailer.Message` and calls the JS SMTP transport.
5. Register that mailer in `adapter.New` when SMTP settings are enabled and no HTTP provider env is set.

Do not patch `net/smtp` or try to monkey-patch Go networking globally. That would be harder to reason about and could affect OAuth or other outbound HTTP paths.

Validation:
- Fake SMTP server for protocol tests outside Workers if possible.
- Worker-level proof against a test SMTP endpoint on 465 and 587.
- PocketBase password-reset route sends a real message.
- Port 25 returns a deterministic configuration error.

## Open Questions

- Should HTTP provider credentials live only in Worker secrets, or should a setup command write provider settings into D1 like PocketBase SMTP settings? Current recommendation: secrets for API keys, D1 for non-secret mail identity/settings.
- Should direct R2 file download redirects share the same signed-token design as email links? This affects URL generation and app URL settings.
- Should webhook delivery failures be retried through Queues? Current implementation returns the provider failure to PocketBase immediately.
