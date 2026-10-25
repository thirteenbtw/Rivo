package renderer

import (
	"net"
	"testing"

	"github.com/miekg/dns"
)

func TestCastFromAnswer(t *testing.T) {
	m := new(dns.Msg)
	m.Response = true
	inst := "Haier-TV-abc._googlecast._tcp.local."
	m.Answer = []dns.RR{&dns.PTR{Hdr: dns.RR_Header{Name: castService, Rrtype: dns.TypePTR, Class: dns.ClassINET}, Ptr: inst}}
	m.Extra = []dns.RR{
		&dns.TXT{Hdr: dns.RR_Header{Name: inst, Rrtype: dns.TypeTXT, Class: dns.ClassINET}, Txt: []string{"id=abc123", "md=Haier Android TV", `fn=\208\147\208\190\209\129\209\130\208\184\208\189\208\176\209\143`}},
		&dns.SRV{Hdr: dns.RR_Header{Name: inst, Rrtype: dns.TypeSRV, Class: dns.ClassINET}, Port: 8009, Target: "abc.local."},
		&dns.A{Hdr: dns.RR_Header{Name: "abc.local.", Rrtype: dns.TypeA, Class: dns.ClassINET}, A: net.IPv4(192, 168, 1, 50)},
	}
	// round-trip through the wire format, as a real answer arrives
	pkt, err := m.Pack()
	if err != nil {
		t.Fatal(err)
	}
	got := new(dns.Msg)
	if err := got.Unpack(pkt); err != nil {
		t.Fatal(err)
	}
	devs := castFromAnswer(got, net.IPv4(192, 168, 1, 99))
	if len(devs) != 1 {
		t.Fatalf("got %d devices", len(devs))
	}
	d := devs[0]
	if d.ID != "abc123" || d.Name != "Гостиная" || d.Model != "Haier Android TV" || d.Addr != "192.168.1.50" || d.Port != 8009 {
		t.Fatalf("unexpected device %+v", d)
	}

	// no SRV/A in the answer: fall back to the sender's address
	got.Extra = got.Extra[:1]
	devs = castFromAnswer(got, net.IPv4(192, 168, 1, 99))
	if len(devs) != 1 || devs[0].Addr != "192.168.1.99" || devs[0].Port != 8009 {
		t.Fatalf("fallback: %+v", devs)
	}
}
