package identity

import "errors"

var ErrSavedReplyNotFound = errors.New("saved reply not found")

type SavedReply struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Body  string `json:"body"`
}
