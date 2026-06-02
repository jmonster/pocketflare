package s3sig

import (
	"strings"
	"testing"
	"time"
)

func TestEmptyPayloadHash(t *testing.T) {
	// SHA-256 of empty string per FIPS 180-4.
	const want = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if got := EmptyPayloadHash(); got != want {
		t.Fatalf("EmptyPayloadHash() = %s, want %s", got, want)
	}
}

func TestCanonicalURI(t *testing.T) {
	tests := []struct {
		key  string
		want string
	}{
		{"foo.txt", "/foo.txt"},
		{"path/to/file.jpg", "/path/to/file.jpg"},
		{"storage/abc123/def456/file.jpg", "/storage/abc123/def456/file.jpg"},
		{"file with spaces.txt", "/file%20with%20spaces.txt"},
		{"path/with spaces/file.txt", "/path/with%20spaces/file.txt"},
		{"/leading-slash", "/leading-slash"},
		{"key+plus.txt", "/key%2Bplus.txt"}, // + must be encoded
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			if got := CanonicalURI(tt.key); got != tt.want {
				t.Errorf("CanonicalURI(%q) = %q, want %q", tt.key, got, tt.want)
			}
		})
	}
}

func TestSignDeterminism(t *testing.T) {
	accessKey := "AKIDEXAMPLE"
	secretKey := "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY"
	region := "us-east-1"
	service := "iam"
	ts := time.Date(2011, 9, 9, 23, 36, 0, 0, time.UTC)
	method := "GET"
	host := "iam.amazonaws.com"
	uri := "/"
	payloadSHA := EmptyPayloadHash()

	want := Sign(accessKey, secretKey, region, service, ts, method, host, uri, nil, payloadSHA)
	for i := 0; i < 10; i++ {
		got := Sign(accessKey, secretKey, region, service, ts, method, host, uri, nil, payloadSHA)
		if got != want {
			t.Fatalf("Sign is not deterministic: iteration %d differs", i)
		}
	}
}

func TestSignStructure(t *testing.T) {
	auth := Sign(
		"AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
		"us-east-1", "iam",
		time.Date(2011, 9, 9, 23, 36, 0, 0, time.UTC),
		"GET", "iam.amazonaws.com", "/",
		nil, EmptyPayloadHash(),
	)

	required := []string{
		"AWS4-HMAC-SHA256 ",
		"Credential=AKIDEXAMPLE/20110909/us-east-1/iam/aws4_request",
		"SignedHeaders=host;x-amz-content-sha256;x-amz-date",
		"Signature=",
	}
	for _, r := range required {
		if !strings.Contains(auth, r) {
			t.Errorf("missing %q in: %s", r, auth)
		}
	}

	// Signature must be exactly 64 hex chars after "Signature=".
	const sigPrefix = "Signature="
	idx := strings.Index(auth, sigPrefix)
	if idx < 0 {
		t.Fatal("no Signature in auth header")
	}
	sig := auth[idx+len(sigPrefix):]
	if len(sig) != 64 {
		t.Errorf("signature length = %d, want 64", len(sig))
	}
	for _, c := range sig {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			t.Errorf("signature contains non-hex char %c", c)
		}
	}
}

func TestSignWithExtraHeaders(t *testing.T) {
	extra := map[string]string{
		"x-amz-copy-source": "/bucket-name/srcKey",
	}
	auth := Sign(
		"AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
		"us-east-1", "iam",
		time.Date(2011, 9, 9, 23, 36, 0, 0, time.UTC),
		"PUT", "iam.amazonaws.com", "/bucket-name/dstKey",
		extra, EmptyPayloadHash(),
	)

	expectedSigned := "host;x-amz-content-sha256;x-amz-copy-source;x-amz-date"
	if !strings.Contains(auth, "SignedHeaders="+expectedSigned) {
		t.Errorf("expected SignedHeaders=%s, got: %s", expectedSigned, auth)
	}
	if !strings.Contains(auth, "Credential=AKIDEXAMPLE/20110909/us-east-1/iam/aws4_request") {
		t.Errorf("wrong credential scope: %s", auth)
	}
}

func TestSignWithSessionTokenHeader(t *testing.T) {
	extra := map[string]string{
		"x-amz-copy-source":    "/bucket-name/srcKey",
		"x-amz-security-token": "session-token",
	}
	auth := Sign(
		"AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
		"auto", "s3",
		time.Date(2026, 6, 2, 12, 0, 0, 0, time.UTC),
		"PUT", "example.r2.cloudflarestorage.com", "/bucket-name/dstKey",
		extra, EmptyPayloadHash(),
	)

	expectedSigned := "host;x-amz-content-sha256;x-amz-copy-source;x-amz-date;x-amz-security-token"
	if !strings.Contains(auth, "SignedHeaders="+expectedSigned) {
		t.Errorf("expected SignedHeaders=%s, got: %s", expectedSigned, auth)
	}
}

func TestCanonicalURIWithBucketPrefix(t *testing.T) {
	// R2 keys are stored under storage/<collection>/<record>/<filename>.
	key := "storage/pbc_12345/pbr_67890/my image (1).jpg"
	got := CanonicalURI(key)
	if !strings.HasPrefix(got, "/") {
		t.Errorf("URI must start with /: %s", got)
	}
	if strings.Contains(got, " ") {
		t.Errorf("URI must not contain literal spaces: %s", got)
	}
	// Verify the space and parens are encoded.
	if !strings.Contains(got, "%20") {
		t.Errorf("expected percent-encoded space in: %s", got)
	}
}
