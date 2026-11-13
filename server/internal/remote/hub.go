// Package remote lets one Rivo window drive another: a phone controls Rivo
// open on the TV. Every window that can show video registers itself as a
// "screen" while its event stream is open; other windows see the screens and
// what they are playing, and send them commands (open a title, pause, seek,
// remote keys). Commands go only to the screen they name and are never
// replayed, unlike the bus events.
package remote

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/thirteenbtw/homecinema/server/internal/events"
)

// Screen is a Rivo window that accepts commands.
type Screen struct {
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	TV    bool            `json:"tv"`
	Addr  string          `json:"addr"`
	State json.RawMessage `json:"state,omitempty"` // what the screen shows, as the screen reports it
	Since int64           `json:"since"`
}

type conn struct {
	Screen
	ch    chan []byte
	gen   int
	gone  *time.Timer // pending removal after the stream closed
	alive bool
}

// Hub keeps the connected screens.
type Hub struct {
	mu      sync.Mutex
	screens map[string]*conn
	gen     int
	bus     *events.Bus
	// Grace keeps a screen listed for a moment after its stream drops, so an
	// EventSource reconnect doesn't make it blink on the remote.
	Grace time.Duration
}

var ErrNoScreen = errors.New("экран не подключён")

func New(bus *events.Bus) *Hub {
	return &Hub{screens: map[string]*conn{}, bus: bus, Grace: 8 * time.Second}
}

// ValidID accepts the ids the UI makes up (letters, digits, dashes).
func ValidID(id string) bool {
	if len(id) < 6 || len(id) > 64 {
		return false
	}
	for _, c := range id {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func cleanName(n string) string {
	n = strings.TrimSpace(strings.Map(func(r rune) rune {
		if r < 32 {
			return -1
		}
		return r
	}, n))
	if r := []rune(n); len(r) > 40 {
		n = string(r[:40])
	}
	return n
}

// Attach registers the screen for as long as its event stream is open. The
// returned channel carries the commands for it; detach must be called when
// the stream closes. A second stream with the same id takes over.
func (h *Hub) Attach(s Screen) (<-chan []byte, func()) {
	s.Name = cleanName(s.Name)
	if s.Name == "" {
		s.Name = "Rivo"
	}
	h.mu.Lock()
	h.gen++
	gen := h.gen
	c := h.screens[s.ID]
	if c == nil {
		s.Since = time.Now().Unix()
		c = &conn{Screen: s}
		h.screens[s.ID] = c
	} else {
		if c.gone != nil {
			c.gone.Stop()
			c.gone = nil
		}
		c.Name, c.TV, c.Addr = s.Name, s.TV, s.Addr
	}
	c.ch = make(chan []byte, 32)
	c.gen = gen
	c.alive = true
	ch := c.ch
	h.mu.Unlock()
	h.publish()
	return ch, func() { h.detach(s.ID, gen) }
}

func (h *Hub) detach(id string, gen int) {
	h.mu.Lock()
	defer h.mu.Unlock()
	c := h.screens[id]
	if c == nil || c.gen != gen {
		return // a newer stream took over
	}
	c.alive = false
	c.gone = time.AfterFunc(h.Grace, func() {
		h.mu.Lock()
		if cur := h.screens[id]; cur == c && !c.alive {
			delete(h.screens, id)
		}
		h.mu.Unlock()
		h.publish()
	})
}

// SetState stores what the screen reports it is showing.
func (h *Hub) SetState(id string, state json.RawMessage) error {
	h.mu.Lock()
	c := h.screens[id]
	if c == nil {
		h.mu.Unlock()
		return ErrNoScreen
	}
	c.State = append(json.RawMessage(nil), state...)
	h.mu.Unlock()
	h.publish()
	return nil
}

// Send hands a command to one screen. It fails when the screen is gone or
// not reading its commands.
func (h *Hub) Send(id string, cmd json.RawMessage) error {
	msg, err := json.Marshal(events.Event{Type: "remote", Data: cmd})
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	c := h.screens[id]
	if c == nil || !c.alive {
		return ErrNoScreen
	}
	select {
	case c.ch <- msg:
		return nil
	default:
		return errors.New("экран не отвечает")
	}
}

// List returns the screens, oldest first.
func (h *Hub) List() []Screen {
	h.mu.Lock()
	defer h.mu.Unlock()
	out := make([]Screen, 0, len(h.screens))
	for _, c := range h.screens {
		out = append(out, c.Screen)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Since != out[j].Since {
			return out[i].Since < out[j].Since
		}
		return out[i].ID < out[j].ID
	})
	return out
}

func (h *Hub) publish() {
	if h.bus != nil {
		h.bus.Publish("screens", h.List())
	}
}
