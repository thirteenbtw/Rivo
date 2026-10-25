package torrent

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"

	"github.com/thirteenbtw/homecinema/server/internal/events"
	"github.com/thirteenbtw/homecinema/server/internal/library"
	"github.com/thirteenbtw/homecinema/server/internal/store"
)

// Deleting a finished torrent with its data removes the download, the library
// copy (a hard link of the same file) with its subtitles and the emptied
// folders, and leaves an unrelated film of the same name alone.
func TestRemoveDeletesLibraryCopy(t *testing.T) {
	dir := t.TempDir()
	dl := filepath.Join(dir, "dl")
	movies, shows := filepath.Join(dir, "Movies"), filepath.Join(dir, "Shows")
	const name = "Some.Film.2021.1080p.mkv"
	src := filepath.Join(dl, name)
	_ = os.MkdirAll(dl, 0o755)
	if err := os.WriteFile(src, bytes.Repeat([]byte("hc"), 300<<10), 0o644); err != nil {
		t.Fatal(err)
	}
	dst := library.Target(name, movies, shows)
	_ = os.MkdirAll(filepath.Dir(dst), 0o755)
	if err := os.Link(src, dst); err != nil {
		t.Skip("no hard links here")
	}
	sub := dst[:len(dst)-len(".mkv")] + ".rus.srt"
	_ = os.WriteFile(sub, []byte("1"), 0o644)
	other := library.Target("Other.Film.2020.mkv", movies, shows)
	_ = os.MkdirAll(filepath.Dir(other), 0o755)
	_ = os.WriteFile(other, []byte("x"), 0o644)

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
	ls.DownloadDir, ls.MoviesDir, ls.ShowsDir = dl, movies, shows
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
	hash, err := e.Add("", tf.Bytes(), "download", true)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.WaitInfo(hash, 10*time.Second); err != nil {
		t.Fatal(err)
	}
	if err := e.Remove(hash, true, true); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{src, dst, sub, filepath.Dir(dst)} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s still exists", p)
		}
	}
	if _, err := os.Stat(other); err != nil {
		t.Errorf("unrelated film deleted: %v", err)
	}
}

// testEngine starts an engine on dl with Rivo's own library folders and adds
// a .torrent built from src.
func testEngine(t *testing.T, dir, dl, src string) (*Engine, string) {
	t.Helper()
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
	t.Cleanup(func() { db.Close() })
	ls := DefaultSettings(dir)
	ls.DownloadDir = dl
	ls.Port = 0
	ls.DHT, ls.UPnP, ls.AutoImport = false, false, false
	ls.Trackers = ""
	b, _ := json.Marshal(ls)
	_ = db.SetSetting("torrent", string(b))
	e := New(db, events.New(), dir, dir)
	if err := e.Restart(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(e.Close)
	hash, err := e.Add("", tf.Bytes(), "stream", false)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.WaitInfo(hash, 10*time.Second); err != nil {
		t.Fatal(err)
	}
	return e, hash
}

// An unfinished download lives under a .part name; deleting the torrent with
// its data must remove that too.
func TestRemoveDeletesPartFile(t *testing.T) {
	dir := t.TempDir()
	dl := filepath.Join(dir, "dl")
	_ = os.MkdirAll(dl, 0o755)
	src := filepath.Join(dl, "Eyes.Wide.Shut.1999.mkv")
	_ = os.WriteFile(src, bytes.Repeat([]byte("hc"), 300<<10), 0o644)
	e, hash := testEngine(t, dir, dl, src)
	e.Close()
	_ = os.Rename(src, src+".part")
	if err := e.Restart(); err != nil {
		t.Fatal(err)
	}
	if err := e.Remove(hash, true, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(src + ".part"); !os.IsNotExist(err) {
		t.Errorf(".part file still exists")
	}
}

// Cleanup removes what no torrent owns, keeps the torrents in the list and
// the piece database, and touches library files only when asked.
func TestCleanupLeftovers(t *testing.T) {
	dir := t.TempDir()
	dl := filepath.Join(dir, "dl")
	_ = os.MkdirAll(dl, 0o755)
	src := filepath.Join(dl, "Active.Film.2024.mkv")
	_ = os.WriteFile(src, bytes.Repeat([]byte("hc"), 300<<10), 0o644)
	e, _ := testEngine(t, dir, dl, src)

	orphanPart := filepath.Join(dl, "Old.Film.2019.mkv.part")
	orphanDir := filepath.Join(dl, "Old.Show.S01", "e01.mkv")
	lib := filepath.Join(dl, "Фильмы", "Old Film (2019)", "Old Film (2019).mkv")
	for _, p := range []string{orphanPart, orphanDir, lib} {
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		_ = os.WriteFile(p, make([]byte, 1000), 0o644)
	}

	r := e.Disk()
	if r.LeftoverN != 2 || r.Leftover != 2000 || r.LibraryN != 1 || r.Library != 1000 {
		t.Fatalf("report: %+v", r)
	}
	if freed, failed := e.Cleanup(false); freed != 2000 || len(failed) > 0 {
		t.Fatalf("cleanup: freed %d, failed %v", freed, failed)
	}
	for _, p := range []string{orphanPart, filepath.Dir(orphanDir)} {
		if _, err := os.Stat(p); !os.IsNotExist(err) {
			t.Errorf("%s still exists", p)
		}
	}
	for _, p := range []string{src, lib} {
		if _, err := os.Stat(p); err != nil {
			t.Errorf("%s deleted: %v", p, err)
		}
	}
	if freed, _ := e.Cleanup(true); freed != 1000 {
		t.Errorf("library cleanup freed %d", freed)
	}
	if _, err := os.Stat(filepath.Dir(lib)); !os.IsNotExist(err) {
		t.Errorf("library title folder still exists")
	}
	if _, err := os.Stat(filepath.Join(dl, "Фильмы")); err != nil {
		t.Errorf("library root removed")
	}
}
