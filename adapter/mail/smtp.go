//go:build js && wasm

package mail

import (
	"bytes"
	"context"
	"fmt"
	netmail "net/mail"
	"strings"
	"syscall/js"
	"time"

	"github.com/domodwyer/mailyak/v3"
	pbmailer "github.com/pocketbase/pocketbase/tools/mailer"
	"github.com/pocketbase/pocketbase/tools/security"

	"github.com/pocketflare/pocketflare/adapter/internal/jsutil"
)

var _ pbmailer.Mailer = (*SMTPClient)(nil)

// SMTPClient delivers email over Workers TCP sockets via cloudflare:sockets.
//
// It builds a MIME message using mailyak (mirroring PocketBase's own
// SMTPClient.send), writes it to a buffer via WriteTo, and hands the
// complete MIME body to the JS SMTP transport for delivery.
type SMTPClient struct {
	Host       string
	Port       int
	Username   string
	Password   string
	AuthMethod string // "PLAIN" (default) or "LOGIN"
	TLS        bool
	LocalName  string
}

func (c *SMTPClient) Send(msg *pbmailer.Message) error {
	// Build MIME message (mirrors PocketBase's SMTPClient.send).
	var buf bytes.Buffer
	if err := buildMIME(&buf, msg); err != nil {
		return fmt.Errorf("mail: build mime: %w", err)
	}
	mimeBody := buf.String()

	// Collect envelope recipients.
	recipients := collectRecipients(msg)

	// Check that the JS transport is available.
	transport := js.Global().Get("__pocketflare_smtp_send")
	if transport.IsUndefined() {
		return fmt.Errorf("mail: SMTP transport not available (not running on Workers or smtp-transport.mjs not loaded)")
	}

	tls := c.TLS || c.Port == 465
	localName := c.LocalName
	if localName == "" {
		localName = "localhost"
	}
	authMethod := c.AuthMethod
	if authMethod == "" {
		authMethod = "PLAIN"
	}

	jsRecipients := make([]any, len(recipients))
	for i, r := range recipients {
		jsRecipients[i] = r
	}

	config := map[string]any{
		"host":        c.Host,
		"port":        c.Port,
		"tls":         tls,
		"username":    c.Username,
		"password":    c.Password,
		"authMethod":  authMethod,
		"localName":   localName,
		"from":        msg.From.Address,
		"recipients":  jsRecipients,
		"mimeMessage": mimeBody,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	promise := transport.Invoke(js.ValueOf(config))
	if _, err := jsutil.AwaitPromise(ctx, promise); err != nil {
		return fmt.Errorf("mail: smtp send: %w", err)
	}
	return nil
}

// buildMIME constructs a complete MIME email and writes it to w.
// It mirrors PocketBase's SMTPClient.send() logic exactly, using
// mailyak.MimeBuf() to capture the formatted email body.
func buildMIME(w *bytes.Buffer, msg *pbmailer.Message) error {
	// Dummy addr and nil auth — WriteTo only formats the email, it never
	// connects to a server or uses auth.
	yak := mailyak.New("localhost:0", nil)

	// From
	if msg.From.Name != "" {
		yak.FromName(msg.From.Name)
	}
	yak.From(msg.From.Address)
	yak.Subject(msg.Subject)
	yak.HTML().Set(msg.HTML)

	if msg.Text == "" {
		if plain, err := html2Text(msg.HTML); err == nil {
			yak.Plain().Set(plain)
		}
	} else {
		yak.Plain().Set(msg.Text)
	}

	// Recipients (for headers only — envelope recipients are separate).
	if len(msg.To) > 0 {
		yak.To(addressesToStrings2(msg.To, true)...)
	}
	if len(msg.Bcc) > 0 {
		yak.Bcc(addressesToStrings2(msg.Bcc, true)...)
	}
	if len(msg.Cc) > 0 {
		yak.Cc(addressesToStrings2(msg.Cc, true)...)
	}

	// Attachments.
	for name, data := range msg.Attachments {
		r, mimeType, err := detectMimeType(data)
		if err != nil {
			return err
		}
		yak.AttachWithMimeType(name, r, mimeType)
	}
	for name, data := range msg.InlineAttachments {
		r, mimeType, err := detectMimeType(data)
		if err != nil {
			return err
		}
		yak.AttachInlineWithMimeType(name, r, mimeType)
	}

	// Custom headers + Message-ID.
	var hasMessageID bool
	for k, v := range msg.Headers {
		if strings.EqualFold(k, "Message-ID") {
			hasMessageID = true
		}
		yak.AddHeader(k, v)
	}
	if !hasMessageID {
		fromParts := strings.Split(msg.From.Address, "@")
		if len(fromParts) == 2 {
			yak.AddHeader("Message-ID", fmt.Sprintf("<%s@%s>",
				security.PseudorandomString(15),
				fromParts[1],
			))
		}
	}

	buf, err := yak.MimeBuf()
	if err != nil {
		return err
	}
	_, err = w.Write(buf.Bytes())
	return err
}

// collectRecipients returns de-duplicated recipient addresses for the SMTP envelope.
func collectRecipients(msg *pbmailer.Message) []string {
	seen := make(map[string]struct{})
	var result []string
	add := func(addrs []netmail.Address) {
		for _, a := range addrs {
			if _, ok := seen[a.Address]; !ok {
				seen[a.Address] = struct{}{}
				result = append(result, a.Address)
			}
		}
	}
	add(msg.To)
	add(msg.Cc)
	add(msg.Bcc)
	return result
}

// addressesToStrings2 converts mail.Address to formatted strings.
func addressesToStrings2(addrs []netmail.Address, withName bool) []string {
	result := make([]string, len(addrs))
	for i, addr := range addrs {
		if withName && addr.Name != "" {
			result[i] = addr.String()
		} else {
			result[i] = addr.Address
		}
	}
	return result
}

// html2Text is a simplified HTML-to-plain-text converter.
// Mirrors PocketBase's mailer.html2Text when Text is empty and HTML is set.
// Relies on mailyak's output — in practice this is only called for the
// fallback plain-text body generation.
func html2Text(html string) (string, error) {
	// Return the HTML as-is for plain text fallback.
	// A full html2text implementation requires golang.org/x/net/html
	// which is available but heavy for this fallback.
	// Most email clients will render the HTML part; plain text is a
	// best-effort fallback. Stripping tags is done simply.
	if html == "" {
		return "", nil
	}
	return stripTags(html), nil
}

func stripTags(s string) string {
	var buf strings.Builder
	inTag := false
	for _, r := range s {
		if r == '<' {
			inTag = true
			continue
		}
		if r == '>' {
			inTag = false
			buf.WriteByte(' ')
			continue
		}
		if !inTag {
			buf.WriteRune(r)
		}
	}
	return strings.TrimSpace(buf.String())
}
