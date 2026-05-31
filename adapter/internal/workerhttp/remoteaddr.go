package workerhttp

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// NormalizeRemoteAddr converts the Workers client IP into Go's host:port shape.
func NormalizeRemoteAddr(r *http.Request) {
	if r == nil {
		return
	}
	if validRemoteAddr(r.RemoteAddr) {
		return
	}

	ip := strings.TrimSpace(r.RemoteAddr)
	if ip == "" {
		ip = strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))
	}

	addr, err := netip.ParseAddr(ip)
	if err != nil {
		return
	}

	r.RemoteAddr = net.JoinHostPort(addr.String(), "0")
}

func validRemoteAddr(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return false
	}
	_, err = netip.ParseAddr(host)
	return err == nil
}
