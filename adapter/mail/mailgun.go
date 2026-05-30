//go:build js && wasm

package mail

import (
	"context"
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"
	"syscall/js"
	"time"

	"github.com/pocketbase/pocketbase/tools/mailer"
	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
)

var _ mailer.Mailer = (*mailgunProvider)(nil)

const mailgunAPI = "https://api.mailgun.net/v3"

type mailgunProvider struct {
	apiKey string
	domain string
}

func (p *mailgunProvider) Send(message *mailer.Message) error {
	payload, err := NewPayload(message)
	if err != nil {
		return err
	}

	hasAttachments := len(payload.Attachments) > 0 || len(payload.InlineAttachments) > 0

	var body []byte
	var contentType string

	if hasAttachments {
		body, contentType, err = buildMailgunMultipart(payload)
	} else {
		body = []byte(buildMailgunForm(payload))
		contentType = "application/x-www-form-urlencoded"
	}
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	endpoint := mailgunAPI + "/" + p.domain + "/messages"
	return p.post(ctx, endpoint, body, contentType)
}

func (p *mailgunProvider) post(ctx context.Context, url string, body []byte, contentType string) error {
	headers := js.Global().Get("Headers").New()
	headers.Call("set", "Accept", "application/json")
	headers.Call("set", "Content-Type", contentType)

	auth := base64.StdEncoding.EncodeToString([]byte("api:" + p.apiKey))
	headers.Call("set", "Authorization", "Basic "+auth)

	// Pass body as Uint8Array so fetch sends binary, not UTF-8 string.
	bodyJS := js.Global().Get("Uint8Array").New(len(body))
	js.CopyBytesToJS(bodyJS, body)

	init := js.Global().Get("Object").New()
	init.Set("method", http.MethodPost)
	init.Set("headers", headers)
	init.Set("body", bodyJS)

	res, err := jsutil.AwaitPromise(ctx, js.Global().Call("fetch", url, init))
	if err != nil {
		return fmt.Errorf("mail: mailgun post: %w", err)
	}

	status := res.Get("status").Int()
	if status < 200 || status >= 300 {
		text, _ := jsutil.AwaitPromise(ctx, res.Call("text"))
		detail := ""
		if !text.IsUndefined() && text.String() != "" {
			detail = ": " + truncate(text.String(), 512)
		}
		return fmt.Errorf("mail: mailgun returned HTTP %d%s", status, detail)
	}

	return nil
}

func buildMailgunForm(p *Payload) string {
	var b strings.Builder
	writeField(&b, "from", formatAddress(p.From))
	for _, to := range p.To {
		writeField(&b, "to", to.Address)
	}
	for _, cc := range p.Cc {
		writeField(&b, "cc", cc.Address)
	}
	for _, bcc := range p.Bcc {
		writeField(&b, "bcc", bcc.Address)
	}
	writeField(&b, "subject", p.Subject)
	if p.Text != "" {
		writeField(&b, "text", p.Text)
	}
	if p.HTML != "" {
		writeField(&b, "html", p.HTML)
	}
	for _, h := range p.Headers {
		writeField(&b, "h:"+h.Name, h.Value)
	}
	return b.String()
}

func writeField(b *strings.Builder, key, value string) {
	if value == "" {
		return
	}
	if b.Len() > 0 {
		b.WriteByte('&')
	}
	b.WriteString(key)
	b.WriteByte('=')
	b.WriteString(urlEncode(value))
}

func urlEncode(s string) string {
	encoded := js.Global().Get("encodeURIComponent").Invoke(s).String()
	return encoded
}

func buildMailgunMultipart(p *Payload) ([]byte, string, error) {
	var buf strings.Builder
	w := multipart.NewWriter(&buf)

	writePart := func(key, value string) {
		if value == "" {
			return
		}
		w.WriteField(key, value)
	}

	writePart("from", formatAddress(p.From))
	for _, to := range p.To {
		writePart("to", to.Address)
	}
	for _, cc := range p.Cc {
		writePart("cc", cc.Address)
	}
	for _, bcc := range p.Bcc {
		writePart("bcc", bcc.Address)
	}
	writePart("subject", p.Subject)
	writePart("text", p.Text)
	writePart("html", p.HTML)
	for _, h := range p.Headers {
		writePart("h:"+h.Name, h.Value)
	}

	writeAttachment := func(a Attachment, fieldName string) error {
		data, err := base64.StdEncoding.DecodeString(a.ContentBase64)
		if err != nil {
			return fmt.Errorf("mail: decode attachment %q: %w", a.Name, err)
		}
		part, err := w.CreateFormFile(fieldName, a.Name)
		if err != nil {
			return fmt.Errorf("mail: create form file: %w", err)
		}
		if _, err := part.Write(data); err != nil {
			return fmt.Errorf("mail: write attachment: %w", err)
		}
		return nil
	}

	for _, a := range p.Attachments {
		if err := writeAttachment(a, "attachment"); err != nil {
			return nil, "", err
		}
	}
	for _, a := range p.InlineAttachments {
		if err := writeAttachment(a, "inline"); err != nil {
			return nil, "", err
		}
	}

	if err := w.Close(); err != nil {
		return nil, "", fmt.Errorf("mail: close multipart writer: %w", err)
	}

	// Multipart writer writes \r\n; JS fetch can handle \r\n or \n.
	return []byte(buf.String()), w.FormDataContentType(), nil
}
