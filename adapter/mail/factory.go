//go:build js && wasm

package mail

import (
	"fmt"

	"github.com/pocketbase/pocketbase/tools/mailer"
)

// NewHTTPMailer returns a mailer.Mailer for the named HTTP mail provider.
//
// Supported providers:
//   - "resend"    — api.resend.com
//   - "postmark"  — api.postmarkapp.com
//   - "sendgrid"  — api.sendgrid.com
//   - "mailgun"   — api.mailgun.net
//   - "webhook"   — generic JSON webhook (uses url and token)
func NewHTTPMailer(name, apiKey, domain, webhookURL, webhookToken string) (mailer.Mailer, error) {
	switch name {
	case "resend":
		return &resendProvider{apiKey: apiKey}, nil
	case "postmark":
		return &postmarkProvider{apiKey: apiKey}, nil
	case "sendgrid":
		return &sendGridProvider{apiKey: apiKey}, nil
	case "mailgun":
		if domain == "" {
			return nil, fmt.Errorf("mail: mailgun requires a domain")
		}
		return &mailgunProvider{apiKey: apiKey, domain: domain}, nil
	case "webhook":
		return &WebhookClient{URL: webhookURL, Token: webhookToken}, nil
	default:
		return nil, fmt.Errorf("mail: unknown provider %q", name)
	}
}
