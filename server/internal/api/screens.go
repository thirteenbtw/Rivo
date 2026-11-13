package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/thirteenbtw/homecinema/server/internal/remote"
)

func (s *Server) listScreens(w http.ResponseWriter, r *http.Request) error {
	return writeJSON(w, s.screens.List())
}

func readRaw(r *http.Request) (json.RawMessage, error) {
	defer r.Body.Close()
	b, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 64<<10))
	if err != nil {
		return nil, badRequest("слишком большой запрос")
	}
	if !json.Valid(b) {
		return nil, badRequest("неверный JSON")
	}
	return b, nil
}

func screenErr(err error) error {
	if errors.Is(err, remote.ErrNoScreen) {
		return notFound(err.Error())
	}
	if err != nil {
		return httpError{http.StatusServiceUnavailable, err.Error()}
	}
	return nil
}

func (s *Server) screenState(w http.ResponseWriter, r *http.Request) error {
	b, err := readRaw(r)
	if err != nil {
		return err
	}
	if err := screenErr(s.screens.SetState(r.PathValue("id"), b)); err != nil {
		return err
	}
	return writeJSON(w, map[string]bool{"ok": true})
}

func (s *Server) screenCommand(w http.ResponseWriter, r *http.Request) error {
	b, err := readRaw(r)
	if err != nil {
		return err
	}
	var c struct {
		Cmd string `json:"cmd"`
	}
	if json.Unmarshal(b, &c) != nil || c.Cmd == "" {
		return badRequest("нет команды")
	}
	if err := screenErr(s.screens.Send(r.PathValue("id"), b)); err != nil {
		return err
	}
	return writeJSON(w, map[string]bool{"ok": true})
}
