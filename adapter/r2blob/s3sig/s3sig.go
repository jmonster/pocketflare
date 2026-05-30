// Package s3sig computes AWS Signature Version 4 Authorization headers.
//
// Pure Go — no syscall/js, no platform constraints. Testable with plain go test.
// Used by the R2 blob driver for server-side CopyObject via the S3 HTTP API.
//
// Reference: https://docs.aws.amazon.com/general/latest/gr/sigv4_signing.html
package s3sig

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	algorithm = "AWS4-HMAC-SHA256"
	emptySHA  = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)

// EmptyPayloadHash returns the hex-encoded SHA-256 of an empty payload.
func EmptyPayloadHash() string { return emptySHA }

// CanonicalURI builds the canonical URI for an S3 object key.
// Each path segment is percent-encoded per RFC 3986.
func CanonicalURI(key string) string {
	parts := strings.Split(strings.TrimPrefix(key, "/"), "/")
	for i, p := range parts {
		parts[i] = rfc3986Escape(p)
	}
	return "/" + strings.Join(parts, "/")
}

// Sign computes the AWS SigV4 Authorization header value.
//
// Parameters:
//   - accessKey: R2/S3 access key ID
//   - secretKey: R2/S3 secret access key
//   - region:    always "auto" for R2
//   - service:   always "s3"
//   - t:         request timestamp
//   - method:    HTTP method (e.g. "PUT")
//   - host:      S3 endpoint host (e.g. "<account>.r2.cloudflarestorage.com")
//   - uri:       canonical URI from CanonicalURI()
//   - extraHeaders: additional signed headers (e.g. x-amz-copy-source)
//   - payloadSHA: hex SHA-256 of the request body (use EmptyPayloadHash() for no body)
//
// The caller must include every key in extraHeaders, plus host, x-amz-content-sha256,
// and x-amz-date (formatted 20060102T150405Z) in the actual HTTP request.
func Sign(accessKey, secretKey, region, service string, t time.Time,
	method, host, uri string, extraHeaders map[string]string, payloadSHA string) string {

	// --- build full header set (lowercase keys) ---
	hdrs := make(map[string]string, len(extraHeaders)+3)
	for k, v := range extraHeaders {
		hdrs[strings.ToLower(k)] = v
	}
	hdrs["host"] = host
	hdrs["x-amz-content-sha256"] = payloadSHA
	hdrs["x-amz-date"] = t.Format("20060102T150405Z")

	signedNames := signedHeaderList(hdrs)
	dateStr := t.Format("20060102")
	scope := fmt.Sprintf("%s/%s/%s/aws4_request", dateStr, region, service)

	creq := buildCanonicalRequest(method, uri, hdrs, signedNames, payloadSHA)
	sts := fmt.Sprintf("%s\n%s\n%s\n%s",
		algorithm,
		t.Format("20060102T150405Z"),
		scope,
		hexEncode(sha256Sum([]byte(creq))),
	)

	sig := hexEncode(hmacSHA256(signingKey(secretKey, dateStr, region, service), []byte(sts)))

	return fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		algorithm, accessKey, scope, signedNames, sig)
}

// --- internal helpers ---

func signedHeaderList(hdrs map[string]string) string {
	names := make([]string, 0, len(hdrs))
	for k := range hdrs {
		names = append(names, k)
	}
	sort.Strings(names)
	return strings.Join(names, ";")
}

func buildCanonicalRequest(method, uri string, hdrs map[string]string, signedNames, payloadSHA string) string {
	var b strings.Builder

	b.WriteString(method)
	b.WriteByte('\n')
	b.WriteString(uri)
	b.WriteByte('\n')
	// canonical query string — empty for S3 CopyObject/UploadPartCopy
	b.WriteByte('\n')

	for _, name := range strings.Split(signedNames, ";") {
		b.WriteString(name)
		b.WriteByte(':')
		b.WriteString(strings.TrimSpace(hdrs[name]))
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	b.WriteString(signedNames)
	b.WriteByte('\n')
	b.WriteString(payloadSHA)

	return b.String()
}

// signingKey derives the HMAC key chain: AWS4<secret> → date → region → service → aws4_request.
func signingKey(secret, date, region, service string) []byte {
	k := hmacSHA256([]byte("AWS4"+secret), []byte(date))
	k = hmacSHA256(k, []byte(region))
	k = hmacSHA256(k, []byte(service))
	return hmacSHA256(k, []byte("aws4_request"))
}

func sha256Sum(p []byte) []byte {
	s := sha256.Sum256(p)
	return s[:]
}

func hmacSHA256(key, data []byte) []byte {
	m := hmac.New(sha256.New, key)
	m.Write(data)
	return m.Sum(nil)
}

func hexEncode(p []byte) string { return hex.EncodeToString(p) }

// rfc3986Escape percent-encodes every character that is not an RFC 3986
// unreserved character. Unlike url.PathEscape this also encodes '+' and '*'
// etc., producing the canonical URI that SigV4 expects.
func rfc3986Escape(s string) string {
	// RFC 3986 unreserved: A-Z a-z 0-9 - _ . ~
	const unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
	var b strings.Builder
	for _, c := range []byte(s) {
		if strings.IndexByte(unreserved, c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
