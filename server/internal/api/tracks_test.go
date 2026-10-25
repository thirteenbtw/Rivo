package api

import (
	"testing"

	"github.com/thirteenbtw/homecinema/server/internal/store"
)

func TestTrackLabels(t *testing.T) {
	audio := []struct {
		t          store.Track
		name, meta string
	}{
		{store.Track{Codec: "ac3", Lang: "rus", Title: "Дубляж, Пифагор", Channels: 6}, "Дубляж, Пифагор", "Русский · DD 5.1"},
		{store.Track{Codec: "aac", Lang: "eng", Channels: 2}, "English", "AAC 2.0"},
		{store.Track{Codec: "aac", Lang: "rus", Title: "Rus", Channels: 2}, "Русский", "AAC 2.0"},
		{store.Track{Codec: "eac3", Lang: "und", Title: "MVO LostFilm (Rus)", Channels: 6}, "MVO LostFilm (Rus)", "Русский · DD+ 5.1"},
		{store.Track{Codec: "aac", Lang: "eng", Title: "Director", Channels: 2, Comment: true}, "Director", "English · AAC 2.0 · комментарии"},
		{store.Track{Codec: "dts", Lang: "tur"}, "Türkçe", "DTS"},
		{store.Track{Codec: "aac", Lang: "und"}, "Дорожка 2", "AAC"},
	}
	for _, c := range audio {
		if n, m := audioLabel(c.t, 1); n != c.name || m != c.meta {
			t.Errorf("audio %+v: got %q / %q, want %q / %q", c.t, n, m, c.name, c.meta)
		}
	}
	subs := []struct {
		t          store.Track
		name, meta string
	}{
		{store.Track{Codec: "subrip", Lang: "rus", Forced: true}, "Русский", "только надписи · SRT · встроенные"},
		{store.Track{Codec: "subrip", Lang: "rus", Title: "Forced", Forced: true}, "Только надписи", "Русский · SRT · встроенные"},
		{store.Track{Codec: "subrip", Lang: "eng", Title: "SDH", SDH: true}, "Для глухих", "English · SRT · встроенные"},
		{store.Track{Codec: "hdmv_pgs_subtitle", Lang: "eng", SDH: true}, "English", "для глухих · PGS · встроенные"},
		{store.Track{Codec: "ass", Lang: "rus", Title: "Полные", External: "/x.ass"}, "Полные", "Русский · ASS · внешние"},
		{store.Track{Codec: "srt", External: "/x.srt"}, "Субтитры 1", "SRT · внешние"},
	}
	for _, c := range subs {
		if n, m := subLabel(c.t, 0); n != c.name || m != c.meta {
			t.Errorf("sub %+v: got %q / %q, want %q / %q", c.t, n, m, c.name, c.meta)
		}
	}
}
