package api

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
	"github.com/thirteenbtw/homecinema/server/internal/torrent"
	"github.com/thirteenbtw/homecinema/server/internal/transcode"
)

// A torrent not kept after watching goes, with its files, once the film is
// played to the end; the sample next to it does not have to be watched, and
// a kept torrent stays.
func TestRemoveWatched(t *testing.T) {
	dir := t.TempDir()
	dl := filepath.Join(dir, "dl")
	rel := filepath.Join(dl, "Film.2021")
	_ = os.MkdirAll(rel, 0o755)
	_ = os.WriteFile(filepath.Join(rel, "Film.2021.1080p.mkv"), bytes.Repeat([]byte("hc"), 512<<10), 0o644)
	_ = os.WriteFile(filepath.Join(rel, "sample.mkv"), bytes.Repeat([]byte("s"), 64<<10), 0o644)
	_ = os.WriteFile(filepath.Join(rel, "info.nfo"), []byte("nfo"), 0o644)
	info := metainfo.Info{PieceLength: 64 << 10}
	if err := info.BuildFromFilePath(rel); err != nil {
		t.Fatal(err)
	}
	mi := metainfo.MetaInfo{}
	mi.InfoBytes, _ = bencode.Marshal(info)
	var tf bytes.Buffer
	_ = mi.Write(&tf)

	st, err := store.Open(filepath.Join(dir, "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	ts := torrent.DefaultSettings(dir)
	ts.DownloadDir, ts.Port = dl, 0
	ts.DHT, ts.UPnP, ts.AutoImport, ts.Trackers = false, false, false, ""
	b, _ := json.Marshal(ts)
	_ = st.SetSetting("torrent", string(b))
	e := torrent.New(st, events.New(), dir, dir)
	if err := e.Restart(); err != nil {
		t.Fatal(err)
	}
	defer e.Close()
	s := &Server{Store: st, Torrents: e, Trans: transcode.New("ffmpeg-missing", t.TempDir())}
	defer func(d time.Duration) { watchedIdle = d }(watchedIdle)
	watchedIdle = 0

	hash, err := e.Add("", tf.Bytes(), "download", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.WaitInfo(hash, 10*time.Second); err != nil {
		t.Fatal(err)
	}
	ti, _ := e.Get(hash)
	film, sample := -1, -1
	for _, f := range ti.Files {
		switch {
		case strings.HasSuffix(f.Path, "1080p.mkv"):
			film = f.Index
		case strings.HasSuffix(f.Path, "sample.mkv"):
			sample = f.Index
		}
	}
	pid := int64(1)
	if p, _ := st.Profiles(); len(p) > 0 {
		pid = p[0].ID
	}

	// Half watched, the sample to the end: stays.
	_ = st.SaveTorrentProgress(pid, hash, film, 3600, 7200)
	_ = st.SaveTorrentProgress(pid, hash, sample, 30, 30)
	s.removeWatched()
	if _, err := e.Get(hash); err != nil {
		t.Fatal("removed before the film was watched")
	}
	// Kept: stays even when watched.
	_ = st.SaveTorrentProgress(pid, hash, film, 7000, 7200)
	_ = e.SetMode(hash, "", ptr(true))
	s.removeWatched()
	if _, err := e.Get(hash); err != nil {
		t.Fatal("kept torrent removed")
	}
	_ = e.SetMode(hash, "", ptr(false))
	s.removeWatched()
	if _, err := e.Get(hash); err == nil {
		t.Fatal("watched torrent not removed")
	}
	if _, err := os.Stat(rel); !os.IsNotExist(err) {
		t.Fatalf("files left: %v", err)
	}
}

func ptr[T any](v T) *T { return &v }
