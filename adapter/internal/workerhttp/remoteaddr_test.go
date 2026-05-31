package workerhttp

import (
	"net"
	"net/http"
	"testing"
)

func TestNormalizeRemoteAddr(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		headerIP   string
		want       string
	}{
		{
			name:       "bare IPv4",
			remoteAddr: "203.0.113.4",
			want:       net.JoinHostPort("203.0.113.4", "0"),
		},
		{
			name:       "bare IPv6",
			remoteAddr: "2a09:bac5:c82c:2446::39d:71",
			want:       net.JoinHostPort("2a09:bac5:c82c:2446::39d:71", "0"),
		},
		{
			name:       "existing IPv4 hostport",
			remoteAddr: "203.0.113.4:443",
			want:       "203.0.113.4:443",
		},
		{
			name:       "existing IPv6 hostport",
			remoteAddr: "[2a09:bac5:c82c:2446::39d:71]:443",
			want:       "[2a09:bac5:c82c:2446::39d:71]:443",
		},
		{
			name:     "header fallback",
			headerIP: "198.51.100.9",
			want:     net.JoinHostPort("198.51.100.9", "0"),
		},
		{
			name:       "invalid unchanged",
			remoteAddr: "invalid IP",
			want:       "invalid IP",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := &http.Request{RemoteAddr: tt.remoteAddr, Header: make(http.Header)}
			if tt.headerIP != "" {
				req.Header.Set("CF-Connecting-IP", tt.headerIP)
			}

			NormalizeRemoteAddr(req)

			if req.RemoteAddr != tt.want {
				t.Fatalf("expected RemoteAddr %q, got %q", tt.want, req.RemoteAddr)
			}
		})
	}
}
