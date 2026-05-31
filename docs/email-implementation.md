# Email Implementation

## Current State

Pocketflare does not use PocketBase's Go `net/smtp` transport in the Workers build. Go WASM cannot dial SMTP directly on Cloudflare Workers; outbound TCP is exposed through JavaScript `cloudflare:sockets`.

`adapter/mail/` provides three transport families:

1. HTTP providers: Resend, Postmark, SendGrid, and Mailgun.
2. Generic webhook: sends the normalized PocketBase message payload to an HTTPS endpoint.
3. SMTP through Workers sockets: JavaScript transport in `smtp-transport.mjs`, called from Go.

Provider selection priority:

1. `POCKETFLARE_MAIL_PROVIDER`
2. `POCKETFLARE_MAIL_WEBHOOK_URL`
3. PocketBase admin SMTP settings

Use HTTP providers or the webhook for production until SMTP sockets are proven against the target provider.

## HTTP Providers

Set:

```toml
[vars]
POCKETFLARE_MAIL_PROVIDER = "resend"
```

Then store the provider key as a Worker secret:

```sh
pnpm exec wrangler secret put POCKETFLARE_MAIL_API_KEY
```

Supported `POCKETFLARE_MAIL_PROVIDER` values:

- `resend`
- `postmark`
- `sendgrid`
- `mailgun`
- `webhook`
- `smtp`

Mailgun also needs:

```toml
[vars]
POCKETFLARE_MAIL_DOMAIN = "mg.example.com"
```

## Webhook

Use the webhook path when mail delivery stays behind a separate service.

```sh
pnpm exec wrangler secret put POCKETFLARE_MAIL_WEBHOOK_URL
pnpm exec wrangler secret put POCKETFLARE_MAIL_WEBHOOK_TOKEN
```

`POCKETFLARE_MAIL_WEBHOOK_TOKEN` is optional. When set, Pocketflare sends it as `Authorization: Bearer <token>`.

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

## SMTP

SMTP support is a Workers-sockets transport, not PocketBase's original `net/smtp` path.

Expected constraints:

- Port 465 uses implicit TLS.
- Port 587 requires STARTTLS.
- Port 25 is blocked by Cloudflare Workers and should fail with a clear configuration error.
- SMTP settings are read from PocketBase admin settings at send time when no HTTP provider or webhook is configured.

SMTP requires live-provider proof before production use, especially STARTTLS on port 587.

## Validation Needed

Minimum proof before promoting SMTP:

1. Send a real password-reset email through PocketBase on port 465.
2. Send a real password-reset email through PocketBase on port 587.
3. Confirm port 25 returns a deterministic configuration error.
4. Confirm admin SMTP setting changes take effect without redeploy.

Minimum proof before promoting a new HTTP provider:

1. Send a password-reset email through the real PocketBase route.
2. Verify provider error responses are returned to PocketBase instead of swallowed.
3. Verify attachments under the 10 MiB cap are delivered.
