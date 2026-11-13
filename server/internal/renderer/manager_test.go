package renderer

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/thirteenbtw/homecinema/server/internal/events"
	"github.com/thirteenbtw/homecinema/server/internal/store"
)

// slowTV answers status requests only after a long wait, like a TV that
// dropped off Wi-Fi.
type slowTV struct{ dev store.Device }

func (s *slowTV) Device() store.Device                    { return s.dev }
func (s *slowTV) Caps() Caps                              { return CastCaps("") }
func (s *slowTV) Load(context.Context, LoadRequest) error { return nil }
func (s *slowTV) Play() error                             { return nil }
func (s *slowTV) Pause() error                            { return nil }
func (s *slowTV) Seek(float64) error                      { return nil }
func (s *slowTV) SetVolume(float64) error                 { return nil }
func (s *slowTV) Stop() error                             { return nil }
func (s *slowTV) Close()                                  {}
func (s *slowTV) Status() (Status, error) {
	time.Sleep(3 * time.Second)
	return Status{State: "playing", Position: 42}, nil
}

func TestStatusesDoNotWaitForTV(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "db.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, events.New())
	dev := store.Device{ID: "tv", Name: "ТВ", Proto: "cast", Addr: "192.168.1.5", Port: 8009}
	m.active["tv"] = &slowTV{dev: dev}
	m.sessions["tv"] = &LoadRequest{Title: "Фильм"}
	m.loadedAt["tv"] = time.Now()

	go m.pollActive(false)
	time.Sleep(100 * time.Millisecond) // the poll is now stuck on the TV

	start := time.Now()
	list := m.Statuses()
	m.Devices()
	m.Session("tv")
	if d := time.Since(start); d > 500*time.Millisecond {
		t.Fatalf("readers waited %v for the TV", d)
	}
	if len(list) != 1 || list[0].State != "connecting" || list[0].Title != "Фильм" {
		t.Fatalf("unexpected statuses %+v", list)
	}

	time.Sleep(3500 * time.Millisecond) // the poll finished
	if got := m.Statuses(); len(got) != 1 || got[0].State != "playing" || got[0].Position != 42 {
		t.Fatalf("poll result not cached: %+v", got)
	}
}
