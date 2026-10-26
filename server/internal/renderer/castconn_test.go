package renderer

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"io"
	"math/big"
	"net"
	"strconv"
	"testing"
	"time"

	"github.com/gogo/protobuf/proto"
	"github.com/vishen/go-chromecast/cast"
	pb "github.com/vishen/go-chromecast/cast/proto"
)

func selfSigned(t *testing.T) tls.Certificate {
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	tpl := &x509.Certificate{SerialNumber: big.NewInt(1), NotBefore: time.Now(), NotAfter: time.Now().Add(time.Hour)}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: key}
}

func readFrame(r io.Reader) (*pb.CastMessage, error) {
	var n uint32
	if err := binary.Read(r, binary.BigEndian, &n); err != nil {
		return nil, err
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(r, b); err != nil {
		return nil, err
	}
	m := &pb.CastMessage{}
	return m, proto.Unmarshal(b, m)
}

func writeFrame(w io.Writer, payload string) {
	src, dst, ns := "receiver-0", "sender-0", "urn:x-cast:com.google.cast.receiver"
	m := &pb.CastMessage{ProtocolVersion: pb.CastMessage_CASTV2_1_0.Enum(), SourceId: &src, DestinationId: &dst, Namespace: &ns, PayloadType: pb.CastMessage_STRING.Enum(), PayloadUtf8: &payload}
	b, _ := proto.Marshal(m)
	binary.Write(w, binary.BigEndian, uint32(len(b)))
	w.Write(b)
}

func TestCastConn(t *testing.T) {
	ln, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{selfSigned(t)}})
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		s, err := ln.Accept()
		if err != nil {
			return
		}
		defer s.Close()
		writeFrame(s, `{"type":"PING"}`)
		// the PONG and our GET_STATUS may come in either order
		got := map[string]bool{}
		for i := 0; i < 2; i++ {
			m, err := readFrame(s)
			if err != nil {
				t.Error(err)
				return
			}
			got[m.GetPayloadUtf8()] = true
		}
		if !got[`{"type":"PONG"}`] || !got[`{"type":"GET_STATUS"}`] {
			t.Errorf("want PONG and GET_STATUS, got %v", got)
		}
		writeFrame(s, `{"type":"RECEIVER_STATUS","requestId":1,"echo":`+strconv.Quote("urn:x-cast:com.google.cast.receiver")+`}`)
		io.Copy(io.Discard, s)
	}()

	_, port, _ := net.SplitHostPort(ln.Addr().String())
	p, _ := strconv.Atoi(port)
	c := newCastConn()
	if err := c.Start("127.0.0.1", p); err != nil {
		t.Fatal(err)
	}
	if err := c.Send(1, &cast.GetStatusHeader, "sender-0", "receiver-0", "urn:x-cast:com.google.cast.receiver"); err != nil {
		t.Fatal(err)
	}
	select {
	case m := <-c.MsgChan():
		if m.GetPayloadUtf8() != `{"type":"RECEIVER_STATUS","requestId":1,"echo":"urn:x-cast:com.google.cast.receiver"}` {
			t.Fatalf("got %s", m.GetPayloadUtf8())
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no message")
	}
	c.Close()
	select {
	case _, ok := <-c.MsgChan():
		if ok {
			t.Fatal("channel still open")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("channel not closed after Close")
	}
}
