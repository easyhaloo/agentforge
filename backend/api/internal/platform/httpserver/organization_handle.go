package httpserver

import "strings"

// principalNamedBy reports whether handle, the organization segment of the request path, names the
// principal's organization: the canonical id exactly, or its slug ignoring ASCII case. These are the
// same rules as Store.ResolvePrincipal; the handler re-checks them so that a resolver bug can never
// serve another tenant's data.
func principalNamedBy(principal Principal, handle string) bool {
	id := strings.TrimSpace(principal.OrganizationID)
	if id == "" {
		return false
	}
	if handle == id {
		return true
	}
	slug := strings.TrimSpace(principal.OrganizationSlug)
	return slug != "" && equalASCIIFold(handle, slug)
}

// equalASCIIFold compares byte for byte after lowering A-Z only. strings.EqualFold would also fold
// non-ASCII letters (the Kelvin sign equals "k"), which the resolver does not.
func equalASCIIFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		x, y := a[i], b[i]
		if 'A' <= x && x <= 'Z' {
			x += 'a' - 'A'
		}
		if 'A' <= y && y <= 'Z' {
			y += 'a' - 'A'
		}
		if x != y {
			return false
		}
	}
	return true
}
