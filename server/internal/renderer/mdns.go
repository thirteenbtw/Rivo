package renderer

import (
	"context"
	"net"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
	"golang.org/x/net/ipv4"

	"github.com/thirteenbtw/homecinema/server/internal/store"
)

const castService = "_googlecast._tcp.local."

var mdnsGroup = &net.UDPAddr{IP: net.IPv4(224, 0, 0, 251), Port: 5353}

// probeCastUnicast asks for Cast devices with a "legacy unicast" mDNS query:
// it is sent from an ephemeral port, so devices answer straight back to that
// port (RFC 6762 §6.7) instead of to the 5353 multicast group. Windows
// Firewall lets such answers through as replies to our own query, so this
// finds TVs even when inbound mDNS is blocked for the server, or when another
// program holds port 5353.
func probeCastUnicast(ctx context.Context) []store.Device {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	var (
		mu  sync.Mutex
		out []store.Device
		wg  sync.WaitGroup
	)
	for _, ifi := range ifaces {
		if ifi.Flags&net.FlagUp == 0 || ifi.Flags&net.FlagMulticast == 0 || ifi.Flags&net.FlagLoopback != 0 {
			continue
		}
		ip := ifaceIPv4(ifi)
		if ip == nil {
			continue
		}
		wg.Add(1)
		go func(ifi net.Interface, ip net.IP) {
			defer wg.Done()
			found := probeIface(ctx, ifi, ip)
			mu.Lock()
			out = append(out, found...)
			mu.Unlock()
		}(ifi, ip)
	}
	wg.Wait()
	return out
}

func ifaceIPv4(ifi net.Interface) net.IP {
	addrs, _ := ifi.Addrs()
	for _, a := range addrs {
		if n, ok := a.(*net.IPNet); ok {
			if ip4 := n.IP.To4(); ip4 != nil && !ip4.IsLinkLocalUnicast() {
				return ip4
			}
		}
	}
	return nil
}

func probeIface(ctx context.Context, ifi net.Interface, ip net.IP) []store.Device {
	conn, err := net.ListenUDP("udp4", &net.UDPAddr{IP: ip, Port: 0})
	if err != nil {
		return nil
	}
	defer conn.Close()
	pc := ipv4.NewPacketConn(conn)
	_ = pc.SetMulticastInterface(&ifi)
	_ = pc.SetMulticastTTL(255)

	q := new(dns.Msg)
	q.SetQuestion(castService, dns.TypePTR)
	q.RecursionDesired = false
	pkt, err := q.Pack()
	if err != nil {
		return nil
	}

	deadline, ok := ctx.Deadline()
	if !ok {
		deadline = time.Now().Add(3 * time.Second)
	}
	_ = conn.SetReadDeadline(deadline)
	// Ask a few times: the first datagram on a fresh socket is easy to lose.
	go func() {
		for i := 0; i < 3; i++ {
			if _, err := conn.WriteToUDP(pkt, mdnsGroup); err != nil {
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(700 * time.Millisecond):
			}
		}
	}()

	var out []store.Device
	buf := make([]byte, 9000)
	for {
		n, from, err := conn.ReadFromUDP(buf)
		if err != nil {
			return out
		}
		m := new(dns.Msg)
		if m.Unpack(buf[:n]) != nil || !m.Response {
			continue
		}
		out = append(out, castFromAnswer(m, from.IP)...)
	}
}

// castFromAnswer reads Cast devices out of one mDNS answer; from is the
// sender, used when the answer leaves out the A record.
func castFromAnswer(m *dns.Msg, from net.IP) []store.Device {
	rrs := append(append(append([]dns.RR{}, m.Answer...), m.Ns...), m.Extra...)
	srv := map[string]*dns.SRV{}
	txt := map[string][]string{}
	addr := map[string]net.IP{}
	var instances []string
	for _, rr := range rrs {
		switch r := rr.(type) {
		case *dns.PTR:
			if strings.EqualFold(r.Hdr.Name, castService) {
				instances = append(instances, r.Ptr)
			}
		case *dns.SRV:
			srv[strings.ToLower(r.Hdr.Name)] = r
		case *dns.TXT:
			txt[strings.ToLower(r.Hdr.Name)] = r.Txt
		case *dns.A:
			addr[strings.ToLower(r.Hdr.Name)] = r.A
		}
	}
	var out []store.Device
	for _, inst := range instances {
		key := strings.ToLower(inst)
		fields := map[string]string{}
		for _, kv := range txt[key] {
			if k, v, ok := strings.Cut(kv, "="); ok {
				fields[k] = unescapeTXT(v)
			}
		}
		id := fields["id"]
		if id == "" {
			continue
		}
		port := 8009
		ip := from.To4()
		if s := srv[key]; s != nil {
			port = int(s.Port)
			if a := addr[strings.ToLower(s.Target)]; a != nil {
				ip = a.To4()
			}
		}
		if ip == nil {
			continue
		}
		name := fields["fn"]
		if name == "" {
			name = fields["md"]
		}
		out = append(out, store.Device{ID: id, Name: name, Model: fields["md"], Proto: "cast", Addr: ip.String(), Port: port})
	}
	return out
}

// unescapeTXT undoes miekg/dns presentation escapes (\208, \") so Cyrillic
// TV names come out as text.
func unescapeTXT(s string) string {
	if !strings.Contains(s, "\\") {
		return s
	}
	b := make([]byte, 0, len(s))
	for i := 0; i < len(s); i++ {
		if s[i] != '\\' || i+1 >= len(s) {
			b = append(b, s[i])
			continue
		}
		if i+3 < len(s) && isDigit(s[i+1]) && isDigit(s[i+2]) && isDigit(s[i+3]) {
			b = append(b, (s[i+1]-'0')*100+(s[i+2]-'0')*10+(s[i+3]-'0'))
			i += 3
			continue
		}
		b = append(b, s[i+1])
		i++
	}
	return string(b)
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }
