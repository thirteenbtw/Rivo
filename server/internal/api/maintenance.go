package api

import (
	"context"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// ---------- transcode temp files ----------

// cacheInfo reports how much the transcode segments and subtitle cache take.
func (s *Server) cacheInfo(w http.ResponseWriter, r *http.Request) error {
	return writeJSON(w, map[string]any{"bytes": s.tempSize(), "path": s.Cfg.CacheDir})
}

func (s *Server) tempSize() int64 {
	return dirSize(filepath.Join(s.Cfg.CacheDir, "hls")) + dirSize(filepath.Join(s.Cfg.CacheDir, "subs"))
}

// clearCache removes finished transcodes and cached subtitles; segments of
// sessions that are still playing stay.
func (s *Server) clearCache(w http.ResponseWriter, r *http.Request) error {
	live := map[string]bool{}
	for _, x := range s.Trans.Sessions() {
		live[x.ID] = true
	}
	hls := filepath.Join(s.Cfg.CacheDir, "hls")
	entries, _ := os.ReadDir(hls)
	for _, e := range entries {
		if !live[e.Name()] {
			_ = os.RemoveAll(filepath.Join(hls, e.Name()))
		}
	}
	_ = os.RemoveAll(filepath.Join(s.Cfg.CacheDir, "subs"))
	return writeJSON(w, map[string]any{"bytes": s.tempSize()})
}

// ---------- automatic backups ----------

const keepBackups = 4

func (s *Server) backupDir() string { return filepath.Join(s.Cfg.DataDir, "backups") }

func (s *Server) backupInfo(w http.ResponseWriter, r *http.Request) error {
	last, _ := strconv.ParseInt(s.Store.Setting("lastBackup", "0"), 10, 64)
	return writeJSON(w, map[string]any{"last": last, "dir": s.backupDir(), "auto": s.Store.Setting("autoBackup", "") == "1"})
}

func (s *Server) markBackup() {
	_ = s.Store.SetSetting("lastBackup", strconv.FormatInt(time.Now().Unix(), 10))
}

// RunBackups writes a weekly copy of the database to <data>/backups while
// the "autoBackup" setting is on, keeping the last few.
func (s *Server) RunBackups(ctx context.Context) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		if s.Store.Setting("autoBackup", "") == "1" {
			last, _ := strconv.ParseInt(s.Store.Setting("lastAutoBackup", "0"), 10, 64)
			if time.Since(time.Unix(last, 0)) > 7*24*time.Hour {
				if err := s.autoBackup(); err != nil {
					log.Printf("backup: %v", err)
				}
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func (s *Server) autoBackup() error {
	dir := s.backupDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	dst := filepath.Join(dir, "rivo-"+time.Now().Format("2006-01-02")+".db")
	_ = os.Remove(dst)
	if err := s.Store.Backup(dst); err != nil {
		return err
	}
	now := strconv.FormatInt(time.Now().Unix(), 10)
	_ = s.Store.SetSetting("lastAutoBackup", now)
	_ = s.Store.SetSetting("lastBackup", now)
	entries, _ := os.ReadDir(dir)
	var old []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "rivo-") && strings.HasSuffix(e.Name(), ".db") {
			old = append(old, e.Name())
		}
	}
	sort.Strings(old)
	for len(old) > keepBackups {
		_ = os.Remove(filepath.Join(dir, old[0]))
		old = old[1:]
	}
	return nil
}
