package workspace

import "context"

type Repository interface {
	CreateWorkspace(context.Context, Workspace) (Workspace, error)
	GetWorkspace(context.Context, string, string) (Workspace, error)
	GetWorkspaceFile(context.Context, string, string, string) (File, error)
	PutWorkspaceFile(context.Context, string, File, int64) (File, error)
	ListWorkspaceFiles(context.Context, string, string) ([]FileEntry, error)
}

type FileEntry struct {
	Path      string `json:"path"`
	SHA256    string `json:"sha256"`
	Version   int64  `json:"version"`
	UpdatedBy string `json:"updated_by"`
	UpdatedAt string `json:"updated_at"`
}
