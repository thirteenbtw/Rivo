package netutil

import (
	"net"
	"strings"
)

// parseNameservers pulls "nameserver X" lines out of a resolv.conf.
func parseNameservers(conf string) []string {
	var out []string
	for _, l := range strings.Split(conf, "\n") {
		f := strings.Fields(l)
		if len(f) >= 2 && f[0] == "nameserver" && net.ParseIP(f[1]) != nil {
			out = append(out, net.JoinHostPort(f[1], "53"))
		}
	}
	return out
}
