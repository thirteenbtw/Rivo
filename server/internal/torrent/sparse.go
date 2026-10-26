package torrent

import (
	"context"
	"log"
	"os"
	"path/filepath"

	"github.com/anacrolix/torrent/metainfo"
	"github.com/anacrolix/torrent/storage"
)

// sparseStorage creates each file of a torrent as a sparse file before the
// file storage first writes to it. Streaming fetches the end of a video first
// (the container index), and on NTFS a write far past the end of an ordinary
// file makes Windows zero-fill everything before it: for a 30–60 GB remux
// that took minutes, and every peer connection writing to that file stalled
// meanwhile, so the torrent showed connected seeds and no speed.
type sparseStorage struct {
	storage.ClientImplCloser
	dir string
}

func newStorage(dir string) storage.ClientImplCloser {
	return sparseStorage{storage.NewFileOpts(storage.NewFileClientOpts{ClientBaseDir: dir, FilePathMaker: filePath}), dir}
}

// filePath is anacrolix's default layout, spelled out so the files prepared
// here are the ones the storage writes.
func filePath(o storage.FilePathMakerOpts) string {
	var parts []string
	if o.Info.BestName() != metainfo.NoName {
		parts = append(parts, o.Info.BestName())
	}
	return filepath.Join(append(parts, o.File.BestPath()...)...)
}

func (s sparseStorage) OpenTorrent(ctx context.Context, info *metainfo.Info, ih metainfo.Hash) (storage.TorrentImpl, error) {
	t, err := s.ClientImplCloser.OpenTorrent(ctx, info, ih)
	if err != nil {
		return t, err
	}
	for _, fi := range info.UpvertedFiles() {
		if fi.Length == 0 {
			continue
		}
		p := filepath.Join(s.dir, filePath(storage.FilePathMakerOpts{Info: info, File: &fi}))
		if Blocked(p) {
			continue
		}
		if _, err := os.Stat(p); err == nil {
			continue // already complete
		}
		if err := makeSparse(p+".part", fi.Length); err != nil {
			log.Printf("torrent: sparse %s: %v", p, err)
		}
	}
	return t, nil
}
