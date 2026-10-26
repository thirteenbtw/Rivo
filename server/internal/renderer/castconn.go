package renderer

import (
	"context"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"

	"github.com/buger/jsonparser"
	"github.com/gogo/protobuf/proto"
	"github.com/vishen/go-chromecast/cast"
	pb "github.com/vishen/go-chromecast/cast/proto"

	"github.com/thirteenbtw/homecinema/server/internal/netutil"
)

// castConn is go-chromecast's cast.Connection with a dialer we control. It
// dials from the PC's address on the TV's subnet: Windows then sends the
// connection out of that network card, so a VPN that grabs all traffic does
// not swallow it (discovery got through only because it already goes out per
// card). It also waits longer than the library's 3s for a TV just waking up.
type castConn struct {
	conn      *tls.Conn
	msgs      chan *pb.CastMessage
	closeOnce sync.Once
	cancel    context.CancelFunc
	wmu       sync.Mutex
}

var _ cast.Conn = (*castConn)(nil)

func newCastConn() *castConn { return &castConn{msgs: make(chan *pb.CastMessage, 5)} }

func (c *castConn) Start(addr string, port int) error {
	if c.conn != nil {
		return nil
	}
	target := net.JoinHostPort(addr, fmt.Sprint(port))
	d := &net.Dialer{Timeout: 6 * time.Second, KeepAlive: 30 * time.Second}
	if ip := netutil.SubnetAddrFor(addr); ip != nil {
		d.LocalAddr = &net.TCPAddr{IP: ip}
	}
	conn, err := tls.DialWithDialer(d, "tcp", target, &tls.Config{InsecureSkipVerify: true})
	if err != nil && d.LocalAddr != nil {
		// a bound source can fail on odd setups; try the system route once
		d.LocalAddr = nil
		conn, err = tls.DialWithDialer(d, "tcp", target, &tls.Config{InsecureSkipVerify: true})
	}
	if err != nil {
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			return fmt.Errorf("ТВ %s не отвечает: проверьте, что он включён, а VPN не забирает себе локальную сеть (%w)", target, err)
		}
		return fmt.Errorf("нет связи с ТВ %s: %w", target, err)
	}
	c.conn = conn
	ctx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	go c.receiveLoop(ctx)
	return nil
}

func (c *castConn) MsgChan() chan *pb.CastMessage { return c.msgs }
func (c *castConn) SetDebug(bool)                 {}

func (c *castConn) Close() error {
	if c.conn == nil {
		c.closeOnce.Do(func() { close(c.msgs) })
		return nil
	}
	// the receive loop sees the closed socket, stops and closes msgs
	c.cancel()
	return c.conn.Close()
}

func (c *castConn) LocalAddr() (string, error) {
	h, _, err := net.SplitHostPort(c.conn.LocalAddr().String())
	return h, err
}

func (c *castConn) RemoteAddr() (string, error) {
	h, _, err := net.SplitHostPort(c.conn.RemoteAddr().String())
	return h, err
}

func (c *castConn) RemotePort() (string, error) {
	_, p, err := net.SplitHostPort(c.conn.RemoteAddr().String())
	return p, err
}

func (c *castConn) Send(requestID int, payload cast.Payload, sourceID, destinationID, namespace string) error {
	js, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	s := string(js)
	msg := &pb.CastMessage{
		ProtocolVersion: pb.CastMessage_CASTV2_1_0.Enum(),
		SourceId:        &sourceID,
		DestinationId:   &destinationID,
		Namespace:       &namespace,
		PayloadType:     pb.CastMessage_STRING.Enum(),
		PayloadUtf8:     &s,
	}
	proto.SetDefaults(msg)
	data, err := proto.Marshal(msg)
	if err != nil {
		return err
	}
	buf := make([]byte, 4+len(data))
	binary.BigEndian.PutUint32(buf, uint32(len(data)))
	copy(buf[4:], data)
	c.wmu.Lock()
	defer c.wmu.Unlock()
	_, err = c.conn.Write(buf)
	return err
}

func (c *castConn) receiveLoop(ctx context.Context) {
	// only this loop sends on msgs, so only it may close it
	defer c.closeOnce.Do(func() { close(c.msgs) })
	for ctx.Err() == nil {
		var n uint32
		if err := binary.Read(c.conn, binary.BigEndian, &n); err != nil {
			return
		}
		if n == 0 {
			continue
		}
		payload := make([]byte, n)
		if _, err := io.ReadFull(c.conn, payload); err != nil {
			return
		}
		msg := &pb.CastMessage{}
		if proto.Unmarshal(payload, msg) != nil || msg.PayloadUtf8 == nil {
			continue
		}
		typ, _ := jsonparser.GetString([]byte(*msg.PayloadUtf8), "type")
		if typ == "PING" {
			_ = c.Send(-1, &cast.PongHeader, msg.GetSourceId(), msg.GetDestinationId(), msg.GetNamespace())
			continue
		}
		select {
		case c.msgs <- msg:
		case <-ctx.Done():
			return
		}
	}
}
