package delivery

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"
)

// The OpenAPI contract declares these five changeset properties as required
// arrays, so null is never a valid value for any of them.
var changesetJSONArrayFields = []string{"revisions", "evaluations", "evidence", "reviews", "audit"}

func changesetJSONObject(t *testing.T, raw []byte) map[string]any {
	t.Helper()
	var object map[string]any
	if err := json.Unmarshal(raw, &object); err != nil {
		t.Fatalf("decode %s: %v", raw, err)
	}
	return object
}

// requireChangesetJSONArrays fails for every field that is not a real JSON
// array (null and absent both fail) or that has the wrong number of elements.
// wantLengths follows the order of changesetJSONArrayFields.
func requireChangesetJSONArrays(t *testing.T, object map[string]any, wantLengths [5]int) {
	t.Helper()
	for i, field := range changesetJSONArrayFields {
		value, present := object[field]
		if !present {
			t.Errorf("%s: key is absent, want a JSON array", field)
			continue
		}
		array, ok := value.([]any)
		if !ok {
			t.Errorf("%s: got %T(%v), want a JSON array", field, value, value)
			continue
		}
		if len(array) != wantLengths[i] {
			t.Errorf("%s: got %d elements, want %d", field, len(array), wantLengths[i])
		}
	}
}

func changesetJSONPopulated(t *testing.T) *Changeset {
	t.Helper()
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	changeset, err := NewChangeset("cs-full", "org/repo", "Ship <feature> & more", "author", now)
	if err != nil {
		t.Fatal(err)
	}
	steps := []error{
		changeset.AddGitRevision("rev-1", "feature", "0123456789012345678901234567890123456789", "abcdefabcdefabcdefabcdefabcdefabcdefabcd", "author", now),
		changeset.RecordEvaluationAgainstBase("eval-1", "rev-1", "base-sha", EvaluationPassed, "all checks passed", "worker", now),
		changeset.AttachEvidenceArtifact("ev-1", "rev-1", "eval-1", "evaluation-report", "artifact://sha256/abc", "abc123", 42, "worker", now),
		changeset.AssignReview("review-1", "rev-1", "reviewer", "author", "please verify", now),
		changeset.DecideReview("review-1", true, "reviewer", "approved", now),
		changeset.CompleteMerge("merge-1", "maintainer", "main", "deadbeef", now),
	}
	for i, err := range steps {
		if err != nil {
			t.Fatalf("lifecycle step %d: %v", i+1, err)
		}
	}
	return changeset
}

// State exactly as the pre-fix code persisted it for a changeset without
// revisions, evaluations, evidence or reviews: four nulls and the creation event.
const changesetJSONLegacyState = `{"id":"cs-legacy","created_by":"author","repository":"org/repo","title":"Legacy","revisions":null,"evaluations":null,"evidence":null,"reviews":null,"audit":[{"sequence":1,"actor":"author","operation":"changeset.created","target_id":"cs-legacy","outcome":"succeeded","at":"2026-11-17T10:00:00Z"}]}`

func TestChangesetJSONFreshChangesetHasEmptyArrays(t *testing.T) {
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	changeset, err := NewChangeset("cs-fresh", "org/repo", "Fresh", "author", now)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(changeset)
	if err != nil {
		t.Fatal(err)
	}
	object := changesetJSONObject(t, raw)
	// NewChangeset records the creation event, so audit holds exactly that one event.
	requireChangesetJSONArrays(t, object, [5]int{0, 0, 0, 0, 1})
	if merge, present := object["merge"]; present {
		t.Errorf("merge: key must stay omitted until a merge exists, got %v", merge)
	}
}

func TestChangesetJSONLegacyNullArraysRemarshalAsEmptyArrays(t *testing.T) {
	cases := []struct {
		name       string
		state      string
		wantAudits int
	}{
		{"four null arrays and the creation event, as persisted before the fix", changesetJSONLegacyState, 1},
		{"every array null", `{"id":"cs-legacy","created_by":"author","repository":"org/repo","title":"Legacy","revisions":null,"evaluations":null,"evidence":null,"reviews":null,"audit":null}`, 0},
		{"every array key absent", `{"id":"cs-legacy","created_by":"author","repository":"org/repo","title":"Legacy"}`, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var changeset Changeset
			if err := json.Unmarshal([]byte(tc.state), &changeset); err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(&changeset)
			if err != nil {
				t.Fatal(err)
			}
			requireChangesetJSONArrays(t, changesetJSONObject(t, raw), [5]int{0, 0, 0, 0, tc.wantAudits})
		})
	}
}

func TestChangesetJSONPointerAndValueMarshalIdentically(t *testing.T) {
	now := time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)
	changeset, err := NewChangeset("cs-receiver", "org/repo", "Receiver", "author", now)
	if err != nil {
		t.Fatal(err)
	}
	byPointer, err := json.Marshal(changeset)
	if err != nil {
		t.Fatal(err)
	}
	// A value passed to Marshal is not addressable, so only a value receiver
	// makes it use the same encoding as the pointer.
	byValue, err := json.Marshal(*changeset)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(byPointer, byValue) {
		t.Errorf("pointer and value encodings differ:\n pointer: %s\n value:   %s", byPointer, byValue)
	}
	requireChangesetJSONArrays(t, changesetJSONObject(t, byValue), [5]int{0, 0, 0, 0, 1})
}

// Guards that the fix changes nothing for changesets that already serialize
// correctly: field order, omitempty fields, HTML escaping and timestamps.
func TestChangesetJSONPopulatedChangesetIsUnchanged(t *testing.T) {
	const at = `"2026-11-17T10:00:00Z"`
	want := `{"id":"cs-full","created_by":"author","repository":"org/repo","title":"Ship \u003cfeature\u003e \u0026 more",` +
		`"revisions":[{"id":"rev-1","ref":"feature","commit_sha":"0123456789012345678901234567890123456789","parent_sha":"abcdefabcdefabcdefabcdefabcdefabcdefabcd","created_at":` + at + `}],` +
		`"evaluations":[{"id":"eval-1","revision_id":"rev-1","base_sha":"base-sha","status":"passed","summary":"all checks passed","created_at":` + at + `}],` +
		`"evidence":[{"id":"ev-1","revision_id":"rev-1","evaluation_id":"eval-1","kind":"evaluation-report","uri":"artifact://sha256/abc","sha256":"abc123","size":42,"status":"active","created_at":` + at + `}],` +
		`"reviews":[{"id":"review-1","revision_id":"rev-1","reviewer":"reviewer","status":"approved","comment":"approved","created_at":` + at + `}],` +
		`"merge":{"id":"merge-1","revision_id":"rev-1","actor":"maintainer","target_ref":"main","commit_sha":"deadbeef","created_at":` + at + `},` +
		`"audit":[` +
		`{"sequence":1,"actor":"author","operation":"changeset.created","target_id":"cs-full","outcome":"succeeded","at":` + at + `},` +
		`{"sequence":2,"actor":"author","operation":"revision.created","target_id":"rev-1","outcome":"succeeded","at":` + at + `},` +
		`{"sequence":3,"actor":"worker","operation":"evaluation.recorded","target_id":"eval-1","outcome":"succeeded","at":` + at + `},` +
		`{"sequence":4,"actor":"worker","operation":"evidence.attached","target_id":"ev-1","outcome":"succeeded","at":` + at + `},` +
		`{"sequence":5,"actor":"author","operation":"review.assigned","target_id":"review-1","outcome":"succeeded","at":` + at + `},` +
		`{"sequence":6,"actor":"reviewer","operation":"review.decided","target_id":"review-1","outcome":"approved","at":` + at + `},` +
		`{"sequence":7,"actor":"maintainer","operation":"merge.completed","target_id":"merge-1","outcome":"succeeded","at":` + at + `}` +
		`]}`
	got, err := json.Marshal(changesetJSONPopulated(t))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != want {
		t.Errorf("populated changeset encoding changed:\n got:  %s\n want: %s", got, want)
	}
}

func TestChangesetJSONRoundTripIsStable(t *testing.T) {
	var legacy Changeset
	if err := json.Unmarshal([]byte(changesetJSONLegacyState), &legacy); err != nil {
		t.Fatal(err)
	}
	fresh, err := NewChangeset("cs-fresh", "org/repo", "Fresh", "author", time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]*Changeset{"fresh": fresh, "legacy": &legacy, "populated": changesetJSONPopulated(t)}
	for name, changeset := range cases {
		t.Run(name, func(t *testing.T) {
			first, err := json.Marshal(changeset)
			if err != nil {
				t.Fatal(err)
			}
			var decoded Changeset
			if err := json.Unmarshal(first, &decoded); err != nil {
				t.Fatal(err)
			}
			second, err := json.Marshal(&decoded)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(first, second) {
				t.Errorf("round trip changed the encoding:\n first:  %s\n second: %s", first, second)
			}
		})
	}
}
