// Package announce advertises the Rivo server on the local network over mDNS
// (DNS-SD service _rivo._tcp), so the TV apps find the PC without typing an
// IP address. Android discovers it with NsdManager. If the announcement can't
// start (port 5353 taken, multicast blocked) the apps fall back to probing the
// subnet for the HTTP port, so a failure here is only logged.
package announce

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/grandcat/zeroconf"
)

const Service = "_rivo._tcp"

// Run announces the server until ctx ends.
func Run(ctx context.Context, port int, version string) {
	host, _ := os.Hostname()
	host = strings.TrimSuffix(host, ".local")
	name := "Rivo"
	if host != "" {
		name = "Rivo · " + host
	}
	srv, err := zeroconf.Register(name, Service, "local.", port, []string{"app=rivo", "version=" + version, "path=/"}, nil)
	if err != nil {
		log.Printf("mdns announce: %v (TV apps will find the server by scanning)", err)
		return
	}
	log.Printf("mdns: announced %q as %s on port %d", name, Service, port)
	<-ctx.Done()
	srv.Shutdown()
}
