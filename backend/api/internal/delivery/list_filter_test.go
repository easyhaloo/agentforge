package delivery

import (
	"slices"
	"testing"
	"time"
)

var listFilterEpoch = time.Date(2026, 11, 17, 10, 0, 0, 0, time.UTC)

type listFilterSpec struct {
	id         ID
	repository string
	title      string
	author     string
	stage      Lifecycle
	reviewer   string
	age        time.Duration // UpdatedAt is listFilterEpoch + age
}

// listFilterSpecs has at least one changeset per lifecycle state, a repository that only
// prefix-matches another, and a pair with identical timestamps. Ages deliberately disagree
// with id order, so sorting by id alone cannot satisfy the ordering tests.
func listFilterSpecs() []listFilterSpec {
	return []listFilterSpec{
		{id: "cs-01", repository: "org/api", title: "Add login", author: "alice", stage: LifecycleInReview, reviewer: "rita", age: 3 * time.Minute},
		{id: "cs-02", repository: "org/api", title: "Fix cache", author: "bob", stage: LifecycleReadyToMerge, reviewer: "rita", age: 9 * time.Minute},
		{id: "cs-03", repository: "org/web", title: "Refactor table", author: "alice", stage: LifecycleInReview, reviewer: "sam", age: 6 * time.Minute},
		{id: "cs-04", repository: "org/web", title: "Docs", author: "carol", stage: LifecycleDraft, age: 1 * time.Minute},
		{id: "cs-05", repository: "org/api", title: "Rename package", author: "bob", stage: LifecycleMerged, reviewer: "sam", age: 8 * time.Minute},
		{id: "cs-06", repository: "org/api", title: "Flaky checks", author: "alice", stage: LifecycleEvaluationFailed, age: 5 * time.Minute},
		{id: "cs-07", repository: "org/web", title: "Needs rework", author: "dave", stage: LifecycleChangesRequested, reviewer: "rita", age: 2 * time.Minute},
		{id: "cs-08", repository: "org/api", title: "Await evidence", author: "erin", stage: LifecycleEvidenceRequired, age: 7 * time.Minute},
		{id: "cs-09", repository: "org/web", title: "Await reviewer", author: "erin", stage: LifecycleReviewRequired, age: 4 * time.Minute},
		{id: "cs-10", repository: "org/api-v2", title: "Exact repo only", author: "frank", stage: LifecycleEvaluationPending},
		{id: "cs-11", repository: "org/web", title: "Tie breaker", author: "frank", stage: LifecycleEvaluationPending},
	}
}

// listFilterOrder is the expected order of every fixture: updated_at DESC, then id ASC.
var listFilterOrder = []ID{"cs-02", "cs-05", "cs-08", "cs-03", "cs-06", "cs-09", "cs-01", "cs-07", "cs-04", "cs-10", "cs-11"}

// listFilterNewestFirst puts ids in the order FilterAndPage must return them.
func listFilterNewestFirst(ids ...ID) []ID {
	ordered := slices.Clone(ids)
	slices.SortFunc(ordered, func(a, b ID) int { return slices.Index(listFilterOrder, a) - slices.Index(listFilterOrder, b) })
	return ordered
}

func listFilterMust(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// listFilterAdvance replays real domain transitions up to spec.stage, so a fixture can never
// describe a state the domain would reject.
func listFilterAdvance(t *testing.T, c *Changeset, spec listFilterSpec) {
	t.Helper()
	const sha = "0123456789012345678901234567890123456789"
	now := listFilterEpoch
	if spec.stage == LifecycleDraft {
		return
	}
	listFilterMust(t, c.AddGitRevision("rev-1", "feature", sha, "base", spec.author, now))
	if spec.stage == LifecycleEvaluationPending {
		return
	}
	if spec.stage == LifecycleEvaluationFailed {
		listFilterMust(t, c.RecordEvaluation("eval-1", "rev-1", EvaluationFailed, "", "worker", now))
		return
	}
	listFilterMust(t, c.RecordEvaluation("eval-1", "rev-1", EvaluationPassed, "", "worker", now))
	if spec.stage == LifecycleEvidenceRequired {
		return
	}
	listFilterMust(t, c.AttachEvidence("ev-1", "rev-1", "eval-1", "report", "artifact://sha256", "worker", now))
	if spec.stage == LifecycleReviewRequired {
		return
	}
	listFilterMust(t, c.AssignReview("review-1", "rev-1", spec.reviewer, spec.author, "", now))
	if spec.stage == LifecycleInReview {
		return
	}
	listFilterMust(t, c.DecideReview("review-1", spec.stage != LifecycleChangesRequested, spec.reviewer, "", now))
	if spec.stage == LifecycleMerged {
		listFilterMust(t, c.CompleteMerge("merge-1", "maintainer", "main", sha, now))
	}
}

func listFilterStored(t *testing.T, spec listFilterSpec) StoredChangeset {
	t.Helper()
	c, err := NewChangeset(spec.id, spec.repository, spec.title, spec.author, listFilterEpoch)
	listFilterMust(t, err)
	listFilterAdvance(t, c, spec)
	if got := c.Lifecycle(); got != spec.stage {
		t.Fatalf("fixture %s is %q, want %q", spec.id, got, spec.stage)
	}
	updated := listFilterEpoch.Add(spec.age)
	return StoredChangeset{Changeset: c, Version: 1, CreatedAt: updated, UpdatedAt: updated}
}

func listFilterFixtures(t *testing.T) []StoredChangeset {
	t.Helper()
	var stored []StoredChangeset
	for _, spec := range listFilterSpecs() {
		stored = append(stored, listFilterStored(t, spec))
	}
	return stored
}

func listFilterIDs(items []StoredChangeset) []ID {
	ids := make([]ID, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.Changeset.ID)
	}
	return ids
}

// listFilterRun calls FilterAndPage and enforces the contract every caller relies on.
func listFilterRun(t *testing.T, items []StoredChangeset, filter ListFilter, limit, offset int) ([]StoredChangeset, int) {
	t.Helper()
	got, total := FilterAndPage(items, filter, limit, offset)
	if got == nil {
		t.Fatal("items must be an empty slice, not nil, so the API encodes []")
	}
	if total < len(got) || total > len(items) {
		t.Fatalf("total=%d must lie within [%d, %d]", total, len(got), len(items))
	}
	if limit >= 0 && len(got) > limit {
		t.Fatalf("%d items exceed limit %d", len(got), limit)
	}
	return got, total
}

func TestFilterAndPageWithoutFilterReturnsEverythingNewestFirst(t *testing.T) {
	reversed := listFilterFixtures(t)
	slices.Reverse(reversed)
	got, total := listFilterRun(t, reversed, ListFilter{}, 100, 0)
	if total != len(listFilterOrder) || !slices.Equal(listFilterIDs(got), listFilterOrder) {
		t.Fatalf("got %v total=%d, want %v total=%d", listFilterIDs(got), total, listFilterOrder, len(listFilterOrder))
	}
}

func TestFilterAndPageDoesNotReorderItsInput(t *testing.T) {
	input := listFilterFixtures(t)
	before := listFilterIDs(input)
	listFilterRun(t, input, ListFilter{}, 100, 0)
	if after := listFilterIDs(input); !slices.Equal(before, after) {
		t.Fatalf("input order changed from %v to %v", before, after)
	}
}

func TestFilterAndPageRepositoryIsAnExactMatch(t *testing.T) {
	cases := []struct {
		repository string
		want       []ID
	}{
		{"org/api", []ID{"cs-01", "cs-02", "cs-05", "cs-06", "cs-08"}},
		{"org/api-v2", []ID{"cs-10"}},
		{"org/web", []ID{"cs-03", "cs-04", "cs-07", "cs-09", "cs-11"}},
		{"org/ap", nil},
		{"ORG/API", nil},
		{"unknown/repo", nil},
	}
	for _, tc := range cases {
		t.Run(tc.repository, func(t *testing.T) {
			got, total := listFilterRun(t, listFilterFixtures(t), ListFilter{Repository: tc.repository}, 100, 0)
			want := listFilterNewestFirst(tc.want...)
			if total != len(want) || !slices.Equal(listFilterIDs(got), want) {
				t.Fatalf("got %v total=%d, want %v", listFilterIDs(got), total, want)
			}
		})
	}
}

func TestFilterAndPageStatusMatchesEveryLifecycleState(t *testing.T) {
	for _, stage := range []Lifecycle{
		LifecycleDraft, LifecycleEvaluationPending, LifecycleEvaluationFailed, LifecycleEvidenceRequired, LifecycleReviewRequired,
		LifecycleInReview, LifecycleChangesRequested, LifecycleReadyToMerge, LifecycleMerged,
	} {
		t.Run(string(stage), func(t *testing.T) {
			var declared []ID
			for _, spec := range listFilterSpecs() {
				if spec.stage == stage {
					declared = append(declared, spec.id)
				}
			}
			if len(declared) == 0 {
				t.Fatalf("fixtures have no %s changeset", stage)
			}
			got, total := listFilterRun(t, listFilterFixtures(t), ListFilter{Status: stage}, 100, 0)
			want := listFilterNewestFirst(declared...)
			if total != len(want) || !slices.Equal(listFilterIDs(got), want) {
				t.Fatalf("got %v total=%d, want %v", listFilterIDs(got), total, want)
			}
		})
	}
}

func TestFilterAndPageReviewerMatchesAssignedReviewsOfAnyDecision(t *testing.T) {
	cases := []struct {
		reviewer string
		want     []ID
	}{
		{"rita", []ID{"cs-01", "cs-02", "cs-07"}}, // pending, approved and rejected all count
		{"sam", []ID{"cs-03", "cs-05"}},
		{"rit", nil},  // user ids are matched exactly, not by prefix
		{"RITA", nil}, // and case-sensitively
		{"nobody", nil},
	}
	for _, tc := range cases {
		t.Run(tc.reviewer, func(t *testing.T) {
			got, total := listFilterRun(t, listFilterFixtures(t), ListFilter{Reviewer: tc.reviewer}, 100, 0)
			want := listFilterNewestFirst(tc.want...)
			if total != len(want) || !slices.Equal(listFilterIDs(got), want) {
				t.Fatalf("got %v total=%d, want %v", listFilterIDs(got), total, want)
			}
		})
	}
}

func TestFilterAndPageReviewerOnlyMatchesReviewsOfTheCurrentRevision(t *testing.T) {
	const sha = "0123456789012345678901234567890123456789"
	now := listFilterEpoch
	item := listFilterStored(t, listFilterSpec{id: "cs-stale", repository: "org/api", title: "Stale review", author: "gina", stage: LifecycleInReview, reviewer: "rita"})
	c := item.Changeset
	matches := func(reviewer string) bool {
		t.Helper()
		got, total := listFilterRun(t, []StoredChangeset{item}, ListFilter{Reviewer: reviewer}, 10, 0)
		if total != len(got) {
			t.Fatalf("total=%d but %d items", total, len(got))
		}
		return total == 1
	}
	if !matches("rita") {
		t.Fatal("rita has a pending review on the current revision and must match")
	}

	listFilterMust(t, c.AddGitRevision("rev-2", "feature", sha, "base", "gina", now))
	if matches("rita") {
		t.Fatal("a review of an older revision is stale and must not match")
	}

	listFilterMust(t, c.RecordEvaluation("eval-2", "rev-2", EvaluationPassed, "", "worker", now))
	listFilterMust(t, c.AttachEvidence("ev-2", "rev-2", "eval-2", "report", "artifact://sha256", "worker", now))
	listFilterMust(t, c.AssignReview("review-2", "rev-2", "sam", "gina", "", now))
	if matches("rita") || !matches("sam") {
		t.Fatal("only the reviewer assigned on the current revision must match")
	}

	listFilterMust(t, c.AssignReview("review-3", "rev-2", "rita", "gina", "", now))
	if !matches("rita") {
		t.Fatal("rita must match again once assigned on the current revision")
	}
}

func TestFilterAndPageQueryIsACaseInsensitiveSubstringOverFourFields(t *testing.T) {
	cases := []struct {
		name  string
		query string
		want  []ID
	}{
		{"id", "CS-04", []ID{"cs-04"}},
		{"title", "REFACTOR", []ID{"cs-03"}},
		{"title substring", "ache", []ID{"cs-02"}},
		{"repository", "api-V2", []ID{"cs-10"}},
		{"repository shared by several", "ORG/WEB", []ID{"cs-03", "cs-04", "cs-07", "cs-09", "cs-11"}},
		{"created_by", "DAVE", []ID{"cs-07"}},
		{"created_by shared by several", "erin", []ID{"cs-08", "cs-09"}},
		{"surrounding whitespace is ignored", "  carol ", []ID{"cs-04"}},
		{"blank query is no filter", "   ", listFilterOrder},
		{"reviewers are not searched", "rita", nil},
		{"status labels are not searched", "merged", nil},
		{"no match", "zzz", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, total := listFilterRun(t, listFilterFixtures(t), ListFilter{Query: tc.query}, 100, 0)
			want := listFilterNewestFirst(tc.want...)
			if total != len(want) || !slices.Equal(listFilterIDs(got), want) {
				t.Fatalf("got %v total=%d, want %v", listFilterIDs(got), total, want)
			}
		})
	}
}

func TestFilterAndPageCombinesFiltersWithAnd(t *testing.T) {
	cases := []struct {
		name   string
		filter ListFilter
		want   []ID
	}{
		{"repository and status", ListFilter{Repository: "org/api", Status: LifecycleInReview}, []ID{"cs-01"}},
		{"repository and reviewer", ListFilter{Repository: "org/web", Reviewer: "rita"}, []ID{"cs-07"}},
		{"my pending review queue", ListFilter{Reviewer: "rita", Status: LifecycleInReview}, []ID{"cs-01"}},
		{"another reviewer's pending queue", ListFilter{Reviewer: "sam", Status: LifecycleInReview}, []ID{"cs-03"}},
		{"three filters", ListFilter{Repository: "org/api", Reviewer: "rita", Query: "fix"}, []ID{"cs-02"}},
		{"status and query", ListFilter{Repository: "org/web", Status: LifecycleDraft, Query: "docs"}, []ID{"cs-04"}},
		{"query narrows a repository", ListFilter{Repository: "org/api", Query: "alice"}, []ID{"cs-01", "cs-06"}},
		{"disjoint filters", ListFilter{Reviewer: "rita", Status: LifecycleMerged}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, total := listFilterRun(t, listFilterFixtures(t), tc.filter, 100, 0)
			want := listFilterNewestFirst(tc.want...)
			if total != len(want) || !slices.Equal(listFilterIDs(got), want) {
				t.Fatalf("got %v total=%d, want %v", listFilterIDs(got), total, want)
			}
		})
	}
}

func TestFilterAndPagePaginatesAfterFilteringAndTotalsAllMatches(t *testing.T) {
	cases := []struct {
		name          string
		filter        ListFilter
		limit, offset int
		want          []ID
		wantTotal     int
	}{
		{"first page", ListFilter{}, 3, 0, listFilterOrder[0:3], 11},
		{"middle page", ListFilter{}, 3, 3, listFilterOrder[3:6], 11},
		{"partial last page", ListFilter{}, 3, 9, listFilterOrder[9:11], 11},
		{"offset at the end", ListFilter{}, 3, 11, nil, 11},
		{"offset far beyond the end", ListFilter{}, 3, 100, nil, 11},
		{"limit larger than the result", ListFilter{}, 100, 0, listFilterOrder, 11},
		{"page of a filtered list", ListFilter{Repository: "org/web"}, 2, 2, []ID{"cs-07", "cs-04"}, 5},
		{"total ignores the page size", ListFilter{Reviewer: "rita"}, 1, 0, []ID{"cs-02"}, 3},
		{"offset beyond a filtered list keeps its total", ListFilter{Reviewer: "rita"}, 5, 3, nil, 3},
		{"no match", ListFilter{Query: "zzz"}, 20, 0, nil, 0},
		{"negative limit and offset never panic", ListFilter{}, -1, -5, nil, 11},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, total := listFilterRun(t, listFilterFixtures(t), tc.filter, tc.limit, tc.offset)
			if total != tc.wantTotal || !slices.Equal(listFilterIDs(got), tc.want) {
				t.Fatalf("got %v total=%d, want %v total=%d", listFilterIDs(got), total, tc.want, tc.wantTotal)
			}
		})
	}
}
