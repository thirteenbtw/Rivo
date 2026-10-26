package api

import (
	"context"
	"crypto/sha1"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"log"
	"maps"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/thirteenbtw/homecinema/server/internal/store"
	"github.com/thirteenbtw/homecinema/server/internal/torrent"
)

func (s *Server) listTorrents(w http.ResponseWriter, r *http.Request) error {
	return writeJSON(w, s.Torrents.List())
}

// addTorrent accepts JSON {magnet, mode, keep} or a multipart .torrent upload (FR-T1).
func (s *Server) addTorrent(w http.ResponseWriter, r *http.Request) error {
	if !s.Torrents.Settings().AcceptedRisk {
		return httpError{http.StatusPreconditionRequired, "подтвердите предупреждение об ответственности за контент"}
	}
	var source, mode, link string
	var file []byte
	keep := s.Torrents.Settings().KeepWatched
	if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/") {
		if err := r.ParseMultipartForm(16 << 20); err != nil {
			return badRequest("%v", err)
		}
		mode = r.FormValue("mode")
		if v := r.FormValue("keep"); v != "" {
			keep = v != "0"
		}
		source = r.FormValue("magnet")
		if fh, _, err := r.FormFile("file"); err == nil {
			file, _ = io.ReadAll(io.LimitReader(fh, 16<<20))
			fh.Close()
		}
	} else {
		var b struct {
			Magnet string `json:"magnet"`
			Link   string `json:"link"` // .torrent URL from a search result
			Mode   string `json:"mode"`
			Keep   *bool  `json:"keep"`
		}
		if err := readJSON(r, &b); err != nil {
			return err
		}
		source, mode, link = b.Magnet, b.Mode, b.Link
		if b.Keep != nil {
			keep = *b.Keep
		}
	}
	if link != "" {
		if strings.HasPrefix(link, "magnet:") {
			source = link
		} else {
			// The .torrent from the indexer skips the metadata wait; the
			// magnet sent along (if any) is the fallback.
			data, magnet, err := torrent.FetchTorrent(r.Context(), link)
			switch {
			case err == nil && magnet != "":
				source, file = magnet, nil
			case err == nil:
				file = data
			case !strings.HasPrefix(source, "magnet:"):
				return badRequest("не удалось скачать .torrent: %v", err)
			}
		}
	}
	if source == "" && len(file) == 0 {
		return badRequest("нужна magnet-ссылка или .torrent-файл")
	}
	hash, err := s.Torrents.Add(source, file, mode, keep)
	if err != nil {
		return badRequest("%v", err)
	}
	return writeJSON(w, map[string]string{"hash": hash})
}

func (s *Server) getTorrent(w http.ResponseWriter, r *http.Request) error {
	info, err := s.Torrents.Get(r.PathValue("hash"))
	if err != nil {
		return notFound(err.Error())
	}
	return writeJSON(w, info)
}

func (s *Server) patchTorrent(w http.ResponseWriter, r *http.Request) error {
	hash := r.PathValue("hash")
	var b struct {
		Paused   *bool  `json:"paused"`
		Priority *int   `json:"priority"`
		Mode     string `json:"mode"`
		Keep     *bool  `json:"keep"`
		FilesOff *[]int `json:"filesOff"`
	}
	if err := readJSON(r, &b); err != nil {
		return err
	}
	var err error
	if b.Paused != nil {
		err = s.Torrents.SetPaused(hash, *b.Paused)
	}
	if err == nil && b.Priority != nil {
		err = s.Torrents.SetPriority(hash, *b.Priority)
	}
	if err == nil && (b.Mode != "" || b.Keep != nil) {
		err = s.Torrents.SetMode(hash, b.Mode, b.Keep)
	}
	if err == nil && b.FilesOff != nil {
		err = s.Torrents.SetFiles(hash, *b.FilesOff)
	}
	if err != nil {
		return badRequest("%v", err)
	}
	return writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) deleteTorrent(w http.ResponseWriter, r *http.Request) error {
	hash := r.PathValue("hash")
	data, lib := r.URL.Query().Get("data") == "1", r.URL.Query().Get("library") == "1"
	if _, err := s.Torrents.Get(hash); err != nil {
		return notFound(err.Error())
	}
	err := s.removeTorrent(hash, data, lib)
	var pe *torrent.PendingError
	if errors.As(err, &pe) {
		return writeJSON(w, map[string]any{"ok": true, "pending": pe.Error()})
	}
	if err != nil {
		return err
	}
	return writeJSON(w, map[string]bool{"ok": true})
}

// torrentReaders matches the transcoder inputs that read a torrent's files.
func (s *Server) torrentReaders(hash string, lib bool) func(string) bool {
	open := map[string]bool{}
	for _, p := range s.Torrents.DataPaths(hash, lib) {
		open[p] = true
	}
	return func(in string) bool { return open[in] || strings.Contains(in, "/torrents/"+strings.ToLower(hash)+"/") }
}

// removeTorrent drops a torrent; files still open elsewhere come back as a
// *torrent.PendingError and are deleted once released.
func (s *Server) removeTorrent(hash string, data, lib bool) error {
	if data {
		// ffmpeg playing one of these files keeps it locked on Windows.
		s.Trans.StopWhere(s.torrentReaders(hash, lib))
	}
	err := s.Torrents.Remove(hash, data, lib)
	var pe *torrent.PendingError
	if err == nil || errors.As(err, &pe) {
		_ = s.Store.ForgetTorrentProgress(hash)
	}
	if data && lib && s.Scanner != nil {
		s.Scanner.RequestScan(0) // drop the deleted copies from the library
	}
	return err
}

// watchedIdle is how long a watched torrent stays after the player let go of
// it, so closing and reopening the player (or a seek) does not lose it.
var watchedIdle = 2 * time.Minute

// removeWatchedLoop deletes the torrents not kept after watching once every
// video file in them has been played to the end and nothing reads them.
func (s *Server) removeWatchedLoop() {
	for {
		time.Sleep(30 * time.Second)
		s.removeWatched()
	}
}

func (s *Server) removeWatched() {
	for _, d := range s.Torrents.Disposables(watchedIdle) {
		watched, last := s.Store.TorrentWatched(d.Hash)
		if time.Since(time.Unix(last, 0)) < watchedIdle || !allWatched(d.Files, watched) || s.Trans.Uses(s.torrentReaders(d.Hash, true)) {
			continue
		}
		err := s.removeTorrent(d.Hash, true, true)
		var pe *torrent.PendingError
		switch {
		case errors.As(err, &pe):
			log.Printf("torrent %s watched, removed; queued for deletion: %v", d.Hash, pe)
		case err != nil:
			log.Printf("torrent %s watched, remove: %v", d.Hash, err)
		default:
			log.Printf("torrent %s watched, removed with its files", d.Hash)
		}
	}
}

func allWatched(files []int, watched map[int]bool) bool {
	for _, f := range files {
		if !watched[f] {
			return false
		}
	}
	return len(files) > 0
}

// torrentDisk reports the files in the download folder no torrent owns.
func (s *Server) torrentDisk(w http.ResponseWriter, r *http.Request) error {
	return writeJSON(w, s.Torrents.Disk())
}

func (s *Server) torrentCleanup(w http.ResponseWriter, r *http.Request) error {
	var b struct {
		Library bool `json:"library"`
	}
	_ = readJSON(r, &b)
	gone := map[string]bool{}
	for _, p := range s.Torrents.CleanupPaths(b.Library) {
		gone[p] = true
	}
	s.Trans.StopWhere(func(in string) bool { return gone[in] })
	freed, failed := s.Torrents.Cleanup(b.Library)
	if b.Library {
		s.Scanner.RequestScan(0)
	}
	res := map[string]any{"freed": freed}
	if len(failed) > 0 {
		res["pending"] = torrent.LockedError(failed).Error()
	}
	return writeJSON(w, res)
}

func (s *Server) torrentStream(w http.ResponseWriter, r *http.Request) error {
	st, err := s.Torrents.Stream(r.PathValue("hash"), queryInt(r, "file", -1), queryInt(r, "cells", 200))
	if err != nil {
		return notFound(err.Error())
	}
	return writeJSON(w, st)
}

func (s *Server) torrentFile(w http.ResponseWriter, r *http.Request) {
	idx, err := strconv.Atoi(r.PathValue("idx"))
	if err != nil {
		idx = -1
	}
	s.Torrents.ServeFile(w, r, r.PathValue("hash"), idx)
}

// torrentFileID gives a torrent file a stable pseudo file id (negative, so it
// never collides with library files) for transcode session bookkeeping.
func torrentFileID(hash string, idx int) int64 {
	h := sha1.Sum([]byte(fmt.Sprintf("%s/%d", strings.ToLower(hash), idx)))
	return -int64(binary.BigEndian.Uint64(h[:8]) >> 2)
}

func (s *Server) loopbackBase() string {
	return fmt.Sprintf("http://127.0.0.1:%d", s.Port)
}

// torrentPlayback prepares a torrent file for playback while it downloads
// (FR-T4): direct when the client can decode it, otherwise HLS over the
// partially downloaded file (FR-T5). Without a start in q it resumes where
// the profile left the file (profile 0: from the beginning).
func (s *Server) torrentPlayback(ctx context.Context, hash string, idx int, caps rendererCaps, q map[string][]string, profile int64) (*playback, error) {
	if err := s.Torrents.WaitInfo(hash, 60*time.Second); err != nil {
		return nil, badRequest("%v", err)
	}
	idx, name, size, err := s.Torrents.FileIndex(hash, idx)
	if err != nil {
		return nil, badRequest("%v", err)
	}
	if torrent.Blocked(name) {
		return nil, badRequest("исполняемые файлы не открываются")
	}
	input := s.torrentInput(hash, idx)
	f, err := s.probeURL(ctx, fmt.Sprintf("%s/%d", hash, idx), input)
	if err != nil {
		return nil, badRequest("%v", err)
	}
	if _, ok := q["start"]; !ok && profile > 0 {
		if pos := s.Store.TorrentProgress(profile, hash, idx); pos > 0 && (f.Duration == 0 || pos < f.Duration-5) {
			q = maps.Clone(q)
			q["start"] = []string{strconv.FormatFloat(pos, 'f', 3, 64)}
		}
	}
	f.ID = torrentFileID(hash, idx)
	f.Size = size
	f.Container = containerFromName(name, f.Container)
	direct := fmt.Sprintf("/api/torrents/%s/files/%d", strings.ToLower(hash), idx)
	pb, err := s.preparePlayback(ctx, f, input, caps, q, "", direct)
	if err != nil {
		return nil, err
	}
	for i := range pb.Subs {
		if pb.Subs[i].URL != "" {
			pb.Subs[i].URL = fmt.Sprintf("/api/torrents/%s/files/%d/subs/%d", strings.ToLower(hash), idx, pb.Subs[i].Index)
		}
	}
	pb.TorrentFile = idx
	pb.Title = name
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		pb.Title = name[i+1:]
	}
	pb.Info = "Торрент · " + pb.Summary
	return pb, nil
}

// torrentInput is what ffmpeg reads for a torrent file: the file itself once
// it is complete, otherwise the server's own stream, which waits for pieces.
func (s *Server) torrentInput(hash string, idx int) string {
	if p, ok := s.Torrents.LocalPath(hash, idx); ok {
		return p
	}
	return s.loopbackBase() + "/api/t/" + s.streamToken("torrent:"+strings.ToLower(hash)) + fmt.Sprintf("/torrents/%s/files/%d", strings.ToLower(hash), idx)
}

// torrentSubtitle serves an embedded subtitle track of a torrent file, from
// the player's position on, as it is extracted.
func (s *Server) torrentSubtitle(w http.ResponseWriter, r *http.Request) {
	hash := strings.ToLower(r.PathValue("hash"))
	idx, err1 := strconv.Atoi(r.PathValue("idx"))
	n, err2 := strconv.Atoi(strings.TrimSuffix(r.PathValue("n"), ".vtt"))
	if err1 != nil || err2 != nil {
		http.NotFound(w, r)
		return
	}
	input := s.torrentInput(hash, idx)
	f, err := s.probeURL(r.Context(), fmt.Sprintf("%s/%d", hash, idx), input)
	if err != nil || n < 0 || n >= len(f.Subs) {
		http.NotFound(w, r)
		return
	}
	if !r.URL.Query().Has("from") {
		r.URL.RawQuery = "from=0"
	}
	s.serveSubtitleFrom(w, r, fmt.Sprintf("torrent:%s/%d", hash, idx), input, f.Subs[n])
}

func containerFromName(name, probed string) string {
	switch strings.ToLower(name[strings.LastIndex(name, ".")+1:]) {
	case "mp4", "m4v":
		return "mp4"
	case "webm":
		return "webm"
	case "mkv":
		return "mkv"
	}
	return probed
}

func (s *Server) torrentPlay(w http.ResponseWriter, r *http.Request) error {
	pb, err := s.torrentPlayback(r.Context(), r.PathValue("hash"), queryInt(r, "file", -1), browserCaps(r), r.URL.Query(), s.profileID(r))
	if err != nil {
		return err
	}
	return writeJSON(w, pb)
}

// torrentProgress saves the player's position in a torrent file.
func (s *Server) torrentProgress(w http.ResponseWriter, r *http.Request) error {
	pid, err := s.requireProfile(r)
	if err != nil {
		return err
	}
	var b struct {
		File     int     `json:"file"`
		Position float64 `json:"position"`
		Duration float64 `json:"duration"`
	}
	if err := readJSON(r, &b); err != nil {
		return err
	}
	if b.File < 0 {
		return badRequest("нет файла")
	}
	if err := s.Store.SaveTorrentProgress(pid, r.PathValue("hash"), b.File, b.Position, b.Duration); err != nil {
		return err
	}
	return writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) searchTorrents(w http.ResponseWriter, r *http.Request) error {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if q == "" {
		return badRequest("пустой запрос")
	}
	if len(s.Torrents.Indexers()) == 0 {
		return badRequest("включите источник поиска (JacRed или свой Torznab) в настройках")
	}
	res, errs := s.Torrents.Search(r.Context(), q)
	return writeJSON(w, map[string]any{"results": res, "errors": errs})
}

func (s *Server) getIndexers(w http.ResponseWriter, r *http.Request) error {
	list := s.Torrents.Indexers()
	for i := range list {
		if list[i].APIKey != "" {
			list[i].APIKey = "••••" + tail(list[i].APIKey, 4)
		}
	}
	return writeJSON(w, map[string]any{"indexers": list, "prefs": s.Torrents.Prefs()})
}

func (s *Server) putIndexers(w http.ResponseWriter, r *http.Request) error {
	var b struct {
		Indexers []torrent.Indexer    `json:"indexers"`
		Prefs    *torrent.SearchPrefs `json:"prefs"`
	}
	if err := readJSON(r, &b); err != nil {
		return err
	}
	old := map[string]string{}
	for _, in := range s.Torrents.Indexers() {
		old[in.URL] = in.APIKey
	}
	for i := range b.Indexers {
		if strings.HasPrefix(b.Indexers[i].APIKey, "••••") { // unchanged masked key
			b.Indexers[i].APIKey = old[b.Indexers[i].URL]
		}
	}
	if err := s.Torrents.SetIndexers(b.Indexers); err != nil {
		return err
	}
	if b.Prefs != nil {
		_ = s.Store.SetSetting("searchPrefs", toJSONString(b.Prefs))
	}
	return writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) getTorrentSettings(w http.ResponseWriter, r *http.Request) error {
	return writeJSON(w, s.Torrents.Settings())
}

func (s *Server) putTorrentSettings(w http.ResponseWriter, r *http.Request) error {
	st := s.Torrents.Settings()
	if err := readJSON(r, &st); err != nil {
		return err
	}
	if st.Port < 1024 || st.Port > 65535 {
		return badRequest("порт должен быть в диапазоне 1024–65535")
	}
	if err := s.Torrents.UpdateSettings(st); err != nil {
		return badRequest("%v", err)
	}
	// Make sure finished downloads land in a folder the library watches.
	for _, dir := range []struct{ path, kind string }{{st.MoviesDir, "movies"}, {st.ShowsDir, "shows"}} {
		if dir.path != "" {
			if lib, err := s.Store.AddLibrary(dir.path, dir.kind); err == nil {
				s.Scanner.RequestScan(lib.ID)
			}
		}
	}
	return writeJSON(w, s.Torrents.Settings())
}

func (s *Server) interfaces(w http.ResponseWriter, r *http.Request) error {
	return writeJSON(w, torrent.Interfaces())
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[len(s)-n:]
}

var _ = store.File{}
