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

func TestNameDuplicates(t *testing.T) {
	// A Blu-ray remux: no track names, several dubs in one language.
	audio := []store.Track{
		{Codec: "ac3", Lang: "rus", Channels: 6, Kbps: 640},
		{Codec: "ac3", Lang: "rus", Channels: 6, Kbps: 448},
		{Codec: "dts", Profile: "DTS-HD MA", Lang: "rus", Channels: 6, Kbps: 3500},
		{Codec: "ac3", Lang: "ukr", Channels: 2, Kbps: 192},
	}
	var out []trackOut
	for i, a := range audio {
		n, m := audioLabel(a, i)
		out = append(out, trackOut{Name: n, Meta: m, kbps: a.Kbps})
	}
	nameDuplicates(out, true)
	want := [][2]string{{"Русский 1", "DD 5.1 · 640 кбит/с"}, {"Русский 2", "DD 5.1 · 448 кбит/с"}, {"Русский 3", "DTS-HD MA 5.1"}, {"Українська", "DD 2.0"}}
	for i, w := range want {
		if out[i].Name != w[0] || out[i].Meta != w[1] || out[i].Label != w[0]+" · "+w[1] {
			t.Errorf("%d: got %q / %q, want %q / %q", i, out[i].Name, out[i].Meta, w[0], w[1])
		}
	}
}
