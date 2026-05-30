//go:build js && wasm

package webmailer

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/mail"
	"path/filepath"
	"strings"
	"syscall/js"
	"time"

	"github.com/pocketbase/pocketbase/tools/mailer"

	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
)

const maxAttachmentBytes = 10 << 20

type Client struct {
	URL   string
	Token string
}

type payload struct {
	From              address      `json:"from"`
	To                []address    `json:"to"`
	Cc                []address    `json:"cc,omitempty"`
	Bcc               []address    `json:"bcc,omitempty"`
	Subject           string       `json:"subject"`
	HTML              string       `json:"html,omitempty"`
	Text              string       `json:"text,omitempty"`
	Headers           []header     `json:"headers,omitempty"`
	Attachments       []attachment `json:"attachments,omitempty"`
	InlineAttachments []attachment `json:"inlineAttachments,omitempty"`
}

type address struct {
	Name    string `json:"name,omitempty"`
	Address string `json:"address"`
}

type header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type attachment struct {
	Name          string `json:"name"`
	ContentType   string `json:"contentType,omitempty"`
	ContentBase64 string `json:"contentBase64"`
}

func (c *Client) Send(message *mailer.Message) error {
	if strings.TrimSpace(c.URL) == "" {
		return fmt.Errorf("webmailer: missing webhook URL")
	}

	payload, err := newPayload(message)
	if err != nil {
		return err
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("webmailer: marshal payload: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return c.post(ctx, body)
}

func newPayload(message *mailer.Message) (*payload, error) {
	p := &payload{
		From:    newAddress(message.From),
		To:      newAddresses(message.To),
		Cc:      newAddresses(message.Cc),
		Bcc:     newAddresses(message.Bcc),
		Subject: message.Subject,
		HTML:    message.HTML,
		Text:    message.Text,
		Headers: newHeaders(message.Headers),
	}

	attachments, err := newAttachments(message.Attachments)
	if err != nil {
		return nil, err
	}
	p.Attachments = attachments

	inlineAttachments, err := newAttachments(message.InlineAttachments)
	if err != nil {
		return nil, err
	}
	p.InlineAttachments = inlineAttachments

	return p, nil
}

func newAddress(addr mail.Address) address {
	return address{Name: addr.Name, Address: addr.Address}
}

func newAddresses(addrs []mail.Address) []address {
	result := make([]address, len(addrs))
	for i, addr := range addrs {
		result[i] = newAddress(addr)
	}
	return result
}

func newHeaders(headers map[string]string) []header {
	result := make([]header, 0, len(headers))
	for name, value := range headers {
		result = append(result, header{Name: name, Value: value})
	}
	return result
}

func newAttachments(files map[string]io.Reader) ([]attachment, error) {
	result := make([]attachment, 0, len(files))
	for name, reader := range files {
		data, err := io.ReadAll(io.LimitReader(reader, maxAttachmentBytes+1))
		if err != nil {
			return nil, fmt.Errorf("read attachment %q: %w", name, err)
		}
		if len(data) > maxAttachmentBytes {
			return nil, fmt.Errorf("attachment %q exceeds %d bytes", name, maxAttachmentBytes)
		}

		result = append(result, attachment{
			Name:          name,
			ContentType:   mime.TypeByExtension(filepath.Ext(name)),
			ContentBase64: base64.StdEncoding.EncodeToString(data),
		})
	}
	return result, nil
}

func (c *Client) post(ctx context.Context, body []byte) error {
	headers := js.Global().Get("Headers").New()
	headers.Call("set", "Accept", "application/json")
	headers.Call("set", "Content-Type", "application/json")
	if c.Token != "" {
		headers.Call("set", "Authorization", "Bearer "+c.Token)
	}

	init := js.Global().Get("Object").New()
	init.Set("method", http.MethodPost)
	init.Set("headers", headers)
	init.Set("body", string(body))

	res, err := jsutil.AwaitPromise(ctx, js.Global().Call("fetch", c.URL, init))
	if err != nil {
		return fmt.Errorf("webmailer: post: %w", err)
	}

	status := res.Get("status").Int()
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return fmt.Errorf("webmailer: webhook returned HTTP %d: %s", status, responseText(ctx, res))
	}

	return nil
}

func responseText(ctx context.Context, res js.Value) string {
	text, err := jsutil.AwaitPromise(ctx, res.Call("text"))
	if err != nil {
		return ""
	}

	value := text.String()
	if len(value) > 512 {
		return value[:512]
	}
	return value
}
