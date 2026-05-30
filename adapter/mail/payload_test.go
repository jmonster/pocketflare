package mail

import (
	"bytes"
	"io"
	"net/mail"
	"strings"
	"testing"

	pbmailer "github.com/pocketbase/pocketbase/tools/mailer"
)

func TestNewPayload_EmptyMessage(t *testing.T) {
	msg := &pbmailer.Message{}
	p, err := NewPayload(msg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Subject != "" {
		t.Errorf("expected empty subject, got %q", p.Subject)
	}
	if len(p.To) != 0 {
		t.Errorf("expected 0 To, got %d", len(p.To))
	}
}

func TestNewPayload_FullMessage(t *testing.T) {
	msg := &pbmailer.Message{
		From:    mail.Address{Name: "Sender", Address: "sender@example.com"},
		To:      []mail.Address{{Name: "Recipient", Address: "to@example.com"}},
		Cc:      []mail.Address{{Address: "cc@example.com"}},
		Bcc:     []mail.Address{{Address: "bcc@example.com"}},
		Subject: "Test Subject",
		HTML:    "<p>Hello</p>",
		Text:    "Hello",
		Headers: map[string]string{"X-Custom": "value"},
	}

	p, err := NewPayload(msg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if p.From.Name != "Sender" || p.From.Address != "sender@example.com" {
		t.Errorf("bad From: %+v", p.From)
	}
	if len(p.To) != 1 || p.To[0].Address != "to@example.com" {
		t.Errorf("bad To: %+v", p.To)
	}
	if len(p.Cc) != 1 || p.Cc[0].Address != "cc@example.com" {
		t.Errorf("bad Cc: %+v", p.Cc)
	}
	if len(p.Bcc) != 1 || p.Bcc[0].Address != "bcc@example.com" {
		t.Errorf("bad Bcc: %+v", p.Bcc)
	}
	if p.Subject != "Test Subject" {
		t.Errorf("bad Subject: %q", p.Subject)
	}
	if p.HTML != "<p>Hello</p>" {
		t.Errorf("bad HTML: %q", p.HTML)
	}
	if p.Text != "Hello" {
		t.Errorf("bad Text: %q", p.Text)
	}
	if len(p.Headers) != 1 || p.Headers[0].Name != "X-Custom" || p.Headers[0].Value != "value" {
		t.Errorf("bad Headers: %+v", p.Headers)
	}
}

func TestNewPayload_AttachmentEncoding(t *testing.T) {
	msg := &pbmailer.Message{
		Attachments: map[string]io.Reader{
			"test.txt": strings.NewReader("file contents"),
		},
	}

	p, err := NewPayload(msg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(p.Attachments) != 1 {
		t.Fatalf("expected 1 attachment, got %d", len(p.Attachments))
	}

	a := p.Attachments[0]
	if a.Name != "test.txt" {
		t.Errorf("bad name: %q", a.Name)
	}
	if a.ContentBase64 == "" {
		t.Error("expected base64 content")
	}
	// "file contents" base64: "ZmlsZSBjb250ZW50cw=="
	if a.ContentBase64 != "ZmlsZSBjb250ZW50cw==" {
		t.Errorf("unexpected base64: %q", a.ContentBase64)
	}
}

func TestNewPayload_AttachmentExceedsCap(t *testing.T) {
	data := bytes.Repeat([]byte("x"), maxAttachmentBytes+1)
	msg := &pbmailer.Message{
		Attachments: map[string]io.Reader{
			"large.bin": bytes.NewReader(data),
		},
	}

	_, err := NewPayload(msg)
	if err == nil {
		t.Fatal("expected error for oversized attachment")
	}
	if !strings.Contains(err.Error(), "exceeds") {
		t.Errorf("expected 'exceeds' in error, got: %v", err)
	}
}

func TestNewPayload_HeadersEmpty(t *testing.T) {
	msg := &pbmailer.Message{}
	p, err := NewPayload(msg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Headers == nil || len(p.Headers) != 0 {
		t.Errorf("expected empty headers slice, got %+v", p.Headers)
	}
}
