package postgres

import (
	"io/fs"
	"regexp"
	"sort"
	"strconv"
	"testing"
)

// duplicateNumberAllowlist lists the historical migration files whose numbers
// collide. Renaming them would make already-deployed environments treat them
// as new migrations and re-run (versions are recorded by full filename in
// schema_migrations). Do not add new entries here.
var duplicateNumberAllowlist = map[string][]string{
	"008": {"008_pipelines.sql", "008_platform_credentials.sql"},
	"009": {"009_pipeline_execution.sql", "009_settings_tables.sql"},
	"019": {"019_pipeline_scripts.sql", "019_user_profile.sql"},
	"027": {"027_issue_attachments.sql", "027_repository_creation.sql"},
	"028": {"028_issue_type.sql", "028_repository_workflows.sql"},
	"029": {"029_repository_workflow_availability.sql", "029_saved_replies.sql"},
	"042": {"042_notification_inbox_preferences.sql", "042_repository_actions_setting.sql"},
	"043": {"043_notification_email.sql", "043_repository_ref_rules.sql"},
	"044": {"044_repository_issues_setting.sql", "044_repository_webhooks.sql"},
	"053": {"053_project_initial_view.sql", "053_repository_suggest_branch_update.sql"},
}

var migrationNameRe = regexp.MustCompile(`^\d{3}_[a-z0-9_]+\.sql$`)

// TestMigrationFileNames verifies embedded migration file naming without a
// database connection. Migrations run in lexicographic filename order (see
// store.go Migrate), so duplicate numbers cause confusing execution order.
func TestMigrationFileNames(t *testing.T) {
	entries, err := fs.ReadDir(migrations, "migrations")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}

	byNumber := make(map[string][]string)
	maxNumber := 0
	for _, e := range entries {
		name := e.Name()
		if !migrationNameRe.MatchString(name) {
			t.Errorf("migration file %q does not match ^\\d{3}_[a-z0-9_]+\\.sql$", name)
			continue
		}
		number := name[:3]
		byNumber[number] = append(byNumber[number], name)
		if n, err := strconv.Atoi(number); err == nil && n > maxNumber {
			maxNumber = n
		}
	}

	fail := func(number string, names []string) {
		t.Errorf("migration number %s is duplicated: %v; next available number is %03d. "+
			"Unreleased migrations must be renumbered (new number = current max + 1); "+
			"already-released migrations must never be renamed, extend the allowlist instead.",
			number, names, maxNumber+1)
	}

	for number, names := range byNumber {
		if len(names) < 2 {
			continue
		}
		sort.Strings(names)
		allowed := duplicateNumberAllowlist[number]
		if len(names) != len(allowed) {
			fail(number, names)
			continue
		}
		for _, n := range names {
			if !containsString(allowed, n) {
				fail(number, names)
				break
			}
		}
	}

	// Allowlist entries must still exist: a renamed/deleted allowlisted
	// migration would re-run in already-deployed environments.
	for number, names := range duplicateNumberAllowlist {
		for _, n := range names {
			if !containsString(byNumber[number], n) {
				t.Errorf("allowlisted migration %q is missing from migrations/; "+
					"if it was renamed, already-deployed environments will re-run it as a new migration", n)
			}
		}
	}
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
