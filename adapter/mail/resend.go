//go:build js && wasm

package mail

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"syscall/js"
	"time"

	"github.com/pocketbase/pocketbase/tools/mailer"
	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
)

var _ mailer.Mailer = (*resendProvider)(nil)

type resendProvider struct {
	apiKey string
}

// Resend API reference: https://resend.com/docs/api-reference/emails/send-email
type resendPayload struct {
	From        string            `json:"from"`
	To          []string          `json:"to"`
	Cc          []string          `json:"cc,omitempty"`
	Bcc         []string          `json:"bcc,omitempty"`
	Subject     string            `json:"subject"`
	HTML        string            `json:"html,omitempty"`
	Text        string            `json:"text,omitempty"`
	Headers     map[string]string `json:"headers,omitempty"`
	Attachments []resendAttachment `json:"attachments,omitempty"`
}

type resendAttachment struct {
	Filename    string `json:"filename"`
	Content     string `json:"content"`
	ContentType string `json:"content_type,omitempty"`
}

func (p *resendProvider) Send(message *mailer.Message) error {
	payload, err := NewPayload(message)
	if err != nil {
		return err
	}

	rp := resendPayload{
		From:    formatAddress(payload.From),
		To:      addressesToStrings(payload.To),
		Cc:      addressesToStrings(payload.Cc),
		Bcc:     addressesToStrings(payload.Bcc),
		Subject: payload.Subject,
		HTML:    payload.HTML,
		Text:    payload.Text,
		Headers: payloadHeadersToMap(payload.Headers),
	}
	for _, a := range payload.Attachments {
		rp.Attachments = append(rp.Attachments, resendAttachment{
			Filename:    a.Name,
			Content:     a.ContentBase64,
			ContentType: a.ContentType,
		})
	}
	for _, a := range payload.InlineAttachments {
		rp.Attachments = append(rp.Attachments, resendAttachment{
			Filename:    a.Name,
			Content:     a.ContentBase64,
			ContentType: a.ContentType,
		})
	}

	body, err := json.Marshal(rp)
	if err != nil {
		return fmt.Errorf("mail: resend marshal: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return p.post(ctx, body)
}

func (p *resendProvider) post(ctx context.Context, body []byte) error {
	headers := js.Global().Get("Headers").New()
	headers.Call("set", "Accept", "application/json")
	headers.Call("set", "Content-Type", "application/json")
	headers.Call("set", "Authorization", "Bearer "+p.apiKey)

	init := js.Global().Get("Object").New()
	init.Set("method", http.MethodPost)
	init.Set("headers", headers)
	init.Set("body", string(body))

	res, err := jsutil.AwaitPromise(ctx, js.Global().Call("fetch", "https://api.resend.com/emails", init))
	if err != nil {
		return fmt.Errorf("mail: resend post: %w", err)
	}

	status := res.Get("status").Int()
	if status < 200 || status >= 300 {
		text, _ := jsutil.AwaitPromise(ctx, res.Call("text"))
		detail := ""
		if !text.IsUndefined() && text.String() != "" {
			detail = ": " + truncate(text.String(), 512)
		}
		return fmt.Errorf("mail: resend returned HTTP %d%s", status, detail)
	}

	return nil
}

// Shared helpers used by multiple providers.

func formatAddress(a Address) string {
	if a.Name != "" {
		return a.Name + " <" + a.Address + ">"
	}
	return a.Address
}

func addressesToStrings(addrs []Address) []string {
	result := make([]string, len(addrs))
	for i, a := range addrs {
		result[i] = a.Address
	}
	return result
}

func payloadHeadersToMap(headers []Header) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	m := make(map[string]string, len(headers))
	for _, h := range headers {
		m[h.Name] = h.Value
	}
	return m
}

func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max]
	}
	return s
}
