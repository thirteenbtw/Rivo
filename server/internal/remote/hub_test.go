package remote

import (
	"encoding/json"
	"testing"
	"time"
)

func TestHubAttachSendDetach(t *testing.T) {
	h := New(nil)
	h.Grace = 20 * time.Millisecond
	ch, detach := h.Attach(Screen{ID: "tv-123456", Name: "  Телевизор\n", TV: true})
	if l := h.List(); len(l) != 1 || l[0].Name != "Телевизор" || !l[0].TV {
		t.Fatalf("list = %+v", l)
	}
	if err := h.Send("tv-123456", json.RawMessage(`{"cmd":"toggle"}`)); err != nil {
		t.Fatal(err)
	}
	var ev struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(<-ch, &ev); err != nil || ev.Type != "remote" || string(ev.Data) != `{"cmd":"toggle"}` {
		t.Fatalf("event = %+v %v", ev, err)
	}
	if err := h.Send("nope-123456", json.RawMessage(`{}`)); err != ErrNoScreen {
		t.Fatalf("send to missing screen: %v", err)
	}
	if err := h.SetState("tv-123456", json.RawMessage(`{"page":"/"}`)); err != nil {
		t.Fatal(err)
	}

	// A reconnect within the grace period keeps the screen and its state.
	detach()
	if err := h.Send("tv-123456", json.RawMessage(`{"cmd":"x"}`)); err != ErrNoScreen {
		t.Fatalf("send while disconnected: %v", err)
	}
	_, detach2 := h.Attach(Screen{ID: "tv-123456", Name: "TV"})
	time.Sleep(40 * time.Millisecond)
	if l := h.List(); len(l) != 1 || string(l[0].State) != `{"page":"/"}` {
		t.Fatalf("after reconnect: %+v", l)
	}
	// The old stream's late detach doesn't drop the new one.
	detach()
	time.Sleep(40 * time.Millisecond)
	if len(h.List()) != 1 {
		t.Fatal("stale detach removed the screen")
	}
	detach2()
	time.Sleep(40 * time.Millisecond)
	if len(h.List()) != 0 {
		t.Fatal("screen kept after grace")
	}
}

func TestValidID(t *testing.T) {
	for id, ok := range map[string]bool{"abc123": true, "a-b_c-1234": true, "short": false, "with space1": false, "../../etc": false} {
		if ValidID(id) != ok {
			t.Errorf("ValidID(%q) = %v", id, !ok)
		}
	}
}
