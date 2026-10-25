package torrent

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"

	"github.com/thirteenbtw/homecinema/server/internal/events"
	"github.com/thirteenbtw/homecinema/server/internal/store"
)

// A "watch now" torrent without a player downloads nothing, and a full disk
// stops even an open player: both must say so rather than "streaming".
func TestStatusExplainsIdleStream(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "src", "Film.2021.mkv")
	_ = os.MkdirAll(filepath.Dir(src), 0o755)
	if err := os.WriteFile(src, bytes.Repeat([]byte("hc"), 300<<10), 0o644); err != nil {
		t.Fatal(err)
	}
	info := metainfo.Info{PieceLength: 64 << 10}
	if err := info.BuildFromFilePath(src); err != nil {
		t.Fatal(err)
	}
	mi := metainfo.MetaInfo{}
	mi.InfoBytes, _ = bencode.Marshal(info)
	var tf bytes.Buffer
	if err := mi.Write(&tf); err != nil {
		t.Fatal(err)
	}

	db, err := store.Open(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ls := DefaultSettings(dir)
	ls.DownloadDir = filepath.Join(dir, "dl")
	ls.Port = 0
	ls.DHT, ls.UPnP, ls.AutoImport = false, false, false
	ls.Trackers = ""
	b, _ := json.Marshal(ls)
	_ = db.SetSetting("torrent", string(b))
	e := New(db, events.New(), dir, dir)
	if err := e.Restart(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	hash, err := e.Add("", tf.Bytes(), "stream", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.WaitInfo(hash, 10*time.Second); err != nil {
		t.Fatal(err)
	}
	status := func() Info {
		t.Helper()
		i, err := e.Get(hash)
		if err != nil {
			t.Fatal(err)
		}
		return i
	}
	if s := status().Status; s != "waiting" {
		t.Fatalf("stream without player: status %q, want waiting", s)
	}

	keep := true
	if err := e.SetMode(hash, "", &keep); err != nil {
		t.Fatal(err)
	}
	if s := status().Status; s != "downloading" {
		t.Fatalf("kept stream without player: status %q, want downloading", s)
	}

	sr, _, err := e.openStream(hash, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer sr.Close()
	if s := status().Status; s != "streaming" {
		t.Fatalf("open player: status %q, want streaming", s)
	}
	e.mu.Lock()
	e.diskLow, e.freeBytes = true, 1<<30
	e.mu.Unlock()
	if i := status(); i.Status != "nospace" || !strings.Contains(i.Hint, "1.0 ГБ") {
		t.Fatalf("low disk with open player: status %q hint %q, want nospace", i.Status, i.Hint)
	}

	e.mu.Lock()
	e.diskLow, e.freeBytes = false, 100<<10
	e.mu.Unlock()
	if h := status().Hint; !strings.Contains(h, "Не поместится") {
		t.Fatalf("torrent larger than free space: hint %q", h)
	}
}
