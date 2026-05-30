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

var _ mailer.Mailer = (*WebhookClient)(nil)

// WebhookClient posts mail payloads as JSON to an HTTPS webhook endpoint.
type WebhookClient struct {
	URL   string
	Token string
}

func (c *WebhookClient) Send(message *mailer.Message) error {
	if strings.TrimSpace(c.URL) == "" {
		return fmt.Errorf("mail: missing webhook URL")
	}

	payload, err := NewPayload(message)
	if err != nil {
		return err
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("mail: marshal payload: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	return c.post(ctx, body)
}

func (c *WebhookClient) post(ctx context.Context, body []byte) error {
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
		return fmt.Errorf("mail: webhook post: %w", err)
	}

	status := res.Get("status").Int()
	if status < http.StatusOK || status >= http.StatusMultipleChoices {
		return fmt.Errorf("mail: webhook returned HTTP %d: %s", status, responseText(ctx, res))
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
