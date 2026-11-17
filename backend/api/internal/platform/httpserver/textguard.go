package httpserver

import (
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

// rejectMalformedText answers 400 for a request whose decoded path, or any decoded query key or
// value, contains U+0000 or is not valid UTF-8. PostgreSQL text can hold neither (SQLSTATE 22021),
// so such input would otherwise surface as a 500 or 503 from whichever query it reaches first.
//
// The check is syntactic and never consults storage, so its answer does not depend on which
// organizations or changesets exist and cannot be used to enumerate them. It wraps the mux only:
// request ID, CORS and CSRF run first and answer as before. JSON request bodies are not inspected.
func rejectMalformedText(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !wellFormedText(r.URL.Path) || !wellFormedQuery(r.URL.Query()) {
			writeProblem(w, http.StatusBadRequest, "Malformed request", "The request path and query must be valid UTF-8 and must not contain NUL characters")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func wellFormedText(value string) bool {
	return strings.IndexByte(value, 0) < 0 && utf8.ValidString(value)
}

func wellFormedQuery(query url.Values) bool {
	for key, values := range query {
		if !wellFormedText(key) {
			return false
		}
		for _, value := range values {
			if !wellFormedText(value) {
				return false
			}
		}
	}
	return true
}
