package netutil

import (
	"context"
	"net"
	"os"
	"time"
)

// Android has no /etc/resolv.conf, so the pure-Go resolver would ask
// 127.0.0.1:53 and fail. Point it at public DNS servers instead (Termux's
// resolv.conf is used when present).
func init() {
	if _, err := os.Stat("/etc/resolv.conf"); err == nil {
		return
	}
	servers := []string{"1.1.1.1:53", "8.8.8.8:53", "77.88.8.8:53"}
	if p := os.Getenv("PREFIX"); p != "" {
		if b, err := os.ReadFile(p + "/etc/resolv.conf"); err == nil {
			if s := parseNameservers(string(b)); len(s) > 0 {
				servers = append(s, servers...)
			}
		}
	}
	net.DefaultResolver = &net.Resolver{
		PreferGo: true,
		Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
			d := net.Dialer{Timeout: 3 * time.Second}
			var last error
			for _, s := range servers {
				c, err := d.DialContext(ctx, network, s)
				if err == nil {
					return c, nil
				}
				last = err
			}
			return nil, last
		},
	}
}
