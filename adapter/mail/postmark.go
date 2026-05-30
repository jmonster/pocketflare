//go:build js && wasm

package mail

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"syscall/js"
	"time"

	"github.com/pocketbase/pocketbase/tools/mailer"
	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
)

var _ mailer.Mailer = (*postmarkProvider)(nil)

type postmarkProvider struct {
	apiKey string
}

// Postmark API reference: https://postmarkapp.com/developer/api/email-api
type postmarkPayload struct {
	From       string             `json:"From"`
	To         string             `json:"To"`
	Cc         string             `json:"Cc,omitempty"`
	Bcc        string             `json:"Bcc,omitempty"`
	Subject    string             `json:"Subject"`
	HTMLBody   string             `json:"HtmlBody,omitempty"`
	TextBody   string             `json:"TextBody,omitempty"`
	Headers    []postmarkHeader   `json:"Headers,omitempty"`
	Attachments []postmarkAttachment `json:"Attachments,omitempty"`
}

type postmarkHeader struct {
	Name  string `json:"Name"`
	Value string `json:"Value"`
}

type postmarkAttachment struct {
	Name        string `json:"Name"`
	Content     string `json:"Content"`
	ContentType string `json:"ContentType"`
}

func (p *postmarkProvider) Send(message *mailer.Message) error {
	payload, err := NewPayload(message)
	if err != nil {
		return err
	}

	pp := postmarkPayload{
		From:     formatAddress(payload.From),
		To:       joinAddresses(payload.To),
		Cc:       joinAddresses(payload.Cc),
		Bcc:      joinAddresses(payload.Bcc),
		Subject:  payload.Subject,
		HTMLBody: payload.HTML,
		TextBody: payload.Text,
	}
	for _, h := range payload.Headers {
		pp.Headers = append(pp.Headers, postmarkHeader{Name: h.Name, Value: h.Value})
	}
	for _, a := range payload.Attachments {
		pp.Attachments = append(pp.Attachments, postmarkAttachment{
			Name:        a.Name,
			Content:     a.ContentBase64,
			ContentType: a.ContentType,
		})
	}
	for _, a := range payload.InlineAttachments {
		pp.Attachments = append(pp.Attachments, postmarkAttachment{
			Name:        a.Name,
			Content:     a.ContentBase64,
			ContentType: a.ContentType,
		})
	}

	body, err := json.Marshal(pp)
	if err != nil {
		return fmt.Errorf("mail: postmark marshal: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return p.post(ctx, body)
}

func (p *postmarkProvider) post(ctx context.Context, body []byte) error {
	headers := js.Global().Get("Headers").New()
	headers.Call("set", "Accept", "application/json")
	headers.Call("set", "Content-Type", "application/json")
	headers.Call("set", "X-Postmark-Server-Token", p.apiKey)

	init := js.Global().Get("Object").New()
	init.Set("method", http.MethodPost)
	init.Set("headers", headers)
	init.Set("body", string(body))

	res, err := jsutil.AwaitPromise(ctx, js.Global().Call("fetch", "https://api.postmarkapp.com/email", init))
	if err != nil {
		return fmt.Errorf("mail: postmark post: %w", err)
	}

	status := res.Get("status").Int()
	if status < 200 || status >= 300 {
		text, _ := jsutil.AwaitPromise(ctx, res.Call("text"))
		detail := ""
		if !text.IsUndefined() && text.String() != "" {
			detail = ": " + truncate(text.String(), 512)
		}
		return fmt.Errorf("mail: postmark returned HTTP %d%s", status, detail)
	}

	return nil
}

func joinAddresses(addrs []Address) string {
	parts := make([]string, len(addrs))
	for i, a := range addrs {
		parts[i] = a.Address
	}
	return strings.Join(parts, ",")
}
