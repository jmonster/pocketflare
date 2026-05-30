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

var _ mailer.Mailer = (*sendGridProvider)(nil)

type sendGridProvider struct {
	apiKey string
}

// SendGrid v3 Mail Send API reference:
// https://docs.sendgrid.com/api-reference/mail-send/mail-send
type sendGridPayload struct {
	Personalizations []sendGridPersonalization `json:"personalizations"`
	From             sendGridAddress           `json:"from"`
	Subject          string                    `json:"subject"`
	Content          []sendGridContent         `json:"content"`
	Headers          map[string]string         `json:"headers,omitempty"`
	Attachments      []sendGridAttachment      `json:"attachments,omitempty"`
}

type sendGridPersonalization struct {
	To  []sendGridAddress `json:"to"`
	Cc  []sendGridAddress `json:"cc,omitempty"`
	Bcc []sendGridAddress `json:"bcc,omitempty"`
}

type sendGridAddress struct {
	Email string `json:"email"`
	Name  string `json:"name,omitempty"`
}

type sendGridContent struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type sendGridAttachment struct {
	Filename    string `json:"filename"`
	Type        string `json:"type"`
	Content     string `json:"content"`
	Disposition string `json:"disposition"`
}

func (p *sendGridProvider) Send(message *mailer.Message) error {
	payload, err := NewPayload(message)
	if err != nil {
		return err
	}

	sp := sendGridPayload{
		Personalizations: []sendGridPersonalization{{
			To:  toSendGridAddresses(payload.To),
			Cc:  toSendGridAddresses(payload.Cc),
			Bcc: toSendGridAddresses(payload.Bcc),
		}},
		From:    sendGridAddress{Email: payload.From.Address, Name: payload.From.Name},
		Subject: payload.Subject,
		Headers: payloadHeadersToMap(payload.Headers),
	}

	if payload.Text != "" {
		sp.Content = append(sp.Content, sendGridContent{Type: "text/plain", Value: payload.Text})
	}
	if payload.HTML != "" {
		sp.Content = append(sp.Content, sendGridContent{Type: "text/html", Value: payload.HTML})
	}

	for _, a := range payload.Attachments {
		sp.Attachments = append(sp.Attachments, sendGridAttachment{
			Filename:    a.Name,
			Type:        a.ContentType,
			Content:     a.ContentBase64,
			Disposition: "attachment",
		})
	}
	for _, a := range payload.InlineAttachments {
		sp.Attachments = append(sp.Attachments, sendGridAttachment{
			Filename:    a.Name,
			Type:        a.ContentType,
			Content:     a.ContentBase64,
			Disposition: "inline",
		})
	}

	body, err := json.Marshal(sp)
	if err != nil {
		return fmt.Errorf("mail: sendgrid marshal: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return p.post(ctx, body)
}

func (p *sendGridProvider) post(ctx context.Context, body []byte) error {
	headers := js.Global().Get("Headers").New()
	headers.Call("set", "Accept", "application/json")
	headers.Call("set", "Content-Type", "application/json")
	headers.Call("set", "Authorization", "Bearer "+p.apiKey)

	init := js.Global().Get("Object").New()
	init.Set("method", http.MethodPost)
	init.Set("headers", headers)
	init.Set("body", string(body))

	res, err := jsutil.AwaitPromise(ctx, js.Global().Call("fetch", "https://api.sendgrid.com/v3/mail/send", init))
	if err != nil {
		return fmt.Errorf("mail: sendgrid post: %w", err)
	}

	status := res.Get("status").Int()
	if status < 200 || status >= 300 {
		text, _ := jsutil.AwaitPromise(ctx, res.Call("text"))
		detail := ""
		if !text.IsUndefined() && text.String() != "" {
			detail = ": " + truncate(text.String(), 512)
		}
		return fmt.Errorf("mail: sendgrid returned HTTP %d%s", status, detail)
	}

	return nil
}

func toSendGridAddresses(addrs []Address) []sendGridAddress {
	result := make([]sendGridAddress, len(addrs))
	for i, a := range addrs {
		result[i] = sendGridAddress{Email: a.Address, Name: a.Name}
	}
	return result
}
