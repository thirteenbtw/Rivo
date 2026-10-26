package store

import "testing"

// A torrent stream resumes where it was left; finishing it starts it over.
func TestTorrentProgress(t *testing.T) {
	s := openTest(t)
	p, err := s.Profiles()
	if err != nil || len(p) == 0 {
		t.Fatal("no default profile", err)
	}
	pid := p[0].ID
	if got := s.TorrentProgress(pid, "ABC", 0); got != 0 {
		t.Fatalf("empty: %v", got)
	}
	if err := s.SaveTorrentProgress(pid, "ABC", 0, 3600, 7200); err != nil {
		t.Fatal(err)
	}
	if got := s.TorrentProgress(pid, "abc", 0); got != 3600 {
		t.Fatalf("saved: %v", got)
	}
	if got := s.TorrentProgress(pid, "abc", 1); got != 0 {
		t.Fatalf("other file: %v", got)
	}
	_ = s.SaveTorrentProgress(pid, "abc", 0, 7100, 7200)
	if got := s.TorrentProgress(pid, "abc", 0); got != 0 {
		t.Fatalf("finished: %v", got)
	}
	_ = s.SaveTorrentProgress(pid, "abc", 0, 60, 7200)
	_ = s.ForgetTorrentProgress("ABC")
	if got := s.TorrentProgress(pid, "abc", 0); got != 0 {
		t.Fatalf("forgotten: %v", got)
	}
}
