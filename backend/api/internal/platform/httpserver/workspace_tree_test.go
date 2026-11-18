package httpserver

import (
	"errors"
	"reflect"
	"testing"

	"github.com/easyhaloo/agentforge/backend/api/internal/delivery"
	"github.com/easyhaloo/agentforge/backend/api/internal/workspace"
)

func TestMergeWorkspaceTreeEntriesCombinesPinnedBaseAndOverlay(t *testing.T) {
	base := []delivery.PreviewEntry{
		{Name: "README.md", Path: "README.md", Kind: "file"},
		{Name: "src", Path: "src", Kind: "tree"},
	}
	overlays := []workspace.FileEntry{
		{Path: "README.md", Version: 2},
		{Path: "src/main.go", Version: 1},
		{Path: "notes/todo.txt", Version: 1},
	}

	got, err := mergeWorkspaceTreeEntries(base, overlays, "")
	if err != nil {
		t.Fatalf("mergeWorkspaceTreeEntries() error = %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("got %d entries, want 3: %#v", len(got), got)
	}
	wantNames := []string{"README.md", "notes", "src"}
	gotNames := []string{got[0].Name, got[1].Name, got[2].Name}
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("entry order = %#v, want %#v", gotNames, wantNames)
	}
	if got[0].Source != "workspace" || got[0].Version != 2 {
		t.Fatalf("overridden file = %#v, want workspace version 2", got[0])
	}
	if got[2].Kind != "tree" || got[2].Source != "workspace" {
		t.Fatalf("edited directory = %#v, want workspace tree", got[2])
	}
}

func TestMergeWorkspaceTreeEntriesScopesDirectory(t *testing.T) {
	base := []delivery.PreviewEntry{{Name: "nested.txt", Path: "docs/nested.txt", Kind: "file"}}
	overlays := []workspace.FileEntry{
		{Path: "README.md", Version: 1},
		{Path: "docs/new.md", Version: 3},
		{Path: "docs/sub/page.md", Version: 1},
	}
	got, err := mergeWorkspaceTreeEntries(base, overlays, "docs")
	if err != nil {
		t.Fatalf("mergeWorkspaceTreeEntries() error = %v", err)
	}
	if len(got) != 3 || got[1].Name != "new.md" || got[2].Name != "sub" {
		t.Fatalf("directory entries = %#v, want nested.txt, new.md, sub", got)
	}
}

func TestMergeWorkspaceTreeEntriesRejectsFileDirectoryCollisions(t *testing.T) {
	tests := []struct {
		name     string
		base     []delivery.PreviewEntry
		overlays []workspace.FileEntry
	}{
		{
			name: "base file replaced by directory",
			base: []delivery.PreviewEntry{{Name: "config", Path: "config", Kind: "file"}},
			overlays: []workspace.FileEntry{{Path: "config/settings.json", Version: 1}},
		},
		{
			name: "base directory replaced by file",
			base: []delivery.PreviewEntry{{Name: "config", Path: "config", Kind: "tree"}},
			overlays: []workspace.FileEntry{{Path: "config", Version: 1}},
		},
		{
			name: "overlay file and child",
			overlays: []workspace.FileEntry{
				{Path: "config", Version: 1},
				{Path: "config/settings.json", Version: 1},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := mergeWorkspaceTreeEntries(tt.base, tt.overlays, "")
			if !errors.Is(err, workspace.ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestMergeWorkspaceTreeEntriesRejectsDuplicateBaseNames(t *testing.T) {
	_, err := mergeWorkspaceTreeEntries([]delivery.PreviewEntry{
		{Name: "same", Path: "same", Kind: "file"},
		{Name: "same", Path: "same", Kind: "file"},
	}, nil, "")
	if !errors.Is(err, workspace.ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestMergeWorkspaceTreeEntriesPreservesSubmodules(t *testing.T) {
	got, err := mergeWorkspaceTreeEntries([]delivery.PreviewEntry{
		{Name: "vendor", Path: "vendor", Kind: "commit"},
	}, nil, "")
	if err != nil {
		t.Fatalf("mergeWorkspaceTreeEntries() error = %v", err)
	}
	if len(got) != 1 || got[0].Kind != "commit" {
		t.Fatalf("entries = %#v, want the git submodule entry preserved", got)
	}
}
