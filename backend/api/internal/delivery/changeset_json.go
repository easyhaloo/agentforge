package delivery

import "encoding/json"

// MarshalJSON always encodes revisions, evaluations, evidence, reviews and audit
// as arrays, as the OpenAPI contract requires; nil slices would otherwise become
// null. It sits on the domain type so every encoding path is covered: HTTP
// responses, the JSONB state written by the store, and legacy rows whose stored
// state already holds null. The value receiver applies to both Changeset and
// *Changeset, and c is a copy, so the caller's slices are never modified.
func (c Changeset) MarshalJSON() ([]byte, error) {
	type plain Changeset // a defined type has no methods, so this does not recurse
	if c.Revisions == nil {
		c.Revisions = []Revision{}
	}
	if c.Evaluations == nil {
		c.Evaluations = []Evaluation{}
	}
	if c.Evidence == nil {
		c.Evidence = []Evidence{}
	}
	if c.Reviews == nil {
		c.Reviews = []Review{}
	}
	if c.Audit == nil {
		c.Audit = []AuditEvent{}
	}
	if c.PullRequest != nil && c.PullRequest.Comments == nil {
		c.PullRequest.Comments = []PRComment{}
	}
	return json.Marshal(plain(c))
}
