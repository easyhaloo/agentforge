package httpserver

import (
	"errors"
	"net/http"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/easyhaloo/agentforge/backend/api/internal/identity"
)

func (d DeliveryDependencies) listSavedReplies(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}
	items, err := d.Settings.ListSavedReplies(r.Context(), userID)
	if err != nil {
		writeSavedReplyError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, struct {
		Items []identity.SavedReply `json:"items"`
	}{Items: items})
}

func (d DeliveryDependencies) writeSavedReply(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}
	var input struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if !decodeJSON(w, r, &input) {
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if !wellFormedText(input.Title) || input.Title == "" || utf8.RuneCountInString(input.Title) > 100 {
		writeProblem(w, http.StatusBadRequest, "Invalid saved reply", "title must contain 1 to 100 Unicode code points and no NUL characters")
		return
	}
	if !wellFormedText(input.Body) || strings.TrimSpace(input.Body) == "" {
		writeProblem(w, http.StatusBadRequest, "Invalid saved reply", "body must be non-blank and contain no NUL characters")
		return
	}
	units := 0
	for _, ch := range input.Body {
		units += utf16.RuneLen(ch)
		if units > 16384 {
			writeProblem(w, http.StatusBadRequest, "Invalid saved reply", "body must not exceed 16384 UTF-16 code units")
			return
		}
	}

	status := http.StatusCreated
	var reply identity.SavedReply
	var err error
	if r.Method == http.MethodPatch {
		status = http.StatusOK
		reply, err = d.Settings.UpdateSavedReply(r.Context(), userID, r.PathValue("replyID"), input.Title, input.Body)
	} else {
		reply, err = d.Settings.CreateSavedReply(r.Context(), userID, input.Title, input.Body)
	}
	if err != nil {
		writeSavedReplyError(w, err)
		return
	}
	writeJSON(w, status, reply)
}

func (d DeliveryDependencies) deleteSavedReply(w http.ResponseWriter, r *http.Request) {
	userID, ok := d.authenticateUser(w, r)
	if !ok {
		return
	}
	if err := d.Settings.DeleteSavedReply(r.Context(), userID, r.PathValue("replyID")); err != nil {
		writeSavedReplyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeSavedReplyError(w http.ResponseWriter, err error) {
	if errors.Is(err, identity.ErrSavedReplyNotFound) {
		writeProblem(w, http.StatusNotFound, "Saved reply not found", "No saved reply exists with this ID for the current account")
		return
	}
	writeProblem(w, http.StatusInternalServerError, "Saved reply request failed", "The saved reply operation could not be completed")
}
