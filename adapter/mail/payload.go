// Package mail provides mailer.Mailer implementations for HTTP mail providers
// and SMTP-over-Workers-sockets.
package mail

import (
	"encoding/base64"
	"fmt"
	"io"
	"net/mail"

	"github.com/gabriel-vasile/mimetype"
	pbmailer "github.com/pocketbase/pocketbase/tools/mailer"
)

const maxAttachmentBytes = 10 << 20

// Address represents an email address with an optional display name.
type Address struct {
	Name    string `json:"name,omitempty"`
	Address string `json:"address"`
}

// Header is a key-value email header.
type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Attachment is a base64-encoded file attachment.
type Attachment struct {
	Name          string `json:"name"`
	ContentType   string `json:"contentType,omitempty"`
	ContentBase64 string `json:"contentBase64"`
}

// Payload is the canonical email representation shared by all providers.
type Payload struct {
	From              Address      `json:"from"`
	To                []Address    `json:"to"`
	Cc                []Address    `json:"cc,omitempty"`
	Bcc               []Address    `json:"bcc,omitempty"`
	Subject           string       `json:"subject"`
	HTML              string       `json:"html,omitempty"`
	Text              string       `json:"text,omitempty"`
	Headers           []Header     `json:"headers,omitempty"`
	Attachments       []Attachment `json:"attachments,omitempty"`
	InlineAttachments []Attachment `json:"inlineAttachments,omitempty"`
}

// NewPayload converts a PocketBase mailer.Message to the shared Payload.
func NewPayload(msg *pbmailer.Message) (*Payload, error) {
	p := &Payload{
		From:    newAddress(msg.From),
		To:      newAddresses(msg.To),
		Cc:      newAddresses(msg.Cc),
		Bcc:     newAddresses(msg.Bcc),
		Subject: msg.Subject,
		HTML:    msg.HTML,
		Text:    msg.Text,
		Headers: newHeaders(msg.Headers),
	}

	attachments, err := newAttachments(msg.Attachments)
	if err != nil {
		return nil, err
	}
	p.Attachments = attachments

	inlineAttachments, err := newAttachments(msg.InlineAttachments)
	if err != nil {
		return nil, err
	}
	p.InlineAttachments = inlineAttachments

	return p, nil
}

func newAddress(addr mail.Address) Address {
	return Address{Name: addr.Name, Address: addr.Address}
}

func newAddresses(addrs []mail.Address) []Address {
	result := make([]Address, len(addrs))
	for i, addr := range addrs {
		result[i] = newAddress(addr)
	}
	return result
}

func newHeaders(headers map[string]string) []Header {
	result := make([]Header, 0, len(headers))
	for name, value := range headers {
		result = append(result, Header{Name: name, Value: value})
	}
	return result
}

func newAttachments(files map[string]io.Reader) ([]Attachment, error) {
	result := make([]Attachment, 0, len(files))
	for name, reader := range files {
		data, err := io.ReadAll(io.LimitReader(reader, maxAttachmentBytes+1))
		if err != nil {
			return nil, fmt.Errorf("read attachment %q: %w", name, err)
		}
		if len(data) > maxAttachmentBytes {
			return nil, fmt.Errorf("attachment %q exceeds %d bytes", name, maxAttachmentBytes)
		}

		result = append(result, Attachment{
			Name:          name,
			ContentType:   detectContentType(name, data),
			ContentBase64: base64.StdEncoding.EncodeToString(data),
		})
	}
	return result, nil
}

// detectContentType uses magic-byte detection on the first 512 bytes,
// falling back to the filename extension.
func detectContentType(name string, data []byte) string {
	detectLen := 512
	if len(data) < detectLen {
		detectLen = len(data)
	}
	if detectLen > 0 {
		if mime := mimetype.Detect(data[:detectLen]); mime != nil {
			return mime.String()
		}
	}
	return "application/octet-stream"
}
