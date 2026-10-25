package torrent

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Leftover is a file in the download folder that no torrent in the list owns:
// the remains of torrents removed without their data, or of removals that
// missed unfinished .part files.
type Leftover struct {
	Path    string `json:"path"` // relative to the download folder
	Size    int64  `json:"size"`
	Library bool   `json:"library"` // imported into «Фильмы» / «Сериалы»
	Linked  bool   `json:"linked"`  // a hard link of a library file: counted there, deleted with it
}

type DiskReport struct {
	Dir          string     `json:"dir"`
	FreeGB       float64    `json:"freeGB"`
	Active       int64      `json:"active"`   // bytes owned by torrents in the list
	Leftover     int64      `json:"leftover"` // download leftovers
	LeftoverN    int        `json:"leftoverN"`
	Library      int64      `json:"library"` // library files whose torrent is gone
	LibraryN     int        `json:"libraryN"`
	LibraryOwned bool       `json:"libraryOwned"` // the library folders are Rivo's own, inside the download folder
	Items        []Leftover `json:"items"`        // largest first
}

// scanState is what the scan needs from the engine, taken under the lock.
type scanState struct {
	dir           string
	movies, shows string // Rivo's own library folders; empty when the user chose their own
	owned         map[string]bool
	ownedPrefixes []string // torrents still waiting for metadata: their name only
	activeStats   []os.FileInfo
}

func (e *Engine) scanStateLocked() scanState {
	st := e.settings
	ss := scanState{dir: filepath.Clean(st.DownloadDir), owned: map[string]bool{}}
	if st.MoviesDir == "" {
		ss.movies = filepath.Join(ss.dir, "Фильмы")
	}
	if st.ShowsDir == "" {
		ss.shows = filepath.Join(ss.dir, "Сериалы")
	}
	for _, m := range e.items {
		if m.t.Info() == nil {
			if n := m.row.Name; n != "" {
				ss.ownedPrefixes = append(ss.ownedPrefixes, filepath.Join(ss.dir, n))
			}
			continue
		}
		for _, f := range m.t.Files() {
			src := filepath.Join(ss.dir, filepath.FromSlash(f.Path()))
			for _, p := range []string{src, src + ".part", src + ".hc-link"} {
				ss.owned[p] = true
				if fi, err := os.Stat(p); err == nil {
					ss.activeStats = append(ss.activeStats, fi)
				}
			}
		}
	}
	return ss
}

func (ss scanState) ownedPath(p string) bool {
	if ss.owned[p] {
		return true
	}
	for _, pre := range ss.ownedPrefixes {
		if p == pre || strings.HasPrefix(p, pre+".") || strings.HasPrefix(p, pre+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

func (ss scanState) sharesActive(fi os.FileInfo) bool {
	for _, a := range ss.activeStats {
		if os.SameFile(a, fi) {
			return true
		}
	}
	return false
}

// userLibrary reports whether p lies in a library folder the user picked
// inside the download folder; those are never touched.
func (e *Engine) inUserLibrary(p string) bool {
	st := e.Settings()
	for _, d := range []string{st.MoviesDir, st.ShowsDir} {
		if d != "" && (p == filepath.Clean(d) || strings.HasPrefix(p, filepath.Clean(d)+string(filepath.Separator))) {
			return true
		}
	}
	return false
}

func (e *Engine) scan() (scanState, []Leftover, int64) {
	e.mu.Lock()
	ss := e.scanStateLocked()
	e.mu.Unlock()
	var out []Leftover
	var stats []os.FileInfo
	var active int64
	_ = filepath.WalkDir(ss.dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			if p != ss.dir && e.inUserLibrary(p) {
				return filepath.SkipDir
			}
			return nil
		}
		// anacrolix piece-completion database
		if filepath.Dir(p) == ss.dir && strings.HasPrefix(d.Name(), ".torrent.") {
			return nil
		}
		fi, err := d.Info()
		if err != nil || !fi.Mode().IsRegular() {
			return nil
		}
		rel, _ := filepath.Rel(ss.dir, p)
		lib := ss.movies != "" && strings.HasPrefix(p, ss.movies+string(filepath.Separator)) ||
			ss.shows != "" && strings.HasPrefix(p, ss.shows+string(filepath.Separator))
		switch {
		case ss.ownedPath(p):
			active += fi.Size()
		case lib && ss.sharesActive(fi):
			// a hard link of a file still seeding: it frees nothing on its own
		default:
			out = append(out, Leftover{Path: rel, Size: fi.Size(), Library: lib})
			stats = append(stats, fi)
		}
		return nil
	})
	// A download whose library hard link stays frees nothing on its own, so
	// it goes with the library copy and is counted once.
	for i := range out {
		if out[i].Library {
			continue
		}
		for j := range out {
			if out[j].Library && !out[j].Linked && os.SameFile(stats[i], stats[j]) {
				out[i].Library, out[i].Linked = true, true
				break
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Size > out[j].Size })
	return ss, out, active
}

// Disk reports what the download folder holds beyond the torrents in the list.
func (e *Engine) Disk() DiskReport {
	ss, items, active := e.scan()
	r := DiskReport{Dir: ss.dir, Active: active, LibraryOwned: ss.movies != "" || ss.shows != "", Items: []Leftover{}}
	if free, err := FreeSpace(ss.dir); err == nil {
		r.FreeGB = float64(free) / (1 << 30)
	}
	for _, it := range items {
		if it.Linked {
			continue
		}
		if it.Library {
			r.Library += it.Size
			r.LibraryN++
		} else {
			r.Leftover += it.Size
			r.LeftoverN++
		}
	}
	if len(items) > 100 {
		items = items[:100]
	}
	r.Items = append(r.Items, items...)
	return r
}

// CleanupPaths lists the absolute paths Cleanup would delete.
func (e *Engine) CleanupPaths(withLibrary bool) []string {
	ss, items, _ := e.scan()
	var out []string
	for _, it := range items {
		if !it.Library || withLibrary {
			out = append(out, filepath.Join(ss.dir, it.Path))
		}
	}
	return out
}

// Cleanup deletes the leftovers (and, withLibrary, library files whose torrent
// is gone), then the folders that emptied. It returns the bytes freed and
// what could not be deleted.
func (e *Engine) Cleanup(withLibrary bool) (int64, []string) {
	ss, items, _ := e.scan()
	var files []string
	sizes := map[string]int64{}
	for _, it := range items {
		if it.Library && !withLibrary {
			continue
		}
		p := filepath.Join(ss.dir, it.Path)
		files = append(files, p)
		if !it.Linked {
			sizes[p] = it.Size
		}
	}
	var dirs []string
	if entries, err := os.ReadDir(ss.dir); err == nil {
		for _, en := range entries {
			p := filepath.Join(ss.dir, en.Name())
			if !en.IsDir() || e.inUserLibrary(p) {
				continue
			}
			if p == ss.movies || p == ss.shows {
				// keep the library roots, drop emptied titles inside
				if sub, err := os.ReadDir(p); err == nil {
					for _, s := range sub {
						if s.IsDir() {
							dirs = append(dirs, filepath.Join(p, s.Name()))
						}
					}
				}
				continue
			}
			dirs = append(dirs, p)
		}
	}
	failed := removeAll(files, dirs)
	var freed int64
	left := map[string]bool{}
	for _, p := range failed {
		left[p] = true
	}
	for _, p := range files {
		if !left[p] {
			freed += sizes[p]
		}
	}
	return freed, failed
}
